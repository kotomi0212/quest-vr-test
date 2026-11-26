from pathlib import Path
import csv
import json
import numpy as np


DATA_DIR = Path(r"C:\Users\seguchi\Desktop\261113")
FS = 100.0


def load_csv(path: Path):
    with path.open("r", encoding="cp932", newline="") as fh:
        rows = list(csv.reader(fh))
    header_index = max(i for i, row in enumerate(rows) if row and row[0] == "" and "xb" in row)
    header = ["time_s" if i == 0 else value for i, value in enumerate(rows[header_index])]
    data = np.asarray([[float(v) for v in row] for row in rows[header_index + 1 :] if row], dtype=float)
    return {name: data[:, i] for i, name in enumerate(header)}


def band_metrics(x):
    x = np.asarray(x, dtype=float)
    x = x - np.polyval(np.polyfit(np.arange(x.size), x, 1), np.arange(x.size))
    window = np.hanning(x.size)
    f = np.fft.rfftfreq(x.size, 1 / FS)
    p = np.abs(np.fft.rfft(x * window)) ** 2
    p /= max(np.sum(p), np.finfo(float).tiny)
    out = {}
    for lo, hi in [(0.03, 0.08), (0.08, 0.15), (0.15, 0.3), (0.3, 0.8), (0.8, 2.0)]:
        mask = (f >= lo) & (f < hi)
        out[f"{lo:.2f}-{hi:.2f}"] = float(np.sum(p[mask]))
    peak_mask = (f >= 0.03) & (f <= 1.0)
    out["peak_hz"] = float(f[peak_mask][np.argmax(p[peak_mask])])
    out["rms_mm"] = float(np.sqrt(np.mean(x**2)))
    return out


results = {}
for path in sorted(DATA_DIR.glob("*.csv")):
    d = load_csv(path)
    results[path.name] = {
        "n": len(d["time_s"]),
        "duration_s": float(d["time_s"][-1] - d["time_s"][0]),
        "xb": band_metrics(d["xb"]),
        "axb": band_metrics(d["axb"]),
    }

print(json.dumps(results, ensure_ascii=False, indent=2))
