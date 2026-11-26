from pathlib import Path
import csv
import math

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont


SOURCE = Path(r"C:\Users\seguchi\Documents\ChatGPT\研究\frf_identification\results\iwamoto_trial1_eq2_frf.csv")
OUTPUT_DIR = Path(r"C:\Users\seguchi\gitseguchi\quest-vr-test\artifacts\original-negative-frf-fit")


def font(size, bold=False):
    candidates = [
        Path(r"C:\Windows\Fonts\YuGothB.ttc" if bold else r"C:\Windows\Fonts\YuGothR.ttc"),
        Path(r"C:\Windows\Fonts\meiryob.ttc" if bold else r"C:\Windows\Fonts\meiryo.ttc"),
    ]
    return ImageFont.truetype(str(next(p for p in candidates if p.exists())), size)


def panel(draw, box, title, x, series, yscale="linear", fixed_y=None):
    left, top, right, bottom = box
    x0, x1, y0, y1 = left + 78, right - 25, top + 54, bottom - 55
    xmin, xmax = 0.05, 0.70
    values = np.concatenate([np.asarray(v, float) for _, v, _ in series])
    if fixed_y is not None:
        ymin, ymax = fixed_y
    elif yscale == "log":
        positive = values[values > 0]
        ymin = 10 ** math.floor(math.log10(float(np.min(positive))))
        ymax = 10 ** math.ceil(math.log10(float(np.max(positive))))
    else:
        span = max(float(np.max(values) - np.min(values)), 1e-9)
        ymin, ymax = float(np.min(values) - 0.08 * span), float(np.max(values) + 0.08 * span)

    def px(v):
        return x0 + (math.log10(v) - math.log10(xmin)) / (math.log10(xmax) - math.log10(xmin)) * (x1 - x0)

    def py(v):
        if yscale == "log":
            return y1 - (math.log10(max(v, ymin)) - math.log10(ymin)) / (math.log10(ymax) - math.log10(ymin)) * (y1 - y0)
        return y1 - (v - ymin) / (ymax - ymin) * (y1 - y0)

    draw.text((left + 12, top + 8), title, font=font(22, True), fill="#172B4D")
    for xt in [0.05, 0.1, 0.2, 0.4, 0.7]:
        xx = px(xt)
        draw.line((xx, y0, xx, y1), fill="#D8DFE8", width=1)
        label = f"{xt:g}"
        w = draw.textbbox((0, 0), label, font=font(16))[2]
        draw.text((xx - w / 2, y1 + 10), label, font=font(16), fill="#52657A")
    if yscale == "log":
        exponents = range(int(round(math.log10(ymin))), int(round(math.log10(ymax))) + 1)
        yticks = [10.0**e for e in exponents]
    else:
        yticks = np.linspace(ymin, ymax, 5)
    for yt in yticks:
        yy = py(float(yt))
        draw.line((x0, yy, x1, yy), fill="#D8DFE8", width=1)
        label = f"{yt:.0e}" if yscale == "log" else f"{yt:.0f}"
        w = draw.textbbox((0, 0), label, font=font(15))[2]
        draw.text((x0 - w - 10, yy - 9), label, font=font(15), fill="#52657A")
    draw.rectangle((x0, y0, x1, y1), outline="#52657A", width=2)
    draw.text(((x0 + x1) / 2 - 45, y1 + 32), "周波数 (Hz)", font=font(17), fill="#52657A")

    order = np.argsort(x)
    for name, vals, color in series:
        vals = np.asarray(vals)[order]
        xs = np.asarray(x)[order]
        points = [(px(float(xx)), py(float(yy))) for xx, yy in zip(xs, vals)]
        if name == "モデル":
            draw.line(points, fill=color, width=4)
        else:
            draw.line(points, fill=color, width=2)
            for xx, yy in points:
                draw.ellipse((xx - 4, yy - 4, xx + 4, yy + 4), fill=color, outline="white", width=1)


data = pd.read_csv(SOURCE)
frequency = data["frequency_hz"].to_numpy(float)
experimental = data["H_real"].to_numpy(float) + 1j * data["H_imag"].to_numpy(float)
model = data["model_real"].to_numpy(float) + 1j * data["model_imag"].to_numpy(float)
residual = experimental - model
fit_percent = 100.0 * (1.0 - np.linalg.norm(residual) / np.linalg.norm(experimental - np.mean(experimental)))
rmse = float(np.sqrt(np.mean(np.abs(residual) ** 2)))
error_share = 100.0 * np.abs(residual) ** 2 / np.sum(np.abs(residual) ** 2)

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
derived = data.copy()
derived["residual_real"] = residual.real
derived["residual_imag"] = residual.imag
derived["residual_magnitude"] = np.abs(residual)
derived["squared_error_share_percent"] = error_share
derived.to_csv(OUTPUT_DIR / "iwamoto-trial1-eq2-negative-fit.csv", index=False, encoding="utf-8-sig")

W, H = 1700, 1350
img = Image.new("RGB", (W, H), "#FFFFFF")
draw = ImageDraw.Draw(img)
draw.text((65, 35), "元解析のFRF適合：iwamoto 試行1（適合率 −0.27%）", font=font(36, True), fill="#172B4D")
draw.text((65, 91), "eq2重心変位 / VR加速度・24周波数点・試行別等重み複素FRF", font=font(22), fill="#52657A")
draw.text((65, 127), "Tv=0.030 s（探索下限）, γv=0（非負制約境界）, 複素RMSE=5.011 s²", font=font(21), fill="#8A3B12")

legend_y = 166
draw.line((70, legend_y + 10, 118, legend_y + 10), fill="#1F4E79", width=5)
draw.text((130, legend_y - 5), "モデル", font=font(19), fill="#172B4D")
draw.line((250, legend_y + 10, 298, legend_y + 10), fill="#E07A2D", width=3)
draw.ellipse((270, legend_y + 4, 282, legend_y + 16), fill="#E07A2D")
draw.text((310, legend_y - 5), "実験FRF", font=font(19), fill="#172B4D")

boxes = [
    (45, 205, 835, 700), (865, 205, 1655, 700),
    (45, 720, 835, 1215), (865, 720, 1655, 1215),
]
gain_exp, gain_model = np.abs(experimental), np.abs(model)
phase_exp = data["phase_deg"].to_numpy(float)
phase_model = np.unwrap(np.angle(model)) * 180.0 / math.pi
panel(draw, boxes[0], "ゲイン |H| [s²]（対数軸）", frequency,
      [("モデル", gain_model, "#1F4E79"), ("実験", gain_exp, "#E07A2D")], "log")
phase_min = math.floor(min(float(np.min(phase_exp)), float(np.min(phase_model))) / 90) * 90
phase_max = math.ceil(max(float(np.max(phase_exp)), float(np.max(phase_model))) / 90) * 90
panel(draw, boxes[1], "位相 [deg]", frequency,
      [("モデル", phase_model, "#1F4E79"), ("実験", phase_exp, "#E07A2D")], "linear", (phase_min, phase_max))
panel(draw, boxes[2], "複素残差 |Hexp−Hmodel| [s²]（対数軸）", frequency,
      [("残差", np.abs(residual), "#C62828")], "log")
panel(draw, boxes[3], "周波数点ごとの二乗誤差寄与 [%]（対数軸）", frequency,
      [("寄与", np.maximum(error_share, 1e-5), "#C62828")], "log", (1e-4, 100.0))

note = (
    f"適合率 = 100×[1−||Hexp−Hmodel|| / ||Hexp−mean(Hexp)||] = {fit_percent:.3f}%　　"
    f"0.055 Hzだけで総二乗誤差の{error_share[np.argmin(frequency)]:.2f}%を占めます。"
)
draw.rounded_rectangle((65, 1240, W - 65, 1315), radius=16, fill="#FFF1CC", outline="#D59A00", width=2)
draw.text((88, 1262), note, font=font(19), fill="#5F4700")
img.save(OUTPUT_DIR / "iwamoto-trial1-eq2-negative-fit.png")

print(f"fit_percent={fit_percent:.12f}")
print(f"rmse={rmse:.12f}")
print(f"max_error_share_percent={float(np.max(error_share)):.12f}")
