"""Four timestamp affine mapping. All timestamps in monotonic seconds."""
import numpy as np

def fit_clock(probes):
    # q1 request send; p2 PC receive; p3 PC send; q4 Quest receive.
    a=np.asarray([[p[k] for k in ('q1','p2','p3','q4')] for p in probes],float)
    if a.ndim!=2 or a.shape[0]<8 or a.shape[1]!=4 or not np.isfinite(a).all():
        raise ValueError('At least eight finite four-timestamp probes required')
    q1,p2,p3,q4=a.T
    rtt=q4-q1-(p3-p2)
    if np.any(q4<q1) or np.any(p3<p2) or np.any(rtt<-.0001):
        raise ValueError('Invalid probe ordering or mixed clock units')
    q=(q1+q4)/2;p=(p2+p3)/2
    # Keep lowest-latency half within each time quartile, preserving drift baseline.
    groups=np.array_split(np.argsort(q),4)
    chosen=np.concatenate([g[np.argsort(rtt[g])[:max(1,len(g)//2)]] for g in groups])
    origin=float(q[chosen].mean());target=float(p[chosen].mean())
    span=float(np.ptp(q[chosen]))
    if span<1:raise ValueError('Clock drift needs probes spanning at least one second')
    slope=float(np.linalg.lstsq((q[chosen]-origin)[:,None],p[chosen]-target,rcond=None)[0][0])
    residual=p-(target+slope*(q-origin))
    return dict(quest_origin_s=origin,pc_origin_s=target,slope=slope,
        drift_ppm=(slope-1)*1e6,probe_span_s=span,probes=len(a),selected=len(chosen),
        rtt_min_s=float(rtt.min()),rtt_median_s=float(np.median(rtt)),
        rtt_p95_s=float(np.quantile(rtt,.95)),
        residual_rms_s=float(np.sqrt(np.mean(residual**2))),
        selected_residual_rms_s=float(np.sqrt(np.mean(residual[chosen]**2))),
        selected_residual_p95_abs_s=float(np.quantile(abs(residual[chosen]),.95)),
        uncertainty_note='RTT/2 is an asymmetry allowance, not measured absolute accuracy. Optical and sensor latency excluded.',
        asymmetry_allowance_max_s=float(max(0,rtt.max())/2),
        extrapolation_warning='Do not extrapolate outside probe range without additional validation',
        quest_range_s=[float(q.min()),float(q.max())])

def to_pc(q,model):
    return model['pc_origin_s']+model['slope']*(np.asarray(q)-model['quest_origin_s'])

def resample(time,values,target,max_gap):
    time=np.asarray(time,float);values=np.asarray(values,float);target=np.asarray(target,float)
    if len(time)<2 or values.shape!=time.shape or np.any(np.diff(time)<=0) or not all(np.isfinite(x).all() for x in (time,values,target)):
        raise ValueError('Invalid time series')
    if target.min()<time[0] or target.max()>time[-1]:raise ValueError('Extrapolation forbidden')
    right=np.searchsorted(time,target,side='right').clip(1,len(time)-1)
    gaps=time[right]-time[right-1]
    exact=np.isin(target,time)
    if np.any((gaps>max_gap)&~exact):raise ValueError('Refusing to interpolate across a recording gap')
    return np.interp(target,time,values)
