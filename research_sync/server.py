"""PC-operated acquisition service. Never performs COM/FRF processing."""
import argparse
import asyncio
from collections import deque
import functools
import http.server
import json
import math
import secrets
import ssl
import statistics
import threading
import time
import uuid
from pathlib import Path
from .acquisition import VendorCapture
from .recording import export_recording
from websockets.asyncio.server import serve

STATIC={'/operator.html','/quest.html','/quest.js','/waveform.js','/fixation.js','/fixation_target.js','/operator.js','/grid.svg','/vendor/aframe.min.js'}

def vendor_present():
    try:
        import ctypes as c
        dll=c.WinDLL('ftd2xx.dll');count=c.c_ulong()
        if dll.FT_CreateDeviceInfoList(c.byref(count))!=0:return False
        for i in range(count.value):
            flags,kind,identity,location=[c.c_ulong() for _ in range(4)]
            serial=c.create_string_buffer(16);description=c.create_string_buffer(64);handle=c.c_void_p()
            if dll.FT_GetDeviceInfoDetail(i,c.byref(flags),c.byref(kind),c.byref(identity),c.byref(location),serial,description,c.byref(handle))==0 and b'MEDICAL_FP_AMP' in description.value:return True
        return False
    except Exception:return None

async def run(args):
    root=Path(__file__).parent
    config=json.loads((root/args.stimulus).read_text(encoding='utf-8'))
    default_config=json.loads(json.dumps(config))
    config['scene']=json.loads((root/'scene.json').read_text(encoding='utf-8'))
    token=args.token or secrets.token_urlsafe(24)
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=False)
    log=(out/'events.jsonl').open('x',encoding='utf-8',buffering=1)
    peers={};subscribers=set();tasks=set();finished=set();finishing=set();trial=None;capture=None
    height_request=None
    stop_event=asyncio.Event();rtts=deque(maxlen=240)
    state=dict(phase='idle',trial_id=None,elapsed_s=0.,scheduled_pc_s=None,duration_s=config['duration_s'],
        eye_height_m=None,eye_height_q_s=None,height_pending=False,
        start_delay_s=args.start_delay,quest_xr=False,quest_visible=False,quest_rendering=False,
        quest_last_seen_s=None,sync_probes=0,rtt_median_ms=None,quest_software_current=False,
        vendor_available=None,combalance_state='待機（開始時に接続確認）' if args.vendor_directory else '実機取得なし',
        sampling_hz=None,save_directory=str(out),last_export=None,last_error=None,completed_trials=0)
    def record(kind,**data):
        log.write(json.dumps(dict(kind=kind,pc_monotonic_s=time.perf_counter(),pc_epoch_s=time.time(),**data),ensure_ascii=False)+'\n')
    def snapshot():
        return dict(type='system_status',service_version='pc-acquisition-v6',**state,
            pc_now_s=time.perf_counter(),quest_connected='quest' in list(peers.values()),
            vendor_enabled=bool(args.vendor_directory),scene=config['scene'],
            busy=trial is not None or capture is not None or bool(finishing))
    tls=None
    if bool(args.cert)!=bool(args.key):raise ValueError('Supply both certificate and key')
    if args.cert:
        tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(args.cert,args.key)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            self.send_header('Cache-Control','no-store');super().end_headers()
        def do_GET(self):
            path=self.path.split('?',1)[0]
            if path=='/api/session':
                body=json.dumps(dict(token=token,ws_port=args.ws_port,tls=bool(tls),status=snapshot())).encode()
                self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
            if path in ('/','/q','/p'):
                page='operator.html' if path=='/p' else 'quest.html'
                self.send_response(302);self.send_header('Location',f'/{page}#token={token}');self.end_headers();return
            if path in ('/quest.html','/operator.html'):
                html=(root/path[1:]).read_text(encoding='utf-8')
                if path=='/operator.html':
                    from html import escape
                    from .study_stimuli import available_conditions
                    html=html.replace('<!--STIMULUS_OPTIONS-->',''.join(f'<option value="{escape(key)}">{escape(label)}</option>' for label,key in available_conditions().items()))
                bootstrap='<script>history.replaceState(null,"",location.pathname+"#token="+'+json.dumps(token)+');window.controlWsPort='+str(args.ws_port)+';</script>'
                html=html.replace('<script',bootstrap+'<script',1)
                for name in ('quest.js','waveform.js','operator.js','fixation.js','fixation_target.js'):
                    html=html.replace('src="'+name+'"','src="'+name+'?v='+str((root/name).stat().st_mtime_ns)+'"')
                body=html.encode('utf-8');self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
            if path not in STATIC:self.send_error(404);return
            super().do_GET()
        def do_HEAD(self):
            if self.path.split('?',1)[0] not in STATIC:self.send_error(404);return
            super().do_HEAD()
    httpd=http.server.ThreadingHTTPServer(('127.0.0.1',args.http_port),functools.partial(Handler,directory=str(root)))
    if tls:httpd.socket=tls.wrap_socket(httpd.socket,server_side=True)
    threading.Thread(target=httpd.serve_forever,daemon=True).start()
    async def broadcast(message):
        for ws in list(peers):
            try:await ws.send(json.dumps(message,ensure_ascii=False))
            except Exception:pass
    def launch(coroutine):
        task=asyncio.create_task(coroutine);tasks.add(task);task.add_done_callback(tasks.discard);return task
    async def close_capture(current):
        nonlocal capture
        if current is None:return
        error=None
        try:
            await current.stop();record('vendor_capture_stopped',directory=str(current.output))
        except Exception as exc:
            error=str(exc);record('vendor_capture_error',directory=str(current.output),message=error);state['last_error']=error
            if current.process is None or current.process.returncode is None:raise
        finally:
            if capture is current and current.process is not None and current.process.returncode is not None:capture=None
        return error
    async def finish(identifier,reason):
        nonlocal trial
        if identifier is None or identifier in finished or identifier in finishing:return
        finishing.add(identifier)
        if trial==identifier:trial=None
        current=capture;state.update(phase='saving',combalance_state='停止・CSV保存中' if current else state['combalance_state'])
        try:
            cleanup_error=await close_capture(current)
            destination=out/'trials'/identifier
            summary=await asyncio.to_thread(export_recording,out/'events.jsonl',identifier,destination,current.output if current else None,reason)
            record('csv_saved',trial_id=identifier,directory=str(destination),quest_frames=summary['quest_frames'],combalance_samples=summary['combalance_samples'])
            state['imu_warning']=summary.get('external_imu_quality',{}).get('warning')
            state.update(phase='error' if cleanup_error else 'complete' if reason=='complete' else 'stopped',last_export=str(destination),
                combalance_state='停止処理を確認してください' if cleanup_error else '待機・設定復元済み' if args.vendor_directory else '実機取得なし')
            if reason=='complete':state['completed_trials']+=1
        except Exception as error:
            state.update(phase='error',last_error=str(error));record('finalize_error',trial_id=identifier,message=str(error))
        finally:finishing.discard(identifier);finished.add(identifier)
    async def watch_capture(identifier,current):
        await current.process.wait()
        if trial==identifier and identifier not in finishing:
            state['last_error']='ComBalance取得が予定より先に終了しました'
            record('vendor_capture_error',trial_id=identifier,message=state['last_error'])
            await broadcast(dict(type='stop',trial_id=identifier));await finish(identifier,'acquisition-ended-unexpectedly')
    async def prepare(identifier,initiator,delay):
        nonlocal capture
        current=None
        try:
            if trial!=identifier:return
            state.update(phase='preparing',combalance_state='接続・取得準備中' if args.vendor_directory else '実機取得なし')
            if args.vendor_directory:
                current=VendorCapture(args.vendor_directory,out/'trials'/identifier/'combalance_raw',batch=2,duration=config['duration_s']+delay+10);capture=current
                record('vendor_capture_preparing',trial_id=identifier)
                meta=await current.start()
                record('vendor_capture_ready',trial_id=identifier,directory=str(current.output),metadata=meta,timing_kind='PC block receipt timestamps; acquisition latency uncalibrated')
                state.update(combalance_state='取得中',sampling_hz=meta['Frequency'],vendor_available=True)
                launch(watch_capture(identifier,current))
            if trial!=identifier or 'quest' not in peers.values():return
            scheduled=time.perf_counter()+delay
            state.update(phase='countdown',scheduled_pc_s=scheduled)
            record('command_start',trial_id=identifier,scheduled_pc_s=scheduled,initiator=initiator,start_delay_s=delay,stimulus=config,participant=state.get('participant'))
            await broadcast(dict(type='start',trial_id=identifier,scheduled_pc_s=scheduled,pc_sent_s=time.perf_counter(),duration_s=config['duration_s']))
        except Exception as error:
            state['last_error']=str(error);record('start_failed',trial_id=identifier,message=str(error))
            await broadcast(dict(type='error',message='計測を開始できませんでした: '+str(error)))
            await finish(identifier,'start-failed')
    async def client(ws):
        nonlocal trial,config,height_request
        try:
            hello=json.loads(await asyncio.wait_for(ws.recv(),10));role=hello.get('role')
            if hello.get('token')!=token or role not in ('quest','operator'):
                record('rejected',reason='authentication');await ws.close(1008,'authentication required');return
            if role=='quest' and hello.get('user_agent') and not args.allow_desktop_simulation and not any(k in hello['user_agent'] for k in ('OculusBrowser','Quest','Android')):
                await ws.close(1008,'Open Quest page on headset');return
            if role=='quest' and 'quest' in peers.values():await ws.close(1008,'one Quest per session');return
            peers[ws]=role
            if hello.get('subscribe_status'):subscribers.add(ws)
            if role=='quest':rtts.clear();state.update(sync_probes=0,quest_last_seen_s=time.perf_counter(),quest_software_current=hello.get('client_version')=='pc-control-v5' or args.allow_desktop_simulation)
            record('connected',role=role)
            await ws.send(json.dumps(dict(type='config',stimulus=config,start_delay_s=args.start_delay,vendor_enabled=bool(args.vendor_directory))))
            async for raw in ws:
                p2=time.perf_counter();msg=json.loads(raw);kind=msg.get('type')
                if kind=='ping' and role=='quest':
                    state.update(quest_last_seen_s=p2,quest_xr=bool(msg.get('xr_presenting')),quest_visible=bool(msg.get('visible')),quest_rendering=bool(msg.get('rendering')))
                    await ws.send(json.dumps(dict(type='pong',q1=msg['q1'],p2=p2,p3=time.perf_counter())))
                elif kind=='capture_height' and role=='operator':
                    if trial or capture is not None or finishing or 'quest' not in peers.values() or not state['quest_software_current']:
                        await ws.send(json.dumps(dict(type='error',message='試行の保存完了とQuestの接続を確認してください')));continue
                    height_request=str(uuid.uuid4());state.update(height_pending=True)
                    record('height_requested',request_id=height_request)
                    state['height_requested_pc_s']=time.perf_counter()
                    await broadcast(dict(type='capture_height',request_id=height_request))
                elif kind=='height_result' and role=='quest':
                    if not state['height_pending'] or not height_request or msg.get('request_id')!=height_request:continue
                    state['height_pending']=False;height_request=None
                    height=msg.get('height_m')
                    if msg.get('ok') and isinstance(height,(int,float)) and math.isfinite(height) and .3<height<=3 and not trial:
                        state.update(eye_height_m=height,eye_height_q_s=msg.get('q_s'),last_error=None)
                        record('height_captured',height_m=height,q_s=msg.get('q_s'))
                    else:
                        state['last_error']=msg.get('message','高さを取得できませんでした')
                        await broadcast(dict(type='error',message=state['last_error']))
                elif kind=='height_invalidated' and role=='quest':
                    height_request=None;state.update(eye_height_m=None,eye_height_q_s=None,height_pending=False)
                    record('height_invalidated')
                elif kind=='start':
                    delay=float(msg.get('start_delay_s',args.start_delay))
                    if not 3<=delay<=30:await ws.send(json.dumps(dict(type='error',message='開始待ち時間は3～30秒です')));continue
                    if not state['quest_software_current']:
                        await ws.send(json.dumps(dict(type='error',message='Quest Browserのページを一度再読み込みして表示を更新してください')));continue
                    if trial or capture is not None or finishing or 'quest' not in peers.values():
                        await ws.send(json.dumps(dict(type='error',message='Questの接続と、前の試行の保存完了を確認してください')));continue
                    condition=msg.get('condition','multicosine')
                    if condition not in ('study_sweep90','study_multicosine10','multicosine','none','dot','spinner','pilot_rest','pilot_five_x1p4',*[f'pilot_{kind}_x{n}' for kind in ('single','five') for n in (1,2,3)]):
                        await ws.send(json.dumps(dict(type='error',message='Unknown visual condition')));continue
                    if state['height_pending']:
                        await ws.send(json.dumps(dict(type='error',message='目線高さの取得完了を待ってください')));continue
                    if condition in ('dot','spinner') and state['eye_height_m'] is None:
                        await ws.send(json.dumps(dict(type='error',message='先に目線高さを取得してください')));continue
                    participant=None
                    if msg.get('participant') is not None:
                        from .named_recording import participant_info
                        try:participant=participant_info(msg['participant'])
                        except (ValueError,KeyError,TypeError) as error:
                            await ws.send(json.dumps(dict(type='error',message=str(error))));continue
                    state['participant']=participant
                    from .trial_stimuli import select_stimulus
                    try:config=select_stimulus(default_config,condition)
                    except (ValueError,FileNotFoundError) as error:
                        await ws.send(json.dumps(dict(type='error',message=str(error))));continue
                    config['eye_height_m']=state['eye_height_m'];config['eye_height_q_s']=state['eye_height_q_s']
                    config['scene']=json.loads((root/'scene.json').read_text(encoding='utf-8'))
                    state.update(duration_s=config['duration_s'],condition=condition)
                    await broadcast(dict(type='config',stimulus=config))
                    trial=str(uuid.uuid4());state.update(trial_id=trial,elapsed_s=0.,scheduled_pc_s=None,last_error=None,imu_warning=None)
                    launch(prepare(trial,role,delay))
                elif kind in ('stop','shutdown'):
                    identifier=trial;record('command_stop',trial_id=identifier)
                    await broadcast(dict(type='stop',trial_id=identifier));await finish(identifier,'pc-stop' if role=='operator' else 'quest-stop')
                    if kind=='shutdown' and role=='operator':stop_event.set()
                elif role=='quest' and kind in ('probe','received','frame','ended','blocked','capabilities','setup'):
                    record(kind,payload=msg);state['quest_last_seen_s']=p2
                    if kind=='probe':
                        rtt=(msg['q4']-msg['q1'])-(msg['p3']-msg['p2'])
                        if rtt>=-.0001:rtts.append(max(0,rtt));state.update(sync_probes=state['sync_probes']+1,rtt_median_ms=statistics.median(rtts)*1000)
                    elif kind=='frame' and msg['trial_id']==trial:state.update(phase='running',elapsed_s=msg['elapsed_s'],quest_rendering=True)
                    elif kind in ('ended','blocked') and msg.get('trial_id')==trial:
                        if kind=='blocked':state['last_error']=msg.get('message','Quest未準備')
                        await finish(trial,msg.get('reason','quest-not-ready'))
                        await broadcast(dict(type='status',message=kind))
        except Exception as error:record('connection_error',message=str(error))
        finally:
            role=peers.pop(ws,None);subscribers.discard(ws);record('disconnected',role=role)
            if role=='quest':
                height_request=None
                state.update(eye_height_m=None,eye_height_q_s=None,height_pending=False,quest_xr=False,quest_rendering=False,quest_visible=False,quest_software_current=False)
                if trial:
                    identifier=trial;await broadcast(dict(type='stop',trial_id=identifier));await finish(identifier,'quest-disconnect')
    async def publish():
        while not stop_event.is_set():
            if state['height_pending'] and time.perf_counter()-state.get('height_requested_pc_s',0)>5:
                state.update(height_pending=False,last_error='高さ取得がタイムアウトしました。装着とVR表示を確認して再取得してください')
            payload=json.dumps(snapshot(),ensure_ascii=False)
            for ws in list(subscribers):
                try:await ws.send(payload)
                except Exception:pass
            await asyncio.sleep(.25)
    async def hardware_poll():
        while not stop_event.is_set():
            if args.vendor_directory and capture is None:state['vendor_available']=await asyncio.to_thread(vendor_present)
            await asyncio.sleep(5)
    scheme='https' if tls else 'http'
    print(f'PC: {scheme}://localhost:{args.http_port}/operator.html#token={token}',flush=True)
    print(f'Quest: {scheme}://localhost:{args.http_port}/quest.html#token={token}',flush=True)
    record('session',stimulus=config,pc_control=True)
    publisher=asyncio.create_task(publish());hardware=asyncio.create_task(hardware_poll())
    try:
        async with serve(client,'127.0.0.1',args.ws_port,ssl=tls,max_size=262144):await stop_event.wait()
    finally:
        if trial:await finish(trial,'server-shutdown')
        if tasks:await asyncio.gather(*tasks,return_exceptions=True)
        publisher.cancel();hardware.cancel();await asyncio.gather(publisher,hardware,return_exceptions=True)
        if capture is not None:await close_capture(capture)
        httpd.shutdown();log.close()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--cert');p.add_argument('--key');p.add_argument('--token')
    p.add_argument('--stimulus',default='results/stimulus/stimulus.json');p.add_argument('--output',required=True)
    p.add_argument('--http-port',type=int,default=8443);p.add_argument('--ws-port',type=int,default=8765)
    p.add_argument('--start-delay',type=float,default=10);p.add_argument('--allow-desktop-simulation',action='store_true');p.add_argument('--vendor-directory')
    args=p.parse_args()
    if not 3<=args.start_delay<=30:p.error('--start-delay must be 3..30 seconds')
    asyncio.run(run(args))
