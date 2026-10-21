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
          const s=document.querySelector('a-scene'),group=s.querySelector('#kiemel-environment').getObject3D('mesh').userData.projection.source;
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

    def test_kiemel_default_and_automatic_animation_loop(self):
        self.quest()
        self.assertEqual(self.status()['pattern'], 'kiemel-triangles')
        self.assertEqual(self.status()['patternSettings']['totalCount'],1500)
        self.xr()
        config=self.config()
        self.command('calibrate',protocol='kiemel',pattern='kiemel-triangles',kiemel=config)
        self.command('start',protocol='kiemel',mode='kiemel',pattern='kiemel-triangles',kiemel=config)
        self.assertEqual(self.status()['status'],'pre-static')
        # Real elapsed time and unmodified A-Frame render loop: no manual tick/time jump.
        self.page.wait_for_function("Math.abs(document.querySelector('#kiemel-environment').getObject3D('mesh').userData.projection.source.rotation.x)>0.003",timeout=15000)
        self.page.wait_for_function("fixture.lastStatus().renderedFrames>50 && fixture.lastStatus().kiemelPhase==='stimulus'",timeout=8000)
        self.assertGreater(self.status()['elapsedSeconds'],5)
        self.assertTrue(self.page.evaluate("document.querySelector('#kiemel-environment').object3D.visible"))
        self.command('emergency')
        self.assertEqual(self.page.evaluate("document.querySelector('#kiemel-environment').object3D.rotation.x"),0)
        self.assertEqual(self.errors,[])

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
              const fixedScreen=document.querySelector('#kiemel-environment').object3D;
              const node=document.querySelector('#kiemel-environment').getObject3D('mesh').userData.projection.source;node.updateMatrixWorld(true);
              const expected=KiemelMotion.at(7,config),center=new AFRAME.THREE.Vector3(...expected.pivot);
              const fixed=center.clone().applyMatrix4(node.matrixWorld);
              const desired=center.clone();
              return {angle:node.rotation.x,z:node.position.z,expectedAngle:KiemelMotion.rad(expected.renderAngleDeg),expectedZ:expected.eyeExactZ,pivotError:fixed.distanceTo(desired),screenAngle:fixedScreen.rotation.x,screenPosition:fixedScreen.position.toArray()};
            }''', {'config':config,'origin':origin})
            self.assertEqual(result['screenAngle'],0)
            self.assertEqual(result['screenPosition'],origin)
            self.assertAlmostEqual(result['angle'], result['expectedAngle'])
            self.assertAlmostEqual(result['z'], result['expectedZ'])
            if condition=='translation': self.assertEqual(result['angle'], 0)
            else: self.assertLess(result['pivotError'], 1e-9)
            self.assertEqual(self.status()['patternSettings']['fingerprint'], fingerprint)
            self.command('emergency')
        self.assertEqual(self.errors, [])

    def test_kiemel_render_targets_change_but_screens_and_reference_stay_fixed(self):
        self.quest();self.xr()
        config=self.config()
        self.command('calibrate',protocol='kiemel',pattern='kiemel-triangles',kiemel=config)
        self.command('start',protocol='kiemel',mode='kiemel',pattern='kiemel-triangles',kiemel=config)
        result=self.page.evaluate('''()=>{
          const s=document.querySelector('a-scene');s.pause();s.renderer.setAnimationLoop(null);
          const group=document.querySelector('#kiemel-environment').getObject3D('mesh'),p=group.userData.projection;
          const snapshot=()=>p.views.map(v=>{
            const bytes=new Uint8Array(p.resolution*p.resolution*4);s.renderer.readRenderTargetPixels(v.target,0,0,p.resolution,p.resolution,bytes);
            let hash=2166136261,white=0;for(let i=0;i<bytes.length;i+=4){hash=Math.imul(hash^bytes[i],16777619)>>>0;if(bytes[i]>250)white++;}return {hash,white};
          });
          const screens=p.views.map(v=>v.screen.matrixWorld.toArray()),cameras=p.views.map(v=>v.camera.matrixWorld.toArray());
          const initial=snapshot();fixture.now=performance.now();Object.defineProperty(performance,'now',{value:()=>fixture.now});fixture.now+=15000;s.components['stimulus-driver'].tick();
          const moved=snapshot();s.camera.position.x+=.2;s.camera.rotation.y+=.3;s.camera.updateMatrixWorld(true);
          const enabled=s.renderer.xr.enabled,oldTarget=s.renderer.getRenderTarget();s.renderer.xr.enabled=true;
          KiemelProjection.render(s.renderer,group);const restored=s.renderer.xr.enabled&&s.renderer.getRenderTarget()===oldTarget;s.renderer.xr.enabled=enabled;
          return {initial,moved,afterHead:snapshot(),screensFixed:JSON.stringify(screens)===JSON.stringify(p.views.map(v=>v.screen.matrixWorld.toArray())),camerasFixed:JSON.stringify(cameras)===JSON.stringify(p.views.map(v=>v.camera.matrixWorld.toArray())),restored};
        }''')
        self.assertTrue(result['screensFixed']);self.assertTrue(result['camerasFixed']);self.assertTrue(result['restored'])
        for initial,moved in zip(result['initial'],result['moved']):
            self.assertGreater(initial['white'],100);self.assertNotEqual(initial['hash'],moved['hash'])
        self.assertEqual(result['moved'],result['afterHead'])
        self.assertEqual(self.errors,[])

    def test_kiemel_operator_preview_and_protocol(self):
        self.page.goto(self.base+'/operator.html')
        self.page.wait_for_function("document.querySelector('#preview').contentWindow.document.querySelector('a-scene')?.renderStarted")
        self.assertEqual(self.page.locator('#mode').input_value(),'kiemel')
        self.assertEqual(self.page.locator('#pattern').input_value(),'kiemel-triangles')
        self.assertEqual(self.page.locator('#mode option[value=trapv]').count(),0)
        self.assertTrue(self.page.locator('#kiemelControls').is_visible())
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
