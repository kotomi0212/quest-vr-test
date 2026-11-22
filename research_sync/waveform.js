(function(root){
  function evaluate(t,c){
    if(c.waveform==='fixation_single_sine')return (root.FixationStimulus||(typeof require!=='undefined'?require('./fixation.js'):null)).state(t);
    if(c.schema===2&&c.waveform==='endpoint_stationary_multicosine'){
      const T=c.duration_s,R=c.stationary_start_s;
      if(t<0||t>T)return{x:0,v:0,a:0};
      let x=0,v=0,a=0;
      c.frequencies_hz.forEach((f,k)=>{
        const w=2*Math.PI*f,theta=c.endpoint_phases_rad[k],z=w*(t-T)+theta;
        x+=(Math.cos(theta)-Math.cos(z))/w**2;v+=Math.sin(z)/w;a+=Math.cos(z);
      });
      const u=Math.max(0,Math.min(1,t/R)),e=10*u**3-15*u**4+6*u**5;
      const d=t>0&&t<R?(30*u**2-60*u**3+30*u**4)/R:0;
      const dd=t>0&&t<R?(60*u-180*u**2+120*u**3)/R**2:0;
      const A=c.acceleration_component_m_s2;
      return{x:A*e*x,v:A*(e*v+d*x),a:A*(e*a+2*d*v+dd*x)};
    }
    let x=0,v=0,a=0;
    c.frequencies_hz.forEach((f,k)=>{const w=2*Math.PI*f,z=w*t+c.phases_rad[k];x-=Math.cos(z)/w**2;v+=Math.sin(z)/w;a+=Math.cos(z);});
    const A=c.acceleration_component_m_s2,u=Math.max(0,Math.min(1,Math.min(t,90-t)/5));
    const e=10*u**3-15*u**4+6*u**5;
    const d=(u>0&&u<1)?(30*u**2-60*u**3+30*u**4)*(t<45?1:-1)/5:0;
    const dd=(u>0&&u<1)?(60*u-180*u**2+120*u**3)/25:0;
    return {x:A*e*x,v:A*(e*v+d*x),a:A*(e*a+2*d*v+dd*x)};
  }
  root.ResearchWaveform={evaluate};
  if(typeof module!=='undefined')module.exports={evaluate};
})(typeof window!=='undefined'?window:globalThis);
