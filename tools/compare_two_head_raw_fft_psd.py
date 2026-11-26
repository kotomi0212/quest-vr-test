"""Raw Z-axis FFT PSD comparison: no filtering, centering, detrending, or window."""
from pathlib import Path
import csv
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from analyze_imu_segment import read_ags


def raw_psd(source):
    data = read_ags(source)
    time_ms, z = data[:, 0], data[:, 3]
    fs = 1000 / np.median(np.diff(time_ms))
    elapsed = (time_ms-time_ms[0])/1000
    keep = (elapsed >= 5.0) & (elapsed < 25.0)
    x = z[keep]
    n = len(x)
    fft = np.fft.rfft(x)
    psd = np.abs(fft)**2 / (fs*n)
    if n % 2 == 0:
        psd[1:-1] *= 2
    else:
        psd[1:] *= 2
    return np.fft.rfftfreq(n, 1/fs), psd


def font(size, bold=False):
    folder=Path(r"C:\Windows\Fonts")
    for name in (["YuGothB.ttc","meiryob.ttc"] if bold else ["YuGothM.ttc","meiryo.ttc"]):
        path=folder/name
        if path.exists(): return ImageFont.truetype(str(path),size)
    return ImageFont.load_default()


def main():
    a,b=Path(sys.argv[1]),Path(sys.argv[2])
    out=Path(sys.argv[3]) if len(sys.argv)>3 else ROOT/"artifacts"
    out.mkdir(exist_ok=True)
    f,pa=raw_psd(a); fb,pb=raw_psd(b)
    if not np.allclose(f,fb): raise ValueError("frequency bins differ")
    mask=f<=1
    results={"frequency_resolution_hz":float(f[1]-f[0]),"method":"raw rectangular-window periodogram; no preprocessing"}
    for label,p in [("103603471",pa),("112815676",pb)]:
        results[label]={}
        for hz in [0,.05,.1,.2]:
            k=int(np.argmin(np.abs(f-hz)))
            results[label][f"psd_{hz:g}_hz"]={"bin_hz":float(f[k]),"value":float(p[k])}

    width,height=1500,850
    image=Image.new("RGB",(width,height),"white");draw=ImageDraw.Draw(image)
    title,body,small=font(30,True),font(20),font(16)
    colors=[(27,113,166),(220,76,70)]
    draw.text((65,28),"未処理データのFFTによる頭部前後加速度PSD",font=title,fill=(20,30,38))
    draw.text((65,70),"5〜25秒、Z軸、フィルタ・平均除去・トレンド除去・窓関数なし",font=body,fill=(70,82,91))
    left,top,right,bottom=90,135,1440,760
    curves=[np.log10(np.maximum(pa[mask],1e-12)),np.log10(np.maximum(pb[mask],1e-12))]
    low=min(float(x.min()) for x in curves);high=max(float(x.max()) for x in curves)
    draw.rectangle((left,top,right,bottom),outline=(170,184,193),width=2)
    for i in range(6):
        y=top+i*(bottom-top)/5;value=high-i*(high-low)/5
        draw.line((left,y,right,y),fill=(226,232,236),width=1)
        draw.text((4,y-8),f"{10**value:.2g}",font=small,fill=(80,92,102))
    for hz in np.arange(0,1.001,.1):
        x=left+hz*(right-left)
        draw.line((x,top,x,bottom),fill=(238,242,244),width=1)
        draw.text((x-10,bottom+8),f"{hz:.1f}",font=small,fill=(80,92,102))
    for curve,color in zip(curves,colors):
        pts=[(left+float(x)*(right-left),bottom-(float(y)-low)/(high-low)*(bottom-top)) for x,y in zip(f[mask],curve)]
        draw.line(pts,fill=color,width=3)
    for i,(color,label) in enumerate(zip(colors,["103603471","112815676"])):
        x=1030+i*190;draw.line((x,88,x+35,88),fill=color,width=6);draw.text((x+43,77),label,font=small,fill=(35,46,54))
    draw.text((665,805),"周波数 (Hz)",font=body,fill=(45,57,65))
    draw.text((8,430),"PSD\n(raw²/Hz)\n対数軸",font=small,fill=(45,57,65))
    png=out/"head-raw-fft-psd-overlay-103603471-vs-112815676-0to1hz.png";image.save(png)
    csv_path=out/"head-raw-fft-psd-overlay-103603471-vs-112815676-0to1hz.csv"
    with csv_path.open("w",encoding="utf-8-sig",newline="") as h:
        w=csv.writer(h);w.writerow(["frequency_hz","raw_psd_103603471_raw2_per_hz","raw_psd_112815676_raw2_per_hz"])
        w.writerows((f"{hz:.9f}",f"{x:.9g}",f"{y:.9g}") for hz,x,y in zip(f[mask],pa[mask],pb[mask]))
    js=out/"head-raw-fft-psd-overlay-103603471-vs-112815676-summary.json";js.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"plot":str(png),"csv":str(csv_path),"summary":str(js),**results},ensure_ascii=False))


if __name__=="__main__": main()
