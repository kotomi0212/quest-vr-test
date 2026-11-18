'use strict';
const assert=require('node:assert/strict'),defaults=require('../ap-sweep-config.js'),S=require('../ap-sweep-stimulus.js');
for(const mode of ['sweep','multicosine'])for(const amplitudePreset of ['low','standard']){
  const c=S.validate({...defaults,amplitudePreset}),tr=S.buildTrajectory(c,mode),limit=amplitudePreset==='low'?.05:.1;
  assert.equal(c.durationSec,80);assert.equal(c.targetVelocityPeakMps,limit);assert.equal(c.sweepSegments.reduce((s,x)=>s+x.durationSec,0),80);
  let peak=0;for(let i=0;i<=8000;i++){const x=S.stateAt(tr,i/100);assert(Number.isFinite(x.positionM));assert(Number.isFinite(x.velocityMps));assert(Number.isFinite(x.accelerationMps2));peak=Math.max(peak,Math.abs(x.velocityMps));}
  assert(Math.abs(peak-limit)<2e-4,`${mode} ${amplitudePreset} peak ${peak}`);assert(tr.config.accelerationAmplitudeMps2>0);assert.equal(tr.design.domain,'acceleration');assert(Math.abs(S.stateAt(tr,0).positionM)<1e-12);assert(Math.abs(S.stateAt(tr,80).positionM)<1e-12);
}
const c=S.validate({...defaults,amplitudePreset:'low'});assert.deepEqual(S.bands.identification,[.05,.1,.15,.2,.25,.3,.35,.4,.45,.5,.55,.6,.65,.7]);
let boundary=0;for(const segment of c.sweepSegments.slice(0,-1)){boundary+=segment.durationSec;const e=1e-7;assert(Math.abs(S.sweepCycles(c,boundary-e)-S.sweepCycles(c,boundary+e))<1e-6);}
const sweep=S.buildTrajectory({...c,amplitudePreset:'standard'},'sweep'),sweepEnd=S.stateAt(sweep,80);assert(Math.abs(sweepEnd.positionM)<1e-5,`sweep end position ${sweepEnd.positionM}`);assert(Math.abs(sweepEnd.velocityMps)<1e-5,`sweep end velocity ${sweepEnd.velocityMps}`);assert(sweep.peaks.accelerationMps2/sweep.design.accelerationAmplitudeMps2<1.01,'sweep ramp must not create an acceleration spike');
const a=S.buildTrajectory({...c,phaseSeed:42},'multicosine'),b=S.buildTrajectory({...c,phaseSeed:42},'multicosine');for(const t of [0,1.234,20,40,79.999])assert.equal(S.stateAt(a,t).positionM,S.stateAt(b,t).positionM);
assert.throws(()=>S.validate({...c,durationSec:90}));assert.throws(()=>S.validate({...c,amplitudePreset:'other'}));
console.log('PASS: 80 s acceleration-domain AP translation, equal component acceleration, bounded velocity peaks, reproducible phases');
