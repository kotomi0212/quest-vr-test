'use strict';
const assert=require('node:assert/strict'),P=require('../kiemel-projection.js');
// XR viewport differs from the normal canvas. A logical viewport restoration
// would overwrite the XR target's viewport and reproduce the regression here.
const xrTarget={viewport:[0,0,1800,900],scissor:[900,0,900,900],scissorTest:true};
let target=xrTarget,face=2,mip=1,viewport=xrTarget.viewport,scissor=xrTarget.scissor,scissorTest=true,color='pink',alpha=.3,fail=false,renders=0;
const r={xr:{enabled:true},autoClear:false,getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
 getViewport(){throw Error('Do not restore logical canvas viewport on an XR target');},
 getClearAlpha:()=>alpha,getClearColor:c=>{c.value=color;},setClearColor:(c,a)=>{color=c.value;alpha=a;},
 setRenderTarget(t,f=0,m=0){target=t;face=f;mip=m;viewport=t.viewport;scissor=t.scissor;scissorTest=t.scissorTest;},
 render(){assert.equal(r.xr.enabled,false);assert.equal(r.autoClear,true);renders++;color='black';alpha=1;if(fail)throw Error('GPU failure');}
};
const screens={userData:{projection:{dirty:true,updateCount:0,clearColor:{},scene:{},views:[1,2,3].map(n=>({target:{viewport:[0,0,1024,1024],scissor:[0,0,1024,1024],scissorTest:false},camera:{n}}))}}};
function restored(){assert.equal(target,xrTarget);assert.equal(face,2);assert.equal(mip,1);assert.deepEqual(viewport,xrTarget.viewport);assert.deepEqual(scissor,xrTarget.scissor);assert.equal(scissorTest,true);assert.equal(color,'pink');assert.equal(alpha,.3);assert.equal(r.xr.enabled,true);assert.equal(r.autoClear,false);}
P.renderPending(r,screens);restored();assert.equal(renders,3);assert.equal(screens.userData.projection.updateCount,1);
P.renderPending(r,screens);assert.equal(renders,3,'No extra renders when nothing changed');
P.request(screens);P.request(screens);P.renderPending(r,screens);restored();assert.equal(renders,6,'Multiple pose requests coalesce into one batch');
fail=true;P.request(screens);assert.throws(()=>P.renderPending(r,screens),/GPU failure/);restored();assert.equal(screens.userData.projection.dirty,true);
console.log('PASS: XR physical viewport/scissor, face/mip, clear color/alpha and XR flag restored; updates coalesce; failure cleanup');
