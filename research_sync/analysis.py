"""Explicit vendor CSV audit/filtering and provisional single-link COM estimator.

No assumption that raw-prefixed channels are calibrated or unfiltered.
"""
import csv
import hashlib
import io
import json
from pathlib import Path
import numpy as np
from scipy import signal

def read_csv(path):
    raw=Path(path).read_bytes()
    for encoding in ('utf-8-sig','cp932'):
        try:
            rows=list(csv.reader(io.StringIO(raw.decode(encoding))));break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError('Unsupported CSV encoding')
    indices=[i for i,r in enumerate(rows) if {'Fx','Fz','My'}.issubset(r)]
    if not indices:
        raise ValueError('Fx, Fz, My header not found')
    index=indices[-1];header=rows[index].copy();header[0]='time_s'
    if len(set(header))!=len(header):
        raise ValueError('Duplicate columns')
    data=np.asarray([[float(v) for v in r] for r in rows[index+1:] if r and any(r)])
    if data.ndim!=2 or data.shape[1]!=len(header) or len(data)<10 or not np.isfinite(data).all():
        raise ValueError('Invalid sample table')
    dt=np.diff(data[:,0]);interval=float(np.median(dt))
    if interval<=0 or not np.allclose(dt,interval,rtol=.001,atol=1e-8):
        raise ValueError('Time must increase uniformly; resolve gaps before filtering')
    meta={r[0]:r[1] for r in rows[:indices[0]] if len(r)==2}
    fs=1/interval
    if '記録周波数(Hz)' in meta and not np.isclose(float(meta['記録周波数(Hz)']),fs,rtol=.001):
        raise ValueError('Header sampling frequency mismatch')
    unitrows=[r for r in rows[:index] if r and r[0]=='単位' and len(r)==len(header)]
    units=dict(zip(header,unitrows[-1])) if unitrows else {}
    return dict(zip(header,data.T)),dict(source=str(Path(path).resolve()),sha256=hashlib.sha256(raw).hexdigest(),
        encoding=encoding,metadata=meta,units=units,fs_hz=fs,samples=len(data))

def apply_filter(x,fs,kind='none',cutoff=None,order=4,zero_phase=True):
    if kind=='none':return np.asarray(x).copy()
    if kind not in ('lowpass','highpass','bandpass') or not isinstance(order,int) or not 1<=order<=20:
        raise ValueError('Invalid filter type/order')
    cutoff=np.atleast_1d(cutoff).astype(float)
    if len(cutoff)!=(2 if kind=='bandpass' else 1) or not np.isfinite(cutoff).all() or np.any(cutoff<=0) or np.any(cutoff>=fs/2) or np.any(np.diff(cutoff)<=0):
        raise ValueError('Cutoffs must satisfy 0 < cutoff < Nyquist, ascending')
    sos=signal.butter(order,cutoff if kind=='bandpass' else float(cutoff[0]),btype=kind,fs=fs,output='sos')
    return signal.sosfiltfilt(sos,x) if zero_phase else signal.sosfilt(sos,x)

def estimate(fx,my,p):
    # Published Eq. (2), IEEE TNSRE 33 (2025), p.4583; static support As=0.
    # Parameters are supplied explicitly; this module supplies no anthropometric defaults.
    mb,lb,jb,lf=[float(p[k]) for k in ('body_mass_kg','body_com_from_ankle_m','body_inertia_kg_m2','ankle_height_m')]
    if not np.isfinite([mb,lb,jb,lf]).all() or min(mb,lb,jb)<=0 or lf<0:
        raise ValueError('Invalid body parameters')
    c2=jb/(mb*lb)+lb+lf
    x=(my-c2*fx)/(mb*9.80665)
    # Body COM acceleration; feet assumed stationary, no external supports.
    acceleration=-fx/mb
    return x,acceleration

def two_link_coefficients(frequency,rx,ny,p):
    """Published Eqs.(3)-(5), static floor; complex Fourier coefficients in SI."""
    m1,m2,j1,j2,l1,l2,L1,Lf=[float(p[k]) for k in
        ('lower_mass_kg','upper_mass_kg','lower_inertia_kg_m2','upper_inertia_kg_m2',
         'lower_com_m','upper_com_m','lower_length_m','ankle_height_m')]
    if not np.isfinite([m1,m2,j1,j2,l1,l2,L1,Lf]).all() or min(m1,m2,j1,j2,l1,l2,L1)<=0 or Lf<0:
        raise ValueError('Invalid double-link parameters')
    c3=j1/l1+m1*(Lf+l1)-j2*L1/(l1*l2)
    c4=j2/l2+m2*(Lf+L1+l2)
    answers=[]
    for f,r,n in zip(frequency,rx,ny):
        if f<=0:raise ValueError('Double-link dynamic estimator excludes DC')
        w2=(2*np.pi*f)**2
        matrix=np.array([[-m1*w2,-m2*w2],[-c3*w2-m1*9.80665,-c4*w2-m2*9.80665]])
        if np.linalg.cond(matrix)>1e10:raise ValueError('Ill-conditioned double-link inversion')
        x1,x2=np.linalg.solve(matrix,[-r,-n])
        answers.append((m1*x1+m2*x2)/(m1+m2))
    return np.asarray(answers)

def harmonic_coefficients(time,x,frequencies):
    time=np.asarray(time);frequencies=np.asarray(frequencies)
    matrix=np.column_stack([np.ones(len(time)),
        *[f(time*2*np.pi*hz) for hz in frequencies for f in (np.cos,np.sin)]])
    if len(time)<=matrix.shape[1] or np.linalg.cond(matrix)>1e8:
        raise ValueError('Insufficient/ill-conditioned harmonic window')
    beta=np.linalg.lstsq(matrix,x,rcond=None)[0]
    return beta[1::2]-1j*beta[2::2]

def analyze(source,directory,config):
    channels,audit=read_csv(source)
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=False)
    p=json.loads(json.dumps(config)) if isinstance(config,dict) else json.loads(Path(config).read_text(encoding='utf-8'))
    fs=audit['fs_hz'];time=channels['time_s']
    filt=p.get('filter',{})
    def filtered(x):return apply_filter(x,fs,**filt)
    result={'time_s':time}
    for col in ('Fx','Fz','My','rawFx','rawFz','rawMy','xp','xb','axb'):
        if col in channels:result['vendor_'+col]=channels[col]
    # Estimation requires an explicit, reviewed sign/unit/calibration declaration.
    if p.get('estimation'):
        e=p['estimation']
        if not e.get('calibration_verified'):
            raise ValueError('Confirm channel calibration, axes and moment origin before estimating COM')
        fx=filtered((channels[e['fx_column']]-e['fx_bias_n'])*e['fx_sign_on_plate'])
        my=filtered((channels[e['my_column']]-e['my_bias_nm'])*e['my_sign_on_plate'])
        if audit['units'].get(e['fx_column'])!='N' or audit['units'].get(e['my_column']) not in ('N・m','N·m','N･m','Nｍ','N・ｍ','N•m','N\u30fbm'):
            # Vendor uses N・m; reject an unknown unit rather than guessing a scale.
            raise ValueError('Force/moment units are not verified N and N·m')
        x,a=estimate(fx,my,e)
        v=np.gradient(x,time,edge_order=2);a_dx=np.gradient(v,time,edge_order=2)
        result.update(com_single_link_m=x,com_velocity_derivative_m_s=v,
                      com_acceleration_force_m_s2=a,com_acceleration_derivative_m_s2=a_dx,
                      estimator_force_on_plate_n=fx,estimator_moment_on_plate_nm=my)
        if e.get('two_link'):
            frequencies=np.arange(1,31)*.05
            mask=(time>=p['start_s'])&(time<p['end_s'])
            if (p['end_s']-p['start_s'])<20:raise ValueError('Harmonic window must span at least 20 s')
            rxhat=harmonic_coefficients(time[mask],fx[mask],frequencies)
            nyhat=harmonic_coefficients(time[mask],my[mask],frequencies)
            xhat2=two_link_coefficients(frequencies,rxhat,nyhat,e['two_link'])
            xhat1=harmonic_coefficients(time[mask],x[mask],frequencies)
            stitched=np.where(frequencies<=.45000001,xhat1,xhat2)
            omega=2*np.pi*frequencies
            np.savetxt(directory/'com_harmonics.csv',np.c_[frequencies,xhat1.real,xhat1.imag,
                xhat2.real,xhat2.imag,stitched.real,stitched.imag,(1j*omega*stitched).real,
                (1j*omega*stitched).imag,(-omega**2*stitched).real,(-omega**2*stitched).imag],
                delimiter=',',header='frequency_hz,single_real_m,single_imag_m,double_real_m,double_imag_m,selected_real_m,selected_imag_m,velocity_real_m_s,velocity_imag_m_s,acceleration_real_m_s2,acceleration_imag_m_s2',comments='')
        if np.any(abs(channels[e['fz_column']])<e.get('minimum_load_n',20)):
            raise ValueError('Insufficient vertical load for COP')
        # Only valid when moment is already expressed at the contact plane.
        if e.get('moment_origin_is_contact_plane'):
            result['cop_m']=-my/(channels[e['fz_column']]*e['fz_sign_on_plate'])
    for col in p.get('filter_columns',['xb','axb','xp']):
        if col in channels:result['filtered_'+col]=filtered(channels[col])
    if 'xb' in channels and audit['units'].get('xb')=='mm':
        vendor_x=filtered(channels['xb'])*.001
        vendor_v=np.gradient(vendor_x,time,edge_order=2)
        result.update(vendor_com_filtered_m=vendor_x,vendor_com_velocity_derivative_m_s=vendor_v,
                      vendor_com_acceleration_derivative_m_s2=np.gradient(vendor_v,time,edge_order=2))
        if 'axb' in channels and audit['units'].get('axb')=='mm/s/s':
            result['vendor_com_acceleration_filtered_m_s2']=filtered(channels['axb'])*.001
    comparisons={}
    for ours,theirs,scale in [('com_single_link_m','xb',.001),('com_acceleration_force_m_s2','axb',.001),('cop_m','xp',.001)]:
        if ours in result and theirs in channels:
            mask=(time>=p.get('start_s',10))&(time<p.get('end_s',time[-1]))
            if mask.sum()<10:raise ValueError('Comparison interval too short')
            a,b=result[ours][mask],channels[theirs][mask]*scale
            comparisons[ours]=dict(rmse=float(np.sqrt(np.mean((a-b)**2))),
                demeaned_rmse=float(np.sqrt(np.mean(((a-a.mean())-(b-b.mean()))**2))))
    np.savetxt(directory/'analysis.csv',np.column_stack(list(result.values())),delimiter=',',header=','.join(result),comments='')
    audit.update(config=p,comparisons=comparisons,clock_mapping='unavailable; relative sample time only',
                 warnings=['raw prefix does not establish processing history','Published equations checked; vendor axes and calibration require independent validation',
                           'Single-link time series is approximate at high frequency; use selected harmonic estimates when double-link parameters are supplied',
                           'Filtering cannot undo existing vendor filters; derivative endpoints and filter edges unreliable'])
    (directory/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    return audit

if __name__=='__main__':
    import argparse
    cli=argparse.ArgumentParser();cli.add_argument('source');cli.add_argument('output');cli.add_argument('config')
    args=cli.parse_args();print(json.dumps(analyze(args.source,args.output,args.config),ensure_ascii=False,indent=2))
