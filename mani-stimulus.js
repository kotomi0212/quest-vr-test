/* Mani 2022, Methods 2.2-2.3. Unreported emitter geometry is explicitly parameterized. */
(function(scope) {
  'use strict';
  const defaults = Object.freeze({condition:'lower', durationSec:50, countdownSec:3,
    emissionRate:1000, radiusM:0.05, speedMps:0.05, nearM:0.5, farM:20,
    halfWidthM:12, halfHeightM:12, faceExclusionM:0.2, seed:2022});
  function validate(input={}) {
    const c={...defaults,...input};
    if(!['upper','lower','full','none'].includes(c.condition)) throw Error('視野条件が不正です');
    const ranges={durationSec:[1,600],countdownSec:[0,30],emissionRate:[1,2000],radiusM:[.001,.1],
      speedMps:[.01,10],nearM:[.2,5],farM:[6,100],halfWidthM:[1,50],halfHeightM:[1,50],faceExclusionM:[.1,.5],seed:[0,4294967295]};
    for(const [key,[min,max]] of Object.entries(ranges))
      if(!Number.isFinite(c[key])||c[key]<min||c[key]>max) throw Error(key+' が範囲外です');
    if(!Number.isInteger(c.emissionRate)||!Number.isInteger(c.seed)||c.nearM>=c.farM||Math.ceil(c.durationSec*c.emissionRate)>100000) throw Error('生成球数は10万以下、seedと発生率は整数が必要です');
    return Object.fromEntries(Object.keys(defaults).map(k=>[k,c[k]]));
  }
  function generate(input) {
    const c=validate(input); let seed=c.seed>>>0;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    // Preserve total births: fold the full cloud into a half field, doubling local density.
    return Array.from({length:Math.ceil(c.durationSec*c.emissionRate)},(_,i)=>{
      let x,y;do{x=(rand()*2-1)*c.halfWidthM;y=(rand()*2-1)*c.halfHeightM;}
      while(Math.hypot(x,y)<c.faceExclusionM+c.radiusM);
      if(c.condition==='upper')y=Math.abs(y)+c.radiusM;
      if(c.condition==='lower')y=-Math.abs(y)-c.radiusM;
      return [x,y,c.nearM+rand()*(c.farM-c.nearM),i/c.emissionRate];
    });
  }
  function depth(initial,t,c) {
    return initial-c.speedMps*t;
  }
  function visible(y,condition) {return condition==='full'||condition==='upper'&&y>0||condition==='lower'&&y<0;}
  const api={defaults,validate,generate,depth,visible,doi:'10.1016/j.gaitpost.2022.07.004',
    fidelity:'Methods 2.2-2.3 matched for diameter, speed, emission rate, density, fixation and duration; emitter volume, lifetime and reference frame are implementation assumptions',
    fixation:{widthM:.1,distanceM:15,color:'#ff0000'},
    assumptions:{trajectory:'constant +Z velocity, yielding radial perspective expansion; emitter positions sampled in a cuboid',
      lifetime:'until near plane or trial end; no recycling',reference:'calibrated world-fixed cloud; per-eye current view half-field mask',
      faceExclusion:'no trajectories through a cylinder around the calibrated face; does not account for subsequent head translation'}};
  scope.ManiStimulus=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
