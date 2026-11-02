"""Real WebGL; mocked Firebase/XR boundaries, no production backend traffic.

python tests/mani_browser_checks.py
AFRAME_BUNDLE_PATH and CHROMIUM_PATH optionally override local dependencies.
"""
import functools
import http.server
import os
from pathlib import Path
import tempfile
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class ManiBrowserChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw = sync_playwright().start()
        options = dict(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        if os.environ.get('CHROMIUM_PATH'): options['executable_path'] = os.environ['CHROMIUM_PATH']
        cls.browser = cls.pw.chromium.launch(**options)
        cls.bundle = Path(os.environ.get('AFRAME_BUNDLE_PATH', ROOT / 'outputs/aframe.min.js'))
        if not cls.bundle.exists():
            import urllib.request
            cls.bundle = Path(tempfile.gettempdir()) / 'mani-aframe.min.js'
            urllib.request.urlretrieve('https://aframe.io/releases/1.7.0/aframe.min.js', cls.bundle)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':900,'height':700})
        self.errors = []
        self.context.on('page', lambda p: p.on('pageerror', lambda e: self.errors.append(str(e))))
        self.context.route('https://**/*', self.external)
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()

    def external(self, route):
        url = route.request.url
        if 'aframe.min.js' in url: route.fulfill(path=self.bundle, content_type='application/javascript')
        elif url.endswith('firebase-app-compat.js'): route.fulfill(body=(ROOT/'tests/firebase-fixture.js').read_text(), content_type='application/javascript')
        elif url.endswith(('firebase-auth-compat.js','firebase-database-compat.js')): route.fulfill(body='', content_type='application/javascript')
        else: route.abort()

    def quest(self):
        self.page.goto(self.base+'/quest2.html')
        self.page.wait_for_function("window.fixture?.lastStatus()?.renderStarted")
        self.path = self.page.evaluate("[...fixture.listeners.keys()].find(k=>k.endsWith('/command'))")
        self.page.evaluate("""() => {
          const scene=document.querySelector('a-scene'),xr=scene.renderer.xr;
          scene.pause(); // Drive production ticks manually; eliminate requestAnimationFrame races.
          fixture.time=1000;performance.now=()=>fixture.time;
          fixture.session={addEventListener(){},frameRate:90,visibilityState:'visible'};
          xr.enabled=false;xr.isPresenting=true;xr.getSession=()=>fixture.session;xr.getCamera=()=>scene.camera;
          document.querySelector('.a-enter-vr').style.display='none';
          fixture.send=(c)=>fixture.emit([...fixture.listeners.keys()].find(k=>k.endsWith('/command')),
            {seq:++fixture.seq,questInstanceId:fixture.lastStatus().instanceId,requestedAt:Date.now(),runId:'trial-test-'+fixture.seq,...c});
          scene.components['mani-driver'].tick();
          fixture.send({type:'calibrate'});
        }""")

    def send(self, **command):
        self.page.evaluate('(c)=>fixture.send(c)', command)

    def status(self): return self.page.evaluate('fixture.lastStatus()')

    def advance(self, ms):
        self.page.evaluate('(ms)=>{fixture.time+=ms;document.querySelector("a-scene").components["mani-driver"].tick();}', ms)

    def test_trial_timing_logging_stop_and_reentry(self):
        self.quest()
        self.assertTrue(self.status()['calibrated'])
        self.send(type='start', settings={'countdownSec':3})
        self.assertEqual(self.status()['status'], 'countdown')
        self.advance(2999); self.assertEqual(self.status()['status'], 'countdown')
        self.advance(1); self.assertEqual(self.status()['status'], 'running')
        self.advance(10000)
        self.assertEqual(self.page.evaluate("document.querySelector('#cloud').getObject3D('mesh').count"),10000)
        self.advance(40000); self.assertEqual(self.status()['reason'], 'completed')
        log=self.page.evaluate("fixture.writes.find(w=>w.path.includes('/logs/')).value")
        self.assertEqual(log['scheduledSphereCount'],50000)
        self.assertEqual(log['lastSubmittedSphereCount'],10000)
        self.assertEqual(log['analysisWindowSec'],[10,40]); self.assertEqual(log['nominalXRHz'],90)
        self.assertEqual(len(log['samples'][0]),10)
        self.send(type='start',settings={'countdownSec':0});self.advance(1)
        self.send(type='stop',questInstanceId='stale',seq=-1);self.assertEqual(self.status()['reason'],'stopped')
        self.page.evaluate("document.querySelector('a-scene').renderer.xr.isPresenting=false")
        self.advance(1);self.assertFalse(self.status()['calibrated'])
        self.assertFalse(self.errors,self.errors)

    def test_mask_pixels_density_and_fixation(self):
        from PIL import Image
        import io
        self.quest()
        for condition in ['upper','lower','full','none']:
            self.send(type='start',settings={'condition':condition,'countdownSec':0,'emissionRate':100})
            self.advance(1);self.advance(20000)
            self.page.evaluate("document.querySelector('a-scene').renderer.render(document.querySelector('a-scene').object3D,document.querySelector('a-scene').camera)")
            img=Image.open(io.BytesIO(self.page.locator('canvas').screenshot())).convert('RGB')
            above=below=red=0
            for y in range(img.height):
                for x in range(img.width):
                    r,g,b=img.getpixel((x,y))
                    if min(r,g,b)>200:
                        if y<img.height//2-2:above+=1
                        elif y>img.height//2+2:below+=1
                    if r>180 and g<80 and b<80:red+=1
            self.assertGreater(red,0,condition)
            if condition=='upper':self.assertGreater(above,100);self.assertEqual(below,0)
            elif condition=='lower':self.assertGreater(below,100);self.assertEqual(above,0)
            elif condition=='none':self.assertEqual(above+below,0)
            else:self.assertGreater(above,100);self.assertGreater(below,100)
            if condition=='lower':img.save(Path(tempfile.gettempdir())/'mani-lower-preview.png')
            self.send(type='stop')
        self.assertFalse(self.errors,self.errors)

    def test_stale_duplicate_disconnect_and_invalid(self):
        self.quest()
        self.send(type='start',requestedAt=1);self.assertNotEqual(self.status()['status'],'running')
        self.send(type='start',settings={'speedMps':0});self.assertEqual(self.status()['status'],'blocked')
        self.send(type='start',settings={'countdownSec':0});self.advance(1)
        self.send(type='start');self.assertEqual(self.status()['status'],'blocked')
        self.page.evaluate("fixture.emit('.info/connected',false)")
        self.assertFalse(self.page.evaluate("document.querySelector('#cloud').getObject3D('mesh').visible"))
        self.page.evaluate("fixture.emit('.info/connected',true)")
        self.assertFalse(self.status()['calibrated'])
        self.assertFalse(self.errors,self.errors)

    def test_full_paper_load_and_duplicate_command(self):
        self.quest()
        self.send(type='start',settings={'condition':'full','countdownSec':0});self.advance(1)
        self.advance(49999)
        self.page.evaluate("document.querySelector('a-scene').renderer.render(document.querySelector('a-scene').object3D,document.querySelector('a-scene').camera)")
        self.assertEqual(self.page.evaluate("document.querySelector('#cloud').getObject3D('mesh').count"),49999)
        self.send(type='calibrate',seq=1)
        self.advance(1)
        self.assertEqual(self.status()['reason'],'completed')
        self.assertFalse(self.errors,self.errors)

    def test_operator_command_and_preview_isolation(self):
        self.page.goto(self.base+'/operator2.html')
        self.page.wait_for_function("window.fixture && !document.getElementById('control').hidden")
        self.page.wait_for_function("document.querySelector('iframe').contentWindow.document.querySelector('a-scene')?.renderStarted")
        self.page.evaluate("""() => fixture.emit([...fixture.listeners.keys()].find(k=>k.endsWith('/status')),
          {protocol:'mani-2022',instanceId:'quest-test',at:Date.now(),renderStarted:true,immersive:true,calibrated:true,firebaseState:'接続済み',status:'idle'})""")
        self.page.click('#start')
        command=self.page.evaluate("fixture.writes.find(w=>w.path.endsWith('/command')).value")
        self.assertEqual(command['settings']['emissionRate'],1000);self.assertEqual(command['settings']['durationSec'],50)
        self.assertEqual(command['settings']['radiusM'],.05);self.assertEqual(command['settings']['speedMps'],.05)
        frame=self.page.frames[1]
        self.assertTrue(frame.evaluate('typeof firebase === "undefined"'))
        self.page.click('#previewStart')
        self.assertEqual(self.page.evaluate("fixture.writes.filter(w=>w.path.endsWith('/command')).length"),1)
        self.page.click('#stop')
        self.assertEqual(self.page.evaluate("fixture.writes.filter(w=>w.path.endsWith('/command')).at(-1).value.type"),'stop')
        self.assertFalse(self.errors,self.errors)

if __name__ == '__main__': unittest.main()
