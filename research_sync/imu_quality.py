"""Report raw external channel availability, never invent calibrated IMU axes."""
import csv
from pathlib import Path

def external_imu_quality(path):
    path=Path(path);count=0;nonzero=0;minimum=[None]*7;maximum=[None]*7
    if not path.exists():return dict(status='not_recorded',samples=0,warning='頭部IMUデータなし')
    with path.open(encoding='utf-8-sig',newline='') as stream:
        for row in csv.DictReader(stream):
            try:values=[int(row[f'external_imu_count_{k}']) for k in range(7)]
            except (ValueError,KeyError):continue
            count+=1;nonzero+=any(v!=0 for v in values)
            for k,v in enumerate(values):minimum[k]=v if minimum[k] is None else min(minimum[k],v);maximum[k]=v if maximum[k] is None else max(maximum[k],v)
    status='not_recorded' if not count else 'all_zero' if not nonzero else 'constant' if minimum==maximum else 'raw_signal_present_unvalidated'
    warnings=dict(not_recorded='頭部IMUデータなし',all_zero='外部IMUの7chが全サンプル0です。頭部応答として使用しないでください。',constant='外部IMUが全期間一定です。接続・有効化・データ形式を確認してください。')
    return dict(status=status,samples=count,nonzero_samples=nonzero,channel_min=minimum,channel_max=maximum,warning=warnings.get(status),
        calibration='Raw counts only. Channel identities, physical units, orientation and gravity correction are not validated.')
