from pathlib import Path
import csv
import json
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont


DATA_DIR = Path(r"C:\Users\seguchi\Desktop\261113")
OUTPUT_DIR = Path(r"C:\Users\seguchi\gitseguchi\quest-vr-test\artifacts\261113-model-error")
FS = 100.0
KP = 10.53
KD = 3.97
TD = 0.155
G = 9.80665


def load_csv(path: Path):
    with path.open("r", encoding="cp932", newline="") as fh:
        rows = list(csv.reader(fh))
    header_index = max(i for i, row in enumerate(rows) if row and row[0] == "" and "xb" in row)
    header = ["time_s" if i == 0 else value for i, value in enumerate(rows[header_index])]
    data = np.asarray([[float(v) for v in row] for row in rows[header_index + 1 :] if row], dtype=float)
    return {name: data[:, i] for i, name in enumerate(header)}


K1 = math.log(0.1 / 0.7) / 30.0
CYCLES1 = 0.7 * math.expm1(K1 * 30.0) / K1


def frequency_phase(tau):
    tau = np.asarray(tau, dtype=float)
    f = 0.7 * np.exp(K1 * tau)
    phase = 2 * math.pi * 0.7 * np.expm1(K1 * tau) / K1
    return f, phase


def coefficients(height_m):
    a_over_m = 0.0425 * height_m / 0.531 + 0.978 * 0.531 * height_m
    return 0.978 * G / a_over_m


def model_unit_frf(freq, height_m, tv):
    s = 1j * 2 * math.pi * np.asarray(freq)
    e = np.exp(-TD * s)
    a = coefficients(height_m)
    d = s * s - a + (KP + KD * s) * e
    return -(KP * e) / ((1.0 + tv * s) * d)


TARGET_F = np.asarray([0.62, 0.52, 0.43, 0.36, 0.30, 0.25, 0.21, 0.18, 0.15, 0.13, 0.115])
TARGET_TAU = np.log(TARGET_F / 0.7) / K1


def estimate_local_frf(time, y, onset):
    hs, r2s, used_f = [], [], []
    for fc, tau_c in zip(TARGET_F, TARGET_TAU):
        center = onset + tau_c
        full_window = min(16.0, max(8.0, 3.0 / fc))
        lo = max(onset, center - full_window / 2)
        hi = min(onset + 30.0, center + full_window / 2)
        mask = (time >= lo) & (time <= hi)
        if mask.sum() < 300:
            continue
        tau = time[mask] - onset
        f, phase = frequency_phase(tau)
        amplitude = 0.1 * 2 * math.pi * f
        u = amplitude * np.cos(phase)
        q = amplitude * np.sin(phase)
        local_t = time[mask] - center
        X = np.column_stack([u, q, np.ones(mask.sum()), local_t, local_t**2])
        beta, *_ = np.linalg.lstsq(X, y[mask], rcond=None)
        fitted = X @ beta
        resid = y[mask] - fitted
        baseline = y[mask] - np.polyval(np.polyfit(local_t, y[mask], 2), local_t)
        denom = float(np.dot(baseline, baseline))
        r2 = max(0.0, 1.0 - float(np.dot(resid, resid)) / denom) if denom > 0 else 0.0
        hs.append(complex(beta[0], -beta[1]))
        r2s.append(r2)
        used_f.append(fc)
    return np.asarray(used_f), np.asarray(hs), np.asarray(r2s)


def fit_file(path, height):
    d = load_csv(path)
    time = d["time_s"]
    y = d["xb"] * 1e-3
    tv_grid = np.geomspace(0.02, 20.0, 240)
    best = None
    for onset in np.arange(0.0, 12.0001, 0.05):
        freq, h, r2 = estimate_local_frf(time, y, onset)
        # Retain every point but down-weight weak local lock-in estimates.
        weights = 0.05 + r2
        for tv in tv_grid:
            unit = model_unit_frf(freq, height, tv)
            for polarity in (-1.0, 1.0):
                basis = polarity * unit
                denominator = float(np.sum(weights * np.abs(basis) ** 2))
                gamma = max(0.0, float(np.real(np.sum(weights * np.conj(basis) * h)) / denominator))
                residual = h - gamma * basis
                objective = float(np.sum(weights * np.abs(residual) ** 2) / np.sum(weights * np.abs(h) ** 2))
                if best is None or objective < best["objective"]:
                    best = {
                        "objective": objective,
                        "onset_s": float(onset),
                        "tv_s": float(tv),
                        "gamma_s2": gamma,
                        "polarity": int(polarity),
                        "mean_local_r2": float(np.mean(r2)),
                        "frequencies_hz": freq.tolist(),
                        "local_r2": r2.tolist(),
                        "experimental_real": h.real.tolist(),
                        "experimental_imag": h.imag.tolist(),
                    }
    freq = np.asarray(best["frequencies_hz"])
    h = np.asarray(best["experimental_real"]) + 1j * np.asarray(best["experimental_imag"])
    model = best["polarity"] * best["gamma_s2"] * model_unit_frf(freq, height, best["tv_s"])
    residual = h - model
    best["model_real"] = model.real.tolist()
    best["model_imag"] = model.imag.tolist()
    best["error_magnitude_m_per_m_s2"] = np.abs(residual).tolist()
    best["normalized_fit_percent"] = 100.0 * (1.0 - math.sqrt(best["objective"]))
    return best


def font(size, bold=False):
    candidates = [
        Path(r"C:\Windows\Fonts\YuGothB.ttc" if bold else r"C:\Windows\Fonts\YuGothR.ttc"),
        Path(r"C:\Windows\Fonts\meiryob.ttc" if bold else r"C:\Windows\Fonts\meiryo.ttc"),
        Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"),
    ]
    chosen = next((p for p in candidates if p.exists()), candidates[-1])
    return ImageFont.truetype(str(chosen), size=size)


def draw_subplot(draw, box, x, series, title, log_x=True, phase=False):
    left, top, right, bottom = box
    pad_l, pad_r, pad_t, pad_b = 72, 20, 42, 54
    x0, x1 = left + pad_l, right - pad_r
    y0, y1 = top + pad_t, bottom - pad_b
    all_y = np.concatenate([np.asarray(values, dtype=float) for _, values, _ in series])
    if phase:
        ymin, ymax = -180.0, 180.0
    else:
        ymax = max(float(np.nanmax(all_y)) * 1.12, 1e-6)
        ymin = 0.0
    xmin, xmax = 0.1, 0.7

    def px(value):
        if log_x:
            return x0 + (math.log10(value) - math.log10(xmin)) / (math.log10(xmax) - math.log10(xmin)) * (x1 - x0)
        return x0 + (value - xmin) / (xmax - xmin) * (x1 - x0)

    def py(value):
        return y1 - (value - ymin) / (ymax - ymin) * (y1 - y0)

    grid = "#D7DEE8"
    axis = "#44546A"
    for tick in [0.1, 0.2, 0.3, 0.5, 0.7]:
        xx = px(tick)
        draw.line((xx, y0, xx, y1), fill=grid, width=1)
        label = f"{tick:g}"
        w = draw.textbbox((0, 0), label, font=font(18))[2]
        draw.text((xx - w / 2, y1 + 10), label, font=font(18), fill=axis)
    yticks = np.linspace(ymin, ymax, 5)
    for tick in yticks:
        yy = py(float(tick))
        draw.line((x0, yy, x1, yy), fill=grid, width=1)
        label = f"{tick:.0f}" if phase else f"{tick:.1f}"
        w = draw.textbbox((0, 0), label, font=font(17))[2]
        draw.text((x0 - w - 10, yy - 10), label, font=font(17), fill=axis)
    draw.rectangle((x0, y0, x1, y1), outline=axis, width=2)
    draw.text((left + 8, top + 5), title, font=font(19, bold=True), fill="#172B4D")
    draw.text((x0 + (x1 - x0) / 2 - 48, y1 + 31), "周波数 (Hz)", font=font(18), fill=axis)

    for name, values, color in series:
        order = np.argsort(x)
        xs = np.asarray(x)[order]
        ys = np.asarray(values)[order]
        points = [(px(float(xx)), py(float(yy))) for xx, yy in zip(xs, ys)]
        if name == "モデル":
            segment = []
            for point, yy in zip(points, ys):
                if phase and segment and abs(yy - segment[-1][1]) > 180:
                    if len(segment) > 1:
                        draw.line([(p[0], py(p[1])) for p in segment], fill=color, width=4)
                    segment = []
                segment.append((point[0], float(yy)))
            if len(segment) > 1:
                draw.line([(p[0], py(p[1])) for p in segment], fill=color, width=4)
        else:
            radius = 3 if len(points) > 30 else 5
            for xx, yy in points:
                draw.ellipse((xx - radius, yy - radius, xx + radius, yy + radius), fill=color, outline="white", width=1)


def make_figure(results, output_path):
    width, height = 1900, 2180
    image = Image.new("RGB", (width, height), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    point_count = len(next(iter(results.values()))["frequencies_hz"])
    draw.text((70, 38), f"VR前後スイープ：モデルFRFと実測FRFの誤差（{point_count}周波数点）", font=font(38, bold=True), fill="#172B4D")
    draw.text((70, 92), "入力：再生成したVR刺激加速度　出力：AP方向重心変位 xb", font=font(23), fill="#44546A")
    draw.line((70, 136, width - 70, 136), fill="#C5CEDA", width=2)
    legend_y = 152
    draw.line((75, legend_y + 10, 120, legend_y + 10), fill="#1F4E79", width=5)
    draw.text((132, legend_y - 4), "モデル", font=font(20), fill="#172B4D")
    draw.ellipse((245, legend_y + 4, 257, legend_y + 16), fill="#E07A2D")
    draw.text((270, legend_y - 4), "実測", font=font(20), fill="#172B4D")
    draw.ellipse((370, legend_y + 4, 382, legend_y + 16), fill="#C62828")
    draw.text((395, legend_y - 4), "複素FRF誤差", font=font(20), fill="#172B4D")

    names = list(results)
    row_top = 205
    row_height = 430
    col_width = (width - 110) / 3
    for row, name in enumerate(names):
        r = results[name]
        freq = np.asarray(r["frequencies_hz"])
        exp = np.asarray(r["experimental_real"]) + 1j * np.asarray(r["experimental_imag"])
        model = np.asarray(r["model_real"]) + 1j * np.asarray(r["model_imag"])
        error = np.abs(exp - model)
        gain_exp = np.abs(exp) * 1000.0
        gain_model = np.abs(model) * 1000.0
        phase_exp = np.angle(exp, deg=True)
        phase_model = np.angle(model, deg=True)
        error_mm = error * 1000.0
        subject = "iwamoto" if "iwamoto" in name else "大坪"
        trial = "1" if "00001" in name else "2"
        tv_label = f"{r['tv_s']:.3g} s" + ("（上限）" if r["tv_s"] >= 19.99 else "")
        row_title = f"{subject} 試行{trial}　Tv={tv_label}, γv={r['gamma_s2']:.4g} s², FRF適合度={r['normalized_fit_percent']:.1f}%"
        top = row_top + row * row_height
        draw.text((70, top - 4), row_title, font=font(23, bold=True), fill="#172B4D")
        boxes = []
        for col in range(3):
            left = 35 + col * col_width
            boxes.append((left, top + 35, left + col_width - 15, top + row_height - 10))
        draw_subplot(draw, boxes[0], freq,
                     [("モデル", gain_model, "#1F4E79"), ("実測", gain_exp, "#E07A2D")],
                     "ゲイン [mm/(m/s²)]")
        draw_subplot(draw, boxes[1], freq,
                     [("モデル", phase_model, "#1F4E79"), ("実測", phase_exp, "#E07A2D")],
                     "位相 [deg]", phase=True)
        draw_subplot(draw, boxes[2], freq,
                     [("誤差", error_mm, "#C62828")],
                     "複素FRF誤差 [mm/(m/s²)]")

    note_y = row_top + len(names) * row_height + 5
    draw.rounded_rectangle((70, note_y, width - 70, height - 45), radius=18, fill="#FFF5D6", outline="#D6A21F", width=2)
    mean_r2_values = [r["mean_local_r2"] for r in results.values()]
    notes = [
        "注意：VR加速度は計測CSVに含まれないため、実験時の公開版 commit 44a6819 のスイープ式から再生成しました。",
        "CSVには0.1 Hzハイパスが設定されています。0.05～0.1 Hzは同定から除外し、0.115～0.62 Hzのみを表示しています。",
        "刺激開始時刻はFRF残差が最小となるよう試行別に推定しています。同期ログが得られれば再解析が必要です。",
        f"実測点の局所ロックイン適合度は試行平均{min(mean_r2_values):.2f}～{max(mean_r2_values):.2f}です。",
        f"{point_count}点は窓が重なる連続推定値であり、独立な{point_count}観測ではありません。",
    ]
    for i, line in enumerate(notes):
        draw.text((95, note_y + 20 + i * 34), line, font=font(20), fill="#604B00")
    image.save(output_path, quality=95)


def write_outputs(results):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUTPUT_DIR / "fit-results.json").open("w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)
    with (OUTPUT_DIR / "fit-summary.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["file", "subject", "trial", "height_m", "onset_s", "Tv_s", "gamma_v_s2", "axis_polarity", "frf_fit_percent", "mean_local_lockin_R2"])
        for name, r in results.items():
            subject = "iwamoto" if "iwamoto" in name else "otsubo"
            writer.writerow([name, subject, 1 if "00001" in name else 2, 1.70 if subject == "iwamoto" else 1.78,
                             r["onset_s"], r["tv_s"], r["gamma_s2"], r["polarity"], r["normalized_fit_percent"], r["mean_local_r2"]])
    with (OUTPUT_DIR / "frf-comparison.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["file", "frequency_hz", "experimental_real_m_per_m_s2", "experimental_imag_m_per_m_s2",
                         "experimental_gain_mm_per_m_s2", "experimental_phase_deg", "model_real_m_per_m_s2",
                         "model_imag_m_per_m_s2", "model_gain_mm_per_m_s2", "model_phase_deg",
                         "complex_error_mm_per_m_s2", "local_lockin_R2"])
        for name, r in results.items():
            for i, f in enumerate(r["frequencies_hz"]):
                exp = complex(r["experimental_real"][i], r["experimental_imag"][i])
                model = complex(r["model_real"][i], r["model_imag"][i])
                writer.writerow([name, f, exp.real, exp.imag, abs(exp) * 1000, math.degrees(math.atan2(exp.imag, exp.real)),
                                 model.real, model.imag, abs(model) * 1000, math.degrees(math.atan2(model.imag, model.real)),
                                 abs(exp - model) * 1000, r["local_r2"][i]])
    make_figure(results, OUTPUT_DIR / "model-vs-measured-frf-error.png")


if __name__ == "__main__":
    results = {}
    for path in sorted(DATA_DIR.glob("*.csv")):
        height = 1.70 if "iwamoto" in path.name else 1.78
        results[path.name] = fit_file(path, height)
        print(path.name, {k: v for k, v in results[path.name].items() if not isinstance(v, list)}, flush=True)
    write_outputs(results)
    print(json.dumps({"output_dir": str(OUTPUT_DIR)}, ensure_ascii=False))
