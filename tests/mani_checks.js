'use strict';
const assert=require('node:assert/strict'),M=require('../mani-stimulus.js');
const c=M.validate();
assert.equal(c.durationSec,50);assert.equal(c.radiusM,.05);assert.equal(c.speedMps,.05);assert.equal(c.emissionRate,1000);
assert.deepEqual(M.fixation,{widthM:.1,distanceM:15,color:'#ff0000'});
const full=M.generate({...c,condition:'full'}),upper=M.generate({...c,condition:'upper'}),lower=M.generate(c);
assert.equal(full.length,1000);assert.equal(upper.length,1000);assert.equal(lower.length,1000);
for(let i=0;i<full.length;i++){
  assert.equal(full[i][0],upper[i][0]);assert.equal(upper[i][0],lower[i][0]);
  assert.equal(full[i][2],lower[i][2]);assert.equal(upper[i][1],-lower[i][1]);
  assert(Math.hypot(full[i][0],full[i][1])>=c.faceExclusionM+c.radiusM);
}
assert.deepEqual(M.generate(c),lower);
assert(Math.abs(M.depth(15,20,c)-14)<1e-10);
assert(M.visible(1,'upper'));assert(!M.visible(-1,'upper'));assert(!M.visible(1,'none'));
for(const input of [{condition:'invalid'},{emissionRate:1.1},{poolSize:1.5},{seed:NaN},{radiusM:0},{speedMps:Infinity}])assert.throws(()=>M.validate(input));
console.log('PASS: Mani dimensions and reference counts, equal half-field populations and doubled density, deterministic layout, face exclusion, metric speed, validation');

const span=c.farM-c.nearM,cycle=span/c.speedMps;
for(const p of full) for(const t of [0,1,25,50,390,1000]){const z=M.depth(p[2],t,c);assert(z>=c.nearM&&z<c.farM);assert(Math.abs(z-M.depth(p[2],t+cycle,c))<1e-10);}
assert(M.depth(c.nearM+.001,1,c)>c.farM-.1); // Leaving near edge recycles to far edge.
assert.equal(M.generate({...c,durationSec:600,emissionRate:350}).length,1000);
const inView=t=>full.filter(p=>{const z=M.depth(p[2],t,c);return Math.abs(p[0])/z<Math.tan(Math.PI/4)&&Math.abs(p[1])/z<Math.tan(Math.PI/5);}).length;
const counts=[0,10,25,40,49].map(inView);
assert(Math.max(...counts)/Math.min(...counts)<1.2, 'No accumulating visible density: '+counts);
console.log('PASS: steady frustum counts',counts,'and repeated complete near/far lifecycles');
