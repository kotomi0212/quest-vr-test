"""Deterministic acceleration multisine; SI units, analytic envelope derivatives."""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize_scalar

FREQUENCIES = np.arange(1, 31) * .05
W = 2*np.pi*FREQUENCIES

def envelope(t):
    t = np.asarray(t, float)
    u = np.clip(np.minimum(t, 90-t)/5, 0, 1)
    direction = np.where(t < 45, 1., -1.)/5
    inside = (u > 0) & (u < 1)
    e = 10*u**3-15*u**4+6*u**5
    d = np.where(inside, (30*u**2-60*u**3+30*u**4)*direction, 0)
    dd = np.where(inside, (60*u-180*u**2+120*u**3)/25, 0)
    return e, d, dd

def evaluate(t, phases, amplitude=1., ramp=True):
    t = np.atleast_1d(t)
    z = t[:, None]*W + phases
    x = (-np.cos(z)/W**2).sum(axis=1)*amplitude
    v = (np.sin(z)/W).sum(axis=1)*amplitude
    a = np.cos(z).sum(axis=1)*amplitude
    if not ramp:
        return x, v, a
    e, d, dd = envelope(t)
    return e*x, e*v+d*x, e*a+2*d*v+dd*x

def peak(phases, component):
    t = np.linspace(0, 90, 18001)
    values = np.abs(evaluate(t, phases)[component])
    candidates = np.flatnonzero((values[1:-1] >= values[:-2]) & (values[1:-1] >= values[2:]))+1
    best = float(max(values[0], values[-1]))
    for i in candidates:
        r = minimize_scalar(lambda s: -abs(evaluate([s], phases)[component][0]),
                            bounds=(t[i-1], t[i+1]), method='bounded', options={'xatol':1e-12})
        best = max(best, -r.fun)
    return best

def generate(directory):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=False)
    rng = np.random.default_rng(20261120)
    t = np.arange(0, 90, .025)
    choices = [(-np.pi*np.arange(30)*(np.arange(30)-1)/30)]
    choices += [rng.uniform(-np.pi,np.pi,30) for _ in range(192)]
    def score(p):
        x,v,a=evaluate(t,p)
        # Penalize both travel and acceleration after speed normalization.
        s=.1/np.max(np.abs(v))
        return max(np.max(np.abs(x))*s/.5, np.max(np.abs(a))*s/.8)
    phases=min(choices,key=score)
    amplitude=.1/peak(phases,1)
    config=dict(schema=1, seed=20261120, phases_rad=phases.tolist(),
                frequencies_hz=FREQUENCIES.tolist(), acceleration_component_m_s2=amplitude,
                duration_s=90, ramp_s=5, analysis_default_s=[20,80],
                stationary_interval_s=[5,85],
                maxima=dict(zip(['displacement_m','velocity_m_s','acceleration_m_s2'],
                                [peak(phases,i)*amplitude for i in range(3)])),
                note='Equal acceleration components only in stationary interval; ramps add sidebands. 10 s settling is unvalidated.')
    (directory/'stimulus.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
    t=np.arange(0,90+.001,.001)
    signals=evaluate(t,phases,amplitude)
    np.savetxt(directory/'stimulus.csv',np.column_stack([t,*signals]),delimiter=',',
               header='elapsed_s,ap_m,ap_m_s,ap_m_s2',comments='')
    # 60-second stationary section: all thirty frequencies land on FFT bins.
    ts=np.arange(20,80,.001)
    acc=evaluate(ts,phases,amplitude)[2]
    spectrum=2*abs(np.fft.rfft(acc))/len(acc)
    freq=np.fft.rfftfreq(len(acc),.001)
    measured=spectrum[np.rint(FREQUENCIES*60).astype(int)]
    np.savetxt(directory/'component_amplitudes.csv',np.c_[FREQUENCIES,measured],delimiter=',',
               header='frequency_hz,acceleration_amplitude_m_s2',comments='')
    assert np.allclose(measured,amplitude,rtol=1e-9,atol=1e-12)
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(4,1,figsize=(12,10),layout='constrained')
    for ax,y,label in zip(axes,signals,['Displacement (m)','Velocity (m/s)','Acceleration (m/s²)']):
        ax.plot(t[::10],y[::10],lw=.7); ax.set(ylabel=label,xlabel='Time (s)'); ax.axvspan(20,80,alpha=.12)
    axes[3].stem(freq[freq<=2],spectrum[freq<=2]);axes[3].set(xlabel='Frequency (Hz)',ylabel='Acceleration amplitude (m/s²)')
    fig.savefig(directory/'stimulus.png',dpi=140);plt.close(fig)
    return config

if __name__=='__main__':
    import sys
    print(json.dumps(generate(sys.argv[1]),indent=2))
