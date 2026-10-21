"""Headless WebGL integration checks (XR and Firebase boundaries are simulated).

Starts a loopback HTTP server and headless Chromium. Run only with approval to launch the server and browser.
Uses an existing official A-Frame bundle; no library download or real Firebase.
"""
import os
import unittest

import browser_checks


class KiemelBrowserChecks(browser_checks.BrowserChecks):
    def config(self, condition='ankle'):
        return self.page.evaluate('''condition=>{
          const c=KiemelConfig.restore();c.body={ankleHeight:.08,hipHeight:.9,eyeHeight:1.6};c.motion.type=condition;return c;
        }''', condition)

    def test_kiemel_actual_webgl_environment(self):
        self.quest()
        self.command('configure', pattern='kiemel-triangles', kiemel=self.config())
        self.assertEqual(self.status()['patternSettings']['totalCount'], 1500)
        self.assertEqual(self.status()['layoutSettings']['walls'][0]['center'], [0, 0, -1.07])
        self.assertTrue(self.page.locator('.a-enter-vr-button').is_visible())
        result = self.page.evaluate('''()=>{
          const s=document.querySelector('a-scene'),group=s.querySelector('#kiemel-environment').getObject3D('mesh');
          s.object3D.updateMatrixWorld(true);s.renderer.render(s.object3D,s.camera);
          const gl=s.renderer.getContext(),data=new Uint8Array(s.canvas.width*s.canvas.height*4);
          gl.readPixels(0,0,s.canvas.width,s.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
          let white=0,black=0;for(let i=0;i<data.length;i+=4){if(data[i]>250&&data[i+1]>250&&data[i+2]>250)white++;if(data[i]<2&&data[i+1]<2&&data[i+2]<2)black++;}
          return {white,black,vertices:group.children[3].geometry.attributes.position.count,fixation:group.userData.fixation.visible};
        }''')
        self.assertGreater(result['white'], 100)
        self.assertGreater(result['black'], 1000)
        self.assertEqual(result['vertices'], 4500)
        self.assertFalse(result['fixation'])
        self.assertEqual(self.errors, [])

    def test_kiemel_three_real_scene_transforms(self):
        self.quest(); self.xr()
        config=self.config()
        self.command('calibrate',protocol='kiemel',pattern='kiemel-triangles',kiemel=config)
        origin=self.status()['calibration']['kiemel']['origin']
        fingerprint=self.status()['patternSettings']['fingerprint']
        self.page.evaluate('''()=>{
          const s=document.querySelector('a-scene');s.renderer.setAnimationLoop(null);s.pause();
          fixture.now=performance.now();Object.defineProperty(performance,'now',{value:()=>fixture.now});
          fixture.advance=ms=>{fixture.now+=ms;s.components['stimulus-driver'].tick();};
        }''')
        for condition in ['translation','ankle','hip']:
            config['motion']['type']=condition
            self.command('start',protocol='kiemel',mode='kiemel',pattern='kiemel-triangles',kiemel=config)
            self.page.evaluate('fixture.advance(7000)')
            result=self.page.evaluate('''({config,origin})=>{
              const node=document.querySelector('#kiemel-environment').object3D;node.updateMatrixWorld(true);
              const expected=KiemelMotion.at(7,config),center=new AFRAME.THREE.Vector3(...expected.pivot);
              const fixed=center.clone().applyMatrix4(node.matrixWorld);
              const desired=center.clone();desired.x+=origin[0];desired.y+=origin[1];desired.z+=origin[2];
              return {angle:node.rotation.x,z:node.position.z-origin[2],expectedAngle:KiemelMotion.rad(expected.angleDeg),expectedZ:expected.eyeExactZ,pivotError:fixed.distanceTo(desired)};
            }''', {'config':config,'origin':origin})
            self.assertAlmostEqual(result['angle'], result['expectedAngle'])
            self.assertAlmostEqual(result['z'], result['expectedZ'])
            if condition=='translation': self.assertEqual(result['angle'], 0)
            else: self.assertLess(result['pivotError'], 1e-9)
            self.assertEqual(self.status()['patternSettings']['fingerprint'], fingerprint)
            self.command('emergency')
        self.assertEqual(self.errors, [])

    def test_kiemel_operator_preview_and_protocol(self):
        self.page.goto(self.base+'/operator.html')
        self.page.wait_for_function("document.querySelector('#preview').contentWindow.document.querySelector('a-scene')?.renderStarted")
        self.page.locator('#mode').select_option('kiemel')
        preview=self.page.frames[1]
        preview.wait_for_function("!!document.querySelector('#kiemel-environment').getObject3D('mesh')")
        self.assertEqual(preview.evaluate('typeof firebase'), 'undefined')
        for selector,value in [('#kiemelEye','160'),('#kiemelHip','90'),('#kiemelAnkle','8')]: self.page.locator(selector).fill(value)
        self.page.evaluate('''()=>fixture.emit(Array.from(fixture.listeners.keys()).find(p=>p.endsWith('/status')),
          {status:'ready',at:Date.now(),instanceId:'test-headset',immersive:true,renderStarted:true,calibrated:true,firebaseState:'接続済み'})''')
        self.page.locator('#calibrate').click()
        self.page.wait_for_function("fixture.writes.some(w=>w.value.type==='calibrate'&&w.value.protocol==='kiemel')")
        self.page.locator('#kiemelCondition').select_option('translation')
        self.page.locator('#start').click()
        self.page.wait_for_function("fixture.writes.some(w=>w.value.type==='start'&&w.value.kiemel?.motion.type==='translation')")
        sent=self.page.evaluate("fixture.writes.filter(w=>w.value.type==='start').at(-1).value")
        self.assertEqual(sent['durationSec'],260)
        self.assertEqual(sent['kiemel']['body'], {'ankleHeight':.08,'hipHeight':.9,'eyeHeight':1.6})
        self.assertEqual(self.page.evaluate('fixture.anonymousCalls'),0)
        self.assertEqual(self.errors, [])


if __name__=='__main__':
    if not os.environ.get('AFRAME_BUNDLE_PATH'):
        raise SystemExit('Set AFRAME_BUNDLE_PATH to an already verified official 1.7.0 bundle; no download is performed.')
    names=[name for name in KiemelBrowserChecks.__dict__ if name.startswith('test_kiemel_')]
    result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(KiemelBrowserChecks(name) for name in names))
    raise SystemExit(not result.wasSuccessful())
