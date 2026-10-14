// Execute the actual Quest component/command path without launching a browser.
// DOM, WebXR, and GPU boundaries are fakes; stimulus-driver tick is production code.
'use strict';
const assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs');
const S=require('../stimulus-engine.js');
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
function element(){return {object3D:{position:new Vector3(),rotation:{x:0},visible:true},dataset:{},style:{},setAttribute(){},addEventListener(){},setObject3D(k,v){this[k]=v;},getObject3D(k){return this[k];}};}
const world=element(), room=element(), contrast=element(), surround=element(), camera=element();
const elements={'#visual-world':world,'#room-pattern':room,'#contrast-pattern':contrast,'#contrast-surround':surround,'a-camera':camera};
const scene={...element(),renderStarted:true,hasLoaded:true,camera:{},renderer:{xr:{isPresenting:false,getSession:()=>null},capabilities:{getMaxAnisotropy:()=>8}},is:()=>false,querySelector:s=>elements[s] || null};
const nodes={};
const events={};
const drawing=[];
const canvasContext={fillStyle:'',fillRect(...args){drawing.push([this.fillStyle,...args]);}};
const document={readyState:'loading',body:{appendChild(){}},querySelector(s){if(s==='#scene-template')return {content:{firstElementChild:{cloneNode:()=>scene}}};return nodes[s] ||= {style:{},textContent:''};},createElement:()=>({getContext:()=>canvasContext}),addEventListener(){}};
const THREE={Vector3,MathUtils:{degToRad:a=>a*Math.PI/180},DoubleSide:2,
  CanvasTexture:class {constructor(canvas){this.image=canvas;}},
  CylinderGeometry:class {constructor(...args){this.args=args;}},
  MeshBasicMaterial:class {constructor(options){Object.assign(this,options);}},
  Mesh:class {constructor(geometry,material){Object.assign(this,{geometry,material,position:new Vector3()});}}};
const parent={postMessage(){}};
const window={addEventListener:(name,fn)=>{events[name]=fn;},vrLastError:''};
const sandbox={window,document,AFRAME:{THREE,registerComponent:(name,c)=>{tick=c.tick;}},Stimulus:S,crypto:require('node:crypto').webcrypto,
  URLSearchParams,location:{search:'?preview=1',origin:'http://test'},parent,isSecureContext:false,navigator:{},
  performance:{now:()=>now,timeOrigin:100000},Date,console,setTimeout:()=>1,clearTimeout(){},setInterval(){},reportStartupError:e=>{throw Error(e);}};
window.AFRAME=sandbox.AFRAME;
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../quest-runtime.js'),'utf8'),sandbox);
function command(type,extra={}){events.message({source:parent,origin:'http://test',data:{type:'stimulus-command',command:{type,seq:++seq,runId:'test-'+seq,durationSec:10,mode:'trapv',amplitudeDeg:5,velocityDegSec:2,rampSec:.5,holdSec:1,pattern:'grid',heightCm:160,eyeHeightM:1.5,ankleHeightM:.088,...extra}}});}
async function flush(){await Promise.resolve();await Promise.resolve();}
(async()=>{
 command('calibrate');await flush();
 assert.equal(room.object3D.visible,false);assert.equal(surround.object3D.visible,true);
 assert.equal(contrast.mesh.geometry.args[0],1);
 assert.equal(drawing[0][0],'#fff');assert(drawing.slice(1).every(d=>d[0]==='#000'));
 assert.equal(drawing.length,95); // white fill + 33 vertical + 61 horizontal lines
 for(const mode of ['trapv','sine']) {
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
 assert.equal(window.vrLastError,'');
 console.log('PASS: production Quest ticks move TrapV/sin/legacy CSV, smooth STOP, emergency STOP, grid mesh/white surround, idle scene switching');
})().catch(e=>{console.error(e);process.exitCode=1;});
