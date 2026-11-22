"""Nonparametric harmonic FRF only; no posture-model identification changes."""
import argparse
import csv
import json
from pathlib import Path
import numpy as np
from .analysis import harmonic_coefficients,two_link_coefficients

def analyze(path,output,input_column,output_column,start=20,end=80,estimation_config=None):
    with Path(path).open(encoding='utf-8') as f:rows=list(csv.DictReader(f))
    if len({r['trial_id'] for r in rows})!=1:raise ValueError('Exactly one trial required')
    t=np.array([float(r['elapsed_s']) for r in rows]);mask=(t>=start)&(t<end)
    if end<=start or (end-start)<20 or abs((end-start)*.05-round((end-start)*.05))>1e-8:
        raise ValueError('Choose an integer multiple of 20 seconds for this harmonic grid')
    if t[0]>start+.02 or t[-1]<end-.02:raise ValueError('Requested FRF window not covered')
    all_f=np.arange(1,31)*.05
    f=all_f[:14]
    u=harmonic_coefficients(t[mask],np.array([float(r[input_column]) for r in rows])[mask],all_f)[:14]
    if output_column=='com_hybrid_m':
        if estimation_config is None:raise ValueError('Hybrid COM FRF requires the explicit verified estimation config')
        e=json.loads(Path(estimation_config).read_text(encoding='utf-8'))['estimation']
        if not e.get('calibration_verified') or not e.get('two_link'):raise ValueError('Verified calibration and double-link parameters required')
        if 'estimator_force_on_plate_n' not in rows[0] or 'estimator_moment_on_plate_nm' not in rows[0]:raise ValueError('Common-time estimator force/moment channels required')
        rx=harmonic_coefficients(t[mask],np.array([float(r['estimator_force_on_plate_n']) for r in rows])[mask],all_f)
        ny=harmonic_coefficients(t[mask],np.array([float(r['estimator_moment_on_plate_nm']) for r in rows])[mask],all_f)
        c2=e['body_inertia_kg_m2']/(e['body_mass_kg']*e['body_com_from_ankle_m'])+e['body_com_from_ankle_m']+e['ankle_height_m']
        single=(ny-c2*rx)/(e['body_mass_kg']*9.80665)
        double=two_link_coefficients(all_f,rx,ny,e['two_link'])
        y=np.where(all_f<=.45000001,single,double)[:14]
    else:y=harmonic_coefficients(t[mask],np.array([float(r[output_column]) for r in rows])[mask],all_f)[:14]
    if np.any(abs(u)<1e-10):raise ValueError('Input harmonic is too weak')
    h=y/u;output=Path(output);output.mkdir(parents=True,exist_ok=False)
    np.savetxt(output/'frf.csv',np.c_[f,h.real,h.imag,abs(h),np.angle(h,deg=True)],delimiter=',',
        header='frequency_hz,real,imag,gain,phase_deg',comments='')
    (output/'method.json').write_text(json.dumps(dict(input_column=input_column,output_column=output_column,
        start_s=start,end_s=end,estimation_config=str(estimation_config) if estimation_config is not None else None,
        method='joint 30-frequency sinusoidal least squares; complex output/input; hybrid uses single <=0.45 Hz, double >=0.50 Hz on common PC time',
        limits='One-trial FRF. No coherence or confidence intervals inferred; no control-model parameter identification.'),indent=2),encoding='utf-8')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');p.add_argument('input_column');p.add_argument('output_column');p.add_argument('--start',type=float,default=20);p.add_argument('--end',type=float,default=80);p.add_argument('--estimation-config')
    a=p.parse_args();analyze(a.source,a.output,a.input_column,a.output_column,a.start,a.end,a.estimation_config)
