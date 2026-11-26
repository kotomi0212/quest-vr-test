"""Explicitly provisional human COM/FRF analysis from receipt-timed raw capture.

Never substitutes this receipt-based mapping for validated acquisition anchors.
"""
import json
import csv
from pathlib import Path
import numpy as np
from .analysis import estimate,two_link_coefficients,harmonic_coefficients,apply_filter
from .clocks import fit_clock,to_pc
from .quest_report import trial_records

def run(events,trial_id,decoded,empty_decoded,output,height_m,coefficient_set):
    if coefficient_set not in ('female','male') or not .5<float(height_m)<2.5:raise ValueError('Explicit height and coefficient set required')
    source=Path(decoded);empty=Path(empty_decoded)
    d=np.genfromtxt(source/'decoded.csv',names=True,delimiter=',');z=np.genfromtxt(empty/'decoded.csv',names=True,delimiter=',')
    provenance=json.loads((source/'provenance.json').read_text());reference=json.loads((empty/'provenance.json').read_text())
    if provenance['calibration']['Serial']!=reference['calibration']['Serial']:raise ValueError('Different baseline device')
    for key in ('ForceZero','Prf','Npu','Itf6x12'):
        if provenance['calibration'][key]!=reference['calibration'][key]:raise ValueError('Baseline calibration mismatch')
    records=[json.loads(s) for s in Path(events).read_text().splitlines()]
    frames,probes=trial_records(records,trial_id);clock=fit_clock(probes)
    ended=[r for r in records if r['kind']=='ended' and r['payload']['trial_id']==trial_id]
    if not ended or ended[-1]['payload']['reason']!='complete':raise ValueError('Natural completion required')
    qt=np.array([f['q_apply_s'] for f in frames]);qpc=to_pc(qt,clock)
    start_pc=float(to_pc(frames[0]['q_apply_s']-frames[0]['elapsed_s'],clock));quest_time=qpc-start_pc
    # Timestamp each block's last nominal sample. Use the lower envelope of
    # receipt times per one-second bin, avoiding initial driver buffering.
    batch=provenance['batch_samples'];fs=provenance['sampling_hz']
    last=np.arange(batch-1,len(d),batch);nominal=d['sample_time_s'][last];receipt=d['pc_after_block_read_s'][last]
    usable=(nominal>1)&(nominal<nominal[-1]-1)
    slope,offset=np.polyfit(nominal[usable],receipt[usable],1)
    residual=receipt-(slope*nominal+offset);chosen=[]
    for second in np.unique(nominal[usable].astype(int)):
        group=np.flatnonzero(usable&(nominal.astype(int)==second));chosen.append(group[np.argmin(residual[group])])
    slope,offset=np.polyfit(nominal[chosen],receipt[chosen],1)
    time=slope*d['sample_time_s']+offset-start_pc
    mask=(time>=20)&(time<80)
    if mask.sum()<5000:raise ValueError('Insufficient 20..80 s response coverage')
    tare={k:float(np.mean(z[k])) for k in z.dtype.names if k.startswith('sensor_')}
    vertical=d['sensor_Fz_N']-tare['sensor_Fz_N']
    mass=float(np.mean(vertical[mask])/9.80665)
    if not 10<mass<250:raise ValueError('No plausible standing load; do not estimate COM')
    H=float(height_m);female=coefficient_set=='female'
    params=dict(body_mass_kg=.978*mass,body_com_from_ankle_m=(.523 if female else .531)*H,
        body_inertia_kg_m2=(.0441 if female else .0425)*mass*H*H,ankle_height_m=.038*H)
    double=dict(lower_mass_kg=(.352 if female else .322)*mass,upper_mass_kg=(.626 if female else .656)*mass,
        lower_inertia_kg_m2=(.00249 if female else .00223)*mass*H*H,
        upper_inertia_kg_m2=(.0121 if female else .0114)*mass*H*H,
        lower_com_m=(.291 if female else .285)*H,upper_com_m=(.193 if female else .191)*H,
        lower_length_m=.460*H,ankle_height_m=.038*H)
    # Software convention traced from OEM RotateAxis for quiet/AP trials:
    # force X <- sensor Y, moment Y <- sensor X. Physical direction awaits checking.
    rx=d['sensor_Fy_N']-tare['sensor_Fy_N']
    sensor_moment=d['sensor_Mx_Nm']-tare['sensor_Mx_Nm']
    origin_below=-float(provenance['calibration']['FpAz0'])
    ny=sensor_moment-origin_below*rx
    rx_mean=float(rx[mask].mean());ny_mean=float(ny[mask].mean());rx=rx-rx_mean;ny=ny-ny_mean
    frequencies=np.arange(1,31)*.05
    qm=(quest_time>=20)&(quest_time<80)
    u=harmonic_coefficients(quest_time[qm],np.array([f['ap_m'] for f in frames])[qm],frequencies)
    modes={'none':dict(kind='none'),'lowpass4':dict(kind='lowpass',cutoff=4,order=4,zero_phase=True),
           'highpass0.1_lowpass4':dict(kind='highpass',cutoff=.1,order=4,zero_phase=True)}
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    metrics={};signals={};frfs={}
    for mode,condition in modes.items():
        fx=apply_filter(rx,fs,**condition);my=apply_filter(ny,fs,**condition)
        if mode=='highpass0.1_lowpass4':
            fx=apply_filter(fx,fs,**modes['lowpass4']);my=apply_filter(my,fs,**modes['lowpass4'])
        x,a=estimate(fx,my,params);v=np.gradient(x,time,edge_order=2);a_dx=np.gradient(v,time,edge_order=2)
        signals[mode]=(x,v,a,a_dx)
        rxhat=harmonic_coefficients(time[mask],fx[mask],frequencies);nyhat=harmonic_coefficients(time[mask],my[mask],frequencies)
        x1=harmonic_coefficients(time[mask],x[mask],frequencies);x2=two_link_coefficients(frequencies,rxhat,nyhat,double)
        hybrid=np.where(frequencies<=.45000001,x1,x2);h=hybrid[:14]/u[:14];frfs[mode]=h
        cop=np.divide(my,vertical,out=np.full(len(my),np.nan),where=vertical>20)
        with (output/('provisional_'+mode+'_signals.csv')).open('x',encoding='utf-8',newline='') as stream:
            writer=csv.writer(stream);writer.writerow(['trial_id','sample_time_s','pc_receipt_estimate_s','receipt_based_elapsed_s','relative_com_single_m','com_velocity_derivative_m_s','com_acceleration_force_m_s2','com_acceleration_derivative_m_s2','force_on_plate_n','moment_at_contact_nm','relative_cop_m'])
            writer.writerows([trial_id,*row] for row in np.c_[d['sample_time_s'],time+start_pc,time,x,v,a,a_dx,fx,my,cop])
        np.savetxt(output/('provisional_'+mode+'_frf.csv'),np.c_[frequencies[:14],h.real,h.imag,abs(h),np.angle(h,deg=True)],delimiter=',',
            header='frequency_hz,real,imag,gain_m_per_m,phase_deg_unvalidated_timing_and_axis',comments='')
        np.savetxt(output/('provisional_'+mode+'_com_harmonics.csv'),np.c_[frequencies,hybrid.real,hybrid.imag,
            (1j*2*np.pi*frequencies*hybrid).real,(1j*2*np.pi*frequencies*hybrid).imag,
            (-(2*np.pi*frequencies)**2*hybrid).real,(-(2*np.pi*frequencies)**2*hybrid).imag],delimiter=',',
            header='frequency_hz,com_real_m,com_imag_m,velocity_real_m_s,velocity_imag_m_s,acceleration_real_m_s2,acceleration_imag_m_s2',comments='')
        metrics[mode]=dict(com_displacement_rms_mm=float(np.std(x[mask])*1000),
            com_velocity_rms_mm_s=float(np.std(v[mask])*1000),
            force_acceleration_rms_mm_s2=float(np.std(a[mask])*1000),
            derivative_acceleration_rms_mm_s2=float(np.std(a_dx[mask])*1000))
    report=dict(quality='PROVISIONAL: not validated synchronized FRF',trial_id=trial_id,
        participant_on_plate=True,participant_parameters_source='user confirmed height and female coefficients; mass from measured vertical load',
        height_m=H,coefficient_set=coefficient_set,estimated_mass_kg=mass,
        mean_vertical_load_n=float(vertical[mask].mean()),vertical_load_std_n=float(vertical[mask].std()),
        empty_reference=str(empty.resolve()),empty_reference_means=tare,source=str(source.resolve()),
        body_parameters=params,two_link_parameters=double,analysis_interval_s=[20,80],
        moment_origin_below_contact_m=origin_below,removed_horizontal_dc_n=rx_mean,removed_moment_dc_nm=ny_mean,
        dc_assumption='Analyze sway around equilibrium; remove constant horizontal/moment means, not a high-pass filter',
        coordinate_basis='installed OEM quiet/AP software mapping; physical AP sign and origin require validation',
        clock=clock,receipt_clock_slope=float(slope),receipt_clock_intercept_pc_s=float(offset),
        receipt_clock_drift_ppm=float((slope-1)*1e6),absolute_acquisition_latency_s=None,
        timing_basis='lower-envelope affine fit to PC block receipts, not acquisition timestamps',
        metrics=metrics,limitations=['Unknown absolute sensor acquisition latency biases FRF phase',
        'Physical axis/sign and known-load calibration are not independently validated',
        'Anthropometry is Table I approximation; no subject-specific segment measurements',
        'Single-trial estimates: no confidence intervals/coherence inferred',
        'Transient settling by 20 s is not established; 60 s stationary window used'])
    (output/'conditions_and_results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(4,1,figsize=(12,11),layout='constrained')
    x,v,a,a_dx=signals['lowpass4']
    for ax,y,label in zip(axes[:3],[x,v,a],['COM single-link (mm)','Velocity derivative (mm/s)','Acceleration (mm/s²)']):
        ax.plot(time[mask],y[mask]*1000,lw=.7);ax.set(xlabel='Receipt-estimated elapsed (s)',ylabel=label)
    axes[2].plot(time[mask],a_dx[mask]*1000,lw=.6,alpha=.6);axes[2].legend(['Force estimate','Displacement derivative'])
    for mode,h in frfs.items():axes[3].semilogy(frequencies[:14],abs(h),marker='.',label=mode)
    axes[3].set(xlabel='Frequency (Hz)',ylabel='Provisional hybrid gain (m/m)');axes[3].legend()
    fig.suptitle('PROVISIONAL standing COM/FRF | receipt timing and physical axes not independently validated')
    fig.savefig(output/'provisional_com_comparison.png',dpi=130);plt.close(fig)
    return report

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('events');p.add_argument('trial_id');p.add_argument('decoded');p.add_argument('empty_decoded');p.add_argument('output');p.add_argument('--height-m',type=float,required=True);p.add_argument('--coefficient-set',choices=['female','male'],required=True)
    a=p.parse_args();r=run(a.events,a.trial_id,a.decoded,a.empty_decoded,a.output,a.height_m,a.coefficient_set)
    print(json.dumps(dict(estimated_mass_kg=r['estimated_mass_kg'],metrics=r['metrics'],quality=r['quality']),indent=2))
