"""Offline clock mapping and common-time export; no manual-start pseudo-sync."""
import argparse
import csv
import json
from pathlib import Path
import numpy as np
from .clocks import fit_clock,to_pc,resample
from .quest_report import trial_records

def export(events,analysis,anchors,directory,trial_id,fs=100):
    records=[json.loads(line) for line in Path(events).read_text(encoding='utf-8').splitlines()]
    frames,probes=trial_records(records,trial_id)
    model=fit_clock(probes)
    endings=[r['payload'] for r in records if r['kind']=='ended' and r['payload']['trial_id']==trial_id]
    if not endings or endings[-1]['reason']!='complete':raise ValueError('Full-trial synchronized export requires natural completion; export interrupted Quest data with quest_report')
    if len(frames)<10:raise ValueError('Insufficient Quest frames')
    qt=np.asarray([r['q_apply_s'] for r in frames]);pt=to_pc(qt,model)
    if qt.min()<model['quest_range_s'][0] or qt.max()>model['quest_range_s'][1]:
        raise ValueError('Quest samples are not bracketed by clock calibration probes')
    com=np.genfromtxt(analysis,names=True,delimiter=',')
    anchor=json.loads(Path(anchors).read_text(encoding='utf-8'))
    if anchor.get('kind')!='validated_acquisition_time_pairs':
        raise ValueError('ComBalance needs measured acquisition-time anchors; file dates/manual starts are insufficient')
    pairs=np.asarray(anchor['pairs_sample_s_pc_monotonic_s'],float)
    if pairs.ndim!=2 or pairs.shape[1]!=2 or len(pairs)<3 or np.ptp(pairs[:,0])<1 or np.any(np.diff(pairs[:,0])<=0) or np.any(np.diff(pairs[:,1])<=0):
        raise ValueError('At least three increasing anchors spanning a second required')
    origin=pairs[:,0].mean();beta=np.polyfit(pairs[:,0]-origin,pairs[:,1],1)
    ct=np.polyval(beta,com['time_s']-origin)
    if com['time_s'].min()<pairs[:,0].min() or com['time_s'].max()>pairs[:,0].max():
        raise ValueError('ComBalance samples must be bracketed by measured anchors')
    if fs<=0 or fs>1000:raise ValueError('Invalid output rate')
    # Downsampling requires an explicit anti-aliasing stage before this exporter.
    if fs<1/np.median(np.diff(pt))-.5 or fs<1/np.median(np.diff(ct))-.5:
        raise ValueError('Downsampling requires prior anti-alias filtering; choose a higher common rate')
    start=max(pt[0],ct[0]);end=min(pt[-1],ct[-1]);target=np.arange(start,end,1/fs)
    if len(target)<10:raise ValueError('No useful shared recording interval')
    trial_start=float(to_pc(frames[0]['q_apply_s']-frames[0]['elapsed_s'],model))
    columns={'pc_monotonic_s':target,'elapsed_s':target-trial_start}
    for name in ('ap_m','ap_m_s','ap_m_s2'):
        columns[name]=resample(pt,[f[name] for f in frames],target,.1)
    for name in com.dtype.names:
        if name.startswith(('com_','estimator_')) or name=='cop_m':columns[name]=resample(ct,com[name],target,.03)
    if len(columns)==5:raise ValueError('No estimated COM/COP channels in analysis file')
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=False)
    with (directory/'synchronized.csv').open('x',newline='',encoding='utf-8') as stream:
        writer=csv.writer(stream);writer.writerow(['trial_id',*columns]);writer.writerows(
            [trial_id,*row] for row in np.column_stack(list(columns.values())))
    np.savetxt(directory/'quest_mapped.csv',np.c_[qt,pt],delimiter=',',header='quest_s,pc_monotonic_s',comments='')
    (directory/'synchronization.json').write_text(json.dumps(dict(trial_id=trial_id,quest_clock=model,
        combalance_anchors=anchor,com_clock_slope=float(beta[0]),com_clock_drift_ppm=float((beta[0]-1)*1e6),
        com_anchor_residual_rms_s=float(np.sqrt(np.mean((np.polyval(beta,pairs[:,0]-origin)-pairs[:,1])**2))),
        output_rate_hz=fs,interpolation='linear; bounded gaps; no extrapolation',
        limitation='Acquisition anchors and optical latency must be validated independently'),indent=2),encoding='utf-8')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('events');p.add_argument('analysis');p.add_argument('anchors');p.add_argument('output');p.add_argument('trial_id');p.add_argument('--fs',type=float,default=100)
    a=p.parse_args();export(a.events,a.analysis,a.anchors,a.output,a.trial_id,a.fs)
