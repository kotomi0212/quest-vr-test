"""Decode manufacturer's buffered payloads, retaining ADC and timing provenance."""
import base64
import hashlib
import json
from pathlib import Path
import numpy as np

def decode_payload(payload,batch):
    # Installed DataHandler.BinToAd: first batch records have 12 uint16
    # force ADCs + 7 int16 onboard IMU values; external IMU follows separately.
    if len(payload)!=52*batch:raise ValueError('Unexpected packet size')
    primary=np.frombuffer(payload[:38*batch],dtype='<u2').reshape(batch,19)
    adc=primary[:,:12].copy()
    imu=primary[:,12:].copy().view('<i2')
    external=np.frombuffer(payload[38*batch:],dtype='<i2').reshape(batch,7).copy()
    return adc,imu,external

def force_engineering(adc,parameters):
    def get(name,size):
        v=np.asarray(parameters[name]['values'],dtype=np.float32)
        if len(v)!=size or not np.isfinite(v).all():raise ValueError('Invalid calibration: '+name)
        return v
    zero,prf,npu=(get(k,12) for k in ('ForceZero','Prf','Npu'))
    matrix=get('Itf6x12',72).astype(float).reshape(6,12)
    # OEM AdToEng uses single precision for ADC correction, then double matrix arithmetic.
    corrected=((np.asarray(adc,dtype=np.float32)-zero)*prf)*npu
    return corrected.astype(float)@matrix.T

def decode(directory,output):
    directory=Path(directory);params=json.loads((directory/'device_parameters.json').read_text())
    rawpath=directory/'raw_blocks.jsonl';events=[json.loads(s) for s in rawpath.read_text().splitlines()]
    blocks=[r for r in events if r['kind']=='raw_block'];batch=int(params['Matome']);fs=float(params['Frequency'])
    if not blocks:raise ValueError('No raw blocks')
    if [b['block_index'] for b in blocks]!=list(range(len(blocks))):raise ValueError('Block sequence is not contiguous')
    adc=[];imu=[];external=[];before=[];after=[]
    for b in blocks:
        x,y,z=decode_payload(base64.b64decode(b['base64'],validate=True),batch)
        adc.append(x);imu.append(y);external.append(z)
        before.extend([b['pc_before_read_s']]*batch);after.extend([b['pc_after_read_s']]*batch)
    adc=np.vstack(adc);imu=np.vstack(imu);external=np.vstack(external)
    force=force_engineering(adc,params);index=np.arange(len(adc));relative=index/fs
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    names=['sample_index','sample_time_s','pc_before_block_read_s','pc_after_block_read_s']
    names += ['adc_'+str(k) for k in range(12)]
    names += ['sensor_'+k for k in ('Fx_N','Fy_N','Fz_N','Mx_Nm','My_Nm','Mz_Nm')]
    names += ['onboard_imu_count_'+str(k) for k in range(7)]
    names += ['external_imu_count_'+str(k) for k in range(7)]
    np.savetxt(output/'decoded.csv',np.c_[index,relative,before,after,adc,force,imu,external],delimiter=',',header=','.join(names),comments='')
    stops=[r for r in events if r['kind']=='capture_stop'];times=np.array([r['pc_after_read_s'] for r in blocks])
    fit=np.polyfit(np.arange(len(blocks))*batch/fs,times-times[0],1)
    report=dict(source=str(directory.resolve()),raw_sha256=hashlib.sha256(rawpath.read_bytes()).hexdigest(),
        samples=len(adc),sampling_hz=fs,batch_samples=batch,batch_duration_s=batch/fs,
        capture_stop=stops[-1] if stops else None,software_filters='none in this decoder',
        coordinate_system='manufacturer sensor axes before RotateAxis; AP mapping not asserted',
        apparent_arrival_clock_drift_ppm=float((fit[0]-1)*1e6),
        timing='Read timestamps are block dequeue times, not acquisition anchors. Apparent drift includes USB scheduling.',
        units=dict(force='N',moment='N m',adc='counts',imu='counts'),
        calibration=params,validation='ADC scaling/matrix traced from installed OEM IL; independent known-load calibration still required')
    (output/'provenance.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(3,1,figsize=(11,8),layout='constrained')
    axes[0].plot(relative,force[:,:3]);axes[0].set(ylabel='Sensor force (N)');axes[0].legend(['Fx','Fy','Fz'])
    axes[1].plot(relative,force[:,3:]);axes[1].set(ylabel='Sensor moment (N m)');axes[1].legend(['Mx','My','Mz'])
    axes[2].plot(np.arange(1,len(times))*batch/fs,np.diff(times)*1000);axes[2].set(xlabel='Nominal sample time (s)',ylabel='Block read interval (ms)')
    fig.suptitle('Force acquisition | no added software filters; acquisition time not validated')
    fig.savefig(output/'bench.png',dpi=130);plt.close(fig)
    return report

if __name__=='__main__':
    import sys
    report=decode(sys.argv[1],sys.argv[2]);print(json.dumps({k:report[k] for k in ('samples','sampling_hz','batch_duration_s','capture_stop')}))
