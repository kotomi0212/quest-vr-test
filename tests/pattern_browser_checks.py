"""Real A-Frame/WebGL pattern checks. Firebase/XR boundaries are simulated.

Run: python3 tests/pattern_browser_checks.py
AFRAME_BUNDLE_PATH may point to an official, TLS-verified A-Frame 1.7.0 bundle.
"""
import unittest

import browser_checks


class PatternBrowserChecks(browser_checks.BrowserChecks):
    def pattern_state(self):
        return self.page.evaluate('''() => {
          const s=document.querySelector('a-scene'),el=s.querySelector('#contrast-pattern'),mesh=el.getObject3D('mesh');
          return {id:fixture.lastStatus().pattern,settings:fixture.lastStatus().patternSettings,
            geometry:mesh.geometry.type,width:mesh.geometry.parameters.width,height:mesh.geometry.parameters.height,
            position:mesh.position.toArray(),toneMapped:mesh.material.toneMapped,colorSpace:mesh.material.map.colorSpace};
        }''')

    def test_pattern_planes_render_and_match_geometry(self):
        self.quest()
        for pattern in ['noise-1f', 'stripes-high', 'stripes-low']:
            self.command('configure', pattern=pattern)
            state = self.pattern_state()
            self.assertEqual(state['id'], pattern)
            self.assertEqual(state['geometry'], 'PlaneGeometry')
            self.assertEqual([state['width'], state['height']], [6, 4])
            self.assertEqual(state['position'], [0, 1.6, -3])
            self.assertFalse(state['toneMapped'])
            self.assertEqual(state['colorSpace'], 'srgb')
            self.assertFalse(self.status()['immersive'])
            self.assertTrue(self.page.locator('.a-enter-vr-button').is_visible())
            self.assertTrue(self.status()['configured'])
            self.page.wait_for_timeout(50)
        self.assertEqual(self.errors, [])

    def test_pattern_actual_webgl_stripe_colors(self):
        self.quest()
        colors = {}
        for pattern in ['stripes-high', 'stripes-low']:
            self.command('configure', pattern=pattern)
            colors[pattern] = self.page.evaluate('''() => {
              const s=document.querySelector('a-scene'),T=AFRAME.THREE;
              s.object3D.updateMatrixWorld(true);s.renderer.render(s.object3D,s.camera);
              const mesh=s.querySelector('#contrast-pattern').getObject3D('mesh'),gl=s.renderer.getContext();
              return [.49,.51].map(u=>{
                const point=new T.Vector3((u-.5)*6,0,0);mesh.localToWorld(point);point.project(s.camera);
                const pixel=new Uint8Array(4);
                gl.readPixels(Math.floor((point.x+1)/2*s.canvas.width),Math.floor((point.y+1)/2*s.canvas.height),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
                return Array.from(pixel);
              });
            }''')
        self.assertLess(max(colors['stripes-high'][0][:3]), 3)
        self.assertGreater(min(colors['stripes-high'][1][:3]), 252)
        for color, expected in zip(colors['stripes-low'], [179, 196]):
            for channel in color[:3]:
                self.assertLessEqual(abs(channel - expected), 2)
        self.assertEqual(self.errors, [])

    def test_pattern_motion_logs_and_busy_switch(self):
        self.quest()
        self.calibrated()
        # Freeze the actual frame driver and advance its production tick deterministically.
        self.page.evaluate('''() => {
          const s=document.querySelector('a-scene');s.renderer.setAnimationLoop(null);s.pause();
          fixture.now=performance.now();Object.defineProperty(performance,'now',{value:()=>fixture.now});
          fixture.advance=ms=>{fixture.now+=ms;s.components['stimulus-driver'].tick();};
        }''')
        trajectories = []
        for pattern in ['noise-1f', 'stripes-high', 'stripes-low']:
            start = self.command('start', pattern=pattern)
            self.assertEqual(self.status()['status'], 'countdown')
            self.page.evaluate('fixture.advance(3001)')
            trajectories.append(self.page.evaluate('''()=>{
              const positions=[];
              for(let i=0;i<200;i++){fixture.advance(10);positions.push(document.querySelector('#visual-world').object3D.rotation.x);}
              return positions;
            }'''))
            self.command('configure', pattern='room')
            self.assertEqual(self.status()['status'], 'blocked')
            self.assertEqual(self.status()['pattern'], pattern)
            self.command('emergency')
            log = self.page.evaluate('''id=>fixture.writes.find(w=>w.path.endsWith('/'+id)).value''', start['runId'])
            self.assertEqual(log['pattern'], pattern)
            self.assertEqual(log['patternSettings']['id'], pattern)
            self.assertEqual(log['patternSettings']['screen']['distanceM'], 3)
            self.assertGreater(len(log['samples']), 100)
            self.assertTrue(self.status()['immersive'])
        self.assertEqual(trajectories[0], trajectories[1])
        self.assertEqual(trajectories[1], trajectories[2])
        self.assertGreater(max(trajectories[0]), .01)
        self.assertEqual(self.errors, [])

    def test_pattern_cache_and_legacy_options(self):
        self.quest()
        self.command('configure', pattern='noise-1f')
        self.page.evaluate("fixture.noiseTexture=document.querySelector('#contrast-pattern').getObject3D('mesh').material.map")
        for pattern in ['stripes-high', 'stripes-low', 'grid', 'room', 'noise-1f']:
            self.command('configure', pattern=pattern)
        self.assertTrue(self.page.evaluate("fixture.noiseTexture===document.querySelector('#contrast-pattern').getObject3D('mesh').material.map"))
        self.assertFalse(self.page.evaluate("document.querySelector('#room-pattern').object3D.visible"))
        self.command('configure', pattern='unknown')
        self.assertEqual(self.status()['status'], 'blocked')
        self.assertEqual(self.status()['pattern'], 'noise-1f')
        self.assertEqual(self.errors, [])

    def test_pattern_operator_preview_and_command(self):
        self.page.goto(self.base + '/operator.html')
        self.page.wait_for_function("document.querySelector('#preview').contentWindow.document.querySelector('a-scene')?.renderStarted")
        preview = self.page.frames[1]
        # No Quest connection: static PC preview must still work without touching auth/status.
        self.page.locator('#pattern').select_option('stripes-low')
        preview.wait_for_function("document.querySelector('#contrast-pattern').dataset.pattern==='stripes-low'")
        self.assertEqual(preview.locator('canvas.a-canvas').bounding_box()['height'], 340)
        self.assertIn('コントラスト10%', self.page.locator('#patternDescription').inner_text())
        self.assertEqual(preview.evaluate('typeof firebase'), 'undefined')
        self.assertEqual(self.page.evaluate('fixture.anonymousCalls'), 0)
        self.page.evaluate('''()=>fixture.emit(Array.from(fixture.listeners.keys()).find(p=>p.endsWith('/status')),
          {status:'ready',at:Date.now(),instanceId:'test-headset',immersive:false,renderStarted:true,calibrated:false,firebaseState:'接続済み'})''')
        self.page.locator('#pattern').select_option('noise-1f')
        self.page.wait_for_function("fixture.writes.some(w=>w.value.type==='configure'&&w.value.pattern==='noise-1f')")
        self.page.locator('#pattern').select_option('stripes-high')
        self.page.wait_for_function("fixture.writes.some(w=>w.value.type==='configure'&&w.value.pattern==='stripes-high')")
        preview.wait_for_function("document.querySelector('#contrast-pattern').dataset.pattern==='stripes-high'")
        self.assertEqual(self.errors, [])


if __name__ == '__main__':
    # Only this feature's tests; existing base fixtures and helpers are reused.
    names = [name for name in PatternBrowserChecks.__dict__ if name.startswith('test_pattern_')]
    result = unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(PatternBrowserChecks(name) for name in names))
    raise SystemExit(not result.wasSuccessful())
