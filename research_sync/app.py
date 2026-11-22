"""Standalone offline CSV inspection/filtering GUI; no device control."""
import json
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import ttk,filedialog,messagebox
from uuid import uuid4
import numpy as np
from .analysis import read_csv,apply_filter,analyze

class AnalysisApp:
    def __init__(self,root):
        self.root=root;root.title('ComBalance オフライン解析');root.geometry('1120x850')
        self.source=None;self.channels=None;self.audit=None;self.advanced=None
        self.signal=tk.StringVar(value='xb');self.kind=tk.StringVar(value='none')
        self.cutoff=tk.StringVar(value='4');self.order=tk.StringVar(value='4');self.zero=tk.BooleanVar(value=True)
        self.start=tk.StringVar(value='10');self.end=tk.StringVar(value='50')
        self.note=tk.StringVar(value='CSVを選択してください。元ファイルは変更しません。')
        top=ttk.Frame(root,padding=12);top.pack(fill='x')
        ttk.Button(top,text='CSVを選ぶ',command=self.load).pack(side='left',padx=4)
        ttk.Button(top,text='COM推定設定を読み込む',command=self.load_config).pack(side='left',padx=4)
        ttk.Button(top,text='条件と結果を新規保存',command=self.save).pack(side='left',padx=4)
        ttk.Label(root,textvariable=self.note,wraplength=1060,padding=10).pack(fill='x')
        options=ttk.Frame(root,padding=10);options.pack(fill='x')
        def entry(label,variable,width=9):
            ttk.Label(options,text=label).pack(side='left',padx=(8,2));ttk.Entry(options,textvariable=variable,width=width).pack(side='left')
        ttk.Label(options,text='列').pack(side='left');self.column=ttk.Combobox(options,textvariable=self.signal,width=12,state='readonly');self.column.pack(side='left')
        ttk.Combobox(options,textvariable=self.kind,values=['none','lowpass','highpass','bandpass'],width=12,state='readonly').pack(side='left',padx=8)
        entry('遮断Hz',self.cutoff,12);entry('次数',self.order,3)
        ttk.Checkbutton(options,text='ゼロ位相（オフライン）',variable=self.zero).pack(side='left',padx=8)
        options2=ttk.Frame(root,padding=10);options2.pack(fill='x')
        for label,var in [('開始秒',self.start),('終了秒',self.end)]:
            ttk.Label(options2,text=label).pack(side='left',padx=4);ttk.Entry(options2,textvariable=var,width=8).pack(side='left')
        ttk.Button(options2,text='グラフを更新',command=self.preview).pack(side='left',padx=12)
        self.metadata=tk.Text(root,height=7,wrap='word',font=('Yu Gothic UI',10));self.metadata.pack(fill='x',padx=12)
        from matplotlib.figure import Figure
        from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg,NavigationToolbar2Tk
        self.figure=Figure(figsize=(10,5),layout='constrained');self.canvas=FigureCanvasTkAgg(self.figure,master=root)
        self.canvas.get_tk_widget().pack(fill='both',expand=True,padx=12)
        NavigationToolbar2Tk(self.canvas,root)
    def load(self):
        name=filedialog.askopenfilename(filetypes=[('ComBalance CSV','*.csv')])
        if not name:return
        try:
            channels,audit=read_csv(name);self.source=Path(name);self.channels=channels;self.audit=audit
            names=[k for k in channels if k!='time_s'];self.column['values']=names
            self.signal.set('xb' if 'xb' in names else names[0]);self.advanced=None
            self.start.set(str(max(0,float(channels['time_s'][0]))));self.end.set(str(float(channels['time_s'][-1])))
            self.metadata.delete('1.0','end');self.metadata.insert('end',json.dumps(dict(source=str(self.source),fs_hz=audit['fs_hz'],samples=audit['samples'],metadata=audit['metadata'],units=audit['units']),ensure_ascii=False,indent=2))
            self.note.set('元CSVを読み込みました。raw列の処理履歴・座標は名称だけでは確定できません。')
            self.preview()
        except Exception as e:messagebox.showerror('読み込みを停止しました',str(e))
    def load_config(self):
        name=filedialog.askopenfilename(filetypes=[('推定設定','*.json')])
        if not name:return
        try:
            p=json.loads(Path(name).read_text(encoding='utf-8'));self.advanced=p
            if p.get('estimation') and not p['estimation'].get('calibration_verified'):self.note.set('未確認の推定設定です。校正・座標等を確認するまでCOM推定は実行できません。')
            else:self.note.set('推定設定を読み込みました。保存時に条件を検証してCOM解析を実行します。')
        except Exception as e:messagebox.showerror('設定エラー',str(e))
    def settings(self):
        p=dict(self.advanced or {});kind=self.kind.get();f=dict(kind=kind)
        if kind!='none':
            values=[float(v.strip()) for v in self.cutoff.get().split(',')]
            if len(values)!=(2 if kind=='bandpass' else 1):raise ValueError('LPF/HPFは1個、BPFはカンマ区切りで2個の遮断周波数を指定してください')
            f.update(cutoff=values if kind=='bandpass' else values[0],order=int(self.order.get()),zero_phase=self.zero.get())
        p.update(filter=f,start_s=float(self.start.get()),end_s=float(self.end.get()),filter_columns=list(dict.fromkeys([self.signal.get(),'xb','axb','xp'])))
        return p
    def preview(self):
        if self.channels is None:return
        try:
            p=self.settings();t=self.channels['time_s'];key=self.signal.get();x=self.channels[key]
            if not t[0]<=p['start_s']<p['end_s']<=t[-1]+1/self.audit['fs_hz']:raise ValueError('解析区間が記録範囲外です')
            y=apply_filter(x,self.audit['fs_hz'],**p['filter']);mask=(t>=p['start_s'])&(t<p['end_s'])
            if mask.sum()<10:raise ValueError('解析区間に10点以上必要です')
            self.figure.clear();axes=self.figure.subplots(3,1)
            axes[0].plot(t[mask],x[mask],label='CSV');axes[0].plot(t[mask],y[mask],label='Filtered',lw=.8)
            axes[0].set(ylabel=key+' ('+self.audit['units'].get(key,'unknown')+')');axes[0].legend()
            if key in ('xb','yb') and self.audit['units'].get(key)=='mm':
                velocity=np.gradient(y*.001,t);acc=np.gradient(velocity,t)
                axes[1].plot(t[mask],velocity[mask]);axes[1].set(ylabel='d(COM)/dt (m/s)')
                axes[2].plot(t[mask],acc[mask]);axes[2].set(ylabel='d²(COM)/dt² (m/s²)',xlabel='Time (s)')
            else:
                f=np.fft.rfftfreq(mask.sum(),1/self.audit['fs_hz'])
                for ax,data,label in zip(axes[1:],[x,y],['CSV spectrum','Filtered spectrum']):
                    amplitude=2*abs(np.fft.rfft(data[mask]-data[mask].mean()))/mask.sum();keep=(f>0)&(f<=2)
                    ax.plot(f[keep],amplitude[keep]);ax.set(xlabel='Frequency (Hz)',ylabel=label)
            self.figure.suptitle('Offline inspection | derivative estimates use vendor COM; not independent force-based validation')
            self.canvas.draw()
        except Exception as e:messagebox.showerror('条件を確認してください',str(e))
    def save(self):
        if self.source is None:return
        parent=filedialog.askdirectory(title='結果の保存先（この中に新しいフォルダを作成）')
        if not parent:return
        try:
            p=self.settings();run=Path(parent)/('analysis-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid4().hex[:6])
            analyze(self.source,run,p);(run/'conditions.json').write_text(json.dumps(p,ensure_ascii=False,indent=2),encoding='utf-8')
            self.preview();self.figure.savefig(run/'inspection.png',dpi=140)
            self.note.set('保存しました: '+str(run))
        except Exception as e:messagebox.showerror('解析を停止しました',str(e))

def main():
    root=tk.Tk();AnalysisApp(root);root.mainloop()

if __name__=='__main__':main()
