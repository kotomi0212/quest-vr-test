"""Runnable 2026-11-24 visual profiles for the acquisition application."""
import copy
import json
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parent/'study_profiles'
LABELS={
    '90秒 スイープ 0.70→0.05 Hz（中心固定）':'study_sweep90',
    '100秒 マルチコサイン10周波数（20秒×4周期）':'study_multicosine10',
}

def profile(condition):
    if condition not in LABELS.values():raise ValueError('Unknown study stimulus')
    c=json.loads((ROOT/(condition+'.json')).read_text(encoding='utf-8'))
    if c.get('condition')!=condition or not c.get('enabled'):raise ValueError('Stimulus is not enabled')
    if c['waveform']=='sampled_centered_sweep':
        samples=np.asarray(c['samples_xva'],float)
        if samples.shape!=(4501,3) or not np.isfinite(samples).all() or c['sample_step_s']!=.02 or c['duration_s']!=90:
            raise ValueError('Invalid sweep samples')
        peaks=np.max(abs(samples),axis=0)
        if np.any(peaks>np.array([.30,.10,.20])):raise ValueError('Sweep exceeds configured bounds')
        if max(abs(samples[[0,-1],1]))>1e-8:raise ValueError('Sweep endpoint velocity is not zero')
    elif c['waveform']=='pilot_acceleration_multicosine':
        from .low_band import check_limits
        _,violations=check_limits(c)
        if violations:raise ValueError('Stimulus exceeds configured bounds: '+', '.join(violations))
    else:raise ValueError('Unsupported study waveform')
    return copy.deepcopy(c)

def available_conditions():
    """Only expose pilot conditions whose generated profiles are enabled."""
    result=dict(LABELS)
    result.update({'90秒 マルチコサイン30周波数（従来）':'multicosine',
        '30秒 注視点なし':'none','30秒 赤い固定点':'dot','30秒 ローディング表示':'spinner',
        '静止60秒：ノイズ確認':'pilot_rest'})
    for kind,title,T in [('single','単一0.20 Hz',40),('five','5周波数',100)]:
        for n in ((1,1.4,2,3) if kind=='five' else (1,2,3)):
            key=f'pilot_{kind}_x{str(n).replace(chr(46),chr(112))}'
            try:c=json.loads((ROOT.parent/'pilot_profiles'/(key+'.json')).read_text(encoding='utf-8'))
            except (OSError,ValueError):continue
            if c.get('enabled'):result[f'{title} {T}秒・成分振幅{n}倍']=key
    return result
