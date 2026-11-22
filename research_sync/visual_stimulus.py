"""Visual stimulus only: analytic multicosine, stationary through the last instant.

Endpoint phase constraints make velocity and acceleration zero at T. The constant
position offset makes position zero there, without modifying acceleration lines.
Only the first ten seconds have a position envelope, differentiated analytically.
"""
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize,minimize_scalar

def settings(path=None):
    p=json.loads(Path(path or Path(__file__).with_name('visual_stimulus_settings.json')).read_text(encoding='utf-8'))
    values=[p[k] for k in ('duration_s','stationary_start_s','frequency_min_hz','frequency_max_hz','frequency_step_hz','target_velocity_peak_m_s')]
    if not np.isfinite(values).all() or not 0<p['stationary_start_s']<p['duration_s'] or min(values[2:])<=0:
        raise ValueError('Invalid visual stimulus settings')
    count=round((p['frequency_max_hz']-p['frequency_min_hz'])/p['frequency_step_hz'])+1
    f=p['frequency_min_hz']+np.arange(count)*p['frequency_step_hz']
    if count<2 or not np.isclose(f[-1],p['frequency_max_hz']):raise ValueError('Invalid frequency grid')
    return p,f

def startup_envelope(time,startup):
    t=np.asarray(time,float);u=np.clip(t/startup,0,1);inside=(t>0)&(t<startup)
    e=10*u**3-15*u**4+6*u**5
    d=np.where(inside,(30*u**2-60*u**3+30*u**4)/startup,0)
    dd=np.where(inside,(60*u-180*u**2+120*u**3)/startup**2,0)
    return e,d,dd

def evaluate(time,config):
    t=np.atleast_1d(np.asarray(time,float));T=config['duration_s'];tau=config['stationary_start_s']
    w=2*np.pi*np.asarray(config['frequencies_hz']);theta=np.asarray(config['endpoint_phases_rad']);A=config['acceleration_component_m_s2']
    angle=(np.clip(t,0,T)[:,None]-T)*w+theta
    x=A*((np.cos(theta)-np.cos(angle))/w**2).sum(axis=1)
    v=A*(np.sin(angle)/w).sum(axis=1);a=A*np.cos(angle).sum(axis=1)
    e,d,dd=startup_envelope(t,tau)
    result=(e*x,e*v+d*x,e*a+2*d*v+dd*x)
    # Outside the trial the room stays at its neutral position. The constrained
    # analytic limits at T are checked independently before this clamping.
    outside=(t<0)|(t>T)
    return tuple(np.where(outside,0,y) for y in result)

def endpoint_constraints(theta,w):
    return np.array([(np.sin(theta)/w).sum()/np.linalg.norm(1/w),np.cos(theta).sum()/np.sqrt(len(w))])

def design_phases(p,frequencies):
    w=2*np.pi*frequencies;n=len(w);rng=np.random.default_rng(p['seed'])
    t=np.linspace(0,p['duration_s'],1801);angle=(t[:,None]-p['duration_s'])*w
    C=np.cos(angle);S=np.sin(angle);e,d,dd=startup_envelope(t,p['stationary_start_s'])
    normw=np.linalg.norm(1/w)
    constraint=dict(type='eq',fun=lambda z:endpoint_constraints(z,w),
        jac=lambda z:np.vstack([np.cos(z)/w/normw,-np.sin(z)/np.sqrt(n)]))
    def signals_and_jac(theta):
        c=np.cos(theta);s=np.sin(theta)
        x=(1-C)@(c/w**2)+S@(s/w**2);v=S@(c/w)+C@(s/w);a=C@c-S@s
        jx=((C-1)*s+S*c)/w**2;jv=(-S*s+C*c)/w;ja=-C*s-S*c
        return ((e*x,e*v+d*x,e*a+2*d*v+dd*x),
                (e[:,None]*jx,e[:,None]*jv+d[:,None]*jx,e[:,None]*ja+2*d[:,None]*jv+dd[:,None]*jx))
    def norm_gradient(y,jac):
        scale=max(float(abs(y).max()),1e-12);q=y/scale;pwr=12
        norm=(np.mean(abs(q)**pwr))**(1/pwr)*scale
        grad=np.mean((q*abs(q)**(pwr-2))[:,None]*jac,axis=0)/(max(norm/scale,1e-12)**(pwr-1))
        return norm,grad
    def objective(theta):
        ys,js=signals_and_jac(theta);nx,dx=norm_gradient(ys[0],js[0]);nv,dv=norm_gradient(ys[1],js[1]);na,da=norm_gradient(ys[2],js[2])
        numerator=nx/.30+na/.25;derivative=dx/.30+da/.25
        return .1*numerator/nv,.1*(derivative/nv-numerator*dv/nv**2)
    candidates=[]
    # Balanced 0/pi signs are a feasible reference when the component count is even.
    if n%2==0:
        reference=np.r_[np.zeros(n//2),np.full(n//2,np.pi)];rng.shuffle(reference);candidates.append(reference)
    for _ in range(int(p['phase_candidates'])):
        initial=rng.uniform(-np.pi,np.pi,n)
        projected=minimize(lambda z:(float(np.sum(1-np.cos(z-initial))),np.sin(z-initial)),initial,
            jac=True,constraints=[constraint],method='SLSQP',options=dict(ftol=1e-11,maxiter=100))
        if np.max(abs(constraint['fun'](projected.x)))<1e-8:candidates.append(projected.x)
    if not candidates:raise RuntimeError('Could not construct endpoint-stationary phases')
    candidates.sort(key=lambda z:objective(z)[0]);refined=[]
    for initial in candidates[:3]:
        fit=minimize(objective,initial,jac=True,constraints=[constraint],method='SLSQP',
            options=dict(ftol=1e-9,maxiter=int(p['phase_refinement_iterations'])))
        if np.max(abs(constraint['fun'](fit.x)))<1e-8:refined.append(fit.x)
    phases=min(candidates[:3]+refined,key=lambda z:objective(z)[0])
    # Final feasibility projection removes optimizer tolerances without changing
    # the acceleration amplitudes, which remain one common scalar.
    projected=minimize(lambda z:(float(np.sum((z-phases)**2)),2*(z-phases)),phases,
        jac=True,constraints=[constraint],method='SLSQP',options=dict(ftol=1e-13,maxiter=100))
    if np.max(abs(constraint['fun'](projected.x)))>1e-10:raise RuntimeError('Endpoint constraints failed')
    return (projected.x+np.pi)%(2*np.pi)-np.pi

def peak(config,component):
    dt=min(.005,1/(200*max(config['frequencies_hz'])))
    t=np.linspace(0,config['duration_s'],int(np.ceil(config['duration_s']/dt))+1)
    y=abs(evaluate(t,config)[component]);indices=np.flatnonzero((y[1:-1]>=y[:-2])&(y[1:-1]>=y[2:]))+1
    best=max(float(y[0]),float(y[-1]));when=float(t[int(np.argmax(y))])
    for i in indices:
        result=minimize_scalar(lambda q:-abs(evaluate([q],config)[component][0]),bounds=(t[i-1],t[i+1]),method='bounded',options={'xatol':1e-12})
        if -result.fun>best:best=-float(result.fun);when=float(result.x)
    return dict(value=best,time_s=when)

def generate(output,settings_path=None):
    p,f=settings(settings_path);output=Path(output);output.mkdir(parents=True,exist_ok=False)
    theta=design_phases(p,f);w=2*np.pi*f
    config=dict(schema=2,waveform='endpoint_stationary_multicosine',duration_s=p['duration_s'],stationary_start_s=p['stationary_start_s'],
        stationary_interval_s=[p['stationary_start_s'],p['duration_s']],frequencies_hz=f.tolist(),endpoint_phases_rad=theta.tolist(),
        phases_rad=((theta-w*p['duration_s']+np.pi)%(2*np.pi)-np.pi).tolist(),acceleration_component_m_s2=1.,
        target_velocity_peak_m_s=p['target_velocity_peak_m_s'],settings=p,
        boundary_method='Endpoint velocity and acceleration constrained to zero; constant position offset; startup-only quintic envelope',
        integration='Analytic; no numerical integration',note='Pure equal-acceleration multicosine throughout the stationary interval, including the endpoint. No end taper.')
    config['acceleration_component_m_s2']=p['target_velocity_peak_m_s']/peak(config,1)['value']
    maxima={name:peak(config,k) for k,name in enumerate(['displacement_m','velocity_m_s','acceleration_m_s2'])};config['maxima']=maxima
    end=evaluate([p['duration_s']],config);start=evaluate([0],config)
    if max(abs(y[0]) for y in end)>1e-9 or max(abs(y[0]) for y in start)>1e-9:raise RuntimeError('Rest boundary continuity failed')
    (output/'stimulus.json').write_text(json.dumps(config,indent=2),encoding='utf-8')
    t=np.linspace(0,p['duration_s'],round(p['duration_s']*1000)+1);x,v,a=evaluate(t,config)
    np.savetxt(output/'stimulus.csv',np.c_[t,x,v,a],delimiter=',',header='time_s,displacement_m,velocity_m_s,acceleration_m_s2',comments='')
    # Independent joint harmonic fit on the full requested interval, no endpoint ramp.
    ts=np.arange(p['stationary_start_s'],p['duration_s'],.005);acc=evaluate(ts,config)[2]
    matrix=np.column_stack([np.ones(len(ts)),*[func(2*np.pi*hz*ts) for hz in f for func in (np.cos,np.sin)]])
    beta=np.linalg.lstsq(matrix,acc,rcond=None)[0];amplitudes=np.hypot(beta[1::2],beta[2::2])
    np.testing.assert_allclose(amplitudes,config['acceleration_component_m_s2'],rtol=1e-9,atol=1e-12)
    np.savetxt(output/'component_amplitudes.csv',np.c_[f,amplitudes],delimiter=',',header='frequency_hz,acceleration_amplitude_m_s2',comments='')
    verification=dict(duration_s=p['duration_s'],constant_amplitude_interval_s=config['stationary_interval_s'],
        component_count=len(f),common_acceleration_amplitude_m_s2=config['acceleration_component_m_s2'],
        measured_component_amplitudes_m_s2=amplitudes.tolist(),max_relative_component_error=float(np.max(abs(amplitudes/config['acceleration_component_m_s2']-1))),
        maxima=maxima,start_state=[float(y[0]) for y in start],end_state=[float(y[0]) for y in end],
        acceleration_crest_factor=float(maxima['acceleration_m_s2']['value']/(config['acceleration_component_m_s2']*np.sqrt(len(f)/2))),
        optimization='Deterministic candidate projection and constrained local phase refinement; no global-optimum claim')
    (output/'verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(4,1,figsize=(12,11),layout='constrained')
    for ax,y,label in zip(axes[:3],[x,v,a],['Displacement (m)','Velocity (m/s)','Acceleration (m/s²)']):
        ax.plot(t[::10],y[::10],lw=.8);ax.axvspan(p['stationary_start_s'],p['duration_s'],color='#b9ddc6',alpha=.25)
        ax.axvline(p['stationary_start_s'],ls='--',color='#617267',lw=.8);ax.set(xlabel='Time (s)',ylabel=label,xlim=(0,p['duration_s']))
    axes[1].axhline(p['target_velocity_peak_m_s'],ls=':',color='#a33');axes[1].axhline(-p['target_velocity_peak_m_s'],ls=':',color='#a33')
    axes[3].stem(f,amplitudes);axes[3].set(xlabel='Frequency (Hz)',ylabel='Acceleration amplitude (m/s²)',ylim=(0,1.15*amplitudes.max()))
    fig.suptitle(f"{p['duration_s']:g} s analytic multicosine | constant amplitudes over {p['stationary_start_s']:g}–{p['duration_s']:g} s | no end taper")
    fig.savefig(output/'waveforms.png',dpi=140);plt.close(fig)
    return verification

if __name__=='__main__':
    import argparse
    cli=argparse.ArgumentParser();cli.add_argument('output');cli.add_argument('--settings');args=cli.parse_args()
    print(json.dumps(generate(args.output,args.settings),indent=2))
