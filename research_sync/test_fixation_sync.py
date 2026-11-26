"""Software integration only; does not load or operate measurement hardware."""
import asyncio
import csv
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from websockets.asyncio.client import connect

def free_port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

class FixationSyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_profiles_and_per_trial_exports(self):
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)/'session';http,ws=free_port(),free_port()
            process=subprocess.Popen([sys.executable,'-m','research_sync.server','--output',str(output),'--http-port',str(http),'--ws-port',str(ws),'--token','test','--allow-desktop-simulation'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            async def receive(socket,kind):
                while True:
                    msg=json.loads(await asyncio.wait_for(socket.recv(),5))
                    if msg['type']==kind:return msg
            try:
                for i in range(60):
                    try:quest=await connect(f'ws://127.0.0.1:{ws}');break
                    except OSError:await asyncio.sleep(.1)
                else:self.fail('Server did not start')
                async with quest:
                    await quest.send(json.dumps(dict(role='quest',token='test',client_version='pc-control-v5')))
                    await receive(quest,'config')
                    async with connect(f'ws://127.0.0.1:{ws}') as operator:
                        await operator.send(json.dumps(dict(role='operator',token='test')));await receive(operator,'config')
                        # Fixed-point trials must not start before an explicit height capture.
                        await operator.send(json.dumps(dict(type='start',condition='dot',start_delay_s=3)))
                        self.assertIn('目線高さ', (await receive(operator,'error'))['message'])
                        await operator.send(json.dumps(dict(type='capture_height')))
                        request=await receive(quest,'capture_height')
                        await quest.send(json.dumps(dict(type='height_result',request_id=request['request_id'],ok=True,height_m=1.55,q_s=1)))
                        await operator.send(json.dumps(dict(type='start',condition='pilot_five_x2',start_delay_s=3)))
                        self.assertIn('上限', (await receive(operator,'error'))['message'])
                        for condition in ('dot','none','spinner','multicosine','pilot_single_x1','pilot_single_x3','pilot_five_x1','pilot_five_x1p4','pilot_rest','study_sweep90','study_multicosine10'):
                            await operator.send(json.dumps(dict(type='start',condition=condition,start_delay_s=3,participant=dict(subject='A',height_cm=170,trial_number=5))))
                            config=(await receive(quest,'config'))['stimulus'];command=await receive(quest,'start');identifier=command['trial_id']
                            self.assertEqual(config['condition'],condition)
                            self.assertEqual(config['eye_height_m'],1.55)
                            await operator.send(json.dumps(dict(type='capture_height')))
                            await receive(operator,'error')
                            self.assertEqual(config['duration_s'],90 if condition in ('multicosine','study_sweep90') else 40 if condition.startswith('pilot_single') else 100 if condition.startswith('pilot_five') or condition=='study_multicosine10' else 60 if condition=='pilot_rest' else 30)
                            await quest.send(json.dumps(dict(type='received',trial_id=identifier,q_receive_s=1)))
                            for k in range(12):
                                q=k*.25;await quest.send(json.dumps(dict(type='probe',q1=q,p2=q+100,p3=q+100.001,q4=q+.003)))
                            await quest.send(json.dumps(dict(type='frame',trial_id=identifier,q_apply_s=2,elapsed_s=1,ap_m=.01,ap_m_s=.02,ap_m_s2=.03,state='software-transform',condition=condition,fixation_anchor=[0,1.55,-2.5] if condition in ('dot','spinner') else None)))
                            await quest.send(json.dumps(dict(type='ended',trial_id=identifier,reason='complete')))
                            await receive(quest,'status')
                            directory=output/'trials'/identifier
                            meta=json.loads((directory/'metadata.json').read_text(encoding='utf-8'))
                            self.assertEqual(meta['participant'],dict(subject='A',height_cm=170.,trial_number=5));self.assertEqual(meta['stimulus'],config);self.assertIsNotNone(meta['quest_clock'])
                            with (directory/'quest.csv').open(encoding='utf-8-sig') as stream:row=next(csv.DictReader(stream))
                            self.assertEqual(row['visual_condition'],condition);self.assertNotEqual(row['pc_mapped_time_s'],'')
                            if condition in ('dot','spinner'):self.assertEqual(float(row['fixation_anchor_y_m']),1.55)
                        await operator.send(json.dumps(dict(type='shutdown')))
                await asyncio.to_thread(process.wait,10)
                self.assertEqual(process.returncode,0)
            finally:
                if process.poll() is None:process.terminate();await asyncio.to_thread(process.wait,10)
