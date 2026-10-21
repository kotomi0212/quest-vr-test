'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../operator.html'),'utf8');
const source=fs.readFileSync(path.join(__dirname,'../operator.js'),'utf8');
const nodes={};
for(const m of html.matchAll(/id="([^"]+)"/g))nodes[m[1]]={value:'',textContent:'',style:{},children:[],appendChild(n){this.children.push(n);},addEventListener(){},getAttribute(){return null;},setAttribute(){},removeAttribute(){},getContext(){return {clearRect(){},beginPath(){},lineTo(){},moveTo(){},stroke(){}};}};
for(const m of source.matchAll(/\$\('([^']+)'\)/g))assert(nodes[m[1]],'Missing operator element '+m[1]);
Object.entries({mode:'sine',pattern:'grid',amp:'5',freq:'.2',duration:'10',heightCm:'160',eyeCm:'150',ankleCm:'8.8'}).forEach(([id,v])=>nodes[id].value=v);
const writes=[],listeners={};let downloadLogs={},csvBlob;
function ref(p){return {child:n=>ref(p+'/'+n),on:(e,cb)=>{listeners[p]=cb;if(p==='.info/connected')cb({val:()=>true});},off(){},set:async c=>{writes.push(c);},get:async()=>({val:()=>downloadLogs})};}
const auth={onAuthStateChanged:cb=>cb({uid:'operator',isAnonymous:false})};
const database=()=>({ref});database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
const firebase={initializeApp(){},auth:()=>auth,database};
const context={window:{firebase,VR_REMOTE_CONFIG:{firebase:{},sessionId:'test'},addEventListener(){}},firebase,document:{getElementById:id=>nodes[id],createElement:()=>({click(){}})},Stimulus:require('../stimulus-engine.js'),StimulusPatterns:require('../stimulus-patterns.js'),layoutConfig:require('../layout-config.js'),motionConfig:require('../motion-config.js'),KiemelConfig:require('../kiemel-config.js'),KiemelMotion:require('../kiemel-motion.js'),crypto:require('node:crypto').webcrypto,Date,Number,location:{origin:'http://test'},setInterval(){},setTimeout:fn=>fn(),Blob,URL:{createObjectURL:blob=>{csvBlob=blob;return'test-blob';},revokeObjectURL(){}}};
vm.runInNewContext(source,context);
listeners['sessions/test/status']({val:()=>({instanceId:'quest',at:Date.now(),firebaseState:'接続済み',immersive:true,renderStarted:true,calibrated:true})});
(async()=>{
 nodes.pattern.value='grid';await nodes.start.onclick();assert.equal(writes.at(-1).mode,'sine');assert.equal(writes.at(-1).pattern,'grid');
 nodes.mode.value='sine';await nodes.start.onclick();assert.equal(writes.at(-1).mode,'sine');
 await nodes.baseline.onclick();assert.equal(writes.at(-1).mode,'baseline');assert.equal(nodes.mode.value,'sine');
 await nodes.stop.onclick();assert.equal(writes.at(-1).type,'return');
 await nodes.emergency.onclick();assert.equal(writes.at(-1).type,'emergency');
 nodes.pattern.value='room';await nodes.pattern.onchange();assert.equal(writes.at(-1).type,'configure');assert.equal(writes.at(-1).pattern,'room');
 assert.deepEqual(nodes.pattern.children.map(n=>n.value),Object.keys(context.StimulusPatterns.definitions));
 const common={};
 for(const pattern of ['noise-1f','stripes-high','stripes-low']) {
  nodes.pattern.value=pattern;await nodes.pattern.onchange();assert.equal(writes.at(-1).pattern,pattern);
  await nodes.start.onclick();const c=writes.at(-1);assert.equal(c.pattern,pattern);
  common[pattern]=JSON.stringify([c.mode,c.frequencyHz,c.amplitudeDeg,c.durationSec,c.velocityDegSec,c.rampSec,c.holdSec]);
 }
 assert.equal(common['noise-1f'],common['stripes-high']);assert.equal(common['stripes-high'],common['stripes-low']);
 listeners['sessions/test/status']({val:()=>({instanceId:'quest',at:Date.now(),firebaseState:'接続済み',immersive:false,renderStarted:true,calibrated:false,xrPresenting:false,xrSessionActive:false})});
 nodes.pattern.value='grid';await nodes.applyPattern.onclick();assert.equal(writes.at(-1).type,'configure');assert.equal(writes.at(-1).pattern,'grid');
 const count=writes.length;await nodes.start.onclick();assert.equal(writes.length,count);assert(nodes.log.textContent.includes('実VRセッション'));
 assert(!html.includes('option value="csv"'));assert(!html.includes('option value="baseline"'));assert(!html.includes('option value="checker"'));
 listeners['sessions/test/status']({val:()=>({instanceId:'quest',at:Date.now(),firebaseState:'接続済み',immersive:true,renderStarted:true,calibrated:true})});
 Object.entries({kiemelEye:'160',kiemelHip:'90',kiemelAnkle:'8'}).forEach(([id,value])=>nodes[id].value=value);
 nodes.mode.value='kiemel';await nodes.mode.onchange();assert.equal(writes.at(-1).protocol,'kiemel');assert.equal(nodes.pattern.value,'kiemel-triangles');
 await nodes.calibrate.onclick();assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1).kiemel.body)),{eyeHeight:1.6,hipHeight:.9,ankleHeight:.08});
 for(const condition of ['translation','ankle','hip']) {
  nodes.kiemelCondition.value=condition;await nodes.start.onclick();const c=writes.at(-1);
  assert.equal(c.mode,'kiemel');assert.equal(c.protocol,'kiemel');assert.equal(c.durationSec,260);assert.equal(c.kiemel.motion.type,condition);
  assert.equal(c.kiemel.motion.amplitudeScale,1);assert(!('amplitudeDeg' in c),'No independent condition amplitude');
 }
 await nodes.baseline.onclick();assert.equal(writes.at(-1).mode,'baseline');assert.equal(writes.at(-1).protocol,'kiemel');
 nodes.kiemelShort.onclick();await nodes.start.onclick();assert.equal(writes.at(-1).durationSec,135);assert.equal(writes.at(-1).kiemel.motion.duration,125);
 nodes.kiemelScale.value='.5';await nodes.kiemelRestore.onclick();assert.equal(Number(nodes.kiemelScale.value),1);assert.equal(Number(nodes.kiemelDuration.value),250);assert.equal(nodes.kiemelEye.value,'160');
 nodes.kiemelEye.value='';const beforeMissing=writes.length;await nodes.start.onclick();assert.equal(writes.length,beforeMissing);assert(nodes.log.textContent.includes('身体寸法'));
 nodes.kiemelEye.value='160';nodes.kiemelDuration.value=10;await nodes.start.onclick();assert.equal(writes.length,beforeMissing);assert(nodes.log.textContent.includes('終端'));
 nodes.kiemelDuration.value=250;nodes.kiemelFixation.checked=true;await nodes.applyPattern.onclick();assert.equal(writes.at(-1).kiemel.pattern.fixationPoint,true);
 downloadLogs={u:{old:{mode:'sine',samples:[[0,2]]},modern:{mode:'kiemel',sampleColumns:['elapsed_ms','applied_deg','commanded_deg','performance_ms','epoch_estimate_ms','translation_z_m','phase'],samples:[[0,0,0,100,100000,.02,'stimulus']]}}};
 await nodes.csvDownload.onclick();const text=await csvBlob.text();
 const csvRows=text.trim().split(/\r?\n/).map(line=>[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m=>m[1].replaceAll('""','"')));
 const headers=csvRows[0],old=csvRows.find(r=>r[0]==='old'),modern=csvRows.find(r=>r[0]==='modern');
 assert.equal(old.length,headers.length);assert.equal(modern.length,headers.length);
 assert.equal(old[headers.indexOf('translation_z_m')],'');assert.equal(modern[headers.indexOf('translation_z_m')],'0.02');assert.equal(modern[headers.indexOf('phase')],'stimulus');
 nodes.pattern.value='room';await nodes.pattern.onchange();assert.notEqual(nodes.mode.value,'kiemel');assert.equal(writes.at(-1).protocol,undefined);
 console.log('PASS: operator DOM references, sin/Baseline commands, STOP/emergency, idle pattern command, simplified selectors');
 console.log('PASS: Kiemel conditions/body conversion/preset restore/short timing/no independent amplitude/mixed-schema CSV');
})().catch(e=>{console.error(e);process.exitCode=1;});
