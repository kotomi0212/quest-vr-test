(() => {
const $=id=>document.getElementById(id);
const token=new URLSearchParams(location.hash.slice(1)).get('token')||sessionStorage.getItem('vr-sync-token');
if(!token){location.replace('/p');return;}sessionStorage.setItem('vr-sync-token',token);
let ws;
function status(s){
 $('quest').textContent=s.quest_connected?'接続済み':'未接続';$('vr').textContent=s.quest_xr&&s.quest_rendering?'描画中':'装着・VR待ち';
 $('force').textContent=s.vendor_available===false?'USB未接続':s.combalance_state;
 $('clock').textContent=s.rtt_median_ms===null?'同期通信待ち':`RTT ${s.rtt_median_ms.toFixed(1)} ms`;
 const labels={idle:'待機中',preparing:'ComBalance取得準備中…',running:`計測中 ${s.elapsed_s.toFixed(1)} / ${s.duration_s}秒`,saving:'停止・CSV保存中…',complete:'計測完了・保存済み',stopped:'中断・保存済み',error:'エラー'};
 $('status').textContent=s.phase==='countdown'?`約${Math.max(0,Math.ceil(s.scheduled_pc_s-s.pc_now_s))}秒後に開始。Questを装着してください。`:labels[s.phase]||s.phase;
 $('progress').max=s.duration_s;$('progress').value=s.elapsed_s;$('save').textContent='CSV保存先: '+(s.last_export||s.save_directory);
 $('start').disabled=!s.quest_connected||!s.quest_software_current||s.busy||s.vendor_available===false;$('stop').disabled=false;
 if(s.quest_connected&&!s.quest_software_current)$('message').textContent='Questのページを一度再読み込みしてください。';
 if(s.last_error)$('message').textContent=s.last_error;
}
function connect(){
 ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//localhost:'+(window.controlWsPort||8765));
 ws.onopen=()=>ws.send(JSON.stringify({role:'operator',token,subscribe_status:true}));
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='system_status')status(m);if(m.type==='error')$('message').textContent=m.message;};
 ws.onclose=()=>{$('start').disabled=true;$('stop').disabled=true;$('status').textContent='自動再接続中…';setTimeout(connect,1000);};
 ws.onerror=()=>ws.close();
}
$('start').onclick=()=>{const delay=Number($('delay').value);if(!Number.isFinite(delay)||delay<3||delay>30){$('message').textContent='待ち時間は3～30秒にしてください';return;}if(ws.readyState===1){$('start').disabled=true;ws.send(JSON.stringify({type:'start',start_delay_s:delay,condition:$('condition').value}));}};
$('stop').onclick=()=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'stop'}));};
connect();
})();
