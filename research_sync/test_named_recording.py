import csv
import json
from pathlib import Path
import tempfile
import unittest
from .named_recording import estimate_weight,save_named,participant_info

class NamedRecordingTests(unittest.TestCase):
    def fixture(self,root,unstable=False):
        source=root/'trial';source.mkdir()
        meta=dict(participant=dict(subject='被験者A',height_cm=170,trial_number=5),stimulus=dict(condition='dot'),pc_commands=[dict(kind='command_start',scheduled_pc_s=100,pc_epoch_s=1795215600)])
        with (source/'combalance.csv').open('w',encoding='utf-8-sig',newline='') as stream:
            w=csv.writer(stream);w.writerow(['pc_estimated_sample_time_s','sensor_Fz_N'])
            for i in range(400):w.writerow([98+i*.01,(-1 if not unstable or i%2 else -1.4)*60.0*9.80665 if i<200 else -10000])
        (source/'quest.csv').write_text('trial_id,ap_displacement_m\ntest,0.01\n',encoding='utf-8')
        (source/'metadata.json').write_text(json.dumps(meta),encoding='utf-8')
        return source,meta
    def test_baseline_and_named_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,meta=self.fixture(root)
            weight=estimate_weight(source,meta);self.assertEqual(weight['body_mass_kg'],60.0)
            result=save_named(source,root/'saved');self.assertEqual(result['next_trial_number'],6)
            directory=Path(result['directory']);self.assertIn('_被験者A_30s_red_dot_005',directory.name)
            for path in directory.glob('*.csv'):
                with path.open(encoding='utf-8-sig') as stream:row=next(csv.DictReader(stream))
                self.assertEqual(row['subject'],'被験者A');self.assertEqual(float(row['height_cm']),170);self.assertEqual(float(row['body_mass_kg']),60.0);self.assertEqual(row['trial_number'],'5')
            with self.assertRaises(FileExistsError):save_named(source,root/'saved')
            self.assertTrue((source/'quest.csv').exists())
            self.assertEqual(len(list((root/'saved').iterdir())),1)
    def test_unstable_or_missing_force_is_blank(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source,meta=self.fixture(root,True)
            self.assertEqual(estimate_weight(source,meta)['status'],'unstable_baseline')
            (source/'combalance.csv').unlink()
            result=save_named(source,root/'saved')
            with next(Path(result['directory']).glob('*quest.csv')).open(encoding='utf-8-sig') as stream:row=next(csv.DictReader(stream))
            self.assertEqual(row['body_mass_kg'],'')
    def test_input_validation(self):
        for subject,height,number in [('',170,1),('A',float('nan'),1),('A',170,0),('A',170,'1.5')]:
            with self.assertRaises((ValueError,TypeError)):participant_info(dict(subject=subject,height_cm=height,trial_number=number))
