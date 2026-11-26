"""Overlay two head recordings and a desk-still IMU FFT amplitude spectrum."""
from pathlib import Path
import csv,json,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/".video-tools"));sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from compare_two_head_fft_amplitude import spectrum

def font(size,bold=False):
    root=Path(r"C:\Windows\Fonts")
    for name in (["YuGothB.ttc","meiryob.ttc"] if bold else ["YuGothM.ttc","meiryo.ttc"]):
        p=root/name
        if p.exists():return ImageFont.truetype(str(p),size)
    return ImageFont.load_default()

def main():
    sources=[Path(x) for x in sys.argv[1:5]];out=Path(sys.argv[5]);out.mkdir(exist_ok=True)
    labels=["103603471","112815676","机上静置","自然景色"]
    colors=[(27,113,166),(220,76,70),(45,155,93),(230,145,38)]
    spectra=[spectrum(p) for p in sources];f=spectra[0][0];amps=[x[1] for x in spectra]
    mask=f<=1;summary={"duration_s":50,"frequency_resolution_hz":.02,"processing":"5-55 s; mean removal only; no filter, detrend, or window"}
    for label,a in zip(labels,amps):
        summary[label]={}
        for hz in [.1,.2]:
            k=int(np.argmin(abs(f-hz)));summary[label][f"amplitude_{hz:g}_hz"]={"bin_hz":float(f[k]),"raw_amplitude":float(a[k])}
    W,H=1500,850;im=Image.new("RGB",(W,H),"white");d=ImageDraw.Draw(im);title,body,small=font(30,True),font(20),font(16)
    d.text((65,28),"頭部記録・机上静置・自然景色のFFT振幅比較",font=title,fill=(20,30,38));d.text((65,70),"5〜55秒、平均値のみ除去、周波数分解能0.02 Hz",font=body,fill=(70,82,91))
    l,t,r,bt=90,135,1440,760;maximum=max(float(a[mask].max()) for a in amps)*1.08
    d.rectangle((l,t,r,bt),outline=(170,184,193),width=2)
    for i in range(6):
        y=t+i*(bt-t)/5;v=maximum*(1-i/5);d.line((l,y,r,y),fill=(226,232,236),width=1);d.text((8,y-8),f"{v:.1f}",font=small,fill=(80,92,102))
    for hz in np.arange(0,1.001,.1):
        x=l+hz*(r-l);d.line((x,t,x,bt),fill=(238,242,244),width=1);d.text((x-10,bt+8),f"{hz:.1f}",font=small,fill=(80,92,102))
    for a,color in zip(amps,colors):
        pts=[(l+float(hz)*(r-l),bt-float(v)/maximum*(bt-t)) for hz,v in zip(f[mask],a[mask])];d.line(pts,fill=color,width=3)
    for hz in [.1,.2]:
        x=l+hz*(r-l);d.line((x,t,x,bt),fill=(70,70,70),width=2);d.text((x+5,t+10),f"{hz:g} Hz",font=small,fill=(55,55,55))
    for i,(color,label) in enumerate(zip(colors,labels)):
        x=650+i*200;d.line((x,88,x+26,88),fill=color,width=6);d.text((x+34,77),label,font=small,fill=(35,46,54))
    d.text((665,805),"周波数 (Hz)",font=body,fill=(45,57,65));d.text((8,430),"FFT振幅\n(raw)",font=small,fill=(45,57,65))
    png=out/"head-fft-vs-desk-and-natural-view-5to55s-0to1hz.png";im.save(png)
    csvp=out/"head-fft-vs-desk-and-natural-view-5to55s-0to1hz.csv"
    with csvp.open("w",encoding="utf-8-sig",newline="") as h:
        w=csv.writer(h);w.writerow(["frequency_hz",*labels]);w.writerows((f"{hz:.2f}",*[f"{a[i]:.9g}" for a in amps]) for i,hz in enumerate(f[mask]))
    js=out/"head-fft-vs-desk-and-natural-view-5to55s-summary.json";js.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"plot":str(png),"csv":str(csvp),"summary":str(js),**summary},ensure_ascii=False))
if __name__=="__main__":main()
