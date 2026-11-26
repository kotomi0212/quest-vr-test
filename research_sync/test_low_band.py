import csv,json,subprocess,tempfile,unittest
from pathlib import Path
import numpy as np
from .low_band import OUTPUT,BASE_A,LIMITS,evaluate,profile,check_limits
from .imu_quality import external_imu_quality

class LowBandTests(unittest.TestCase):
    def test_equal_amplitudes_and_exact_ratios(self):
        for kind in ('single','five'):
            configs=[json.loads((OUTPUT/f'pilot_{kind}_x{n}.json').read_text()) for n in (1,2,3)]
            for c in configs:
                lo,hi=c['analysis_interval_s'];t=np.arange(lo,hi,.01);x,v,a=evaluate(t,c)
                matrix=np.column_stack([np.ones(len(t)),*[func(2*np.pi*f*t) for f in c['frequencies_hz'] for func in (np.cos,np.sin)]])
                beta=np.linalg.lstsq(matrix,a,rcond=None)[0];measured=np.hypot(beta[1::2],beta[2::2])
                np.testing.assert_allclose(measured,BASE_A*c['amplitude_multiple'],rtol=1e-10)
                np.testing.assert_allclose(evaluate([0,c['duration_s']],c),0,atol=1e-14)
            t=np.linspace(0,configs[0]['duration_s'],4001)
            for n,c in zip((1,2,3),configs):np.testing.assert_allclose(evaluate(t,c),np.array(evaluate(t,configs[0]))*n,atol=1e-13)
    def test_derivatives_peaks_and_limit_rejection(self):
        for c in json.loads((OUTPUT/'index.json').read_text()):
            t=np.linspace(.01,c['duration_s']-.01,2000);h=1e-5
            x,v,a=evaluate(t,c);left=evaluate(t-h,c);right=evaluate(t+h,c)
            np.testing.assert_allclose((right[0]-left[0])/(2*h),v,atol=2e-8)
            np.testing.assert_allclose((right[1]-left[1])/(2*h),a,atol=2e-8)
            actual,violations=check_limits(c);self.assertEqual(c['enabled'],not violations)
            if c['enabled']:
                profile(c['condition'])
                for name in LIMITS:self.assertLessEqual(actual[name]['value'],LIMITS[name]+1e-9)
            else:
                with self.assertRaises(ValueError):profile(c['condition'])
    def test_browser_parity(self):
        configs=json.loads((OUTPUT/'index.json').read_text());times=[0,.01,2.5,5,10,20,35,40,50,90,99.99,100,101]
        code="const fs=require('fs'),w=require('./research_sync/waveform.js');const q=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(q.configs.map(c=>q.times.map(t=>w.evaluate(t,c)))));"
        result=subprocess.run(['node','-e',code],input=json.dumps(dict(configs=configs,times=times)),text=True,capture_output=True,check=True,cwd=OUTPUT.parents[1])
        for c,rows in zip(configs,json.loads(result.stdout)):
            np.testing.assert_allclose(np.array([[row[k] for row in rows] for k in ('x','v','a')]),evaluate(times,c),atol=1e-13)
    def test_external_imu_zero_and_varying_channels(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'combalance.csv'
            for moving,status in [(False,'all_zero'),(True,'raw_signal_present_unvalidated')]:
                with p.open('w',newline='') as stream:
                    writer=csv.writer(stream);writer.writerow([f'external_imu_count_{k}' for k in range(7)])
                    writer.writerows([[i if moving else 0]*7 for i in range(100)])
                quality=external_imu_quality(p);self.assertEqual(quality['status'],status)
                if not moving:self.assertTrue(quality['warning'])
