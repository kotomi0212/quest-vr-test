'use strict';
const assert=require('node:assert/strict'), S=require('../experiment-stimulus.js');
for(const type of ['multicosine','sweep']){for(const amplitudePreset of ['low','standard']){const tr=S.build({amplitudePreset},type,.005);assert.equal(tr.config.sweepSegments.reduce((a,b)=>a+b),80);const limit=amplitudePreset==='low'?.5:1;for(let t=0;t<=80;t+=.1){const x=S.stateAt(tr,t);assert(Number.isFinite(x.positionDeg));assert(Math.abs(x.positionDeg)<=limit+1e-6);assert(Math.abs(x.velocityDegS)<=8.000001);assert(Math.abs(x.accelerationDegS2)<=40.000001);}assert(Math.abs(S.stateAt(tr,0).positionDeg)<1e-15);assert(Math.abs(S.stateAt(tr,80).positionDeg)<1e-15);}}
const c=S.validate({});assert.deepEqual(S.bands.identification,[.05,.1,.15,.2,.25,.3,.35,.4,.45,.5,.55,.6,.65,.7]);
const standard=S.build({amplitudePreset:'standard',phaseSeed:42},'multicosine',.005),repeat=S.build({amplitudePreset:'standard',phaseSeed:42},'multicosine',.005),low=S.build({amplitudePreset:'low',phaseSeed:42},'multicosine',.005);
for(const t of [0,1.234,20,40,79.999]){assert.equal(S.stateAt(standard,t).positionDeg,S.stateAt(repeat,t).positionDeg);assert(Math.abs(S.stateAt(low,t).positionDeg-S.stateAt(standard,t).positionDeg/2)<1e-10);}
for(const t of [10,18,30]){const e=1e-7;assert(Math.abs(S.sweepCycles(c,t-e)-S.sweepCycles(c,t+e))<1e-6);}
assert.equal(S.sweepFrequency(c,0).f0,.7);assert(Math.abs(S.sweepFrequency(c,80).f1-.05)<1e-12);
console.log('PASS: deterministic 80 s multicosine/sweep, two amplitude presets, continuous phase, bounded states');
