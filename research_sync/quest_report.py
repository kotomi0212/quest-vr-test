"""Export actual Quest application logs without relabeling interrupted trials."""
import csv
import json
from pathlib import Path
import numpy as np
from .clocks import fit_clock,to_pc
from .stimulus import evaluate

def trial_records(records,trial_id):
    indices=[i for i,r in enumerate(records) if r['kind']=='frame' and r['payload']['trial_id']==trial_id]
    if not indices:raise ValueError('No trial frames')
    # Browser performance clocks reset on reload; never fit different connections together.
    previous=[i for i,r in enumerate(records[:indices[0]]) if r['kind']=='connected' and r.get('role')=='quest']
    start=previous[-1] if previous else 0
    following=[i for i in range(indices[0]+1,len(records)) if records[i]['kind']=='connected' and records[i].get('role')=='quest']
    end=following[0] if following else len(records)
    if indices[-1]>=end:raise ValueError('Trial spans clock-reset connections')
    segment=records[start:end]
    return [records[i]['payload'] for i in indices], [r['payload'] for r in segment if r['kind']=='probe']

def report(events,directory,trial_id):
    records=[json.loads(s) for s in Path(events).read_text(encoding='utf-8').splitlines()]
    frames,probes=trial_records(records,trial_id);model=fit_clock(probes)
    q=np.array([f['q_apply_s'] for f in frames]);elapsed=np.array([f['elapsed_s'] for f in frames])
    data=np.array([[f[k] for k in ('ap_m','ap_m_s','ap_m_s2')] for f in frames])
    ends=[r['payload'] for r in records if r['kind']=='ended' and r['payload']['trial_id']==trial_id]
    status=ends[-1]['reason'] if ends else 'no_termination_record'
    config=next(r['stimulus'] for r in records if r['kind']=='session')
    expected=np.column_stack(evaluate(elapsed,config['phases_rad'],config['acceleration_component_m_s2']))
    output=Path(directory);output.mkdir(parents=True,exist_ok=False)
    with (output/'quest_applied.csv').open('x',encoding='utf-8',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['trial_id','quest_s','pc_mapped_s','elapsed_s','ap_m','ap_m_s','ap_m_s2','application_state'])
        writer.writerows([trial_id,qt,pt,t,*row,'software-transform'] for qt,pt,t,row in zip(q,to_pc(q,model),elapsed,data))
    result=dict(trial_id=trial_id,source=str(Path(events).resolve()),termination=status,
        completed_90s=bool(status=='complete' and elapsed[-1]>89.9),frame_count=len(frames),
        first_elapsed_s=float(elapsed[0]),last_elapsed_s=float(elapsed[-1]),
        median_frame_hz=float(1/np.median(np.diff(q))),largest_frame_gap_s=float(np.diff(q).max()),
        analytic_application_max_abs_error=dict(zip(['m','m_s','m_s2'],np.max(abs(data-expected),axis=0).tolist())),
        clock=model,limitations=['Application-time logs, not photons','Participant presence and concurrent acquisition must be checked separately']+
        ([] if status=='complete' else ['Interrupted trial cannot supply a full 20..80 s FRF window']))
    commands=[r for r in records if r['kind']=='command_start' and r['trial_id']==trial_id]
    received=[r['payload'] for r in records if r['kind']=='received' and r['payload']['trial_id']==trial_id]
    if commands:
        result['first_application_after_scheduled_pc_s']=float(to_pc(q[0],model)-commands[-1]['scheduled_pc_s'])
        if received:result['mapped_command_delivery_s']=float(to_pc(received[-1]['q_receive_s'],model)-commands[-1]['pc_monotonic_s'])
    (output/'trial_report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(3,1,figsize=(11,8),layout='constrained')
    for ax,y,unit in zip(axes,data.T,['m','m/s','m/s²']):
        ax.plot(elapsed,y,lw=.7);ax.set(xlim=(0,90),xlabel='Elapsed (s)',ylabel=unit)
        if elapsed[-1]<89.9:ax.axvspan(elapsed[-1],90,color='gray',alpha=.15)
    fig.suptitle('Actual Quest software application log | '+status)
    fig.savefig(output/'quest_applied.png',dpi=130);plt.close(fig)
    return result

if __name__=='__main__':
    import sys
    r=report(*sys.argv[1:]);print(json.dumps(r,indent=2))
