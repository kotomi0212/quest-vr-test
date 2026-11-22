import base64
import csv
import json
from pathlib import Path
import tempfile
import tkinter as tk
import unittest
from unittest.mock import patch
import numpy as np
from .control_app import ControlApp
from .recording import export_recording

class ControlTests(unittest.TestCase):
    def test_declining_save_keeps_trial_number(self):
        root=tk.Tk();root.withdraw();app=ControlApp(root)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                path=Path(tmp);app.trial_number.set('12');app.review_busy=True
                meta=dict(participant=dict(subject='A',height_cm=170,trial_number=12),stimulus=dict(condition='none'),pc_commands=[dict(kind='command_start',pc_epoch_s=1795215600)])
                (path/'metadata.json').write_text(json.dumps(meta),encoding='utf-8')
                with patch('research_sync.control_app.messagebox.askyesno',return_value=False) as ask:
                    app.review_recording(str(path))
                self.assertTrue(ask.called);self.assertEqual(app.trial_number.get(),'12');self.assertFalse(app.review_busy)
                self.assertEqual(json.loads((path/'review_decision.json').read_text())['decision'],'not_saved')
        finally:root.destroy();app.loop.call_soon_threadsafe(app.loop.stop)
    def test_pc_screen_allows_donning_and_blocks_busy_or_old_client(self):
        root=tk.Tk();root.withdraw();app=ControlApp(root)
        try:
            app.connected=True
            s=dict(quest_connected=True,quest_software_current=True,quest_rendering=False,quest_xr=False,
                vendor_available=True,combalance_state='待機',rtt_median_ms=3.,phase='idle',elapsed_s=0,
                duration_s=90,trial_id=None,busy=False,last_error=None,last_export=None,save_directory='test',scheduled_pc_s=None)
            app.show_status(s);self.assertEqual(str(app.start_button['state']),'normal')
            s['busy']=True;app.show_status(s);self.assertEqual(str(app.start_button['state']),'disabled')
            s.update(busy=False,quest_software_current=False);app.show_status(s);self.assertEqual(str(app.start_button['state']),'disabled')
            root.update()
        finally:root.destroy();app.loop.call_soon_threadsafe(app.loop.stop)
    def test_csv_acquisition_export_is_not_analysis(self):
        with tempfile.TemporaryDirectory(prefix='pc-record-test-') as tmp:
            root=Path(tmp);raw=root/'raw';raw.mkdir();records=[dict(kind='session',stimulus=dict(scene=dict(gridSpacingM=.5))),dict(kind='connected',role='quest')]
            for i in range(16):
                q=i*.25;records.append(dict(kind='probe',payload=dict(q1=q,p2=q+1000+.001,p3=q+1000+.0011,q4=q+.0021)))
            records.extend([dict(kind='received',payload=dict(trial_id='test',q_receive_s=1)),dict(kind='frame',payload=dict(trial_id='test',q_apply_s=2,elapsed_s=0,ap_m=0,ap_m_s=0,ap_m_s2=0,state='software-transform'))])
            events=root/'events.jsonl';events.write_text('\n'.join(json.dumps(x) for x in records))
            matrix=np.zeros((6,12));matrix[:,:6]=np.eye(6)
            params=dict(Matome=2,Frequency=100,Serial='synthetic',ForceZero=dict(values=[0]*12),Prf=dict(values=[1]*12),Npu=dict(values=[1]*12),Itf6x12=dict(values=matrix.ravel().tolist()))
            (raw/'device_parameters.json').write_text(json.dumps(params))
            primary=np.arange(38,dtype='<u2').reshape(2,19);external=np.zeros((2,7),dtype='<i2')
            b=dict(kind='raw_block',block_index=0,pc_before_read_s=1001.,pc_after_read_s=1001.001,base64=base64.b64encode(primary.tobytes()+external.tobytes()).decode())
            rawfile=raw/'raw_blocks.jsonl';rawfile.write_text(json.dumps(b));original=rawfile.read_bytes()
            summary=export_recording(events,'test',root/'csv',raw,'pc-stop')
            self.assertEqual(summary['combalance_samples'],2);self.assertEqual(summary['quest_frames'],1)
            with (root/'csv/combalance.csv').open(encoding='utf-8-sig') as stream:rows=list(csv.DictReader(stream))
            self.assertEqual(rows[0]['pc_acquisition_time_s'],'');self.assertEqual(rows[0]['timestamp_quality'],'receipt_fit_unvalidated')
            self.assertNotIn('COM',','.join(rows[0]));self.assertEqual(rawfile.read_bytes(),original)
            with self.assertRaises(FileExistsError):export_recording(events,'test',root/'csv',raw)

if __name__=='__main__':unittest.main()
