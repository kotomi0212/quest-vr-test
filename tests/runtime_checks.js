// Execute the actual Quest component/command path without launching a browser.
// DOM, WebXR, and GPU boundaries are fakes; stimulus-driver tick is production code.
'use strict';
const assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
const S=require('../stimulus-engine.js');
const P=require('../stimulus-patterns.js');
const L=require('../layout-config.js'),M=require('../motion-config.js');
const KC=require('../kiemel-config.js'),KM=require('../kiemel-motion.js'),KE=require('../kiemel-environment.js');
let now=0, tick, seq=0;
class Vector3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){Object.assign(this,{x,y,z});return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  copy(v){return this.set(v.x,v.y,v.z);}
  sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z);}
  applyAxisAngle(axis,a){const y=this.y*Math.cos(a)-this.z*Math.sin(a),z=this.y*Math.sin(a)+this.z*Math.cos(a);this.y=y;this.z=z;return this;}
  toArray(){return [this.x,this.y,this.z];}
}
function element(){return {object3D:{position:new Vector3(),rotation:{x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}},setRotationFromAxisAngle(axis,a){this.rotation.set(axis.x*a,axis.y*a,axis.z*a);},visible:true},dataset:{},style:{},setAttribute(){},addEventListener(){},setObject3D(k,v){this[k]=v;},getObject3D(k){return this[k];}};}
const world=element(), room=element(), contrast=element(), surround=element(), camera=element(), kiemel=element();
const elements={'#visual-world':world,'#room-pattern':room,'#contrast-pattern':contrast,'#contrast-surround':surround,'a-camera':camera,'#kiemel-environment':kiemel};
const scene={...element(),renderStarted:true,hasLoaded:true,camera:{},renderer:{xr:{isPresenting:false,getSession:()=>null},capabilities:{getMaxAnisotropy:()=>8}},is:()=>false,querySelector:s=>elements[s] || null};
const nodes={};
const events={};
const drawing=[];
const canvasContext={fillStyle:'',fillRect(...args){drawing.push([this.fillStyle,...args]);},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){}};
const document={readyState:'loading',body:{appendChild(){}},querySelector(s){if(s==='#scene-template')return {content:{firstElementChild:{cloneNode:()=>scene}}};return nodes[s] ||= {style:{},textContent:''};},createElement:()=>({getContext:()=>canvasContext}),addEventListener(){}};
const THREE={Vector3,MathUtils:{degToRad:a=>a*Math.PI/180},DoubleSide:2,
  SRGBColorSpace:'srgb',
  CanvasTexture:class {constructor(canvas){this.image=canvas;}},
  CylinderGeometry:class {constructor(...args){this.args=args;}dispose(){}},
  PlaneGeometry:class {constructor(...args){this.args=args;}dispose(){}},
  CircleGeometry:class {constructor(...args){this.args=args;}dispose(){}},
  BufferGeometry:class {constructor(){this.attributes={};}setAttribute(k,v){this.attributes[k]=v;}},
  Float32BufferAttribute:class {constructor(array,itemSize){this.array=new Float32Array(array);this.itemSize=itemSize;}},
  Group:class {constructor(){Object.assign(this,element().object3D);this.children=[];this.userData={};}add(child){this.children.push(child);}},
  MeshBasicMaterial:class {constructor(options){Object.assign(this,options);}dispose(){}},
  Mesh:class {constructor(geometry,material){Object.assign(this,{geometry,material,position:new Vector3(),rotation:{set(){}}});}}};
const parent={postMessage(){}};
const window={addEventListener:(name,fn)=>{events[name]=fn;},vrLastError:''};
const sandbox={window,document,AFRAME:{THREE,registerComponent:(name,c)=>{tick=c.tick;}},Stimulus:S,StimulusPatterns:P,layoutConfig:L,motionConfig:M,KiemelConfig:KC,KiemelMotion:KM,KiemelEnvironment:KE,KiemelProjection:{create(T,model,p){const g=new T.Group();g.userData.projection={source:KE.build(T,model,p)};return g;},render(){}},crypto:require('node:crypto').webcrypto,
  URLSearchParams,location:{search:'?preview=1',origin:'http://test'},parent,isSecureContext:false,navigator:{},
  performance:{now:()=>now,timeOrigin:100000},Date,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},reportStartupError:e=>{throw Error(e);}};
window.AFRAME=sandbox.AFRAME;
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../quest-runtime.js'),'utf8'),sandbox);
function command(type,extra={}){events.message({source:parent,origin:'http://test',data:{type:'stimulus-command',command:{type,seq:++seq,runId:'test-'+seq,durationSec:10,mode:'sine',amplitudeDeg:5,velocityDegSec:2,rampSec:.5,holdSec:1,pattern:'grid',heightCm:160,eyeHeightM:1.5,ankleHeightM:.088,...extra}}});}
async function flush(){await Promise.resolve();await Promise.resolve();}
(async()=>{
 command('calibrate');await flush();
 assert.equal(room.object3D.visible,false);assert.equal(surround.object3D.visible,true);
 assert.equal(contrast.mesh.geometry.args[0],1);
 assert.equal(drawing[0][0],'#fff');assert(drawing.slice(1).every(d=>d[0]==='#000'));
 assert.equal(drawing.length,95); // white fill + 33 vertical + 61 horizontal lines
 for(const mode of ['sine']) {
  command('start',{mode,frequencyHz:.2});await flush();
  now+=3001;tick();
  for(let i=0;i<150;i++){now+=10;tick();}
  assert(world.object3D.rotation.x>.01,mode+' must move in production tick');
  command('return');await flush();
  const startAngle=world.object3D.rotation.x;
  now+=1000;tick(); assert(world.object3D.rotation.x>0 && world.object3D.rotation.x<startAngle);
  now+=1000;tick(); assert.equal(world.object3D.rotation.x,0);
 }
 command('start',{mode:'csv',csvFile:'test.csv',csvPoints:[[0,0],[2,4],[10,0]]});await flush();
 now+=3001;tick();for(let i=0;i<100;i++){now+=10;tick();}
 assert(world.object3D.rotation.x>0);command('emergency');await flush();assert.equal(world.object3D.rotation.x,0);
 command('configure',{pattern:'room'});await flush();assert.equal(room.object3D.visible,true);assert.equal(surround.object3D.visible,false);
 command('configure',{pattern:'grid'});await flush();assert.equal(surround.object3D.visible,true);
 const trajectories=[];const textures=[];
 for(const pattern of ['noise-1f','stripes-high','stripes-low']) {
  command('configure',{pattern});await flush();
  assert.equal(contrast.mesh.geometry.constructor,THREE.PlaneGeometry);
  assert.deepEqual(contrast.mesh.geometry.args,[L.plane.widthM,L.plane.heightM]);
  assert.deepEqual(contrast.mesh.position.toArray(),[L.plane.positionM.x,L.plane.positionM.y,L.plane.positionM.z]);
  assert.equal(contrast.mesh.material.toneMapped,false);
  assert.equal(contrast.mesh.material.map.colorSpace,THREE.SRGBColorSpace);
  textures.push(contrast.mesh.material.map);
  command('start',{mode:'sine',pattern,frequencyHz:.2});await flush();now+=3001;tick();
  const path=[];
  for(let i=0;i<200;i++){now+=10;tick();path.push(world.object3D.rotation.x);}
  trajectories.push(path);
  command('configure',{pattern:'room'});await flush();
  assert.equal(contrast.object3D.visible,true,'Pattern cannot change while a trial is active');
  command('emergency');await flush();assert.equal(world.object3D.rotation.x,0);
 }
 assert.deepEqual(trajectories[0],trajectories[1]);assert.deepEqual(trajectories[1],trajectories[2]);
 command('configure',{pattern:'noise-1f'});await flush();assert.equal(contrast.mesh.material.map,textures[0],'Reuse the fixed noise texture');
 command('configure',{pattern:'bad-id'});await flush();assert.equal(contrast.mesh.material.map,textures[0],'Invalid IDs cannot silently change patterns');
 assert.equal(window.vrLastError,'');
 // Non-preview production command path: static scene changes need no XR,
 // but calibration/START still require a real presenting session boundary.
 const ctx=vm.createContext({...sandbox,location:{search:'',origin:'http://test'},structuredClone});
 document.head={appendChild(script){script.onload();}};
 window.VR_REMOTE_CONFIG={firebase:{},sessionId:'test'};
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'firebase-fixture.js'),'utf8'),ctx);
 ctx.firebase=window.firebase;
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../quest-runtime.js'),'utf8'),ctx);
 events.load();for(let i=0;i<30;i++)await flush();
 const fixture=window.fixture, commandPath='sessions/test/command';
 function headset(type,extra={}){fixture.emit(commandPath,{type,seq:++seq,questInstanceId:fixture.lastStatus().instanceId,requestedAt:Date.now(),pattern:'grid',heightCm:160,ankleHeightM:.088,...extra});}
 headset('configure');await flush();assert.equal(fixture.lastStatus().configured,true);assert.equal(fixture.lastStatus().immersive,false);
 headset('calibrate');await flush();assert.equal(fixture.lastStatus().status,'blocked');
 scene.renderer.xr.isPresenting=true;scene.renderer.xr.getSession=()=>({addEventListener(){}});
 scene.renderer.xr.getCamera=()=>({getWorldPosition:head=>head.set(0,1.6,0)});
 headset('calibrate');await flush();assert.equal(fixture.lastStatus().calibrated,true);assert.equal(fixture.lastStatus().immersive,true);assert.equal(fixture.lastStatus().aframeVR,false);
 headset('start',{pattern:'noise-1f',mode:'sine',frequencyHz:.2,amplitudeDeg:5,durationSec:5,runId:'test-pattern-log'});await flush();
 now+=3001;tick();now+=100;tick();headset('emergency');await flush();
 const log=fixture.writes.find(w=>w.path.endsWith('/logs/test-quest/test-pattern-log'))?.value;
 assert(log,'Pattern trial must produce a log');assert.equal(log.pattern,'noise-1f');
 assert.equal(log.patternSettings.seed,P.get('noise-1f').seed);
 assert.deepEqual(JSON.parse(JSON.stringify(log.layoutSettings.plane)),L.plane);
 assert(log.samples.length>0);
 // Execute Kiemel through the real command/tick path, not only pure waveform math.
 const kcfg=KC.restore();kcfg.body={ankleHeight:.08,hipHeight:.9,eyeHeight:1.6};
 const leftEye={matrixWorld:{elements:Array(16).fill(0)}},rightEye={matrixWorld:{elements:Array(16).fill(0)}};
 leftEye.matrixWorld.elements[12]=-.03;rightEye.matrixWorld.elements[12]=.03;
 leftEye.matrixWorld.elements[13]=rightEye.matrixWorld.elements[13]=1.6;
 scene.renderer.xr.getCamera=()=>({cameras:[leftEye,rightEye],getWorldPosition(){throw Error('Use stereo centre');}});
 headset('start',{protocol:'kiemel',mode:'kiemel',pattern:'kiemel-triangles',kiemel:kcfg,runId:'no-calibration'});await flush();assert.equal(fixture.lastStatus().status,'blocked');
 headset('calibrate',{protocol:'kiemel',pattern:'kiemel-triangles',kiemel:kcfg});await flush();assert.equal(fixture.lastStatus().calibrated,true);
 const moving=()=>kiemel.mesh.userData.projection.source;
 const fixedGroup=kiemel.mesh,fingerprint=fixture.lastStatus().patternSettings.fingerprint;
 assert.equal(fixedGroup.userData.projection.source.children[3].geometry.attributes.position.array.length,1500*9);
 assert.equal(fixedGroup.userData.projection.source.userData.fixation.visible,false);
 leftEye.matrixWorld.elements[12]+=.5;rightEye.matrixWorld.elements[12]+=.5; // Tracking moves, calibrated scene must not follow.
 assert.equal(fixture.lastStatus().patternSettings.totalCount,1500);
 assert.equal(fixture.lastStatus().layoutSettings.geometry.frontDistance,1.07);
 const recorded=[];
 for(const condition of ['translation','ankle','hip']) {
  kcfg.body={eyeHeight:1.6,ankleHeight:.08,hipHeight:.9}; // Key order must not force recalibration.
  kcfg.motion.type=condition;const begin=now,id='kiemel-'+condition;
  headset('start',{protocol:'kiemel',mode:'kiemel',pattern:'kiemel-triangles',kiemel:kcfg,runId:id});await flush();
  assert.equal(fixture.lastStatus().status,'pre-static');assert.equal(kiemel.mesh,fixedGroup);
  assert.equal(fixture.lastStatus().patternSettings.fingerprint,fingerprint);
  assert.equal(fixture.lastStatus().layoutSettings.eyeOrigin[0],0);
  now=begin+4999;tick();assert.equal(moving().rotation.x,0);assert.equal(kiemel.object3D.position.z,0);
  now=begin+5000;tick();assert.equal(fixture.lastStatus().status,'running');
  now=begin+7000;tick();
  const expected=KM.at(7,kcfg);
  assert(Math.abs(moving().position.z-expected.eyeExactZ)<1e-12);
  assert(Math.abs(moving().rotation.x-KM.rad(expected.renderAngleDeg))<1e-12);
  if(condition==='translation')assert.equal(moving().rotation.x,0);
  else assert(Math.abs(moving().rotation.x)>1e-5);
  headset('configure',{pattern:'room'});await flush();assert.equal(fixture.lastStatus().status,'blocked');assert.equal(kiemel.object3D.visible,true);
  now=begin+255000;tick();assert.equal(fixture.lastStatus().status,'post-static');assert.equal(moving().rotation.x,0);
  now=begin+260000;tick();assert.equal(fixture.lastStatus().status,'idle');
  const saved=fixture.writes.find(w=>w.path.endsWith('/'+id)).value;recorded.push(saved);
  assert.equal(saved.reason,'completed');assert.equal(saved.samples.at(-1)[0],260000);
  assert.equal(saved.sampleColumns.length,saved.samples[0].length);assert.equal(saved.kiemelCalibration.origin[1],1.6);
  assert(saved.samples.some(s=>s[10]==='pre-static'));assert(saved.samples.some(s=>s[10]==='post-static'));
 }
 assert.equal(recorded[0].samples[2][8],recorded[1].samples[2][8]);assert.equal(recorded[1].samples[2][8],recorded[2].samples[2][8]);
 headset('start',{protocol:'kiemel',mode:'kiemel',pattern:'kiemel-triangles',kiemel:kcfg,runId:'kiemel-stop'});await flush();
 now+=7000;tick();const beforeStop=Math.abs(moving().rotation.x);
 headset('return');await flush();now+=1000;tick();assert(Math.abs(moving().rotation.x)<beforeStop);
 now+=1000;tick();assert.equal(moving().rotation.x,0);assert.equal(fixture.lastStatus().status,'idle');
 headset('start',{protocol:'kiemel',mode:'baseline',pattern:'kiemel-triangles',kiemel:kcfg,runId:'kiemel-baseline'});await flush();
 now+=7000;tick();assert.equal(moving().rotation.x,0);assert.equal(kiemel.object3D.position.z,0);
 headset('emergency');await flush();assert.equal(fixture.lastStatus().status,'idle');
 const changed=KC.clone(kcfg);changed.body.hipHeight=1;
 headset('start',{protocol:'kiemel',mode:'kiemel',pattern:'kiemel-triangles',kiemel:changed,runId:'body-changed'});await flush();assert.equal(fixture.lastStatus().status,'blocked');
 const fixation=KC.clone(kcfg);fixation.pattern.fixationPoint=true;
 headset('configure',{pattern:'kiemel-triangles',kiemel:fixation});await flush();assert.equal(kiemel.mesh,fixedGroup);assert.equal(fixedGroup.userData.projection.source.userData.fixation.visible,true);assert.equal(fixture.lastStatus().patternSettings.fingerprint,fingerprint);
 headset('configure',{pattern:'room'});await flush();assert.equal(kiemel.object3D.visible,false);assert.equal(world.object3D.visible,true);
 console.log('PASS: production Quest ticks move sin/legacy CSV, smooth STOP, emergency STOP, grid mesh/white surround, idle scene switching');
 console.log('PASS: production Kiemel calibration/3 transforms/260s timeline/fixed pattern/STOP/Baseline/body-change rejection/logs');
})().catch(e=>{console.error(e);process.exitCode=1;});
