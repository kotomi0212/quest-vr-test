'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../operator.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../operator.js'),'utf8');
const nodes={};
for(const m of html.matchAll(/id="([^"]+)"/g))nodes[m[1]]={value:'',textContent:'',style:{},addEventListener(){},getAttribute(){return null;},setAttribute(){},removeAttribute(){},getContext(){return {clearRect(){},beginPath(){},lineTo(){},moveTo(){},stroke(){}};}};
for(const m of source.matchAll(/\$\('([^']+)'\)/g))assert(nodes[m[1]],'Missing operator element '+m[1]);
Object.entries({mode:'trapv',pattern:'grid',amp:'5',freq:'.2',velocity:'2',ramp:'.5',hold:'1',duration:'10',heightCm:'160',eyeCm:'150',ankleCm:'8.8'}).forEach(([id,v])=>nodes[id].value=v);
const writes=[],listeners={};
function ref(p){return {child:n=>ref(p+'/'+n),on:(e,cb)=>{listeners[p]=cb;if(p==='.info/connected')cb({val:()=>true});},off(){},set:async c=>{writes.push(c);}};}
const auth={onAuthStateChanged:cb=>cb({uid:'operator',isAnonymous:false})};
const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
const firebase={initializeApp(){},auth:()=>auth,database};
const context={window:{firebase,VR_REMOTE_CONFIG:{firebase:{},sessionId:'test'},addEventListener(){}},firebase,document:{getElementById:id=>nodes[id]},Stimulus:require('../stimulus-engine.js'),crypto:require('node:crypto').webcrypto,Date,Number,location:{origin:'http://test'},setInterval(){}};
vm.runInNewContext(source,context);
listeners['sessions/test/status']({val:()=>({instanceId:'quest',at:Date.now(),firebaseState:'接続済み',immersive:true,renderStarted:true,calibrated:true})});
(async()=>{
 await nodes.start.onclick();assert.equal(writes.at(-1).mode,'trapv');assert.equal(writes.at(-1).pattern,'grid');
 nodes.mode.value='sine';await nodes.start.onclick();assert.equal(writes.at(-1).mode,'sine');
 await nodes.baseline.onclick();assert.equal(writes.at(-1).mode,'baseline');assert.equal(nodes.mode.value,'sine');
 await nodes.stop.onclick();assert.equal(writes.at(-1).type,'return');
 await nodes.emergency.onclick();assert.equal(writes.at(-1).type,'emergency');
 nodes.pattern.value='room';await nodes.pattern.onchange();assert.equal(writes.at(-1).type,'configure');assert.equal(writes.at(-1).pattern,'room');
 listeners['sessions/test/status']({val:()=>({instanceId:'quest',at:Date.now(),firebaseState:'接続済み',immersive:false,renderStarted:true,calibrated:false,xrPresenting:false,xrSessionActive:false})});
 nodes.pattern.value='grid';await nodes.applyPattern.onclick();assert.equal(writes.at(-1).type,'configure');assert.equal(writes.at(-1).pattern,'grid');
 const count=writes.length;await nodes.start.onclick();assert.equal(writes.length,count);assert(nodes.log.textContent.includes('実VRセッション'));
 assert(!html.includes('option value="csv"'));assert(!html.includes('option value="baseline"'));assert(!html.includes('option value="checker"'));
 console.log('PASS: operator DOM references, TrapV/sin/Baseline commands, STOP/emergency, idle pattern command, simplified selectors');
})().catch(e=>{console.error(e);process.exitCode=1;});
