"""GUI construction/preview/export using a synthetic CSV, never a live device."""
import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import tkinter as tk
import numpy as np
from .app import AnalysisApp
from .analysis import read_csv

class AppTests(unittest.TestCase):
    def test_preview_and_export_preserve_source(self):
        with tempfile.TemporaryDirectory(prefix='combalance-ui-test-') as temp:
            root=tk.Tk();root.withdraw()
            try:
                app=AnalysisApp(root);source=Path(temp)/'source.csv'
                with source.open('w',newline='',encoding='utf-8') as stream:
                    writer=csv.writer(stream);writer.writerow(['記録周波数(Hz)','100'])
                    header=['','Fx','Fz','My','xb','axb','xp'];writer.writerow(header)
                    writer.writerow(['単位','N','N','N･m','mm','mm/s/s','mm']);writer.writerow(header)
                    for t in np.arange(0,10,.01):writer.writerow([t,0,600,0,2*np.cos(2*np.pi*.2*t),0,0])
                original=source.read_bytes();app.source=source;app.channels,app.audit=read_csv(source)
                app.start.set('1');app.end.set('9');app.kind.set('lowpass')
                with patch('research_sync.app.messagebox.showerror',side_effect=lambda title,msg: (_ for _ in ()).throw(AssertionError(msg))):
                    app.preview();root.update()
                    with patch('research_sync.app.filedialog.askdirectory',return_value=temp):app.save()
                runs=list(Path(temp).glob('analysis-*'));self.assertEqual(len(runs),1)
                self.assertTrue((runs[0]/'conditions.json').exists());self.assertTrue((runs[0]/'inspection.png').exists())
                data=np.genfromtxt(runs[0]/'analysis.csv',names=True,delimiter=',')
                self.assertIn('vendor_com_velocity_derivative_m_s',data.dtype.names)
                self.assertEqual(source.read_bytes(),original)
            finally:root.destroy()

if __name__=='__main__':unittest.main()
