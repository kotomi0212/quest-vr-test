'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../stimulus-engine.js');
const c={mode:'trapv',amplitudeDeg:5,velocityDegSec:2,rampSec:.5,holdSec:1};
const p=S.trap(c);
assert.equal(p.move,3); assert.equal(p.period,8);
assert.equal(S.angle(c,0),0); assert.equal(S.angle(c,3),5);
assert.equal(S.angle(c,4),5); assert.equal(S.angle(c,7),0); assert.equal(S.angle(c,8),0);
let prev=0;
for(let t=.001;t<24;t+=.001) { const a=S.angle(c,t); assert(a>=-1e-9 && a<=5+1e-9); assert(Math.abs(a-prev)/.001<=2.00001); prev=a; }
assert(Math.abs((S.angle(c,1.501)-S.angle(c,1.5))/.001-2)<1e-6);
assert.throws(()=>S.trap({...c,velocityDegSec:31}));
assert.throws(()=>S.trap({...c,rampSec:3}));
const points=S.parseCsv('time_s,angle_deg\n0,0\n1,2\n2,0');
assert.equal(S.interpolate(points,.5),1); assert.equal(S.interpolate(points,1.5),1);
for(const bad of ['0,1\n1,0','0,0\n0,1','0,0\n.01,1','0,0\n1,21','0,0\n1,NaN']) assert.throws(()=>S.parseCsv(bad));
S.parseCsv(fs.readFileSync(path.join(__dirname,'../demo_not_ghiasi_trapv.csv'),'utf8'));
// P'=A+Rx(P-A), the runtime translation A-RxA fixes the pivot.
const A=[1,.08,2], theta=.3, rx=([x,y,z])=>[x,y*Math.cos(theta)-z*Math.sin(theta),y*Math.sin(theta)+z*Math.cos(theta)];
const rotated=rx(A), translation=A.map((a,i)=>a-rotated[i]);
rotated.forEach((v,i)=>assert(Math.abs(v+translation[i]-A[i])<1e-12));
for(const file of ['quest.html','operator.html']) {
 const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 for(const match of html.matchAll(/src="([^"?]+)(?:\?[^\"]*)?"/g)) if(!/^https?:/.test(match[1])) assert(fs.existsSync(path.join(__dirname,'..',match[1])),match[1]);
}
console.log('PASS: TrapV integral, period, velocity, CSV interpolation/limits, example CSV, pivot invariance, local script paths');
