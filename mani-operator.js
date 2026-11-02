(() => {
  'use strict';
  const $=id=>document.getElementById(id),tell=t=>{$('feedback').textContent=t;};
  const config=window.VR_REMOTE_CONFIG;
  if(!window.firebase||!config){$('authState').textContent='Firebaseの読込失敗。再読込してください';return;}
  // Reuse the same persisted experimenter sign-in as the original operator page.
  const app=firebase.initializeApp(config.firebase),auth=app.auth(),db=app.database();
  const root=db.ref('sessions/'+config.sessionId+'-mani');
  let quest=null,connected=false,offset=0,seq=0,previewSeq=0,previewReady=false,subscribed=false,awaiting=null;
  const settings=()=>ManiStimulus.validate(Object.fromEntries(Object.keys(ManiStimulus.defaults).map(key=>[key,key==='condition'?$(key).value:Number($(key).value)])));
  const fresh=()=>quest?.protocol==='mani-2022'&&quest.instanceId&&Number.isFinite(quest.at)&&Math.abs(Date.now()+offset-quest.at)<15000;
  const busy=()=>['countdown','running'].includes(quest?.status);
  function receive(snap){
    quest=snap.val();renderState();
    if(awaiting&&quest?.commandSeq===awaiting.seq){
      const labels={countdown:'Quest受信：開始前待機中',running:'Questで提示中',idle:'Questで停止・終了',ready:'正面位置合わせ完了',blocked:'Questが拒否: '+quest.error,'log-error':'ログ保存失敗: '+quest.error};
      if(labels[quest.status]){awaiting.received=true;tell(labels[quest.status]);}
    }
  }
  function renderState(){
    $('state').textContent=!fresh()?'Questの接続・状態更新待ち':`${quest.status} / VR: ${quest.immersive?'開始済み':'未開始'} / 位置合わせ: ${quest.calibrated?'完了':'未完了'}\n${quest.settings?.condition||'-'} / ${Number(quest.elapsedSec||0).toFixed(1)}秒 / ${quest.renderedFrames||0} frames${quest.startupError?'\n'+quest.startupError:''}`;
  }
  db.ref('.info/connected').on('value',s=>{connected=s.val()===true;$('connection').textContent='PC Firebase: '+(connected?'接続済み':'切断');});
  db.ref('.info/serverTimeOffset').on('value',s=>{offset=s.val()||0;});
  $('signIn').onclick=async()=>{try{await auth.signInWithEmailAndPassword($('email').value,$('password').value);}catch(e){$('authState').textContent=e.message;}};
  auth.onAuthStateChanged(user=>{
    const signed=!!user&&!user.isAnonymous;$('login').hidden=signed;$('control').hidden=!signed;
    if(signed&&!subscribed){subscribed=true;root.child('status').on('value',receive,e=>tell('購読エラー: '+e.message));$('preview').src='quest2.html?preview=1&v=steady-flow-v2';}
    else if(!signed){if(subscribed)root.child('status').off('value',receive);subscribed=false;quest=null;previewReady=false;$('preview').removeAttribute('src');}
  });
  window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===$('preview').contentWindow&&e.data?.type==='mani-preview-ready')previewReady=true;});
  function previewCommand(type,cfg){$('preview').contentWindow.postMessage({type:'mani-command',command:{type,seq:++previewSeq,runId:'trial-preview-'+previewSeq,settings:cfg}},location.origin);}
  $('previewStart').onclick=()=>{try{if(!previewReady)throw Error('プレビュー読込待ちです');const cfg=settings();previewCommand('stop');previewCommand('calibrate');previewCommand('start',cfg);tell('PCプレビュー開始（Questへは送信していません）');}catch(e){tell(e.message);}};
  async function dispatch(type){
    const button=$(type),original=button.textContent;let attempt;
    try{
      if(!connected)throw Error('PCのFirebase接続を確認してください');
      if(type!=='stop'){
        if(!fresh()||quest.firebaseState!=='接続済み')throw Error('Questの接続を確認してください');
        if(!quest.renderStarted||!quest.immersive)throw Error('Questで3D描画・VR開始を確認してください');
        if(busy())throw Error('STOPしてから操作してください');
        if(type==='start'&&!quest.calibrated)throw Error('正面位置合わせが必要です');
      }
      const command={type,seq:seq=Math.max(Date.now(),seq+1),questInstanceId:quest?.instanceId||null,
        runId:'trial-'+crypto.randomUUID(),requestedAt:firebase.database.ServerValue.TIMESTAMP};
      if(type==='start')command.settings=settings();
      attempt={seq:command.seq,received:false};awaiting=attempt;button.disabled=true;button.textContent='送信中…';
      await root.child('command').set(command);
      if(type==='stop'&&previewReady)previewCommand('stop');
      if(!attempt.received)tell('送信済み・Questの受信確認待ち');
      setTimeout(()=>{if(awaiting===attempt&&!attempt.received)tell('Questの受信確認がありません。接続・権限・Quest画面を確認してください');},8000);
    }catch(e){tell(e.message);}finally{button.disabled=false;button.textContent=original;}
  }
  for(const type of ['calibrate','start','stop'])$(type).onclick=()=>dispatch(type);
  $('restore').onclick=()=>{for(const [k,v]of Object.entries(ManiStimulus.defaults))$(k).value=v;tell('初期値へ戻しました。次のSTARTで適用します');};
  $('download').onclick=async()=>{try{
    const logs=(await root.child('logs').get()).val()||{},url=URL.createObjectURL(new Blob([JSON.stringify(logs,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='mani-logs.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){tell('ログ取得エラー: '+e.message);}};
  setInterval(renderState,2000);
})();
