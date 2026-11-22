"""Separate, visual-only fixation comparison. No acquisition or analysis imports."""
from http.server import BaseHTTPRequestHandler,HTTPServer
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import json,time,argparse

def serve(port=8872):
    root=Path(__file__).parent
    state=dict(condition='none',start=None)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def send(self,body,mime='text/html; charset=utf-8',code=200):
            self.send_response(code);self.send_header('Content-Type',mime);self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
        def do_GET(self):
            url=urlsplit(self.path);path=url.path
            if path=='/state':return self.send(json.dumps(dict(state,now=time.monotonic())).encode(),'application/json')
            if path in ('/q','/scene'):
                html=(root/'quest.html').read_text(encoding='utf-8').replace('research-driver','fixation-driver').replace('src="quest.js"','src="fixation_scene.js"').replace('src="waveform.js"','src="fixation.js"')
                html=html.replace('右下のVRボタンで開始し、同期プローブが揃うまで待機してください。','VRに入り、PCの注視条件画面から開始してください。')
                if parse_qs(url.query).get('preview'):
                    html=html.replace('<a-scene ','<a-scene embedded xr-mode-ui="enabled:false" ').replace('camera look-controls','camera look-controls="enabled:false"').replace('<style>','<style>html,body{margin:0;height:100%}a-scene{height:100vh}#status{display:none}')
                return self.send(html.encode('utf-8'))
            files={'/':'fixation.html','/fixation.js':'fixation.js','/fixation_scene.js':'fixation_scene.js','/fixation_target.js':'fixation_target.js','/grid.svg':'grid.svg','/vendor/aframe.min.js':'vendor/aframe.min.js'}
            if path not in files:return self.send(b'Not found','text/plain',404)
            p=root/files[path];mime='application/javascript' if p.suffix=='.js' else 'image/svg+xml' if p.suffix=='.svg' else 'text/html; charset=utf-8'
            self.send(p.read_bytes(),mime)
        def do_POST(self):
            if self.path!='/action':return self.send(b'',code=404)
            if self.headers.get('Origin') not in (None,f'http://localhost:{port}',f'http://127.0.0.1:{port}'):return self.send(b'',code=403)
            try:
                data=json.loads(self.rfile.read(min(int(self.headers.get('Content-Length',0)),2048)))
                action=data['action'];condition=data['condition']
                if condition not in ('none','dot','spinner') or action not in ('start','stop','condition'):raise ValueError()
                if action=='start':state.update(condition=condition,start=time.monotonic()+3)
                elif action=='stop':state['start']=None
                elif state['start'] is None or time.monotonic()-state['start']>=30:state['condition']=condition
                self.send(b'{}','application/json')
            except (ValueError,KeyError):self.send(b'Invalid request','text/plain',400)
    print(f'Fixation preview/control: http://localhost:{port}',flush=True)
    HTTPServer(('127.0.0.1',port),Handler).serve_forever()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8872);serve(p.parse_args().port)
