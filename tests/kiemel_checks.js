'use strict';
const assert=require('node:assert/strict'),C=require('../kiemel-config.js'),M=require('../kiemel-motion.js'),E=require('../kiemel-environment.js');
const config=C.restore();config.body={ankleHeight:.08,hipHeight:.90,eyeHeight:1.60};
const near=(a,b,tol=1e-10)=>assert(Math.abs(a-b)<=tol,`${a} != ${b}`);
const wall=E.walls(config.geometry);
assert.deepEqual(wall.map(w=>w.center),[[0,0,-1.07],[-1.52,0,0],[1.52,0,0]]);
for(const w of wall) {
  const normal=[w.u[1]*w.v[2]-w.u[2]*w.v[1],w.u[2]*w.v[0]-w.u[0]*w.v[2],w.u[0]*w.v[1]-w.u[1]*w.v[0]];
  near(Math.abs(normal.reduce((s,n,i)=>s+n*w.center[i],0)),w.id==='front'?1.07:1.52);
}
// Connected front/side edges, computed through each wall's local coordinates.
assert.deepEqual(E.point(wall[0],[-1.52,0]),E.point(wall[1],[1.07,0]));
assert.deepEqual(E.point(wall[0],[1.52,0]),E.point(wall[2],[-1.07,0]));
assert.throws(()=>E.walls({...config.geometry,frontWidth:3}));
const triangle=E.shape(config.pattern),sides=triangle.map((p,i)=>Math.hypot(p[0]-triangle[(i+1)%3][0],p[1]-triangle[(i+1)%3][1])).sort();
sides.forEach((side,i)=>near(side,[.03,.034,.034][i]));
const model=E.generate(config),repeat=E.generate(config);
assert.equal(model.count,1500);assert.deepEqual(model,repeat);
assert.notEqual(model.fingerprint,E.generate({...config,pattern:{...config.pattern,seed:54321}}).fingerprint);
const areaSign=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function inside(p,t){const signs=t.map((a,i)=>areaSign(a,t[(i+1)%3],p));return signs.every(v=>v>1e-12)||signs.every(v=>v< -1e-12);}
function crosses(a,b,c,d){return areaSign(a,b,c)*areaSign(a,b,d)<-1e-16&&areaSign(c,d,a)*areaSign(c,d,b)<-1e-16;}
function segmentDistance(a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy)));return Math.hypot(a[0]+t*dx,a[1]+t*dy);}
for(const w of model.walls) {
  assert.equal(w.polygons.length,500);
  for(let i=0;i<w.polygons.length;i++) {
    const a=w.polygons[i];
    assert(a.every(p=>Math.abs(p[0])<=w.width/2&&Math.abs(p[1])<=w.height/2));
    if(w.id==='front'){assert(!inside([0,0],a));for(let k=0;k<3;k++)assert(segmentDistance(a[k],a[(k+1)%3])>.30);}
    for(let j=0;j<i;j++) {
      const b=w.polygons[j];assert(!inside(a[0],b)&&!inside(b[0],a));
      for(let k=0;k<3;k++)for(let l=0;l<3;l++)assert(!crosses(a[k],a[(k+1)%3],b[l],b[(l+1)%3]));
    }
  }
}
assert(E.circleIntersects([[-1,.1],[1,.1],[0,1]],.3),'Edges crossing the central disk must be rejected');
assert.throws(()=>E.generate({...config,pattern:{...config.pattern,centralBlankRadius:100,maxPlacementAttempts:500}}));
assert.equal(config.pattern.fixationPoint,false);
M.validate(config);const components=M.components(config.motion);
assert.deepEqual(components.map(c=>c.frequency),[3,7,13,23,43,73,113,179,263,367].map(n=>n/125));
near(components[0].amplitude,.02/(3/125));near(components[8].amplitude,components[7].amplitude);near(components[9].amplitude,components[7].amplitude);
assert.deepEqual(components.map(c=>c.sign),[-1,1,-1,1,-1,1,-1,1,-1,1]);
const {H,l2}=M.bodyDimensions(config.body);near(H,1.52);near(l2,.70);
let linearError=0,ankleExactError=0,hipExactError=0;
for(let i=0;i<=60000;i++) {
  const t=i/240,degree=M.ankleAngle(t,config.motion),a=M.pose(degree,config.body,'ankle'),h=M.pose(degree,config.body,'hip'),tr=M.pose(degree,config.body,'translation');
  linearError=Math.max(linearError,Math.abs(a.eyeLinearZ-h.eyeLinearZ),Math.abs(a.eyeLinearZ-tr.translationZ));
  near(tr.angleDeg,0);near(h.angleDeg,degree*H/l2);
  const ea=M.transform([0,0,0],a),eh=M.transform([0,0,0],h),et=M.transform([0,0,0],tr);
  near(ea[2],a.eyeExactZ);near(eh[2],h.eyeExactZ);near(et[2],tr.translationZ);
  if(degree!==0){assert(Math.sign(ea[2])===-Math.sign(degree));assert(Math.sign(eh[2])===-Math.sign(degree));}
  const ba=H*Math.abs(M.rad(degree))**3/6,bh=l2*Math.abs(M.rad(h.angleDeg))**3/6;
  assert(Math.abs(ea[2]-et[2])<=ba+1e-12);assert(Math.abs(eh[2]-et[2])<=bh+1e-12);
  ankleExactError=Math.max(ankleExactError,Math.abs(ea[2]-et[2]));hipExactError=Math.max(hipExactError,Math.abs(eh[2]-et[2]));
}
near(linearError,0);
for(const type of ['ankle','hip'])for(const degree of [-2,-.5,0,.5,2]){const p=M.pose(degree,config.body,type);M.transform(p.pivot,p).forEach((v,i)=>near(v,p.pivot[i]));}
for(const [t,phase] of [[0,'pre-static'],[4.999,'pre-static'],[5,'stimulus'],[254.999,'stimulus'],[255,'post-static'],[259.999,'post-static'],[260,'completed']])assert.equal(M.at(t,config).phase,phase);
near(M.at(255,config).angleDeg,0);near(M.at(0,config).angleDeg,0);
const short=C.clone(config);short.motion.duration=125;M.validate(short);assert.equal(M.at(135,short).phase,'completed');
const invalid=C.clone(config);invalid.motion.duration=10;assert.throws(()=>M.validate(invalid));
assert.throws(()=>M.bodyDimensions({...config.body,hipHeight:1.7}));
for(const rate of [60,72,90,120])near(M.at(Math.round(13*rate)/rate,config).angleDeg,M.ankleAngle(8,config.motion));
const scaled=C.clone(config);scaled.motion.amplitudeScale=.5;near(M.ankleAngle(12.34,scaled.motion),M.ankleAngle(12.34,config.motion)/2);
const edited=C.restore();edited.geometry.wallHeight=99;assert.equal(C.restore().geometry.wallHeight,2.5);
console.log('PASS: 1500 fixed nonoverlapping metric triangles, empty central disk, 3-wall distance/joins, waveform/units/sign/pivots/timeline/frame-rate independence');
console.log(JSON.stringify({testBodyM:config.body,samples:60001,maxLinearDifferenceM:linearError,maxAnkleExactVsTranslationMm:ankleExactError*1000,maxHipExactVsTranslationMm:hipExactError*1000,patternFingerprint:model.fingerprint}));

// Independent off-axis projection: every screen corner maps exactly to NDC ±1.
const projection=require('../kiemel-projection.js');
for(const w of wall){const f=projection.frustum(w);for(const x of [-w.width/2,w.width/2])for(const y of [-w.height/2,w.height/2]){
 const q=E.point(w,[x,y]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),d=-dot(q,f.normal);
 const ndcX=(2*f.near*dot(q,w.u)/d-(f.right+f.left))/(f.right-f.left);
 const ndcY=(2*f.near*dot(q,w.v)/d-(f.top+f.bottom))/(f.top-f.bottom);near(ndcX,Math.sign(x));near(ndcY,Math.sign(y));
}}
for(const condition of ['ankle','hip','translation']){const p=M.pose(1,config.body,condition);assert(p.eyeLinearZ<0);assert(p.eyeExactZ<0);if(condition!=='translation')assert(p.renderAngleDeg<0);}
console.log('PASS: off-axis screen corners and paper positive = forward (-Z) in all conditions');
