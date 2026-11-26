"""Exploratory processed-channel comparison, never a raw-calibration claim."""
import json
from pathlib import Path
import numpy as np
from .analysis import read_csv,estimate,harmonic_coefficients,two_link_coefficients

def compare(source,output):
    c,a=read_csv(source);meta=a['metadata']
    H=float(meta['身長(cm)'])/100;M=float(meta['体重(kg)'])
    if meta['性別']!='女性':raise ValueError('This explicit study configuration uses female Table I coefficients')
    params=dict(body_mass_kg=.978*M,body_com_from_ankle_m=.523*H,
                body_inertia_kg_m2=.0441*M*H**2,ankle_height_m=.038*H)
    double=dict(lower_mass_kg=.352*M,upper_mass_kg=.626*M,lower_inertia_kg_m2=.00249*M*H**2,
                upper_inertia_kg_m2=.0121*M*H**2,lower_com_m=.291*H,upper_com_m=.193*H,
                lower_length_m=.460*H,ankle_height_m=.038*H)
    # Test the on-platform horizontal force convention suggested by axb/Fx.
    # recorded here and not elevated to calibration_verified in the production API.
    x,acc=estimate(c['Fx'],c['My'],params)
    t=c['time_s'];mask=(t>=10)&(t<50)
    pairs=[('COM displacement',x,c['xb']*.001,'m'),
           ('COM acceleration',acc,c['axb']*.001,'m/s²'),
           ('COP contact-plane approximation',c['My']/c['Fz'],c['xp']*.001,'m')]
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(3,2,figsize=(12,9),layout='constrained')
    report=dict(source_audit=a,body_parameters=params,two_link_parameters=double,
        status='exploratory_processed_channels_only_not_calibrated_validation',
        assumptions=['Fx/My hypothesized on-platform signs; Fz is positive load magnitude','Moment origin correction 12.3 mm not applied',
                     'Female Table I anthropometry from reported height and mass',
                     'Existing filtering remains present; no raw bias correction inferred'],metrics={})
    for row,(name,ours,vendor,unit) in enumerate(pairs):
        ac=ours[mask]-ours[mask].mean();bc=vendor[mask]-vendor[mask].mean()
        report['metrics'][name]=dict(demeaned_rmse=float(np.sqrt(np.mean((ac-bc)**2))),unit=unit,
            correlation=float(np.corrcoef(ac,bc)[0,1]))
        axes[row,0].plot(t[mask],ac,label='candidate',lw=.8);axes[row,0].plot(t[mask],bc,label='vendor',lw=.8)
        axes[row,0].set(title=name+' (demeaned)',xlabel='Time (s)',ylabel=unit);axes[row,0].legend()
        f=np.fft.rfftfreq(mask.sum(),1/a['fs_hz']);ya=2*abs(np.fft.rfft(ac))/mask.sum();yb=2*abs(np.fft.rfft(bc))/mask.sum()
        keep=(f>0)&(f<=1.5)
        axes[row,1].semilogy(f[keep],ya[keep],label='candidate');axes[row,1].semilogy(f[keep],yb[keep],label='vendor')
        axes[row,1].set(xlabel='Frequency (Hz)',ylabel='Amplitude ('+unit+')');axes[row,1].legend()
    fig.suptitle('Exploratory comparison: processed channels, unverified axes/origin')
    fig.savefig(output/'comparison.png',dpi=130);plt.close(fig)
    frequencies=np.arange(1,31)*.05
    hats=two_link_coefficients(frequencies,
        harmonic_coefficients(t[mask],c['Fx'][mask],frequencies),
        harmonic_coefficients(t[mask],c['My'][mask],frequencies),double)
    single=harmonic_coefficients(t[mask],x[mask],frequencies)
    vendor=harmonic_coefficients(t[mask],c['xb'][mask]*.001,frequencies)
    np.savetxt(output/'harmonics.csv',np.c_[frequencies,abs(single),abs(hats),abs(vendor)],delimiter=',',
        header='frequency_hz,single_candidate_m,double_candidate_m,vendor_m',comments='')
    np.savetxt(output/'candidate.csv',np.c_[t,x,acc,c['My']/c['Fz']],delimiter=',',
        header='sample_time_s,unverified_com_m,unverified_com_acceleration_m_s2,unverified_cop_m',comments='')
    (output/'comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report['metrics'],ensure_ascii=True,indent=2))

if __name__=='__main__':
    import sys
    compare(sys.argv[1],sys.argv[2])
