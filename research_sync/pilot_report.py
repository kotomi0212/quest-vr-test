"""Export designed stimuli, not measured display or human responses."""
import csv,json
from pathlib import Path
import numpy as np
from .low_band import OUTPUT,evaluate

def generate():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.font_manager import FontProperties
    font=Path('C:/Windows/Fonts/meiryo.ttc')
    if font.exists():plt.rcParams['font.family']=FontProperties(fname=str(font)).get_name()
    plt.rcParams['axes.unicode_minus']=False
    profiles=json.loads((OUTPUT/'index.json').read_text())
    fig,axes=plt.subplots(3,2,figsize=(14,10),layout='constrained')
    colors=['#2774a6','#38a17d','#df9936','#c34b56']
    for col,kind,title in [(0,'single','単一0.20 Hz：40秒'),(1,'five','5周波数：100秒')]:
        series=[p for p in profiles if p['condition'].startswith('pilot_'+kind+'_')]
        for c,color in zip(series,colors):
            t=np.arange(0,c['duration_s']+.0025,.005);signals=evaluate(t,c)
            np.savetxt(OUTPUT/(c['condition']+'.csv'),np.c_[t,*signals],delimiter=',',header='stimulus_elapsed_s,ap_displacement_m,ap_velocity_m_s,ap_acceleration_m_s2',comments='')
            for ax,y,label in zip(axes[:,col],signals,['変位 [m]','速度 [m/s]','加速度 [m/s²]']):
                ax.plot(t,y,color=color,lw=.8,ls='-' if c['enabled'] else '--',label=str(c['amplitude_multiple'])+'倍'+('' if c['enabled'] else '・開始不可'))
                ax.set(xlabel='時間 [秒]',ylabel=label,xlim=(0,c['duration_s']));ax.grid(alpha=.2)
        for ax,limit in zip(axes[:,col],[.3,.1,.2]):
            ax.axhline(limit,color='#777',ls=':',lw=.8);ax.axhline(-limit,color='#777',ls=':',lw=.8)
            ax.axvspan(0,series[0]['ramp_s'],color='#eec779',alpha=.2);ax.axvspan(series[0]['duration_s']-series[0]['ramp_s'],series[0]['duration_s'],color='#eec779',alpha=.2)
        axes[0,col].set_title(title);axes[0,col].legend(fontsize=8,ncol=2)
    fig.suptitle('新規予備試験の設計波形（点線は暫定上限、破線の条件は開始不可）')
    fig.savefig(OUTPUT/'overview.png',dpi=140);fig.savefig(OUTPUT/'overview.pdf');plt.close(fig)
    with (OUTPUT/'summary.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['condition','duration_s','steady_start_s','steady_end_s','component_acceleration_m_s2','maximum_displacement_m','maximum_velocity_m_s','maximum_acceleration_m_s2','enabled'])
        for c in profiles:writer.writerow([c['condition'],c['duration_s'],*c['analysis_interval_s'],c['acceleration_component_m_s2'],*[c['maxima'][k]['value'] for k in ['displacement_m','velocity_m_s','acceleration_m_s2']],c['enabled']])
    # Repeat within ascending intensity blocks; do not randomize an untested high
    # intensity ahead of the lower pilot. No automatic execution is performed.
    rng=np.random.default_rng(20261123);plan=[]
    for stage in [('pilot_rest',),('pilot_single_x1',),('pilot_single_x2',),('pilot_single_x3',),('pilot_five_x1',),('pilot_five_x1p4',)]:
        block=[dict(condition=c,repeat=k) for c in stage for k in (1,2,3)]
        rng.shuffle(block);plan.extend(block)
    randomized={}
    for name,conditions in [('single',['pilot_single_x1','pilot_single_x2','pilot_single_x3']),('five',['pilot_five_x1','pilot_five_x1p4'])]:
        trials=[dict(condition=c,repeat=k) for c in conditions for k in (1,2,3)]
        rng.shuffle(trials);randomized[name]=trials
    (OUTPUT/'suggested_plan.json').write_text(json.dumps(dict(seed=20261123,automatic_execution=False,note='First escalate within participant. Randomized follow-up lists may be used only after every included intensity is approved and tolerated. No automatic starts.',escalation=plan,randomized_followup=randomized),indent=2),encoding='utf-8')

if __name__=='__main__':generate()
