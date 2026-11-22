"""Visual waveform/geometry tests only; no device or acquisition operations."""
import json
from pathlib import Path
import subprocess
import unittest
import numpy as np
from .visual_stimulus import evaluate,peak

ROOT=Path(__file__).parent
CONFIG=ROOT/'results/visual-stimulus-20261121/stimulus.json'

class VisualStimulusTests(unittest.TestCase):
    def setUp(self):self.c=json.loads(CONFIG.read_text(encoding='utf-8'))
    def test_exact_stationary_80_seconds_and_equal_acceleration_lines(self):
        c=self.c;t=np.arange(10,90,.005);f=np.array(c['frequencies_hz']);w=2*np.pi*f
        a=evaluate(t,c)[2]
        expected=c['acceleration_component_m_s2']*np.cos((t[:,None]-90)*w+c['endpoint_phases_rad']).sum(axis=1)
        np.testing.assert_allclose(a,expected,atol=1e-14)
        spectrum=2*abs(np.fft.rfft(a))/len(a)
        amplitudes=spectrum[np.rint(f*80).astype(int)]
        np.testing.assert_allclose(amplitudes,c['acceleration_component_m_s2'],rtol=1e-10)
        self.assertEqual(len(f),30);np.testing.assert_allclose(f,np.arange(1,31)*.05)
    def test_derivatives_and_rest_boundaries(self):
        c=self.c;t=np.r_[np.linspace(.01,89.99,2001),9.999,10,10.001,89.999];h=.0001
        x,v,a=evaluate(t,c)
        np.testing.assert_allclose((evaluate(t+h,c)[0]-evaluate(t-h,c)[0])/(2*h),v,atol=2e-8)
        np.testing.assert_allclose((evaluate(t+h,c)[1]-evaluate(t-h,c)[1])/(2*h),a,atol=2e-7)
        for endpoint in (0,10,90):np.testing.assert_allclose(evaluate([endpoint],c),0,atol=1e-10)
        self.assertLess(abs(evaluate([89.999],c)[0][0]),1e-8)
        self.assertLess(abs(evaluate([89.999],c)[1][0]),1e-5)
    def test_velocity_peak_and_scene_dimensions(self):
        maximum=peak(self.c,1)
        self.assertAlmostEqual(maximum['value'],.1,places=10)
        self.assertLessEqual(float(abs(evaluate(np.linspace(0,90,18001),self.c)[1]).max()),.1+1e-10)
        scene=json.loads((ROOT/'scene.json').read_text())
        self.assertEqual(scene,dict(roomHeightM=3,roomSizeM=6,frontWallDistanceM=3,gridSpacingM=.5))
    def test_python_browser_parity_and_parameter_changes(self):
        alternative=dict(schema=2,waveform='endpoint_stationary_multicosine',duration_s=65,stationary_start_s=5,
            frequencies_hz=[.1,.2],endpoint_phases_rad=[0,np.pi],acceleration_component_m_s2=1)
        alternative['acceleration_component_m_s2']=.05/peak(alternative,1)['value']
        self.assertAlmostEqual(peak(alternative,1)['value'],.05,places=10)
        for config in (self.c,alternative):
            times=np.r_[np.linspace(0,config['duration_s'],513),config['stationary_start_s'],config['duration_s']+.1].tolist()
            script="const fs=require('fs'),w=require('./waveform.js'),p=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(p.t.map(t=>{const s=w.evaluate(t,p.c);return [s.x,s.v,s.a]})));"
            r=subprocess.run(['node','-e',script],input=json.dumps(dict(c=config,t=times)),cwd=ROOT,text=True,capture_output=True,check=True)
            np.testing.assert_allclose(json.loads(r.stdout),np.column_stack(evaluate(times,config)),atol=2e-14)

if __name__=='__main__':unittest.main()
