"""Verify selectable profiles, renderer parity and measurement UI catalogue."""
import json
from pathlib import Path
import subprocess
import unittest
import numpy as np
from .study_stimuli import ROOT,LABELS,profile,available_conditions
from .trial_stimuli import select_stimulus
from .named_recording import STIMULI
from .low_band import evaluate

class StudyStimuliTests(unittest.TestCase):
    def test_new_profiles_and_enabled_catalogue(self):
        conditions=available_conditions()
        self.assertEqual(list(conditions.values())[:2],list(LABELS.values()))
        self.assertNotIn('pilot_five_x2',conditions.values())
        self.assertNotIn('pilot_five_x3',conditions.values())
        for condition in LABELS.values():
            c=select_stimulus({},condition)
            self.assertTrue(c['enabled']);self.assertIn(condition,STIMULI)
        for condition in conditions.values():
            if condition.startswith('pilot_'):
                c=json.loads((ROOT.parent/'pilot_profiles'/(condition+'.json')).read_text())
                self.assertTrue(c['enabled'])

    def test_browser_sweep_matches_independent_design_samples(self):
        c=profile('study_sweep90')
        reference=np.array(json.loads((ROOT/'verification_samples.json').read_text()))
        code="const fs=require('fs'),w=require('./research_sync/waveform.js'),q=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(q.t.map(t=>w.evaluate(t,q.c))));"
        result=subprocess.run(['node','-e',code],input=json.dumps(dict(c=c,t=reference[:,0].tolist())),text=True,capture_output=True,check=True,cwd=ROOT.parents[1])
        actual=np.array([[r[k] for k in ('x','v','a')] for r in json.loads(result.stdout)])
        np.testing.assert_allclose(actual,reference[:,1:],atol=2e-8,rtol=0)

    def test_multicosine_lines_and_browser_derivatives(self):
        c=profile('study_multicosine10');t=np.arange(10,90,.01)
        x,v,a=evaluate(t,c);bins=np.fft.rfftfreq(len(t),.01);s=2*abs(np.fft.rfft(a))/len(t)
        amps=s[np.rint(np.array(c['frequencies_hz'])*80).astype(int)]
        np.testing.assert_allclose(amps,c['acceleration_component_m_s2'],rtol=1e-10)
        self.assertEqual(len(c['frequencies_hz']),10)
        np.testing.assert_allclose(evaluate([0,100],c),0,atol=1e-12)
        code="const fs=require('fs'),w=require('./research_sync/waveform.js'),c=JSON.parse(fs.readFileSync(0,'utf8'));let worst=[0,0];for(let t=.013;t<89.99;t+=.137){const h=1e-5,l=w.evaluate(t-h,c),r=w.evaluate(t+h,c),s=w.evaluate(t,c);worst[0]=Math.max(worst[0],Math.abs((r.x-l.x)/(2*h)-s.v));worst[1]=Math.max(worst[1],Math.abs((r.v-l.v)/(2*h)-s.a));}console.log(JSON.stringify(worst));"
        result=subprocess.run(['node','-e',code],input=json.dumps(profile('study_sweep90')),text=True,capture_output=True,check=True,cwd=ROOT.parents[1])
        self.assertLess(max(json.loads(result.stdout)),1e-7)

if __name__=='__main__':unittest.main()
