"""Analyze a 20 s IMU acceleration segment after skipping the first 5 s."""
from pathlib import Path
import csv
import json
import math
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))

import numpy as np
from PIL import Image, ImageDraw, ImageFont


SKIP_S = 5.0
DURATION_S = 20.0
CUTOFF_HZ = 10.0
FIR_TAPS = 101


def read_ags(path):
    rows = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.reader(handle):
            if len(row) >= 5 and row[0] == "ags":
                rows.append([float(row[1]), float(row[2]), float(row[3]), float(row[4])])
    data = np.asarray(rows, dtype=float)
    if len(data) < 10:
        raise ValueError("AGS acceleration rows are missing")
    return data


def lowpass_fir(signal, fs, cutoff, taps=101):
    # Linear-phase Hamming-windowed sinc. Symmetry gives zero phase after centered convolution.
    n = np.arange(taps) - (taps - 1) / 2
    fc = cutoff / fs
    kernel = 2 * fc * np.sinc(2 * fc * n) * np.hamming(taps)
    kernel /= kernel.sum()
    pad = taps // 2
    padded = np.pad(signal, ((pad, pad), (0, 0)), mode="reflect")
    return np.column_stack([np.convolve(padded[:, i], kernel, mode="valid") for i in range(signal.shape[1])])


def welch(signal, fs, nperseg=1024):
    nperseg = min(nperseg, len(signal))
    step = nperseg // 2
    window = np.hanning(nperseg)
    scale = fs * np.sum(window ** 2)
    spectra = []
    x = np.arange(nperseg)
    for start in range(0, len(signal) - nperseg + 1, step):
        block = signal[start:start + nperseg]
        # Remove a separate linear trend from each axis before each periodogram.
        for axis in range(block.shape[1]):
            slope, intercept = np.polyfit(x, block[:, axis], 1)
            block[:, axis] -= slope * x + intercept
        fft = np.fft.rfft(block * window[:, None], axis=0)
        psd = np.abs(fft) ** 2 / scale
        if nperseg % 2 == 0:
            psd[1:-1] *= 2
        else:
            psd[1:] *= 2
        spectra.append(psd)
    return np.fft.rfftfreq(nperseg, 1 / fs), np.mean(spectra, axis=0)


def font(size):
    path = Path(r"C:\Windows\Fonts\arial.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def plot(path, t, dynamic, freq, psd, peaks):
    width, height = 1500, 950
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    colors = [(27, 113, 166), (207, 61, 70), (43, 139, 104)]
    labels = ["X", "Y", "Z"]
    title_font, axis_font, small_font = font(28), font(20), font(16)
    draw.text((65, 25), "Head IMU acceleration: filtered time series and Welch PSD", font=title_font, fill=(20, 30, 38))

    def panel(box, xvals, series, log_y=False, x_max=None, y_label=""):
        l, top, r, bottom = box
        draw.rectangle(box, outline=(175, 188, 196), width=2)
        if x_max is None: x_max = float(xvals[-1])
        mask = xvals <= x_max
        xv = xvals[mask]
        ys = [s[mask] for s in series]
        if log_y:
            ys = [np.log10(np.maximum(s, 1e-12)) for s in ys]
        lo = min(float(s.min()) for s in ys); hi = max(float(s.max()) for s in ys)
        if hi == lo: hi = lo + 1
        for i in range(5):
            yy = top + i * (bottom-top) / 4
            draw.line((l, yy, r, yy), fill=(226, 232, 236), width=1)
            value = hi - i*(hi-lo)/4
            text = f"{10**value:.2g}" if log_y else f"{value:.0f}"
            draw.text((4, yy-8), text, font=small_font, fill=(86, 99, 109))
        for sec in np.linspace(0, x_max, 6):
            xx = l + sec/x_max*(r-l)
            draw.line((xx, top, xx, bottom), fill=(238, 242, 244), width=1)
            draw.text((xx-12, bottom+8), f"{sec:g}", font=small_font, fill=(86, 99, 109))
        for values, color in zip(ys, colors):
            pts=[]
            for xx0, yy0 in zip(xv, values):
                xx=l+float(xx0)/x_max*(r-l); yy=bottom-(float(yy0)-lo)/(hi-lo)*(bottom-top)
                pts.append((xx,yy))
            draw.line(pts, fill=color, width=2)
        draw.text((l+8, top+8), y_label, font=axis_font, fill=(35, 46, 54))

    panel((75, 95, 1440, 455), t, [dynamic[:,0], dynamic[:,1], dynamic[:,2]], y_label="Filtered acceleration change from mean (cutoff 10 Hz)")
    panel((75, 550, 1440, 880), freq, [psd[:,0], psd[:,1], psd[:,2]], log_y=True, x_max=10, y_label="Power spectral density (log scale), 0-10 Hz")
    x0=950
    for i,(label,color) in enumerate(zip(labels,colors)):
        y=38+i*0
        draw.line((x0+i*145, 43, x0+25+i*145, 43), fill=color, width=5)
        draw.text((x0+32+i*145, 32), f"{label}: peak {peaks[label]['frequency_hz']:.3f} Hz", font=small_font, fill=(40,50,58))
    draw.text((650, 915), "Time after retained segment start (s) / Frequency (Hz)", font=axis_font, fill=(55, 66, 74))
    image.save(path)


def plot_forward(path, t, dynamic_z, freq, psd_z, peak, marker_hz=0.2):
    width, height = 1500, 850
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    blue = (27, 113, 166)
    title_font, axis_font, small_font = font(28), font(20), font(16)
    draw.text((65, 25), "Head IMU: assumed forward/back acceleration (Z axis)", font=title_font, fill=(20, 30, 38))
    draw.text((65, 63), "First 5 s removed; next 20 s; zero-phase 10 Hz low-pass", font=small_font, fill=(70, 82, 91))

    def panel(box, xvals, values, x_max, log_y, label):
        l, top, r, bottom = box
        draw.rectangle(box, outline=(175, 188, 196), width=2)
        mask = xvals <= x_max
        xv, yv = xvals[mask], values[mask]
        if log_y:
            yv = np.log10(np.maximum(yv, 1e-12))
        lo, hi = float(yv.min()), float(yv.max())
        if hi == lo:
            hi = lo + 1
        for i in range(5):
            yy = top + i * (bottom-top) / 4
            draw.line((l, yy, r, yy), fill=(226, 232, 236), width=1)
            value = hi - i*(hi-lo)/4
            text = f"{10**value:.2g}" if log_y else f"{value:.0f}"
            draw.text((4, yy-8), text, font=small_font, fill=(86, 99, 109))
        for value in np.linspace(0, x_max, 6):
            xx = l + value/x_max*(r-l)
            draw.line((xx, top, xx, bottom), fill=(238, 242, 244), width=1)
            draw.text((xx-12, bottom+8), f"{value:g}", font=small_font, fill=(86, 99, 109))
        points = [(l+float(x)/x_max*(r-l), bottom-(float(y)-lo)/(hi-lo)*(bottom-top)) for x, y in zip(xv, yv)]
        draw.line(points, fill=blue, width=2)
        draw.text((l+8, top+8), label, font=axis_font, fill=(35, 46, 54))

    panel((75, 110, 1440, 400), t, dynamic_z, float(t[-1]), False, "Forward/back acceleration change from mean (raw units)")
    panel((75, 505, 1440, 785), freq, psd_z, 10, True, f"Welch PSD, 0-10 Hz; dominant peak {peak['frequency_hz']:.3f} Hz")
    marker_x = 75 + marker_hz / 10 * (1440 - 75)
    draw.line((marker_x, 505, marker_x, 785), fill=(220, 45, 45), width=4)
    draw.text((marker_x + 8, 750), f"{marker_hz:g} Hz", font=small_font, fill=(220, 45, 45))
    image.save(path)


def main():
    source = Path(sys.argv[1])
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "artifacts"
    marker_hz = float(sys.argv[3]) if len(sys.argv) > 3 else 0.2
    output_dir.mkdir(parents=True, exist_ok=True)
    data = read_ags(source)
    time_ms, acceleration = data[:, 0], data[:, 1:4]
    fs = 1000 / np.median(np.diff(time_ms))
    elapsed = (time_ms - time_ms[0]) / 1000
    keep = (elapsed >= SKIP_S) & (elapsed < SKIP_S + DURATION_S)
    retained_t = elapsed[keep] - SKIP_S
    raw = acceleration[keep]
    if retained_t[-1] < DURATION_S - 1/fs - .02:
        raise ValueError("Recording is shorter than the requested 25 seconds")
    filtered = lowpass_fir(raw, fs, CUTOFF_HZ, FIR_TAPS)
    dynamic = filtered - np.mean(filtered, axis=0)
    frequency, psd = welch(filtered.copy(), fs)
    axes = ["X", "Y", "Z"]
    peaks = {}
    band = (frequency >= .05) & (frequency <= CUTOFF_HZ)
    for i, axis in enumerate(axes):
        k = np.flatnonzero(band)[np.argmax(psd[band, i])]
        peaks[axis] = {"frequency_hz": float(frequency[k]), "psd_raw2_per_hz": float(psd[k, i])}

    stem = source.stem + "-skip5s-next20s-lowpass10hz"
    csv_path = output_dir / f"{stem}.csv"
    with csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["recording_elapsed_s","analysis_elapsed_s","accel_x_raw","accel_y_raw","accel_z_raw","accel_x_filtered_10hz","accel_y_filtered_10hz","accel_z_filtered_10hz","accel_x_dynamic_10hz","accel_y_dynamic_10hz","accel_z_dynamic_10hz"])
        for row in zip(elapsed[keep], retained_t, raw[:,0],raw[:,1],raw[:,2],filtered[:,0],filtered[:,1],filtered[:,2],dynamic[:,0],dynamic[:,1],dynamic[:,2]):
            writer.writerow([f"{row[0]:.3f}",f"{row[1]:.3f}",*[f"{v:.6f}" for v in row[2:]]])
    spectrum_path = output_dir / f"{stem}-welch-psd.csv"
    with spectrum_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer=csv.writer(handle);writer.writerow(["frequency_hz","psd_x_raw2_per_hz","psd_y_raw2_per_hz","psd_z_raw2_per_hz"])
        for row in zip(frequency[frequency <= CUTOFF_HZ],psd[frequency <= CUTOFF_HZ,0],psd[frequency <= CUTOFF_HZ,1],psd[frequency <= CUTOFF_HZ,2]):writer.writerow([f"{row[0]:.9f}",*[f"{v:.9g}" for v in row[1:]]])
    plot_path = output_dir / f"{stem}.png"
    plot(plot_path, retained_t, dynamic, frequency, psd, peaks)
    forward_csv_path = output_dir / f"{stem}-forward-back-z.csv"
    with forward_csv_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["recording_elapsed_s","analysis_elapsed_s","accel_forward_back_raw_assumed_z","accel_forward_back_filtered_10hz","accel_forward_back_dynamic_10hz"])
        for row in zip(elapsed[keep], retained_t, raw[:,2], filtered[:,2], dynamic[:,2]):
            writer.writerow([f"{row[0]:.3f}", f"{row[1]:.3f}", *[f"{v:.6f}" for v in row[2:]]])
    forward_spectrum_path = output_dir / f"{stem}-forward-back-z-welch-psd.csv"
    frequency_band = frequency <= CUTOFF_HZ
    with forward_spectrum_path.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        writer.writerow(["frequency_hz", "forward_back_z_psd_raw2_per_hz"])
        for f, value in zip(frequency[frequency_band], psd[frequency_band,2]):
            writer.writerow([f"{f:.9f}", f"{value:.9g}"])
    marker_tag = str(marker_hz).replace(".", "p")
    forward_plot_path = output_dir / f"{stem}-forward-back-z-marker-{marker_tag}hz.png"
    plot_forward(forward_plot_path, retained_t, dynamic[:,2], frequency, psd[:,2], peaks["Z"], marker_hz)
    marker_index = int(np.argmin(np.abs(frequency - marker_hz)))
    summary = {"source":str(source),"sampling_rate_hz":fs,"source_rows":len(data),"source_duration_s":float(elapsed[-1]),"skip_s":SKIP_S,"retained_duration_s":DURATION_S,"retained_rows":len(raw),"filter":{"type":"zero-phase centered FIR, Hamming-windowed sinc","cutoff_hz":CUTOFF_HZ,"taps":FIR_TAPS},"spectral_analysis":{"method":"Welch PSD","nperseg":min(1024,len(raw)),"overlap_percent":50,"linear_detrend_per_segment":True,"frequency_resolution_hz":float(frequency[1]-frequency[0])},"marker":{"requested_hz":marker_hz,"nearest_bin_hz":float(frequency[marker_index]),"forward_back_z_psd_raw2_per_hz":float(psd[marker_index,2])},"dominant_peaks_0p05_to_10_hz":peaks}
    summary_path=output_dir/f"{stem}-summary.json";summary_path.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"processed_csv":str(csv_path),"spectrum_csv":str(spectrum_path),"plot":str(plot_path),"forward_back_csv":str(forward_csv_path),"forward_back_spectrum_csv":str(forward_spectrum_path),"forward_back_plot":str(forward_plot_path),"summary":str(summary_path),**summary},ensure_ascii=False))


if __name__ == "__main__":
    main()
