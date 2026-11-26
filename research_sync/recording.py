"""Acquisition CSV export only. No COM estimation, filtering, or FRF analysis."""
import base64
import csv
import hashlib
import json
from pathlib import Path
import numpy as np
from .clocks import fit_clock,to_pc
from .raw_decode import decode_payload,force_engineering

def export_recording(events,trial_id,output,raw_directory=None,reason='unknown'):
    records=[json.loads(line) for line in Path(events).read_text(encoding='utf-8').splitlines()]
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    frames=[r['payload'] for r in records if r['kind']=='frame' and r['payload']['trial_id']==trial_id]
    received=[i for i,r in enumerate(records) if r['kind']=='received' and r['payload']['trial_id']==trial_id]
    model=None;probes=[]
    if received:
        previous=[i for i,r in enumerate(records[:received[0]]) if r['kind']=='connected' and r.get('role')=='quest']
        left=previous[-1] if previous else 0
        next_conn=[i for i in range(received[0]+1,len(records)) if records[i]['kind']=='connected' and records[i].get('role')=='quest']
        right=next_conn[0] if next_conn else len(records)
        probes=[r['payload'] for r in records[left:right] if r['kind']=='probe']
        try:model=fit_clock(probes)
        except ValueError:pass
    with (output/'quest.csv').open('x',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['trial_id','quest_time_s','pc_mapped_time_s','stimulus_elapsed_s','ap_displacement_m','ap_velocity_m_s','ap_acceleration_m_s2','application_state','visual_condition','fixation_anchor_x_m','fixation_anchor_y_m','fixation_anchor_z_m'])
        for f in frames:
            pc=float(to_pc(f['q_apply_s'],model)) if model else ''
            writer.writerow([trial_id,f['q_apply_s'],pc,f['elapsed_s'],f['ap_m'],f['ap_m_s'],f['ap_m_s2'],f['state'],f.get('condition','multicosine'),*(f.get('fixation_anchor') or ['','',''])])
    with (output/'clock_probes.csv').open('x',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['trial_id','quest_send_s','pc_receive_s','pc_send_s','quest_receive_s'])
        writer.writerows([trial_id,*[p[k] for k in ('q1','p2','p3','q4')]] for p in probes)
    summary=dict(trial_id=trial_id,termination=reason,quest_frames=len(frames),quest_clock=model,
        pc_time_basis='Windows QPC / Python perf_counter seconds',scene=next(r['stimulus'].get('scene') for r in records if r['kind']=='session'),
        processing='Acquisition CSV export only; no filters, COM or FRF',
        events_file=str(Path(events).resolve()),combalance_samples=0,
        timing_validation='Quest clock mapped to PC. Force samples retain PC receipt times; acquisition latency not independently calibrated.')
    commands=[r for r in records if r.get('trial_id')==trial_id and r['kind'] in ('command_start','command_stop')]
    summary['pc_commands']=commands
    summary['stimulus']=next((c['stimulus'] for c in commands if c['kind']=='command_start' and 'stimulus' in c),next(r['stimulus'] for r in records if r['kind']=='session'))
    summary['participant']=next((c.get('participant') for c in commands if c['kind']=='command_start'),None)
    if raw_directory is not None:
        raw_directory=Path(raw_directory);parameter_path=raw_directory/'device_parameters.json';raw_path=raw_directory/'raw_blocks.jsonl'
        if parameter_path.exists() and raw_path.exists():
            params=json.loads(parameter_path.read_text(encoding='utf-8'));batch=int(params['Matome']);fs=float(params['Frequency'])
            blocks=[json.loads(line) for line in raw_path.read_text().splitlines()]
            payloads=[b for b in blocks if b['kind']=='raw_block']
            if [b['block_index'] for b in payloads]!=list(range(len(payloads))):raise ValueError('Noncontiguous raw block indices')
            summary.update(raw_directory=str(raw_directory.resolve()),device_parameters=params,
                raw_sha256=hashlib.sha256(raw_path.read_bytes()).hexdigest(),batch_samples=batch,sampling_hz=fs)
            sample_slope=1.;sample_origin=None
            if payloads:
                nominal=(np.arange(len(payloads))*batch+batch-1)/fs
                receipt=np.array([b['pc_after_read_s'] for b in payloads])
                sample_origin=float(np.min(receipt-nominal))
                if nominal[-1]-nominal[0]>3:
                    use=(nominal>nominal[0]+1)&(nominal<nominal[-1]-1)
                    initial=np.polyfit(nominal[use],receipt[use],1);residual=receipt-np.polyval(initial,nominal);chosen=[]
                    for second in np.unique(nominal[use].astype(int)):
                        group=np.flatnonzero(use&(nominal.astype(int)==second));chosen.append(group[np.argmin(residual[group])])
                    if len(chosen)>=3:sample_slope,sample_origin=map(float,np.polyfit(nominal[chosen],receipt[chosen],1))
            summary['force_sample_clock_estimate']=dict(method='lower-envelope affine fit of block receipt times; provisional',
                slope=sample_slope,intercept_pc_s=sample_origin,absolute_acquisition_latency_s=None,independently_validated=False)
            with (output/'combalance.csv').open('x',encoding='utf-8-sig',newline='') as stream:
                writer=csv.writer(stream);writer.writerow(['trial_id','sample_index','sample_elapsed_s','sampling_hz','pc_before_block_read_s','pc_after_block_read_s','pc_estimated_sample_time_s','pc_acquisition_time_s','timestamp_quality',
                    'sensor_Fx_N','sensor_Fy_N','sensor_Fz_N','sensor_Mx_Nm','sensor_My_Nm','sensor_Mz_Nm',
                    *['force_adc_'+str(k) for k in range(12)],*['onboard_imu_count_'+str(k) for k in range(7)],*['external_imu_count_'+str(k) for k in range(7)]])
                index=0
                for b in payloads:
                    adc,imu,external=decode_payload(base64.b64decode(b['base64'],validate=True),batch);force=force_engineering(adc,params)
                    for j in range(batch):
                        writer.writerow([trial_id,index,index/fs,fs,b['pc_before_read_s'],b['pc_after_read_s'],sample_slope*index/fs+sample_origin,'','receipt_fit_unvalidated',*force[j],*adc[j],*imu[j],*external[j]]);index+=1
                summary['combalance_samples']=index
            summary['capture_end']=next((b for b in reversed(blocks) if b['kind']=='capture_stop'),None)
            summary['force_coordinates']='Native manufacturer sensor axes, before AP remapping. Device coefficients applied; no software filter.'
    from .imu_quality import external_imu_quality
    summary['external_imu_quality']=external_imu_quality(output/'combalance.csv')
    from .named_recording import estimate_weight
    summary['weight_estimate']=estimate_weight(output,summary)
    (output/'metadata.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    return summary
