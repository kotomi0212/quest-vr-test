"""Participant labels, baseline force weight estimate, and reviewed CSV copies."""
import csv
from datetime import datetime,timezone,timedelta
import json
import math
from pathlib import Path
import re
import statistics
import tempfile

STIMULI={'multicosine':'90s_multicosine','none':'30s_no_fixation','dot':'30s_red_dot','spinner':'30s_loading'}
STIMULI.update({'study_sweep90':'90s_sweep_centered','study_multicosine10':'100s_multicosine10'})

STIMULI.update({'pilot_rest':'60s_rest','pilot_five_x1p4':'100s_five_x1p4'})
STIMULI.update({f'pilot_{kind}_x{n}':f'{T}s_{kind}_x{n}' for kind,T in [('single',40),('five',100)] for n in (1,2,3)})

def participant_info(value):
    subject=str(value['subject']).strip();height=float(value['height_cm']);number=int(value['trial_number'])
    if not subject or len(subject)>80:raise ValueError('被験者名を1～80文字で入力してください')
    if not math.isfinite(height) or not 30<=height<=250:raise ValueError('身長は30～250 cmで入力してください')
    if number<1 or str(value['trial_number']).strip()!=str(number):raise ValueError('試行番号は1以上の整数で入力してください')
    return dict(subject=subject,height_cm=height,trial_number=number)

def estimate_weight(directory,metadata):
    """Only the final 2 s of available pre-stimulus static Fz; never the motion."""
    starts=[c['scheduled_pc_s'] for c in metadata.get('pc_commands',[]) if c['kind']=='command_start']
    path=Path(directory)/'combalance.csv'
    result=dict(body_mass_kg=None,status='no_prestimulus_data',method='abs(median(prestimulus sensor_Fz_N))/9.80665; provisional, includes worn equipment')
    if not starts or not path.exists():return result
    start=starts[0];values=[];times=[]
    with path.open(encoding='utf-8-sig',newline='') as stream:
        for row in csv.DictReader(stream):
            try:t=float(row['pc_estimated_sample_time_s']);fz=float(row['sensor_Fz_N'])
            except (ValueError,KeyError):continue
            if start-2<=t<start and math.isfinite(fz):values.append(fz);times.append(t)
    if len(values)<20 or max(times,default=0)-min(times,default=0)<.5:return result
    median=statistics.median(values);mass=abs(median)/9.80665
    spread=(sum((v-median)**2 for v in values)/len(values))**.5/max(abs(median),1)
    result.update(sample_count=len(values),interval_pc_s=[min(times),max(times)],relative_rms=spread)
    if not 10<=mass<=250:result['status']='force_out_of_range';return result
    if spread>.05:result['status']='unstable_baseline';return result
    result.update(body_mass_kg=round(mass,3),status='estimated_from_static_Fz_unvalidated')
    return result

def basename(metadata):
    p=participant_info(metadata['participant'])
    subject=re.sub(r'[<>:"/\\|?*\x00-\x1f]','-',p['subject']).strip(' .')
    if not subject:raise ValueError('ファイル名に使用できる被験者名を入力してください')
    commands=[c for c in metadata['pc_commands'] if c['kind']=='command_start']
    stamp=commands[0]['pc_epoch_s']
    date=datetime.fromtimestamp(stamp,timezone(timedelta(hours=9))).strftime('%Y%m%d')
    stimulus=STIMULI[metadata['stimulus'].get('condition','multicosine')]
    return f"{date}_{subject}_{stimulus}_{p['trial_number']:03d}"

def save_named(source,destination):
    source=Path(source).resolve();root=Path(destination).resolve();root.mkdir(parents=True,exist_ok=True)
    meta=json.loads((source/'metadata.json').read_text(encoding='utf-8'));p=participant_info(meta['participant'])
    name=basename(meta);final=root/name
    if final.exists():raise FileExistsError(f'同名の記録があります。試行番号を変更してください: {name}')
    weight=meta.get('weight_estimate') or estimate_weight(source,meta)
    extra=dict(subject=p['subject'],height_cm=p['height_cm'],body_mass_kg=weight['body_mass_kg'] if weight['body_mass_kg'] is not None else '',body_mass_status=weight['status'],trial_number=p['trial_number'],visual_condition=meta['stimulus'].get('condition','multicosine'))
    temporary=Path(tempfile.mkdtemp(prefix='.saving-',dir=root))
    try:
        for path in source.glob('*.csv'):
            with path.open(encoding='utf-8-sig',newline='') as src,(temporary/f'{name}_{path.name}').open('x',encoding='utf-8-sig',newline='') as dst:
                reader=csv.DictReader(src);fields=list(reader.fieldnames or [])
                writer=csv.DictWriter(dst,fieldnames=fields+[k for k in extra if k not in fields]);writer.writeheader()
                for row in reader:writer.writerow(dict(row,**extra))
        meta.update(participant=p,weight_estimate=weight,review_decision='saved',original_recording=str(source),named_basename=name)
        (temporary/f'{name}_metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
        temporary.rename(final)
    except Exception:
        # This directory was created above and contains only our flat output files.
        if temporary.parent.resolve()==root and temporary.name.startswith('.saving-'):
            for f in temporary.iterdir():
                if f.is_file():f.unlink()
            temporary.rmdir()
        raise
    return dict(directory=str(final),next_trial_number=p['trial_number']+1)
