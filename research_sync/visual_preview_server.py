"""Visual-only local preview server. No measurement, device API or synchronization."""
import argparse
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
import re
from urllib.parse import urlsplit

def serve(port=8870,data='results/visual-stimulus-20261121'):
    root=Path(__file__).parent;folder=(root/data).resolve()
    assets={'visual-preview.html','visual-preview.js','visual-scene.js','waveform.js','fixation.js','fixation_target.js','grid.svg','vendor/aframe.min.js'}
    outputs={'stimulus.json','verification.json','waveforms.png','stimulus.csv','component_amplitudes.csv'}
    class Handler(SimpleHTTPRequestHandler):
        def end_headers(self):self.send_header('Cache-Control','no-store');super().end_headers()
        def do_GET(self):
            name=urlsplit(self.path).path.lstrip('/') or 'visual-preview.html'
            if name=='visual-scene.html':
                html=(root/'quest.html').read_text(encoding='utf-8')
                html=html.replace('stimulus-driver','visual-preview-driver').replace('research-driver','visual-preview-driver')
                html=html.replace('<a-scene ','<a-scene embedded xr-mode-ui="enabled:false" ')
                html=html.replace('camera look-controls','camera look-controls="enabled:false"')
                html=html.replace('src="quest.js"','src="visual-scene.js"')
                html=re.sub(r'<div id="status">.*?</div>','',html)
                html=html.replace('<style>','<style>html,body{height:100%;margin:0}a-scene{height:100vh;width:100vw}')
                payload=html.encode('utf-8');mime='text/html; charset=utf-8'
            else:
                path=folder/name[5:] if name.startswith('data/') and name[5:] in outputs else root/name if name in assets else None
                if path is None or not path.is_file():self.send_error(404);return
                payload=path.read_bytes();mime=self.guess_type(str(path))
                if path.suffix in ('.js','.json','.html','.csv'):mime+='; charset=utf-8'
            self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
    print(f'Visual preview: http://localhost:{port}/visual-preview.html',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=8870);parser.add_argument('--data',default='results/visual-stimulus-20261121');a=parser.parse_args();serve(a.port,a.data)
