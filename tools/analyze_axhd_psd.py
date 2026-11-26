"""Analyze the axhd (head anterior-posterior acceleration) column of a measurement CSV."""
from pathlib import Path
import csv
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from analyze_imu_segment import lowpass_fir, welch

SKIP_S, DURATION_S, CUTOFF_HZ = 5.0, 20.0, 10.0


def load_axhd(path):
    with path.open("r", encoding="cp932", errors="replace", newline="") as handle:
        rows = list(csv.reader(handle))
    header_index = next(i for i, row in enumerate(rows) if "axhd" in row and row and row[0] == "")
    header = rows[header_index]
    axhd_index = header.index("axhd")
    output = []
    for row in rows[header_index + 1:]:
        if len(row) <= axhd_index:
            continue
        try:
            output.append((float(row[0]), float(row[axhd_index])))
        except ValueError:
            continue
    return np.asarray(output, dtype=float)


def font(size, bold=False):
    names = ["YuGothB.ttc" if bold else "YuGothM.ttc", "meiryob.ttc" if bold else "meiryo.ttc"]
    for name in names:
        path = Path(r"C:\Windows\Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def draw_plot(path, t, signal, frequency, psd, peak_hz, peak_value):
    width, height = 1500, 850
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    blue, red = (27, 113, 166), (220, 45, 45)
    title, body, small = font(30, True), font(20), font(16)
    draw.text((65, 25), "頭部前後加速度（axhd）の時系列とPSD", font=title, fill=(20, 30, 38))
    draw.text((65, 67), "開始5秒を除外・次の20秒・10 Hzローパス・Welch法", font=body, fill=(75, 88, 98))

    def panel(box, xv, yv, xmax, log_y, label):
        left, top, right, bottom = box
        mask = xv <= xmax
        x, y = xv[mask], yv[mask]
        if log_y:
            y = np.log10(np.maximum(y, 1e-12))
        low, high = float(y.min()), float(y.max())
        if high == low:
            high += 1
        draw.rectangle(box, outline=(170, 184, 193), width=2)
        for i in range(5):
            py = top + i * (bottom-top)/4
            draw.line((left, py, right, py), fill=(226, 232, 236), width=1)
            value = high - i*(high-low)/4
            text = f"{10**value:.2g}" if log_y else f"{value:.1f}"
            draw.text((5, py-8), text, font=small, fill=(80, 92, 102))
        for tick in np.linspace(0, xmax, 6):
            px = left + tick/xmax*(right-left)
            draw.line((px, top, px, bottom), fill=(238, 242, 244), width=1)
            draw.text((px-12, bottom+8), f"{tick:g}", font=small, fill=(80, 92, 102))
        points = [(left+float(a)/xmax*(right-left), bottom-(float(b)-low)/(high-low)*(bottom-top)) for a,b in zip(x,y)]
        draw.line(points, fill=blue, width=2)
        draw.text((left+8, top+8), label, font=body, fill=(35, 46, 54))

    panel((75, 115, 1440, 405), t, signal, float(t[-1]), False, "頭部前後加速度 axhd（平均除去、mm/s²）")
    panel((75, 510, 1440, 790), frequency, psd, 10, True, f"PSD（(mm/s²)²/Hz）、最大ピーク {peak_hz:.3f} Hz")
    marker_x = 75 + 0.2/10*(1440-75)
    draw.line((marker_x, 510, marker_x, 790), fill=red, width=4)
    draw.text((marker_x+8, 755), "0.2 Hz", font=small, fill=red)
    image.save(path)


def main():
    source = Path(sys.argv[1])
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "artifacts"
    output_dir.mkdir(exist_ok=True)
    data = load_axhd(source)
    time, acceleration = data[:, 0], data[:, 1]
    fs = 1 / np.median(np.diff(time))
    keep = (time >= time[0] + SKIP_S) & (time < time[0] + SKIP_S + DURATION_S)
    retained_t = time[keep] - (time[0] + SKIP_S)
    raw = acceleration[keep]
    filtered = lowpass_fir(raw[:, None], fs, CUTOFF_HZ, 101)[:, 0]
    dynamic = filtered - np.mean(filtered)
    frequency, psd_matrix = welch(dynamic[:, None].copy(), fs)
    psd = psd_matrix[:, 0]
    band = (frequency >= 0.05) & (frequency <= CUTOFF_HZ)
    peak_index = np.flatnonzero(band)[np.argmax(psd[band])]
    near_index = int(np.argmin(np.abs(frequency - 0.2)))
    stem = source.stem + "-axhd-skip5s-next20s-lowpass10hz"

    processed = output_dir / f"{stem}.csv"
    with processed.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["analysis_elapsed_s", "axhd_raw_mm_per_s2", "axhd_filtered_10hz_mm_per_s2", "axhd_dynamic_mm_per_s2"])
        writer.writerows((f"{t:.3f}", f"{a:.9f}", f"{b:.9f}", f"{c:.9f}") for t,a,b,c in zip(retained_t, raw, filtered, dynamic))
    spectrum = output_dir / f"{stem}-welch-psd.csv"
    with spectrum.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["frequency_hz", "axhd_psd_mm2_per_s4_per_hz"])
        writer.writerows((f"{f:.9f}", f"{value:.9g}") for f,value in zip(frequency[frequency <= 10], psd[frequency <= 10]))
    plot = output_dir / f"{stem}.png"
    draw_plot(plot, retained_t, dynamic, frequency, psd, float(frequency[peak_index]), float(psd[peak_index]))
    summary = {
        "sampling_rate_hz": float(fs), "retained_rows": int(len(raw)),
        "dominant_peak_hz": float(frequency[peak_index]), "dominant_peak_psd": float(psd[peak_index]),
        "nearest_to_0p2_hz": float(frequency[near_index]), "psd_near_0p2_hz": float(psd[near_index]),
        "acceleration_column": "axhd", "unit": "mm/s^2"
    }
    summary_path = output_dir / f"{stem}-summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"plot": str(plot), "processed_csv": str(processed), "spectrum_csv": str(spectrum), "summary": str(summary_path), **summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
