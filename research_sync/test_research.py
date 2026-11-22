import json
from pathlib import Path
import unittest
import tempfile
import csv
import numpy as np
from .stimulus import evaluate,FREQUENCIES
from .analysis import apply_filter,estimate,two_link_coefficients,harmonic_coefficients,read_csv
from .clocks import fit_clock,to_pc,resample
from .export import export
from .frf import analyze as frf
from .raw_decode import decode_payload,force_engineering
from .quest_report import trial_records

class ResearchTests(unittest.TestCase):
    def test_raw_payload_and_engineering(self):
        primary=np.arange(38,dtype='<u2').reshape(2,19);primary[:,12:]=np.array([-1,-2,-3,-4,-5,-6,-7],dtype='<i2').view('<u2')
        external=np.arange(-14,0,dtype='<i2').reshape(2,7)
        adc,imu,ext=decode_payload(primary.tobytes()+external.tobytes(),2)
        np.testing.assert_array_equal(adc,primary[:,:12]);np.testing.assert_array_equal(imu[0],[-1,-2,-3,-4,-5,-6,-7]);np.testing.assert_array_equal(ext,external)
        matrix=np.zeros((6,12));matrix[:,:6]=np.eye(6)
        p={k:dict(values=v) for k,v in [('ForceZero',[1]*12),('Prf',[2]*12),('Npu',[3]*12),('Itf6x12',matrix.ravel().tolist())]}
        np.testing.assert_allclose(force_engineering(adc,p),(adc[:,:6].astype(float)-1)*6)
        with self.assertRaises(ValueError):decode_payload(b'invalid',2)

    def test_connection_clock_segmentation(self):
        records=[dict(kind='connected',role='quest'),dict(kind='probe',payload={'q1':100}),
            dict(kind='connected',role='quest'),dict(kind='probe',payload={'q1':1}),
            dict(kind='frame',payload={'trial_id':'new','q_apply_s':2})]
        _,probes=trial_records(records,'new');self.assertEqual(probes,[{'q1':1}])
    def test_stimulus(self):
        c=json.loads((Path(__file__).parent/'results/visual-stimulus-20261121/previous_active_stimulus.json').read_text())
        t=np.arange(0,90,.001);x,v,a=evaluate(t,c['phases_rad'],c['acceleration_component_m_s2'])
        self.assertAlmostEqual(float(abs(v).max()),.1,places=6)
        for t0 in (0,90):np.testing.assert_allclose(evaluate([t0],c['phases_rad']),0,atol=1e-12)
        np.testing.assert_allclose(np.gradient(x,.001)[10:-10],v[10:-10],atol=2e-6)
        # Quintic envelope is C2; jerk changes at 5/85 s. Central differences
        # spanning those joins have O(h) rather than O(h²) acceleration error.
        smooth=(t>.01)&(t<89.99)&(abs(t-5)>.002)&(abs(t-85)>.002)
        np.testing.assert_allclose(np.gradient(v,.001)[smooth],a[smooth],atol=2e-6)
        mask=(t>=20)&(t<80)
        hats=harmonic_coefficients(t[mask],a[mask],FREQUENCIES)
        np.testing.assert_allclose(abs(hats),c['acceleration_component_m_s2'],rtol=1e-9)

    def test_filter(self):
        fs=100;t=np.arange(0,100,1/fs);x=np.cos(2*np.pi*.05*t)+np.cos(2*np.pi*10*t)
        y=apply_filter(x,fs,'lowpass',1,4,True)
        mask=(t>20)&(t<80)
        hats=harmonic_coefficients(t[mask],y[mask],[.05,10])
        self.assertAlmostEqual(abs(hats[0]),1,places=3);self.assertLess(abs(hats[1]),1e-6)
        for kind,cutoff in [('highpass',.1),('bandpass',[.02,4])]:
            self.assertTrue(np.isfinite(apply_filter(x,fs,kind,cutoff,4,False)).all())
        with self.assertRaises(ValueError):apply_filter(x,fs,'lowpass',50)

    def test_clock_drift(self):
        probes=[];slope=1.00004
        for q in np.linspace(0,100,100):
            probes.append(dict(q1=q,p2=1000+slope*(q+.001),p3=1000+slope*(q+.0011),q4=q+.0021))
        m=fit_clock(probes);self.assertAlmostEqual(m['drift_ppm'],40,places=5)
        np.testing.assert_allclose(to_pc([0,100],m),[1000,1000+slope*100],atol=1e-8)
        with self.assertRaises(ValueError):resample([0,1,10],[0,1,10],[5],2)

    def test_single_link_static(self):
        p=dict(body_mass_kg=60,body_com_from_ankle_m=.9,body_inertia_kg_m2=4,ankle_height_m=.06)
        x,a=estimate(np.array([0.]),np.array([60*9.80665*.02]),p)
        self.assertAlmostEqual(x[0],.02);self.assertEqual(a[0],0)

    def test_two_link_forward_inverse(self):
        p=dict(lower_mass_kg=20,upper_mass_kg=40,lower_inertia_kg_m2=1,upper_inertia_kg_m2=3,
            lower_com_m=.4,upper_com_m=.3,lower_length_m=.8,ankle_height_m=.06)
        f=np.array([.5,.7,1.5]);w2=(2*np.pi*f)**2
        x1=np.array([.01+.002j,.005-.001j,.002j]);x2=2*x1
        c3=1/.4+20*(.06+.4)-3*.8/(.4*.3);c4=3/.3+40*(.06+.8+.3)
        rx=w2*(20*x1+40*x2)
        ny=(c3*w2+20*9.80665)*x1+(c4*w2+40*9.80665)*x2
        np.testing.assert_allclose(two_link_coefficients(f,rx,ny,p),(20*x1+40*x2)/60,rtol=1e-10)

    def test_hybrid_frf_on_common_time(self):
        p=dict(lower_mass_kg=20,upper_mass_kg=40,lower_inertia_kg_m2=1,upper_inertia_kg_m2=3,
            lower_com_m=.4,upper_com_m=.3,lower_length_m=.8,ankle_height_m=.06)
        e=dict(calibration_verified=True,body_mass_kg=60,body_com_from_ankle_m=.9,
               body_inertia_kg_m2=4,ankle_height_m=.06,two_link=p)
        t=np.arange(0,90,.01);w=2*np.pi*np.arange(1,31)*.05;cos=np.cos(t[:,None]*w)
        c3=1/.4+20*(.06+.4)-3*.8/(.4*.3);c4=3/.3+40*(.06+.8+.3)
        rx=cos@(w*w*(20*.01+40*.02));ny=cos@((c3*w*w+20*9.80665)*.01+(c4*w*w+40*9.80665)*.02)
        with tempfile.TemporaryDirectory(prefix='hybrid-frf-test-') as tmp:
            root=Path(tmp);source=root/'common.csv';config=root/'config.json'
            config.write_text(json.dumps(dict(estimation=e)))
            with source.open('w',newline='') as stream:
                writer=csv.writer(stream);writer.writerow(['trial_id','elapsed_s','ap_m','estimator_force_on_plate_n','estimator_moment_on_plate_nm'])
                writer.writerows(['synthetic',*row] for row in np.c_[t,cos.sum(axis=1),rx,ny])
            frf(source,root/'out','ap_m','com_hybrid_m',20,80,config)
            result=np.genfromtxt(root/'out/frf.csv',names=True,delimiter=',');high=result['frequency_hz']>=.499
            np.testing.assert_allclose(result['gain'][high],(20*.01+40*.02)/60,atol=1e-10)
            np.testing.assert_allclose(result['phase_deg'][high],0,atol=1e-7)

    def test_synthetic_end_to_end(self):
        c=json.loads((Path(__file__).parent/'results/visual-stimulus-20261121/previous_active_stimulus.json').read_text())
        with tempfile.TemporaryDirectory(prefix='vr-analysis-test-') as temp:
            root=Path(temp);rows=[]
            for q in np.linspace(-1,92,100):
                rows.append(dict(kind='probe',payload=dict(q1=q,p2=1000+q+.001,p3=1000+q+.0011,q4=q+.0021)))
            t=np.arange(0,90,1/72);x,v,a=evaluate(t,c['phases_rad'],c['acceleration_component_m_s2'])
            for q,xx,vv,aa in zip(t,x,v,a):
                rows.append(dict(kind='frame',payload=dict(trial_id='synthetic',q_apply_s=q,elapsed_s=q,ap_m=xx,ap_m_s=vv,ap_m_s2=aa)))
            rows.append(dict(kind='ended',payload=dict(trial_id='synthetic',reason='complete')))
            events=root/'events.jsonl';events.write_text('\n'.join(json.dumps(r) for r in rows))
            ct=np.arange(0,90,.01);cx=evaluate(ct,c['phases_rad'],c['acceleration_component_m_s2'])[0]
            com=root/'analysis.csv';np.savetxt(com,np.c_[ct,2*cx],delimiter=',',header='time_s,com_single_link_m',comments='')
            anchors=root/'anchors.json';anchors.write_text(json.dumps(dict(kind='validated_acquisition_time_pairs',
                validation='synthetic test only',pairs_sample_s_pc_monotonic_s=[[0,1000],[45,1045],[90,1090]])))
            export(events,com,anchors,root/'aligned','synthetic',100)
            frf(root/'aligned/synchronized.csv',root/'frf','ap_m','com_single_link_m')
            result=np.genfromtxt(root/'frf/frf.csv',names=True,delimiter=',')
            np.testing.assert_allclose(result['gain'],2,rtol=.002)
            self.assertLess(float(abs(result['phase_deg']).max()),.1)
            rows[-1]['payload']['reason']='remote-stop';events.write_text('\n'.join(json.dumps(r) for r in rows))
            with self.assertRaisesRegex(ValueError,'natural completion'):
                export(events,com,anchors,root/'must-not-export','synthetic',100)

if __name__=='__main__':unittest.main()
