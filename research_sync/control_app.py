"""Native PC acquisition console. Starts/stops recording, never runs analysis."""
import asyncio
from datetime import datetime
import json
import os
from pathlib import Path
import queue
import secrets
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk,filedialog,messagebox
import urllib.request
from uuid import uuid4
from websockets.asyncio.client import connect

ROOT=Path(__file__).resolve().parent
VENDOR=Path(r'C:\Program Files (x86)\テック技販\コムバランス制御ソフトウェア')
ADB=Path(r'C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe')
HIDDEN=getattr(subprocess,'CREATE_NO_WINDOW',0)

class ControlApp:
    def __init__(self,root):
        self.root=root;root.title('VR × ComBalance 計測');root.geometry('1060x900');root.minsize(860,600)
        self.events=queue.Queue();self.loop=asyncio.new_event_loop();self.ws=None;self.server_process=None
        self.connecting=False;self.connected=False;self.closing=False;self.last_status=None;self.connection_task=None
        self.reviewed_paths=set();self.review_busy=False;self.named_directory=None
        threading.Thread(target=self.loop.run_forever,daemon=True).start()
        style=ttk.Style(root);style.configure('Title.TLabel',font=('Yu Gothic UI',22,'bold'));style.configure('Card.TLabel',font=('Yu Gothic UI',13))
        frame=ttk.Frame(root,padding=24);frame.pack(fill='both',expand=True)
        ttk.Label(frame,text='VR × ComBalance 計測',style='Title.TLabel').pack(anchor='w')
        ttk.Label(frame,text='中心固定スイープ／10周波数マルチコサイン／予備試験 ｜ USB接続 ｜ CSV保存',padding=(0,7)).pack(anchor='w')
        ttk.Label(frame,text='初回だけQuest Browserで http://localhost:8443 を開き、VRボタンで入ってください。\n以後の開始・停止はこのPCで操作できます。',padding=(0,8)).pack(anchor='w')
        self.preference_path=ROOT/'recordings/naming_preferences.json'
        try:prefs=json.loads(self.preference_path.read_text(encoding='utf-8'))
        except (OSError,ValueError):prefs={}
        form=ttk.Frame(frame);form.pack(fill='x',pady=5)
        self.subject=tk.StringVar(value=prefs.get('subject',''));self.height_cm=tk.StringVar(value=str(prefs.get('height_cm','')));self.trial_number=tk.StringVar(value=str(prefs.get('trial_number',1)))
        self.participant_fields=[]
        for label,var,width in [('被験者',self.subject,18),('身長 cm',self.height_cm,7),('次の試行番号',self.trial_number,7)]:
            ttk.Label(form,text=label).pack(side='left',padx=(0,5));entry=ttk.Entry(form,textvariable=var,width=width);entry.pack(side='left',padx=(0,12));self.participant_fields.append(entry)
        self.reset_number=ttk.Button(form,text='番号を1にリセット',command=lambda:self.trial_number.set('1'));self.reset_number.pack(side='left')
        cards=ttk.Frame(frame);cards.pack(fill='x',pady=14);self.cards={}
        for i,(key,title) in enumerate([('quest','Quest接続'),('vr','VR描画'),('force','ComBalance'),('clock','時刻対応')]):
            box=ttk.LabelFrame(cards,text=title,padding=12);box.grid(row=0,column=i,sticky='nsew',padx=4);cards.columnconfigure(i,weight=1)
            var=tk.StringVar(value='未接続');self.cards[key]=var;ttk.Label(box,textvariable=var,style='Card.TLabel').pack(anchor='w')
        from .study_stimuli import available_conditions
        self.conditions=available_conditions()
        self.condition=tk.StringVar(value=next(iter(self.conditions)))
        self.condition_box=ttk.Combobox(frame,textvariable=self.condition,values=list(self.conditions),state='readonly',width=56)
        self.condition_box.pack(anchor='w');self.condition_box.bind('<<ComboboxSelected>>',lambda e:self.start_button.configure(text='選択した試行を予約'))
        height_row=ttk.Frame(frame);height_row.pack(fill='x',pady=5)
        self.height_button=ttk.Button(height_row,text='目線高さを取得し直す',command=lambda:self.submit(self.command(dict(type='capture_height'))),state='disabled')
        self.height_button.pack(side='left');self.eye_height=tk.StringVar(value='未取得（Questを装着し、VRに入ってから取得）')
        ttk.Label(height_row,textvariable=self.eye_height).pack(side='left',padx=12)
        row=ttk.Frame(frame);row.pack(fill='x',pady=8)
        self.connect_button=ttk.Button(row,text='USB接続・準備',command=self.prepare);self.connect_button.pack(side='left',ipady=12)
        ttk.Label(row,text='予約後の待ち時間').pack(side='left',padx=(22,5))
        self.delay=tk.StringVar(value='10');ttk.Spinbox(row,from_=3,to=30,textvariable=self.delay,width=5).pack(side='left')
        ttk.Label(row,text='秒').pack(side='left',padx=5)
        self.start_button=tk.Button(row,text='90秒試行を予約',font=('Yu Gothic UI',13,'bold'),bg='#216844',fg='white',padx=18,pady=12,command=self.start,state='disabled');self.start_button.pack(side='left',padx=16)
        self.stop_button=tk.Button(row,text='停止',font=('Yu Gothic UI',13,'bold'),bg='#a82424',fg='white',padx=25,pady=12,command=self.stop,state='disabled');self.stop_button.pack(side='left')
        self.phase=tk.StringVar(value='USBケーブルで両機器を接続し、「USB接続・準備」を押してください。')
        ttk.Label(frame,textvariable=self.phase,font=('Yu Gothic UI',15),wraplength=900,padding=(0,12)).pack(anchor='w')
        self.progress=ttk.Progressbar(frame,maximum=90);self.progress.pack(fill='x',pady=6)
        self.trial=tk.StringVar(value='試行: —');ttk.Label(frame,textvariable=self.trial).pack(anchor='w',pady=5)
        ttk.Label(frame,text='映像: 幅6 m・奥行6 m・高さ3 m ／ 正面壁まで3 m ／ グリッド50 cm').pack(anchor='w',pady=8)
        save=ttk.LabelFrame(frame,text='保存先（接続中は固定）',padding=12);save.pack(fill='x',pady=12)
        self.save_root=tk.StringVar(value=str(ROOT/'recordings'));ttk.Entry(save,textvariable=self.save_root,state='readonly').pack(side='left',fill='x',expand=True)
        self.folder_button=ttk.Button(save,text='変更',command=self.choose_folder);self.folder_button.pack(side='left',padx=5)
        ttk.Button(save,text='保存先を開く',command=self.open_folder).pack(side='left')
        ttk.Label(frame,text='保存: Quest刺激CSV・ComBalance床反力／モーメントCSV・時計プローブ・生受信データ\nセンサ時刻は受信時刻と区別して保存します。センサ取得遅延・実表示遅延は未校正です。',wraplength=900).pack(anchor='w',pady=8)
        self.message=tk.StringVar(value='FRF・COM解析は実行しません。');ttk.Label(frame,textvariable=self.message,wraplength=900).pack(anchor='w')
        root.protocol('WM_DELETE_WINDOW',self.close);root.after(100,self.drain)
    def choose_folder(self):
        if self.connection_task is not None and not self.connection_task.done():return
        name=filedialog.askdirectory()
        if name:self.save_root.set(name)
    def open_folder(self):
        if self.named_directory:os.startfile(self.named_directory);return
        path=Path(self.last_status.get('last_export') or self.last_status['save_directory']) if self.last_status else Path(self.save_root.get())
        path.mkdir(parents=True,exist_ok=True);os.startfile(str(path))
    def submit(self,coroutine):
        future=asyncio.run_coroutine_threadsafe(coroutine,self.loop)
        def done(f):
            try:f.result()
            except Exception as error:self.events.put(('error',str(error)))
        future.add_done_callback(done);return future
    @staticmethod
    def api():
        with urllib.request.urlopen('http://127.0.0.1:8443/api/session',timeout=2) as response:return json.load(response)
    def prepare(self):
        if self.connecting:return
        self.connecting=True;self.connect_button['state']='disabled';self.phase.set('USBと計測サーバーを準備しています…')
        self.submit(self.prepare_async(Path(self.save_root.get())))
    async def prepare_async(self,save_root):
        try:
            def usb():
                if not ADB.exists():raise FileNotFoundError('Meta Quest Developer HubのADBが見つかりません')
                result=subprocess.run([str(ADB),'devices'],capture_output=True,text=True,timeout=15,creationflags=HIDDEN)
                if not any(line.rstrip().endswith('\tdevice') for line in result.stdout.splitlines()):raise RuntimeError('QuestのUSB接続とUSBデバッグの許可を確認してください')
                for port in (8443,8765):subprocess.run([str(ADB),'reverse',f'tcp:{port}',f'tcp:{port}'],capture_output=True,check=True,timeout=15,creationflags=HIDDEN)
            await asyncio.to_thread(usb)
            try:info=await asyncio.to_thread(self.api)
            except Exception:
                if not (VENDOR/'MedicalFpAmp.dll').exists():raise FileNotFoundError('ComBalance制御ソフトのインストール先が見つかりません')
                helper=ROOT/'bin/ManufacturerCapture.exe'
                if not helper.exists():
                    helper.parent.mkdir(exist_ok=True)
                    compiler=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
                    await asyncio.to_thread(subprocess.run,[str(compiler),'/nologo','/target:exe','/reference:System.Web.Extensions.dll','/out:'+str(helper),str(ROOT/'ManufacturerCapture.cs')],check=True,capture_output=True,creationflags=HIDDEN)
                save_root.mkdir(parents=True,exist_ok=True);name='session-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid4().hex[:6]
                startup=(save_root/(name+'-service.log')).open('x',encoding='utf-8')
                token_path=ROOT/'recordings/.control-token';token_path.parent.mkdir(exist_ok=True)
                if not token_path.exists():
                    try:
                        with token_path.open('x',encoding='ascii') as stream:stream.write(secrets.token_urlsafe(24))
                    except FileExistsError:pass
                local_token=token_path.read_text(encoding='ascii').strip()
                try:self.server_process=subprocess.Popen([sys.executable,'-m','research_sync.server','--output',str(save_root/name),'--vendor-directory',str(VENDOR),'--token',local_token],cwd=str(ROOT.parent),stdout=startup,stderr=subprocess.STDOUT,creationflags=HIDDEN)
                finally:startup.close()
                for _ in range(40):
                    await asyncio.sleep(.25)
                    if self.server_process.poll() is not None:raise RuntimeError('サーバーを開始できません。別の計測ソフトがポートを使用していないか確認してください')
                    try:info=await asyncio.to_thread(self.api);break
                    except Exception:continue
                else:raise TimeoutError('計測サーバーの起動が確認できません')
            if info['status'].get('service_version')!='pc-acquisition-v6':raise RuntimeError('古い計測サーバーが起動しています。旧計測ソフトを終了し、このソフトで再接続してください')
            if not info['status']['vendor_enabled']:raise RuntimeError('このサーバーはComBalance実機取得が無効です')
            if self.connection_task is None or self.connection_task.done():self.connection_task=asyncio.create_task(self.connection_loop())
            self.events.put(('prepared',None))
        finally:self.connecting=False
    async def connection_loop(self):
        while not self.closing:
            try:
                info=await asyncio.to_thread(self.api)
                async with connect(('wss' if info['tls'] else 'ws')+f'://127.0.0.1:{info["ws_port"]}') as ws:
                    self.ws=ws;await ws.send(json.dumps(dict(role='operator',token=info['token'],subscribe_status=True)))
                    self.events.put(('connected',None))
                    async for raw in ws:
                        msg=json.loads(raw)
                        if msg['type']=='system_status':self.last_status=msg;self.events.put(('status',msg))
                        elif msg['type']=='error':self.events.put(('error',msg['message']))
            except Exception as error:
                if not self.closing:self.events.put(('disconnected',str(error)))
            finally:self.ws=None
            if not self.closing:await asyncio.sleep(1)
    async def command(self,message):
        if self.ws is None:raise RuntimeError('PCと計測サーバーが接続されていません')
        await self.ws.send(json.dumps(message))
    def start(self):
        try:
            from .named_recording import participant_info
            participant=participant_info(dict(subject=self.subject.get(),height_cm=self.height_cm.get(),trial_number=self.trial_number.get()))
            delay=float(self.delay.get())
            if not 3<=delay<=30:raise ValueError('待ち時間は3～30秒にしてください')
            self.start_button['state']='disabled';self.submit(self.command(dict(type='start',start_delay_s=delay,condition=self.conditions[self.condition.get()],participant=participant)))
        except Exception as error:messagebox.showerror('開始できません',str(error))
    def stop(self):self.submit(self.command(dict(type='stop')))
    def show_status(self,s):
        self.cards['quest'].set('接続済み' if s['quest_connected'] else '未接続')
        self.cards['vr'].set('表示の更新待ち' if s['quest_connected'] and not s['quest_software_current'] else '描画中' if s['quest_rendering'] and s['quest_xr'] else '装着・VR待ち')
        force=s['combalance_state'] if s['vendor_available'] is not False else 'USB未接続'
        self.cards['force'].set(force)
        self.cards['clock'].set(f'RTT {s["rtt_median_ms"]:.1f} ms' if s['rtt_median_ms'] is not None else '時計通信待ち')
        phase=s['phase'];labels=dict(idle='待機中',preparing='ComBalanceの接続・取得準備中…',running=f'計測中 {s["elapsed_s"]:.1f} / {s["duration_s"]:g}秒',saving='停止・CSV保存中…',complete='計測完了・保存確認待ち',stopped='中断・保存確認待ち',error='エラー: '+str(s.get('last_error') or '詳細を確認してください'))
        if phase=='countdown':text=f'約{max(0,s["scheduled_pc_s"]-time.perf_counter()):.0f}秒後に開始します。Questを装着して正面を向いてください。'
        else:text=labels.get(phase,phase)
        self.phase.set(text);self.progress['maximum']=s['duration_s'];self.progress['value']=min(s['duration_s'],s['elapsed_s']);self.trial.set('試行: '+(s['trial_id'] or '—'))
        enabled=self.connected and s['quest_connected'] and s['quest_software_current'] and not s['busy'] and s['phase']!='error' and s['vendor_available'] is not False
        height=s.get('eye_height_m');pending=s.get('height_pending',False)
        self.eye_height.set('取得中…' if pending else f'取得済み: {height:.3f} m（床基準）' if height is not None else '未取得（Questを装着し、VRに入ってから取得）')
        self.height_button['state']='normal' if self.connected and s['quest_software_current'] and s['quest_connected'] and not s['busy'] and not pending else 'disabled'
        for field in self.participant_fields:field['state']='disabled' if s['busy'] or self.review_busy else 'normal'
        self.reset_number['state']='disabled' if s['busy'] or self.review_busy else 'normal'
        self.condition_box['state']='disabled' if s['busy'] else 'readonly'
        self.folder_button['state']='disabled' if self.connected else 'normal'
        self.connect_button['state']='disabled' if s['busy'] or self.connecting else 'normal'
        self.start_button['state']='normal' if enabled and not pending and not self.review_busy else 'disabled';self.stop_button['state']='normal' if self.connected else 'disabled'
        if s.get('imu_warning'):self.message.set(s['imu_warning'])
        elif s['quest_connected'] and not s['quest_software_current']:self.message.set('Questで http://localhost:8443 を一度再読み込みしてください。PC操作用の表示に更新されます。')
        elif s.get('last_error'):self.message.set(s['last_error'])
        elif self.named_directory:self.message.set('確定保存先: '+self.named_directory)
        else:self.message.set('準備完了後、PCで開始を予約してください。COM・FRF解析は実行しません。')
        path=s.get('last_export')
        if path and (Path(path)/'review_decision.json').exists():self.reviewed_paths.add(path)
        if path and not s['busy'] and path not in self.reviewed_paths and not self.review_busy:
            self.reviewed_paths.add(path);self.review_busy=True;self.start_button['state']='disabled'
            self.root.after_idle(lambda:self.review_recording(path))
    def review_recording(self,path):
        try:
            from .named_recording import basename
            meta=json.loads((Path(path)/'metadata.json').read_text(encoding='utf-8'))
            if not meta.get('participant'):
                self.review_busy=False;self.message.set('旧形式の記録です。被験者情報付きの新しい試行から名前付き保存が利用できます。');return
            name=basename(meta);weight=meta.get('weight_estimate',{}).get('body_mass_kg')
            imu_warning=meta.get('external_imu_quality',{}).get('warning') or ''
            text=f'今回の記録を保存しますか？\n\n{name}\n身長: {meta["participant"]["height_cm"]:g} cm\n体重（床反力推定）: '+(f'{weight:.3f} kg' if weight is not None else '取得不可（CSVは空欄）')+('\n'+imu_warning if imu_warning else '')+'\n\n「いいえ」では名前付きCSVを作りません。復旧用の生データ・一時CSVは保持します。'
            if not messagebox.askyesno('記録の保存',text,parent=self.root):
                (Path(path)/'review_decision.json').write_text(json.dumps(dict(decision='not_saved'),ensure_ascii=False),encoding='utf-8')
                self.review_busy=False;self.message.set('名前付き保存を見送りました。試行番号は変更していません。');return
            self.submit(self.save_reviewed(path))
        except Exception as error:
            self.review_busy=False;self.reviewed_paths.discard(path);messagebox.showerror('保存確認',str(error))
    async def save_reviewed(self,path):
        from .named_recording import save_named
        try:
            result=await asyncio.to_thread(save_named,path,Path(path).parents[2]/'saved')
            result['source']=path
            self.events.put(('named_saved',result))
        except Exception as error:self.events.put(('named_failed',(path,str(error))))
    def drain(self):
        while True:
            try:kind,value=self.events.get_nowait()
            except queue.Empty:break
            if kind=='connected':self.connected=True;self.connect_button['state']='normal';self.connect_button['text']='USB接続を再確認'
            elif kind=='prepared':self.connect_button['state']='normal'
            elif kind=='status':self.show_status(value)
            elif kind=='disconnected':self.connected=False;self.start_button['state']='disabled';self.phase.set('自動再接続中…')
            elif kind=='error':self.message.set(value);self.connect_button['state']='normal'
            elif kind=='named_saved':
                self.review_busy=False;self.named_directory=value['directory'];self.trial_number.set(str(value['next_trial_number']))
                try:(Path(value['source'])/'review_decision.json').write_text(json.dumps(dict(decision='saved',directory=value['directory']),ensure_ascii=False),encoding='utf-8')
                except OSError:pass
                self.preference_path.parent.mkdir(parents=True,exist_ok=True)
                prefs=dict(subject=self.subject.get(),height_cm=self.height_cm.get(),trial_number=self.trial_number.get())
                self.preference_path.write_text(json.dumps(prefs,ensure_ascii=False,indent=2),encoding='utf-8')
                self.message.set('確定保存先: '+self.named_directory)
            elif kind=='named_failed':
                self.review_busy=False;path,error=value
                # A number collision can be resolved in the review retry dialog.
                if messagebox.askretrycancel('保存できませんでした',error+'\n元の記録は保持されています。再試行しますか？',parent=self.root):
                    from tkinter import simpledialog
                    number=simpledialog.askinteger('試行番号','保存に使う試行番号',initialvalue=int(self.trial_number.get()),minvalue=1,parent=self.root)
                    if number is not None:
                        meta_path=Path(path)/'metadata.json';meta=json.loads(meta_path.read_text(encoding='utf-8'));meta['participant']['trial_number']=number
                        meta_path.write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8');self.review_busy=True;self.root.after_idle(lambda:self.review_recording(path))
            elif kind=='closed':self.root.destroy();return
        self.root.after(100,self.drain)
    def close(self):
        if self.last_status and self.last_status.get('busy'):
            self.stop();messagebox.showinfo('計測の停止','停止を指示しました。保存確認を完了してから終了してください',parent=self.root);return
        if self.review_busy:
            messagebox.showinfo('保存確認','記録の保存確認・保存処理を完了してから終了してください',parent=self.root);return
        if self.closing:return
        self.closing=True;self.start_button['state']='disabled';self.phase.set('停止・保存を確認して終了しています…')
        self.submit(self.close_async())
    async def close_async(self):
        try:
            try:info=await asyncio.to_thread(self.api)
            except Exception:info=None
            if info is not None:
                async with connect(('wss' if info['tls'] else 'ws')+f'://127.0.0.1:{info["ws_port"]}') as ws:
                    await ws.send(json.dumps(dict(role='operator',token=info['token'])));await ws.recv()
                    await ws.send(json.dumps(dict(type='shutdown' if self.server_process is not None else 'stop')))
                    deadline=time.monotonic()+25
                    while time.monotonic()<deadline:
                        await asyncio.sleep(.2)
                        try:status=(await asyncio.to_thread(self.api))['status']
                        except Exception:break
                        if not status['busy']:break
                    else:raise RuntimeError('機器の停止確認に時間がかかっています。生データと機器設定の復元を確認してください')
            if self.server_process is not None:await asyncio.to_thread(self.server_process.wait,20)
            self.events.put(('closed',None))
        except Exception:
            self.closing=False;raise

def main():
    root=tk.Tk();app=ControlApp(root);root.after(300,app.prepare);root.mainloop()

if __name__=='__main__':main()
