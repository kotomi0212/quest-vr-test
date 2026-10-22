"""Real A-Frame/software WebGL; deterministic Firebase and XR state boundaries.

Run: python3 tests/browser_checks.py
Requires Python Playwright, Chromium, and HTTPS access to the pinned A-Frame CDN.
No Firebase requests, trial commands, or credentials reach the real backend.
"""
import functools
import http.server
import os
import shutil
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = (ROOT / 'tests/firebase-fixture.js').read_text()


class BrowserChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='quest-browser-')
        cls.aframe = Path(cls.temp.name) / 'aframe.min.js'
        if os.environ.get('AFRAME_BUNDLE_PATH'):
            shutil.copyfile(os.environ['AFRAME_BUNDLE_PATH'], cls.aframe)
        else:
            subprocess.run(['curl', '-fsSL', '--max-time', '60',
                            'https://aframe.io/releases/1.7.0/aframe.min.js', '-o', str(cls.aframe)], check=True)
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True,
            args=['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp.cleanup()

    def setUp(self):
        self.context = self.browser.new_context()
        self.requests, self.errors = [], []
        self.context.on('request', lambda request: self.requests.append(request.url))
        self.context.on('page', lambda page: page.on('pageerror', lambda error: self.errors.append(str(error))))
        self.context.route('https://**/*', self.external)
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()

    def external(self, route):
        url = route.request.url
        if url == 'https://aframe.io/releases/1.7.0/aframe.min.js':
            route.fulfill(path=self.aframe, content_type='application/javascript')
        elif url.endswith('firebase-app-compat.js'):
            route.fulfill(body=FIXTURE, content_type='application/javascript')
        elif url.endswith(('firebase-auth-compat.js', 'firebase-database-compat.js')):
            route.fulfill(body='', content_type='application/javascript')
        else:
            route.abort()

    def quest(self):
        self.page.goto(self.base + '/quest.html')
        self.page.wait_for_function("document.querySelector('a-scene')?.renderStarted && window.fixture?.lastStatus()")
        self.path = self.page.evaluate("Array.from(fixture.listeners.keys()).find(p=>p.endsWith('/command'))")
        self.page.evaluate("fixture.commandPath = " + repr(self.path))

    def status(self):
        return self.page.evaluate('fixture.lastStatus()')

    def xr(self, presenting=True, event_first=False):
        # A real scene/renderer with only the XR session boundary simulated.
        # This deliberately does not claim to create an actual immersive session.
        self.page.evaluate('''({presenting,eventFirst}) => {
          const scene=document.querySelector('a-scene'), xr=scene.renderer.xr;
          xr.enabled=false;
          if(eventFirst) scene.emit('enter-vr');
          xr.getSession=()=>presenting ? window.fixture.session : null;
          xr.getCamera=()=>scene.camera;
          xr.isPresenting=presenting;
          if(presenting) {
            window.fixture.session ||= new EventTarget();
            scene.addState('vr-mode');
            if(!eventFirst) scene.emit('enter-vr');
          } else { scene.removeState('vr-mode'); xr.dispatchEvent({type:'sessionend'}); scene.emit('exit-vr'); }
        }''', {'presenting': presenting, 'eventFirst': event_first})
        self.page.wait_for_function('fixture.lastStatus().immersive === ' + str(presenting).lower())

    def command(self, kind, **overrides):
        command = self.page.evaluate('''kind => ({type:kind,seq:++fixture.seq+Date.now(),
            questInstanceId:fixture.lastStatus().instanceId,requestedAt:Date.now(),
            runId:'test-'+crypto.randomUUID(),mode:'sine',durationSec:5,frequencyHz:.2,amplitudeDeg:1,amplitudePpDeg:2,
            heightCm:160,eyeHeightM:1.5,ankleHeightM:.08,hipHeightM:.9,rotationCenter:'ankle',csvFile:'demo_not_ghiasi_trapv.csv'})''', kind)
        command.update(overrides)
        self.page.evaluate('c=>fixture.emit(fixture.commandPath,c)', command)
        return command

    def calibrated(self):
        self.xr()
        self.command('calibrate')
        self.assertTrue(self.status()['calibrated'])

    def test_real_render_standard_button_and_vr_required(self):
        self.quest()
        d = self.status()
        self.assertTrue(d['loaded'] and d['renderStarted'] and d['vrButton'])
        self.assertEqual(self.page.evaluate('AFRAME.version'), '1.7.0')
        self.assertTrue(self.page.locator('.a-enter-vr-button').is_visible())
        self.assertTrue(self.page.evaluate("!!document.querySelector('canvas').getContext('webgl2')"))
        self.command('start')
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertIn('enter VR', self.status()['error'])
        self.page.evaluate("document.querySelector('a-scene').emit('enter-vr')")
        self.command('start')
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertEqual(self.errors, [])

    def test_event_before_presenting_and_reentry(self):
        self.quest()
        self.xr(event_first=True)
        self.assertFalse(self.status()['calibrated'])
        self.command('start')
        self.assertEqual(self.status()['status'], 'blocked')
        self.command('calibrate')
        self.assertTrue(self.status()['calibrated'])
        self.command('start')
        self.assertEqual(self.status()['status'], 'countdown')
        self.xr(False)
        self.assertFalse(self.status()['calibrated'])
        self.xr(True)
        self.command('start')
        self.assertIn('位置合わせ', self.status()['error'])
        self.assertEqual(self.errors, [])

    def test_sine_stop_logs_and_pivot(self):
        self.quest(); self.calibrated()
        self.page.evaluate("document.querySelector('a-scene').camera.position.set(1,1.6,2)")
        self.command('calibrate', ankleHeightM=0)
        self.assertEqual(self.status()['anklePivotM'], [1, 0, 2])
        self.command('start')
        self.page.wait_for_function("fixture.lastStatus().status==='running'", timeout=10000)
        self.page.wait_for_function("Math.abs(document.querySelector('#visual-world').object3D.rotation.x)>.01")
        self.page.evaluate('''()=>{
          const room=document.querySelector('#visual-world').object3D;
          const pivot=new AFRAME.THREE.Vector3(1,0,2);
          fixture.pivotError=pivot.clone().applyEuler(room.rotation).add(room.position).distanceTo(pivot);
        }''')
        self.assertLess(self.page.evaluate('fixture.pivotError'), 1e-8)
        self.command('stop')
        self.assertEqual(self.status()['status'], 'idle')
        self.assertTrue(self.status()['immersive'])
        self.assertEqual(self.page.evaluate("document.querySelector('#visual-world').object3D.rotation.x"), 0)
        log = self.page.evaluate("fixture.writes.find(w=>w.path.includes('/logs/')).value")
        self.assertGreater(len(log['samples']), 0)
        self.assertEqual(log['reason'], 'stopped')
        self.assertEqual(log['anklePivotM'], [1, 0, 2])
        self.assertEqual(self.errors, [])

    def hold_csv(self):
        # Defer fulfillment while the page can process a subsequent STOP/VR exit.
        self.held = []
        self.page.route('**/demo_not_ghiasi_trapv.csv', lambda route: self.held.append(route))
        self.command('start', mode='csv')
        self.page.wait_for_function("fixture.lastStatus().status==='loading'")
        self.page.wait_for_timeout(100)
        self.assertTrue(self.held)

    def test_csv_stop_during_fetch(self):
        self.quest(); self.calibrated(); self.hold_csv()
        self.command('stop')
        for route in self.held:
            route.fulfill(body='time_s,angle_deg\n0,0\n1,5\n', content_type='text/csv')
        self.page.wait_for_timeout(350)
        self.assertEqual(self.status()['status'], 'idle')
        self.assertFalse(any(w['value']['status'] == 'countdown' for w in self.page.evaluate("fixture.writes.filter(w=>w.path.endsWith('/status'))")))
        self.assertEqual(self.errors, [])

    def test_csv_exit_during_fetch(self):
        self.quest(); self.calibrated(); self.hold_csv(); self.xr(False)
        for route in self.held:
            route.fulfill(body='time_s,angle_deg\n0,0\n1,5\n', content_type='text/csv')
        self.xr(True)
        self.page.wait_for_timeout(350)
        self.assertFalse(self.status()['calibrated'])
        self.assertFalse(any(w['value']['status'] == 'countdown' for w in self.page.evaluate("fixture.writes.filter(w=>w.path.endsWith('/status'))")))

    def test_stale_reload_and_reconnect(self):
        self.quest(); self.calibrated()
        old_id = self.status()['instanceId']
        self.command('start', requestedAt=1)
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertIn('古い', self.status()['error'])
        self.page.reload(); self.page.wait_for_function('window.fixture?.lastStatus()')
        self.page.evaluate("fixture.commandPath=Array.from(fixture.listeners.keys()).find(p=>p.endsWith('/command'))")
        self.calibrated()
        self.command('start', questInstanceId=old_id)
        self.assertNotEqual(self.status()['status'], 'countdown')
        self.command('start')
        self.assertEqual(self.status()['status'], 'countdown')
        reconnect_id = self.status()['instanceId']
        self.page.evaluate("fixture.emit('.info/connected',false)")
        self.page.evaluate("fixture.emit('.info/connected',true)")
        self.assertNotEqual(self.status()['instanceId'], reconnect_id)
        self.command('start', questInstanceId=reconnect_id)  # old recipient cannot replay after reconnect
        self.assertFalse(self.status()['calibrated'])
        self.assertNotEqual(self.status()['status'], 'countdown')
        self.command('calibrate')
        self.command('start')
        self.assertEqual(self.status()['status'], 'countdown')

    def test_csv_and_baseline_complete(self):
        self.quest(); self.calibrated()
        self.command('start', mode='csv')
        self.page.wait_for_function("fixture.lastStatus().status==='countdown'")
        self.page.wait_for_function("fixture.lastStatus().status==='running'", timeout=10000)
        self.page.wait_for_timeout(300)
        self.command('stop')
        log = self.page.evaluate("fixture.writes.filter(w=>w.path.includes('/logs/')).at(-1).value")
        self.assertEqual(log['mode'], 'csv')
        self.assertGreater(len(log['samples']), 0)
        self.command('start', mode='baseline')
        self.page.wait_for_function("fixture.writes.some(w=>w.path.includes('/logs/')&&w.value.reason==='completed')", timeout=15000)
        log = self.page.evaluate("fixture.writes.filter(w=>w.path.includes('/logs/')).at(-1).value")
        self.assertEqual(log['mode'], 'baseline')
        self.assertTrue(all(s[1] == 0 for s in log['samples']))
        self.assertTrue(self.status()['immersive'])
        self.assertEqual(self.errors, [])

    def test_firebase_failure_does_not_prevent_scene(self):
        self.page.route('**/firebase-app-compat.js', lambda route: route.abort())
        self.page.goto(self.base + '/quest.html')
        self.page.wait_for_function("document.querySelector('a-scene')?.renderStarted")
        self.assertTrue(self.page.locator('.a-enter-vr-button').is_visible())
        self.page.wait_for_function("document.querySelector('#diagnostics').textContent.includes('接続エラー')")
        self.assertEqual(self.errors, [])

    def test_delayed_firebase_does_not_delay_render_or_button(self):
        held = []
        self.page.route('**/firebase-app-compat.js', lambda route: held.append(route))
        self.page.goto(self.base + '/quest.html', wait_until='domcontentloaded')
        self.page.wait_for_function("document.querySelector('a-scene')?.renderStarted")
        self.assertTrue(self.page.locator('.a-enter-vr-button').is_visible())
        self.assertTrue(held)
        for route in held:
            route.fulfill(body=FIXTURE, content_type='application/javascript')
        self.page.wait_for_function('window.fixture?.lastStatus()')
        self.assertEqual(self.errors, [])

    def test_graphics_loss_cancels_start(self):
        self.quest(); self.calibrated(); self.command('start')
        self.page.evaluate("document.querySelector('a-scene').canvas.dispatchEvent(new Event('webglcontextlost'))")
        self.assertFalse(self.status()['renderStarted'])
        self.assertFalse(self.status()['calibrated'])
        self.command('start')
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertIn('初期化', self.status()['error'])
        self.assertTrue(self.page.locator('#startup-error').is_visible())

    def test_invalid_csv_rejected(self):
        self.quest(); self.calibrated()
        self.page.route('**/demo_not_ghiasi_trapv.csv', lambda route: route.fulfill(body='time_s,angle_deg\n0,0\n1,wrong\n2,3\n'))
        self.command('start', mode='csv')
        self.page.wait_for_function("fixture.lastStatus().status==='blocked'")
        self.assertIn('CSV読込エラー', self.status()['error'])
        self.assertEqual(self.page.evaluate("document.querySelector('#visual-world').object3D.rotation.x"), 0)

    def test_stop_with_previous_instance_and_duplicate_start(self):
        self.quest(); self.calibrated()
        command = self.command('start')
        count = self.page.evaluate('fixture.writes.length')
        self.page.evaluate('c=>fixture.emit(fixture.commandPath,c)', command)
        self.assertEqual(self.page.evaluate('fixture.writes.length'), count)
        self.command('stop', questInstanceId='old-headset')
        self.assertEqual(self.status()['status'], 'idle')
        self.assertTrue(self.status()['immersive'])

    def test_new_trial_after_stop_does_not_wait_for_log_upload(self):
        self.quest(); self.calibrated(); self.command('start')
        self.page.evaluate('fixture.holdLogs = true')
        self.command('stop')
        self.command('start', mode='baseline')
        self.assertEqual(self.status()['status'], 'countdown')
        self.assertTrue(self.page.evaluate("fixture.writes.some(w=>w.path.includes('/logs/'))"))
        self.command('stop')
        self.assertEqual(self.status()['status'], 'idle')

    def test_preview_isolation_and_operator_feedback(self):
        self.page.goto(self.base + '/operator.html')
        self.page.wait_for_function("document.querySelector('#preview').contentWindow.document.querySelector('a-scene')?.renderStarted")
        frame = self.page.frame_locator('#preview')
        self.assertEqual(frame.locator('.a-enter-vr-button').count(), 0)
        self.assertFalse(self.page.frames[1].evaluate("!!window.fixture || !!window.firebase"))
        self.assertEqual(self.page.evaluate('fixture.anonymousCalls'), 0)
        self.assertEqual(self.page.evaluate('fixture.apps'), ['[DEFAULT]'])
        self.page.evaluate('''()=>{
          fixture.emit(Array.from(fixture.listeners.keys()).find(p=>p.endsWith('/status')),
          {status:'ready',at:Date.now(),instanceId:'test-headset',immersive:true,renderStarted:true,calibrated:true,vrButton:true,firebaseState:'接続済み'});
        }''')
        self.page.locator('#mode').select_option('sine')
        self.page.locator('#start').click()
        self.page.wait_for_function("document.querySelector('#log').textContent.includes('送信済み')")
        sent = self.page.evaluate("fixture.writes.find(w=>w.path.endsWith('/command')).value")
        self.assertEqual(sent['questInstanceId'], 'test-headset')
        self.page.evaluate('''c=>fixture.emit(Array.from(fixture.listeners.keys()).find(p=>p.endsWith('/status')),
          {status:'countdown',at:Date.now(),instanceId:'test-headset',immersive:true,renderStarted:true,calibrated:true,commandSeq:c.seq,firebaseState:'接続済み'})''', sent)
        self.assertIn('受信', self.page.locator('#log').inner_text())
        self.page.wait_for_timeout(3400)
        self.assertGreater(abs(self.page.frames[1].evaluate("document.querySelector('#visual-world').object3D.rotation.x")), .005)
        self.page.locator('#stop').click()
        self.page.wait_for_function("document.querySelector('#log').textContent.includes('STOP送信済み')")
        self.page.frames[1].wait_for_function("document.querySelector('#visual-world').object3D.rotation.x===0", timeout=5000)
        self.assertEqual(self.page.frames[1].evaluate("document.querySelector('#visual-world').object3D.rotation.x"), 0)
        self.assertEqual(self.page.frames[1].evaluate('typeof firebase'), 'undefined')
        self.assertEqual(self.errors, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
