"""Overlay measured AP COM with the time response of the original FRF model.

This is intentionally a display/validation export: it uses the published
per-trial FRF-identification parameters without any additional time-domain
scale, offset, or residual fitting.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"C:\Users\seguchi\Documents\ChatGPT\研究")
sys.path.insert(0, str(ROOT / "analysis_vr_fb"))
import analyze_vr_feedback as base

FRF_ROOT = ROOT / "frf_identification"
OUT = Path(r"C:\Users\seguchi\gitseguchi\quest-vr-test\artifacts\ap-com-time-overlays")
KP, KD, TD = 10.53, 3.97, 0.155


def normalized_body(height_m: float) -> tuple[float, float]:
    """Return a, b in x¨ = a*x - ... - b*X¨s (paper Eq. 1)."""
    mb_over_m = 0.978
    jb_over_m = 0.0425 * height_m**2
    lb = 0.531 * height_m
    inertia_over_m = jb_over_m / lb + mb_over_m * lb
    return mb_over_m * 9.80665 / inertia_over_m, mb_over_m * lb / inertia_over_m


def detrend_linear(x: np.ndarray, t: np.ndarray) -> np.ndarray:
    slope, intercept = np.polyfit(t, x, 1)
    return x - (slope * t + intercept)


def delay_value(values: np.ndarray, sample_position: float, current_i: int) -> float:
    if sample_position <= 0.0:
        return 0.0
    lower = int(math.floor(sample_position))
    frac = sample_position - lower
    if lower >= current_i:
        return float(values[current_i])
    return float(values[lower] * (1.0 - frac) + values[lower + 1] * frac)


def simulate_original_model(velocity: np.ndarray, acceleration: np.ndarray, dt: float,
                            tv_s: float, gamma_s: float, a: float, b: float) -> np.ndarray:
    """Causal integration of Eqs. (1)--(3), equivalent to analyze_frf.model_frf.

    xbar_dot = (-xbar - gamma * velocity) / Tv;
    x_ddot = a*x - Kp*(x_delay-xbar_delay) - Kd*xdot_delay - b*acceleration.
    """
    x = np.zeros(len(velocity))
    xd = np.zeros(len(velocity))
    xbar = np.zeros(len(velocity))
    alpha = math.exp(-dt / tv_s)
    delay_samples = TD / dt
    for i in range(len(velocity) - 1):
        delayed_i = i - delay_samples
        xq = delay_value(x, delayed_i, i)
        vdq = delay_value(xd, delayed_i, i)
        bq = delay_value(xbar, delayed_i, i)
        acc_1 = a * x[i] - KP * (xq - bq) - KD * vdq - b * acceleration[i]
        xp = x[i] + dt * xd[i]
        vp = xd[i] + dt * acc_1
        acc_2 = a * xp - KP * (xq - bq) - KD * vdq - b * acceleration[i + 1]
        x[i + 1] = x[i] + 0.5 * dt * (xd[i] + vp)
        xd[i + 1] = xd[i] + 0.5 * dt * (acc_1 + acc_2)
        mean_velocity = 0.5 * (velocity[i] + velocity[i + 1])
        xbar[i + 1] = alpha * xbar[i] - gamma_s * (1.0 - alpha) * mean_velocity
    return x


def font(size: int, bold: bool = False):
    candidates = [
        r"C:\Windows\Fonts\YuGothB.ttc" if bold else r"C:\Windows\Fonts\YuGothR.ttc",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def make_figure(rows: list[dict], target: Path):
    width, height = 1800, 1260
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    title_font, text_font, small_font = font(30, True), font(21), font(18)
    draw.text((80, 28), "AP重心変位：実測とモデルの重ね合わせ", fill="#202020", font=title_font)
    draw.text((80, 72), "試行別FRF同定パラメータをそのまま適用（追加の時系列フィットなし）", fill="#404040", font=text_font)
    colors = {"measured": "#D55E00", "model": "#1F4E79", "axis": "#303030", "grid": "#D9D9D9"}
    panel_w, panel_h = 790, 500
    panels = [(80, 140), (930, 140), (80, 700), (930, 700)]
    for panel, row in zip(panels, rows):
        x0, y0 = panel; left, right, top, bottom = x0 + 88, x0 + panel_w - 25, y0 + 62, y0 + panel_h - 65
        t, observed, model = row["time"], row["observed"] * 1000, row["model"] * 1000
        all_y = np.r_[observed, model]
        maximum = float(np.nanmax(np.abs(all_y)))
        maximum = max(maximum * 1.12, 1.0)
        draw.text((x0, y0), f'{row["label"]}  (Tv={row["tv"]:.3g} s, γ={row["gamma"]:.3g} s)', fill="#202020", font=text_font)
        def px(tt): return left + (float(tt) / 90.0) * (right - left)
        def py(yy): return bottom - ((float(yy) + maximum) / (2 * maximum)) * (bottom - top)
        for tick in range(0, 91, 15):
            xx = px(tick); draw.line((xx, top, xx, bottom), fill=colors["grid"], width=1)
            draw.text((xx - 8, bottom + 10), str(tick), fill="#333333", font=small_font)
        for fraction in [-1, -0.5, 0, 0.5, 1]:
            value = fraction * maximum; yy = py(value)
            draw.line((left, yy, right, yy), fill=colors["grid"] if fraction else "#969696", width=1)
            draw.text((left - 14, yy - 10), f"{value:.0f}", fill="#333333", font=small_font, anchor="ra")
        draw.line((left, top, left, bottom), fill=colors["axis"], width=2); draw.line((left, bottom, right, bottom), fill=colors["axis"], width=2)
        step = max(1, len(t) // 2200)
        for series, color in ((observed, colors["measured"]), (model, colors["model"])):
            points = [(px(tt), py(yy)) for tt, yy in zip(t[::step], series[::step])]
            draw.line(points, fill=color, width=2)
        draw.text(((left + right) // 2, bottom + 38), "時間 (s)", fill="#333333", font=small_font, anchor="ma")
    draw.line((1290, 88, 1330, 88), fill=colors["measured"], width=4); draw.text((1340, 76), "実測（Eq. 2）", fill="#333333", font=small_font)
    draw.line((1510, 88, 1550, 88), fill=colors["model"], width=4); draw.text((1560, 76), "モデル", fill="#333333", font=small_font)
    image.save(target)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    parameters = pd.read_csv(FRF_ROOT / "results" / "eq2_trial_parameters.csv")
    runs = base.read_vr_runs(base.VR_LOG)
    display_rows, csv_rows = [], []
    for file_name, run_id in base.RUN_MAP.items():
        subject = "iwamoto" if "iwamoto" in file_name else "otsubo"
        trial = 1 if file_name.endswith("00001.csv") else 2
        parameter = parameters[(parameters.subject == subject) & (parameters.trial == trial)].iloc[0]
        meta, force = base.read_force_csv(base.FORCE_DIR / file_name)
        t = force.time_s.to_numpy(float)
        dt = float(np.median(np.diff(t)))
        velocity, _ = base.interp_input(runs[run_id], t)
        acceleration = detrend_linear(np.gradient(velocity, dt, edge_order=2), t)
        body = base.body_parameters(float(meta["身長(cm)"]), float(meta["体重(kg)"]))
        _, observed_raw, _ = base.estimate_com(force, body)
        observed = detrend_linear(observed_raw, t)
        a, b = normalized_body(float(meta["身長(cm)"]) / 100)
        model = simulate_original_model(velocity, acceleration, dt, float(parameter.Tv_s), float(parameter.gamma_s), a, b)
        label = f"{subject.capitalize()} 試行{trial}"
        display_rows.append({"label": label, "time": t, "observed": observed, "model": model,
                             "tv": float(parameter.Tv_s), "gamma": float(parameter.gamma_s)})
        csv_rows.append(pd.DataFrame({"subject": subject, "trial": trial, "file": file_name,
                                     "time_s": t, "ap_com_measured_eq2_m": observed,
                                     "ap_com_model_m": model, "vr_velocity_m_s": velocity,
                                     "vr_acceleration_m_s2": acceleration,
                                     "Tv_s": float(parameter.Tv_s), "gamma_s": float(parameter.gamma_s)}))
    pd.concat(csv_rows, ignore_index=True).to_csv(OUT / "ap-com-measured-and-model.csv", index=False)
    make_figure(display_rows, OUT / "ap-com-measured-and-model.png")


if __name__ == "__main__":
    main()
