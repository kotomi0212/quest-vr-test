from pathlib import Path
import csv
import json
import math
import numpy as np


DATA_DIR = Path(r"C:\Users\seguchi\Desktop\261113")
FS = 100.0
DT = 1.0 / FS
NFFT = 32768
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


def sweep_state(t):
    t = np.asarray(t, dtype=float)
    frequency = np.zeros_like(t)
    phase = np.zeros_like(t)
    valid = (t >= 0.0) & (t <= 100.0)
    first = valid & (t <= 30.0)
    k1 = math.log(0.1 / 0.7) / 30.0
    frequency[first] = 0.7 * np.exp(k1 * t[first])
    phase[first] = 2 * math.pi * 0.7 * np.expm1(k1 * t[first]) / k1
    cycles1 = 0.7 * math.expm1(k1 * 30.0) / k1
    second = valid & (t > 30.0)
    tau = t[second] - 30.0
    k2 = math.log(0.05 / 0.1) / 70.0
    frequency[second] = 0.1 * np.exp(k2 * tau)
    phase[second] = 2 * math.pi * (cycles1 + 0.1 * np.expm1(k2 * tau) / k2)
    accel = np.zeros_like(t)
    accel[valid] = 0.1 * 2 * math.pi * frequency[valid] * np.cos(phase[valid])
    return frequency, phase, accel


def smooth_bandpass(x, lo0=0.08, lo1=0.10, hi1=0.70, hi0=0.80):
    x = np.asarray(x, dtype=float)
    n = len(x)
    nfft = 1 << int(math.ceil(math.log2(max(n, 2))))
    f = np.fft.rfftfreq(nfft, DT)
    w = np.zeros_like(f)
    mid = (f >= lo1) & (f <= hi1)
    w[mid] = 1.0
    low = (f > lo0) & (f < lo1)
    w[low] = 0.5 - 0.5 * np.cos(math.pi * (f[low] - lo0) / (lo1 - lo0))
    high = (f > hi1) & (f < hi0)
    w[high] = 0.5 + 0.5 * np.cos(math.pi * (f[high] - hi1) / (hi0 - hi1))
    return np.fft.irfft(np.fft.rfft(x, nfft) * w, nfft)[:n]


def coefficients(height_m):
    a_over_m = 0.0425 * height_m / 0.531 + 0.978 * 0.531 * height_m
    return 0.978 * G / a_over_m, (0.978 * 0.531 * height_m) / a_over_m


def model_components(height_m, tv_values):
    t = np.arange(NFFT) * DT
    _, _, u = sweep_state(t)
    U = np.fft.rfft(u)
    f = np.fft.rfftfreq(NFFT, DT)
    s = 1j * 2 * math.pi * f
    delay = np.exp(-TD * s)
    a, _ = coefficients(height_m)
    denominator = s * s - a + (KP + KD * s) * delay
    # Visual-only VR motion does not physically accelerate the support surface,
    # so the inertial -b*u term from Eq. (1) is excluded.
    base = np.zeros(NFFT, dtype=float)
    visual = []
    for tv in tv_values:
        g1 = -(KP * delay) / ((1.0 + tv * s) * denominator)
        visual.append(smooth_bandpass(np.fft.irfft(U * g1, NFFT)))
    return base, np.asarray(visual)


def shift_signal(x, onset_s, n):
    source_index = np.arange(n) - onset_s * FS
    return np.interp(source_index, np.arange(len(x)), x, left=0.0, right=0.0)


def fit_file(path, height_m):
    d = load_csv(path)
    measured = d["xb"] * 1e-3
    tt = d["time_s"]
    measured = measured - np.polyval(np.polyfit(tt, measured, 1), tt)
    measured = smooth_bandpass(measured)
    coarse_tv = np.geomspace(0.02, 20.0, 90)
    base, visual = model_components(height_m, coarse_tv)
    best = None
    for onset in np.arange(0.0, 12.0001, 0.1):
        mask = (tt >= onset + 2.0) & (tt <= np.minimum(onset + 30.0, tt[-1] - 2.0))
        y = measured[mask]
        y_energy = float(np.dot(y, y))
        if y_energy == 0:
            continue
        b0 = shift_signal(base, onset, len(tt))[mask]
        for i, tv in enumerate(coarse_tv):
            v1 = shift_signal(visual[i], onset, len(tt))[mask]
            for polarity in (-1.0, 1.0):
                target = y
                denom = float(np.dot(v1, v1))
                gamma = max(0.0, float(np.dot(polarity * v1, target) / denom)) if denom else 0.0
                pred = polarity * gamma * v1
                residual = y - pred
                sse = float(np.dot(residual, residual))
                if best is None or sse < best["sse"]:
                    best = {"sse": sse, "tv": float(tv), "gamma": gamma, "onset": float(onset), "polarity": int(polarity), "y_energy": y_energy}
    # Local refinement around the best coarse solution.
    fine_tv = np.geomspace(best["tv"] / 1.5, best["tv"] * 1.5, 80)
    base, visual = model_components(height_m, fine_tv)
    refined = None
    for onset in np.arange(max(0.0, best["onset"] - 0.3), min(12.0, best["onset"] + 0.3) + 1e-9, 0.01):
        mask = (tt >= onset + 2.0) & (tt <= np.minimum(onset + 30.0, tt[-1] - 2.0))
        y = measured[mask]
        y_energy = float(np.dot(y, y))
        b0 = shift_signal(base, onset, len(tt))[mask]
        for i, tv in enumerate(fine_tv):
            v1 = shift_signal(visual[i], onset, len(tt))[mask]
            polarity = float(best["polarity"])
            target = y
            denom = float(np.dot(v1, v1))
            gamma = max(0.0, float(np.dot(polarity * v1, target) / denom)) if denom else 0.0
            pred = polarity * gamma * v1
            residual = y - pred
            sse = float(np.dot(residual, residual))
            if refined is None or sse < refined["sse"]:
                refined = {"sse": sse, "tv": float(tv), "gamma": gamma, "onset": float(onset), "polarity": int(polarity), "y_energy": y_energy}
    refined["fit_fraction"] = 1.0 - math.sqrt(refined["sse"] / refined["y_energy"])
    refined["rmse_mm"] = 1000.0 * math.sqrt(refined["sse"] / max(1, int((tt >= refined["onset"] + 2).sum())))
    return refined


results = {}
for path in sorted(DATA_DIR.glob("*.csv")):
    height = 1.70 if "iwamoto" in path.name else 1.78
    result = fit_file(path, height)
    results[path.name] = result
    print(path.name, result, flush=True)

print(json.dumps(results, ensure_ascii=False, indent=2))
