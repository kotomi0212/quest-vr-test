"""Compare raw Z-axis FFT amplitude spectra; mean removal only, no filtering/window."""
from pathlib import Path
import csv
import json
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/".video-tools"));sys.path.insert(0,str(Path(__file__).resolve().parent))
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from analyze_imu_segment import read_ags

FS=100.0;START=5.0;DURATION=50.0;NFFT=5000

def spectrum(path):
    data=read_ags(path);t=data[:,0];z=data[:,3]
    fs=1000/np.median(np.diff(t));elapsed=(t-t[0])/1000
    keep=(elapsed>=START)&(elapsed<START+DURATION);x=z[keep]
    n=len(x)
    x=x-np.mean(x)  # Remove DC only; no filtering, detrending, or tapering.
    fft=np.fft.rfft(x,n=NFFT)
    amplitude=2*np.abs(fft)/n
    amplitude[0]/=2
    if NFFT%2==0: amplitude[-1]/=2
    return np.fft.rfftfreq(NFFT,1/fs),amplitude

def font(size,bold=False):
    root=Path(r"C:\Windows\Fonts")
    for name in (["YuGothB.ttc","meiryob.ttc"] if bold else ["YuGothM.ttc","meiryo.ttc"]):
        p=root/name
        if p.exists():return ImageFont.truetype(str(p),size)
    return ImageFont.load_default()

def main():
    a,b=Path(sys.argv[1]),Path(sys.argv[2]);out=Path(sys.argv[3]);out.mkdir(exist_ok=True)
    f,aa=spectrum(a);fb,ab=spectrum(b)
    mask=f<=1
    values={"display_bin_spacing_hz":float(f[1]-f[0]),"true_resolution_hz":1/DURATION,"duration_s":DURATION,"processing":"mean removal only; no filter, detrend, or window"}
    for label,x in [("103603471",aa),("112815676",ab)]:
        values[label]={}
        for hz in [.1,.2]:
            k=int(np.argmin(abs(f-hz)));values[label][f"amplitude_{hz:g}_hz"]={"bin_hz":float(f[k]),"raw_amplitude":float(x[k])}

    W,H=1500,850;im=Image.new("RGB",(W,H),"white");d=ImageDraw.Draw(im)
    title,body,small=font(30,True),font(20),font(16);colors=[(27,113,166),(220,76,70)]
    d.text((65,28),"頭部前後加速度のFFT振幅スペクトル",font=title,fill=(20,30,38))
    d.text((65,70),"5〜55秒（50秒間）、平均値のみ除去、フィルタ・トレンド除去・窓関数なし",font=body,fill=(70,82,91))
    l,t,r,bt=90,135,1440,760;maximum=max(float(aa[mask].max()),float(ab[mask].max()))*1.08
    d.rectangle((l,t,r,bt),outline=(170,184,193),width=2)
    for i in range(6):
        y=t+i*(bt-t)/5;v=maximum*(1-i/5);d.line((l,y,r,y),fill=(226,232,236),width=1);d.text((8,y-8),f"{v:.1f}",font=small,fill=(80,92,102))
    for hz in np.arange(0,1.001,.1):
        x=l+hz*(r-l);d.line((x,t,x,bt),fill=(238,242,244),width=1);d.text((x-10,bt+8),f"{hz:.1f}",font=small,fill=(80,92,102))
    for xvals,color in [(aa[mask],colors[0]),(ab[mask],colors[1])]:
        pts=[(l+float(hz)*(r-l),bt-float(v)/maximum*(bt-t)) for hz,v in zip(f[mask],xvals)];d.line(pts,fill=color,width=3)
    for hz in [.1,.2]:
        x=l+hz*(r-l);d.line((x,t,x,bt),fill=(70,70,70),width=2);d.text((x+5,t+10),f"{hz:g} Hz",font=small,fill=(55,55,55))
    for i,(color,label) in enumerate(zip(colors,["103603471","112815676"])):
        x=1030+i*190;d.line((x,88,x+35,88),fill=color,width=6);d.text((x+43,77),label,font=small,fill=(35,46,54))
    d.text((665,805),"周波数 (Hz)",font=body,fill=(45,57,65));d.text((8,430),"FFT振幅\n(raw)",font=small,fill=(45,57,65))
    png=out/"head-fft-amplitude-overlay-103603471-vs-112815676-5to55s-0to1hz.png";im.save(png)
    csvp=out/"head-fft-amplitude-overlay-103603471-vs-112815676-5to55s-0to1hz.csv"
    with csvp.open("w",encoding="utf-8-sig",newline="") as h:
        w=csv.writer(h);w.writerow(["frequency_hz","amplitude_103603471_raw","amplitude_112815676_raw"]);w.writerows((f"{hz:.2f}",f"{x:.9g}",f"{y:.9g}") for hz,x,y in zip(f[mask],aa[mask],ab[mask]))
    js=out/"head-fft-amplitude-overlay-103603471-vs-112815676-5to55s-summary.json";js.write_text(json.dumps(values,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"plot":str(png),"csv":str(csvp),"summary":str(js),**values},ensure_ascii=False))

if __name__=="__main__":main()
