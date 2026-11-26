"""Visual profiles for the existing synchronized acquisition service."""
import copy

def select_stimulus(default,condition):
    if condition.startswith('study_'):
        from .study_stimuli import profile
        return profile(condition)
    if condition.startswith('pilot_'):
        from .low_band import profile
        return profile(condition)
    if condition=='multicosine':
        result=copy.deepcopy(default);result['condition']=condition;result['fixation']=None
        return result
    if condition not in ('none','dot','spinner'):raise ValueError('Unknown visual condition')
    return dict(schema=3,waveform='fixation_single_sine',duration_s=30,condition=condition,
        frequency_hz=.2,ramp_s=3,target_velocity_peak_m_s=.1,
        fixation=dict(condition=condition,distance_m=2.5,point_radius_m=.025,spinner_radius_m=.065,spinner_rate_hz=1),
        timing_note='Same Quest/PC clock probes and force capture path as the 90 second trial')
