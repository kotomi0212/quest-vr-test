const fs=require('fs'),vm=require('vm'),assert=require('assert');
const waveform=require('./waveform.js');
const config=JSON.parse(fs.readFileSync(__dirname+'/results/stimulus/stimulus.json'));
function harness(){
 let clock=10,component,socket;const messages=[],intervals=[],timeouts=[],docEvents={},sceneEvents={},elements={};
 const world={position:{x:0,y:0,z:0}};
 const scene={renderer:{xr:{isPresenting:true,getSession:()=>({visibilityState:'visible'})}},addEventListener:(k,f)=>sceneEvents[k]=f};
 function element(k){return elements[k]??=( {textContent:'',events:{},attributes:{},setAttribute(...args){this.attributes[args[0]]=args.slice(1);},addEventListener(k,f){this.events[k]=f;}} );}
 const ctx={window:{isSecureContext:true},navigator:{xr:{},userAgent:'Quest 3'},
  location:{hash:'#token=test',pathname:'/quest.html',protocol:'http:',replace(p){ctx.redirect=p;}},
  URLSearchParams,sessionStorage:{getItem(){return null;},setItem(){}},performance:{now:()=>clock*1000},
  setInterval(f){intervals.push(f);},setTimeout(f){timeouts.push(f);return timeouts.length;},clearTimeout(){},
  document:{hidden:false,querySelector:s=>s==='a-scene'?scene:s==='#world'?{object3D:world}:element(s),addEventListener:(k,f)=>docEvents[k]=f},
  ResearchWaveform:waveform,
  WebSocket:class{constructor(){socket=this;this.readyState=0;}send(s){messages.push(JSON.parse(s));}close(){this.readyState=3;this.onclose?.({});}},
  AFRAME:{registerComponent(n,c){component=c;}}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/quest.js','utf8'),ctx);
 const deliver=m=>socket.onmessage({data:JSON.stringify(m)});
 const tick=()=>component.tick.call({el:scene});
 function open(){socket.readyState=1;socket.onopen();deliver({type:'config',stimulus:config});}
 function sync(){for(let i=0;i<8;i++){clock+=.25;deliver({type:'pong',q1:clock-.002,p2:clock+100-.001,p3:clock+100-.001});tick();}}
 return {ctx,messages,world,scene,elements,docEvents,sceneEvents,timeouts,intervals,open,sync,deliver,tick,
  click:k=>element(k).events.click(),advance:s=>clock+=s,get clock(){return clock;},get socket(){return socket;}};
}
const h=harness();h.open();h.click('#vr-start');assert(!h.messages.some(m=>m.type==='start'));
h.sync();h.click('#vr-start');h.click('#vr-start');assert.equal(h.messages.filter(m=>m.type==='start').length,1);
h.deliver({type:'start',trial_id:'solo',scheduled_pc_s:h.clock+103});
// Clock/probes continue during countdown, as on a live connection.
for(let i=0;i<14;i++){h.advance(.25);h.deliver({type:'pong',q1:h.clock-.002,p2:h.clock+100-.001,p3:h.clock+100-.001});h.tick();}
const frame=h.messages.findLast(m=>m.type==='frame');assert(frame);assert(Math.abs(h.world.position.z+frame.ap_m)<1e-12);
assert(h.messages.some(m=>m.type==='setup'&&m.alignment_required===false));
assert(!h.messages.some(m=>m.type==='calibration'));
h.ctx.document.hidden=true;h.docEvents.visibilitychange();
assert(h.messages.some(m=>m.type==='ended'&&m.reason==='hidden'));
const oldFrames=h.messages.filter(m=>m.type==='frame').length;
h.ctx.document.hidden=false;h.advance(20);h.docEvents.visibilitychange();h.tick();
assert.equal(h.messages.filter(m=>m.type==='frame').length,oldFrames);
h.socket.close();h.timeouts.shift()();h.open();h.sync();
assert.equal(h.messages.filter(m=>m.type==='start').length,1,'Reconnect must not replay START');
h.click('#vr-start');assert.equal(h.messages.filter(m=>m.type==='start').length,2,'New explicit START works after wake/reconnect');
h.deliver({type:'start',trial_id:'stop-test',scheduled_pc_s:h.clock+103});h.click('#vr-stop');
assert(h.messages.some(m=>m.type==='stop'));assert(h.messages.some(m=>m.type==='ended'&&m.reason==='quest-stop'));
function drive(h,steps){for(let i=0;i<steps;i++){h.advance(.1);h.deliver({type:'pong',q1:h.clock-.002,p2:h.clock+100-.001,p3:h.clock+100-.001});h.tick();}}
const g=harness();g.open();g.sync();g.deliver({type:'start',trial_id:'gap',scheduled_pc_s:g.clock+103});drive(g,31);g.advance(10);g.tick();
assert(g.messages.some(m=>m.type==='ended'&&m.reason==='frame-suspension'));
const watchdog=harness();watchdog.open();watchdog.sync();watchdog.deliver({type:'start',trial_id:'no-more-xr-frames',scheduled_pc_s:watchdog.clock+103});drive(watchdog,31);watchdog.advance(3);watchdog.intervals[0]();
assert(watchdog.messages.some(m=>m.type==='ended'&&m.reason==='frame-suspension'),'Timer must stop a trial even if no XR tick ever resumes');
console.log('PASS: no alignment gate, in-VR START/STOP, duplicate-click protection, fresh synchronization required');
console.log('PASS: headset hidden/frame suspension interrupts trial; automatic reconnect never replays START; explicit restart works');
const pc=harness();pc.open();pc.sync();pc.scene.renderer.xr.isPresenting=false;pc.ctx.document.hidden=true;
pc.deliver({type:'start',trial_id:'pc-donning',scheduled_pc_s:pc.clock+110,pc_sent_s:pc.clock+100});
pc.advance(2);pc.scene.renderer.xr.isPresenting=true;pc.ctx.document.hidden=false;pc.docEvents.visibilitychange();
pc.sync();drive(pc,61);assert(pc.messages.some(m=>m.type==='frame'&&m.trial_id==='pc-donning'));
assert.equal(pc.elements['#scene-front'].attributes.material[1],'12 6');assert.equal(pc.elements['#scene-floor'].attributes.material[1],'12 12');
const late=harness();late.open();late.sync();late.deliver({type:'start',trial_id:'late',scheduled_pc_s:late.clock+103});late.advance(5);late.intervals[0]();
assert(late.messages.some(m=>m.type==='blocked'&&m.trial_id==='late'));assert(!late.messages.some(m=>m.type==='frame'));
console.log('PASS: PC reservation survives headset donning, starts on time, rejects expired reservation; 50 cm grid verified');

for(const condition of ['none','dot','spinner']){
 const f=harness();f.open();f.sync();
 f.deliver({type:'config',stimulus:{waveform:'fixation_single_sine',duration_s:30,condition}});
 f.deliver({type:'start',trial_id:condition,scheduled_pc_s:f.clock+103});drive(f,331);
 assert(f.messages.some(m=>m.type==='frame'&&m.condition===condition));
 assert(f.messages.some(m=>m.type==='ended'&&m.reason==='complete'));
 assert(Math.abs(f.world.position.z)<1e-12);
}
console.log('PASS: all three fixation conditions record frame labels and auto-complete at 30 seconds');

const height=harness();height.open();height.sync();let captures=0;
height.ctx.window.FixationTarget={captureHeight(){captures++;return 1.57;},tick(){},configure(){},position(){return [0,1.57,-2.5];}};
height.deliver({type:'capture_height',request_id:'manual'});
assert(height.messages.some(m=>m.type==='height_result'&&m.ok&&m.height_m===1.57));
height.deliver({type:'start',trial_id:'lock-height',scheduled_pc_s:height.clock+103});
height.deliver({type:'capture_height',request_id:'busy'});
assert.equal(captures,1);assert(height.messages.some(m=>m.type==='height_result'&&m.request_id==='busy'&&!m.ok));
console.log('PASS: manual eye-height capture succeeds in VR and is blocked during reservation');

for(const id of ['pilot_single_x3','pilot_five_x1p4']){
 const c=JSON.parse(fs.readFileSync(__dirname+'/pilot_profiles/'+id+'.json'));
 const h=harness();h.open();h.sync();h.deliver({type:'config',stimulus:c});
 h.deliver({type:'start',trial_id:id,scheduled_pc_s:h.clock+103});drive(h,Math.ceil((c.duration_s+3.1)*10));
 assert(h.messages.some(m=>m.type==='frame'&&m.condition===id));
 assert(h.messages.some(m=>m.type==='ended'&&m.reason==='complete'));assert.equal(h.world.position.z,0);
}
console.log('PASS: 40/100-second pilot profiles log applied frames and finish at configured duration');

for(const id of ['study_sweep90','study_multicosine10']){
 const c=JSON.parse(fs.readFileSync(__dirname+'/study_profiles/'+id+'.json'));
 const h=harness();h.open();h.sync();h.deliver({type:'config',stimulus:c});
 h.deliver({type:'start',trial_id:id,scheduled_pc_s:h.clock+103});drive(h,Math.ceil((c.duration_s+3.1)*10));
 assert(h.messages.some(m=>m.type==='frame'&&m.condition===id));
 assert(h.messages.some(m=>m.type==='ended'&&m.reason==='complete'));
 const end=c.hold_final_position?-waveform.evaluate(c.duration_s,c).x:0;
 assert(Math.abs(h.world.position.z-end)<1e-10,'Sweep must hold final position, without resetting the world');
 const base=h.world.position.z;
 h.deliver({type:'start',trial_id:id+'-repeat',scheduled_pc_s:h.clock+103});drive(h,32);
 const frame=h.messages.findLast(m=>m.type==='frame');
 assert(Math.abs(h.world.position.z-(base-frame.ap_m))<1e-10,'Next trial must start from the held baseline');
}
console.log('PASS: new sweep/multicosine render, log, complete and preserve the world baseline');
