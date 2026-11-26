"""Pilot waveforms: fixed per-component acceleration, no peak renormalization."""
import copy
import json
from pathlib import Path
import numpy as np
from scipy.optimize import minimize,minimize_scalar

ROOT=Path(__file__).parent
OUTPUT=ROOT/'pilot_profiles'
BASE_A=.01666464946520325
# Engineering bounds for this pilot; these do not certify human-subject safety.
LIMITS=dict(displacement_m=.30,velocity_m_s=.10,acceleration_m_s2=.20)

def envelope(t,T,R):
    t=np.atleast_1d(t).astype(float);u=np.clip(np.minimum(t,T-t)/R,0,1);inside=(u>0)&(u<1)
    e=10*u**3-15*u**4+6*u**5
    d=np.where(inside,(30*u**2-60*u**3+30*u**4)/R*np.where(t<T/2,1,-1),0)
    dd=np.where(inside,(60*u-180*u**2+120*u**3)/R**2,0)
    return e,d,dd

def evaluate(t,c):
    t=np.atleast_1d(t).astype(float);w=2*np.pi*np.array(c['frequencies_hz']);z=t[:,None]*w+np.array(c['phases_rad'])
    A=c['acceleration_component_m_s2'];x=-A*(np.cos(z)/w**2).sum(1);v=A*(np.sin(z)/w).sum(1);a=A*np.cos(z).sum(1)
    e,d,dd=envelope(t,c['duration_s'],c['ramp_s']);outside=(t<=0)|(t>=c['duration_s'])
    return tuple(np.where(outside,0,y) for y in (e*x,e*v+d*x,e*a+2*d*v+dd*x))

def peaks(c):
    t=np.linspace(0,c['duration_s'],int(c['duration_s']/.002)+1);ys=evaluate(t,c);result={}
    for k,name in enumerate(LIMITS):
        y=abs(ys[k]);best=float(y.max());at=float(t[y.argmax()]);idx=np.flatnonzero((y[1:-1]>y[:-2])&(y[1:-1]>=y[2:]))+1
        for i in idx:
            opt=minimize_scalar(lambda q:-abs(evaluate([q],c)[k][0]),bounds=(t[i-1],t[i+1]),method='bounded',options={'xatol':1e-11})
            if -opt.fun>best:best=-float(opt.fun);at=float(opt.x)
        result[name]=dict(value=best,time_s=at)
    return result

def check_limits(c):
    f=np.asarray(c['frequencies_hz'],float);p=np.asarray(c['phases_rad'],float)
    if not len(f) or f.shape!=p.shape or not np.isfinite(f).all() or not np.isfinite(p).all() or np.any(f<=0):raise ValueError('Invalid pilot frequency or phase')
    scalar=[c['duration_s'],c['ramp_s'],c['acceleration_component_m_s2']]
    if not np.isfinite(scalar).all() or not 0<c['ramp_s']<c['duration_s']/2 or c['acceleration_component_m_s2']<0:raise ValueError('Invalid pilot duration, ramp or amplitude')
    actual=peaks(c)
    violations=[name for name,limit in LIMITS.items() if actual[name]['value']>limit*(1+1e-8)]
    return actual,violations

def profile(condition):
    c=json.loads((OUTPUT/(condition+'.json')).read_text(encoding='utf-8'))
    actual,violations=check_limits(c)
    if violations:raise ValueError('暫定上限を超えるため開始できません: '+', '.join(violations))
    c['maxima']=actual
    return copy.deepcopy(c)

def generate():
    OUTPUT.mkdir(exist_ok=True)
    f=np.array([.05,.10,.20,.40,.70]);t=np.linspace(0,100,2001);w=2*np.pi*f;C=np.cos(t[:,None]*w);S=np.sin(t[:,None]*w);e,d,dd=envelope(t,100,10)
    def objective(p):
        co=np.cos(p);si=np.sin(p);x=-BASE_A*(C@(co/w**2)-S@(si/w**2));v=BASE_A*(S@(co/w)+C@(si/w));a=BASE_A*(C@co-S@si)
        signals=[e*x,e*v+d*x,e*a+2*d*v+dd*x]
        return sum(np.mean((abs(y)/limit)**12)**(1/12) for y,limit in zip(signals,LIMITS.values()))
    rng=np.random.default_rng(20261123);candidates=rng.uniform(-np.pi,np.pi,(256,5));best=sorted(candidates,key=objective)[:3]
    fits=[minimize(objective,p,method='Powell',options=dict(maxiter=80,ftol=1e-8)).x for p in best]
    phases=min(best+fits,key=objective).tolist()
    records=[]
    for kind,freq,T,R,phase in [('single',[.2],40,5,[0.]),('five',f.tolist(),100,10,phases),('rest',[.2],60,5,[0.])]:
        for multiple in ([1,1.4,2,3] if kind=='five' else [1,2,3] if kind=='single' else [0]):
            name='pilot_rest' if kind=='rest' else f'pilot_{kind}_x{str(multiple).replace(chr(46),chr(112))}'
            c=dict(schema=4,waveform='pilot_acceleration_multicosine',condition=name,duration_s=T,ramp_s=R,
                analysis_interval_s=[R,T-R] if kind!='rest' else [0,T],frequencies_hz=freq,phases_rad=phase,
                acceleration_component_m_s2=BASE_A*multiple,amplitude_multiple=multiple,reference_component_m_s2=BASE_A,
                fixation=None,engineering_limits=LIMITS,normalization='None: exact requested per-component acceleration',
                sign_convention='AP positive is world -Z; translate whole room, never camera',
                caution='Engineering limits are not validated human safety limits; no sensor or photon delay calibration')
            c['maxima'],violations=check_limits(c);c['limit_violations']=violations;c['enabled']=not violations
            (OUTPUT/(name+'.json')).write_text(json.dumps(c,indent=2),encoding='utf-8');records.append(c)
    (OUTPUT/'index.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
    return records

if __name__=='__main__':
    records=generate()
    print(json.dumps([dict(condition=c['condition'],A=c['acceleration_component_m_s2'],maxima=c['maxima'],enabled=c['enabled']) for c in records],indent=2))
