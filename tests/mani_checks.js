'use strict';
const assert=require('node:assert/strict'),M=require('../mani-stimulus.js');
const c=M.validate();
assert.equal(c.durationSec,50);assert.equal(c.radiusM,.05);assert.equal(c.speedMps,.05);assert.equal(c.emissionRate,1000);
assert.deepEqual(M.fixation,{widthM:.1,distanceM:15,color:'#ff0000'});
const full=M.generate({...c,condition:'full'}),upper=M.generate({...c,condition:'upper'}),lower=M.generate(c);
assert.equal(full.length,50000);assert.equal(upper.length,50000);assert.equal(lower.length,50000);
for(let i=0;i<full.length;i++){
  assert.equal(full[i][0],upper[i][0]);assert.equal(upper[i][0],lower[i][0]);
  assert.equal(full[i][2],lower[i][2]);assert.equal(upper[i][1],-lower[i][1]);
  assert.equal(full[i][3],i/1000);assert(Math.hypot(full[i][0],full[i][1])>=c.faceExclusionM+c.radiusM);
}
assert.deepEqual(M.generate(c),lower);
assert(Math.abs(M.depth(15,20,c)-14)<1e-10);
assert(M.visible(1,'upper'));assert(!M.visible(-1,'upper'));assert(!M.visible(1,'none'));
for(const input of [{condition:'invalid'},{emissionRate:1.1},{durationSec:600},{seed:NaN},{radiusM:0},{speedMps:Infinity}])assert.throws(()=>M.validate(input));
console.log('PASS: Mani paper dimensions/rate/count, equal half-field counts and doubled density, deterministic births, face exclusion, metric speed, validation');
