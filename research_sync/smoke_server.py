"""Isolated software protocol smoke check; never connects to the live Quest ports."""
import asyncio
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request
from websockets.asyncio.client import connect

async def check(token):
    async def idle():
        for _ in range(100):
            def get():
                with urllib.request.urlopen('http://localhost:8873/api/session') as r:return json.load(r)['status']
            if not (await asyncio.to_thread(get))['busy']:return
            await asyncio.sleep(.05)
        raise AssertionError('CSV finalization did not finish')
    async with connect('ws://localhost:8875') as q,connect('ws://localhost:8875') as op:
        await q.send(json.dumps(dict(role='quest',token=token)))
        await op.send(json.dumps(dict(role='operator',token=token)))
        assert json.loads(await q.recv())['type']=='config'
        assert json.loads(await op.recv())['type']=='config'
        await q.send(json.dumps(dict(type='ping',q1=1)))
        pong=json.loads(await q.recv());assert pong['p3']>=pong['p2']
        await op.send(json.dumps(dict(type='start')))
        a=json.loads(await q.recv());b=json.loads(await op.recv())
        assert a['type']==b['type']=='start' and a['trial_id']==b['trial_id']
        await op.send(json.dumps(dict(type='stop')))
        assert json.loads(await q.recv())['type']=='stop'
        assert json.loads(await op.recv())['type']=='stop'
        await idle()
        await q.send(json.dumps(dict(type='start')))
        solo=json.loads(await q.recv());assert solo['type']=='start'
        assert json.loads(await op.recv())['trial_id']==solo['trial_id']
        # A delayed termination from an old trial must not unlock a new one.
        await q.send(json.dumps(dict(type='ended',trial_id=a['trial_id'],reason='late')))
        await q.send(json.dumps(dict(type='start')))
        assert json.loads(await q.recv())['type']=='error'
        await op.close()
        await q.send(json.dumps(dict(type='ping',q1=2)))
        assert json.loads(await q.recv())['type']=='pong','Closing PC UI must not stop solo Quest trial'
        await q.send(json.dumps(dict(type='stop')))
        assert json.loads(await q.recv())['type']=='stop'

def main():
    with tempfile.TemporaryDirectory(prefix='vr-sync-smoke-') as tmp:
        p=subprocess.Popen([sys.executable,'-m','research_sync.server','--output',str(Path(tmp)/'session'),
            '--http-port','8873','--ws-port','8875','--allow-desktop-simulation'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            first=p.stdout.readline();assert '#token=' in first,first
            token=first.strip().split('#token=')[1]
            asyncio.run(check(token))
            assert urllib.request.urlopen('http://localhost:8873/quest.html').status==200
            try:urllib.request.urlopen('http://localhost:8873/server.py')
            except urllib.error.HTTPError as e:assert e.code==404
            else:raise AssertionError('Source files must not be served')
            print('PASS: auth/config, clock reply, PC and solo Quest START/STOP, stale trial isolation, PC disconnect independence, static allowlist')
        finally:p.terminate();p.wait(timeout=10)

if __name__=='__main__':main()
