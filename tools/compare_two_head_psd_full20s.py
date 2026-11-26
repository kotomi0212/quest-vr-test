"""Overlay two head-acceleration PSDs using the full 20 s segment (0.05 Hz bins)."""
from pathlib import Path
import csv
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from analyze_imu_segment import read_ags, lowpass_fir

FS = 100.0
SKIP_S = 5.0
DURATION_S = 20.0


def full_segment_psd(source):
    data = read_ags(source)
    time_ms, acceleration = data[:, 0], data[:, 1:4]
    fs = 1000 / np.median(np.diff(time_ms))
    elapsed = (time_ms - time_ms[0]) / 1000
    keep = (elapsed >= SKIP_S) & (elapsed < SKIP_S + DURATION_S)
    z = lowpass_fir(acceleration[keep, 2:3], fs, 10.0, 101)[:, 0]
    n = len(z)
    x = np.arange(n)
    slope, intercept = np.polyfit(x, z, 1)
    detrended = z - (slope*x + intercept)
    window = np.hanning(n)
    fft = np.fft.rfft(detrended * window)
    psd = np.abs(fft)**2 / (fs * np.sum(window**2))
    psd[1:-1] *= 2
    frequency = np.fft.rfftfreq(n, 1/fs)
    return frequency, psd


def font(size, bold=False):
    folder = Path(r"C:\Windows\Fonts")
    for name in (["YuGothB.ttc", "meiryob.ttc"] if bold else ["YuGothM.ttc", "meiryo.ttc"]):
        path = folder / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def main():
    source_a, source_b = Path(sys.argv[1]), Path(sys.argv[2])
    output_dir = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "artifacts"
    output_dir.mkdir(exist_ok=True)
    frequency, psd_a = full_segment_psd(source_a)
    frequency_b, psd_b = full_segment_psd(source_b)
    if not np.allclose(frequency, frequency_b):
        raise ValueError("frequency bins do not match")

    def value_at(psd, hz):
        index = int(np.argmin(np.abs(frequency-hz)))
        return float(frequency[index]), float(psd[index])

    band = (frequency >= 0.05) & (frequency <= 10)
    peak_a = np.flatnonzero(band)[np.argmax(psd_a[band])]
    peak_b = np.flatnonzero(band)[np.argmax(psd_b[band])]
    result = {
        "frequency_resolution_hz": float(frequency[1]-frequency[0]),
        "103603471": {"psd_0p1": value_at(psd_a, .1)[1], "psd_0p2": value_at(psd_a, .2)[1], "peak_hz": float(frequency[peak_a]), "peak_psd": float(psd_a[peak_a])},
        "112815676": {"psd_0p1": value_at(psd_b, .1)[1], "psd_0p2": value_at(psd_b, .2)[1], "peak_hz": float(frequency[peak_b]), "peak_psd": float(psd_b[peak_b])},
    }

    width, height = 1500, 850
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    title, body, small = font(30, True), font(20), font(16)
    colors = [(27, 113, 166), (220, 76, 70)]
    labels = ["103603471", "112815676"]
    draw.text((65, 28), "頭部前後加速度PSDの重ね合わせ", font=title, fill=(20,30,38))
    draw.text((65, 70), "20秒全体を使用（周波数分解能 0.05 Hz）、Z軸を前後方向と仮定", font=body, fill=(70,82,91))
    left, top, right, bottom = 90, 135, 1440, 760
    x_max = 1.0
    mask = frequency <= x_max
    f = frequency[mask]
    curves = [np.log10(np.maximum(psd_a[mask], 1e-12)), np.log10(np.maximum(psd_b[mask], 1e-12))]
    low = min(float(x.min()) for x in curves)
    high = max(float(x.max()) for x in curves)
    draw.rectangle((left,top,right,bottom), outline=(170,184,193), width=2)
    for i in range(6):
        y = top+i*(bottom-top)/5
        value = high-i*(high-low)/5
        draw.line((left,y,right,y), fill=(226,232,236), width=1)
        draw.text((5,y-8), f"{10**value:.2g}", font=small, fill=(80,92,102))
    for hz in np.arange(0, x_max + .001, .2):
        x = left+hz/x_max*(right-left)
        draw.line((x,top,x,bottom), fill=(238,242,244), width=1)
        draw.text((x-8,bottom+8), f"{hz:g}", font=small, fill=(80,92,102))
    for marker, label in [(.1,"0.1 Hz"),(.2,"0.2 Hz")]:
        x = left+marker/x_max*(right-left)
        draw.line((x,top,x,bottom), fill=(95,95,95), width=2)
        draw.text((x+5,bottom-28 if marker==.1 else bottom-54), label, font=small, fill=(70,70,70))
    for curve,color,label in zip(curves,colors,labels):
        points=[(left+float(x)/x_max*(right-left), bottom-(float(y)-low)/(high-low)*(bottom-top)) for x,y in zip(f,curve)]
        draw.line(points, fill=color, width=3)
    for i,(color,label) in enumerate(zip(colors,labels)):
        x=1030+i*190
        draw.line((x,88,x+35,88), fill=color, width=6)
        draw.text((x+43,77), label, font=small, fill=(35,46,54))
    draw.text((665,805), "周波数 (Hz)", font=body, fill=(45,57,65))
    draw.text((8,430), "PSD\n(raw²/Hz)\n対数軸", font=small, fill=(45,57,65))
    plot_path=output_dir/"head-psd-overlay-103603471-vs-112815676-full20s.png"
    image.save(plot_path)

    csv_path=output_dir/"head-psd-overlay-103603471-vs-112815676-full20s.csv"
    with csv_path.open("w",encoding="utf-8-sig",newline="") as handle:
        writer=csv.writer(handle)
        writer.writerow(["frequency_hz","psd_103603471_raw2_per_hz","psd_112815676_raw2_per_hz"])
        writer.writerows((f"{hz:.9f}",f"{a:.9g}",f"{b:.9g}") for hz,a,b in zip(frequency[mask],psd_a[mask],psd_b[mask]))
    summary_path=output_dir/"head-psd-overlay-103603471-vs-112815676-full20s-summary.json"
    summary_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"plot":str(plot_path),"csv":str(csv_path),"summary":str(summary_path),**result},ensure_ascii=False))


if __name__ == "__main__":
    main()
