(function(root){
 const config={duration:30,ramp:3,frequency:.20,velocityPeak:.10,distance:2.5,pointRadius:.025};
 function raw(t){
  const w=2*Math.PI*config.frequency,u=Math.max(0,Math.min(1,Math.min(t,config.duration-t)/config.ramp));
  const e=10*u**3-15*u**4+6*u**5,d=u>0&&u<1?(30*u**2-60*u**3+30*u**4)/config.ramp*(t<config.duration/2?1:-1):0;
  const dd=u>0&&u<1?(60*u-180*u**2+120*u**3)/config.ramp**2:0;
  const x=Math.cos(w*t)-1,v=-w*Math.sin(w*t),a=-w*w*Math.cos(w*t);
  return {x:e*x,v:e*v+d*x,a:e*a+2*d*v+dd*x};
 }
 let peak=0;for(let i=0;i<=60000;i++)peak=Math.max(peak,Math.abs(raw(i/2000).v));
 const scale=config.velocityPeak/peak;
 function state(t){if(t<=0||t>=config.duration)return{x:0,v:0,a:0};const s=raw(t);return{x:s.x*scale,v:s.v*scale,a:s.a*scale};}
 root.FixationStimulus={config,state,scale};
 if(typeof module!=='undefined')module.exports=root.FixationStimulus;
})(typeof window!=='undefined'?window:globalThis);
