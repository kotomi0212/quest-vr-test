"""Lifecycle of the manufacturer helper; raw acquisition independent of analysis."""
import asyncio
import json
from pathlib import Path

class VendorCapture:
    def __init__(self,vendor,output,helper=None,batch=2,duration=110):
        self.vendor=Path(vendor);self.output=Path(output).resolve();self.batch=batch
        self.helper=Path(helper or Path(__file__).parent/'bin/ManufacturerCapture.exe').resolve()
        self.process=None
        self.duration=duration
        self.collected=False
        self.lock=asyncio.Lock()
    async def start(self):
        async with self.lock:return await self._start()
    async def _start(self):
        if self.process is not None:raise RuntimeError('Capture already started')
        if self.output.exists():raise FileExistsError(self.output)
        if not self.helper.exists():raise FileNotFoundError('Build ManufacturerCapture.exe first')
        self.output.parent.mkdir(parents=True,exist_ok=True)
        self.process=await asyncio.create_subprocess_exec(str(self.helper),str(self.vendor),str(self.output),str(self.duration),str(self.batch),
            stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        async def ready():
            while True:
                line=await self.process.stdout.readline()
                if not line:
                    error=(await self.process.stderr.read()).decode(errors='replace')
                    raise RuntimeError('Vendor capture did not become ready: '+error)
                if line.strip()==b'CAPTURE_READY':return
        try:
            await asyncio.wait_for(ready(),12)
            metadata=json.loads((self.output/'device_parameters.json').read_text())
            if metadata.get('Matome')!=self.batch:raise RuntimeError('Unexpected capture batching')
            return metadata
        except BaseException:
            await asyncio.shield(self._stop());raise
    async def stop(self):
        async with self.lock:return await self._stop()
    async def _stop(self):
        if self.process is None:return
        # Cooperative exit is essential: forcibly killing the helper would skip
        # device batching restoration. No terminate/kill fallback is used.
        if not self.collected:
            if self.process.returncode is None and self.output.exists():(self.output/'stop.request').write_text('stop',encoding='ascii')
            try:
                stdout,stderr=await asyncio.wait_for(self.process.communicate(),15)
            except asyncio.TimeoutError:
                raise RuntimeError('Capture shutdown timed out; helper left alive to restore device settings')
            if self.output.exists():
                (self.output/'helper_shutdown.txt').write_text(stdout.decode(errors='replace')+stderr.decode(errors='replace'),encoding='utf-8')
            self.collected=True
            if b'Cleanup:' in stderr:raise RuntimeError('Manufacturer reported an error restoring device settings: '+stderr.decode(errors='replace'))
        if self.process.returncode:
            raise RuntimeError('Vendor helper exited with code '+str(self.process.returncode))
