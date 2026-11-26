from pathlib import Path
import json
import math
import sys

import numpy as np


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import frf_fit as analysis


PRIOR_RESULTS = Path(r"C:\Users\seguchi\gitseguchi\quest-vr-test\artifacts\261113-model-error\fit-results.json")
OUTPUT_DIR = Path(r"C:\Users\seguchi\gitseguchi\quest-vr-test\artifacts\261113-model-error-90points")


# Ninety evenly spaced positions in sweep time. Frequencies are therefore
# logarithmically distributed across the usable first segment.
analysis.TARGET_TAU = np.linspace(2.0, 28.0, 90)
analysis.TARGET_F = 0.7 * np.exp(analysis.K1 * analysis.TARGET_TAU)
analysis.OUTPUT_DIR = OUTPUT_DIR


def evaluate_file(path, height, fitted):
    data = analysis.load_csv(path)
    frequency, experimental, local_r2 = analysis.estimate_local_frf(
        data["time_s"], data["xb"] * 1e-3, fitted["onset_s"]
    )
    model = (
        fitted["polarity"]
        * fitted["gamma_s2"]
        * analysis.model_unit_frf(frequency, height, fitted["tv_s"])
    )
    weights = 0.05 + local_r2
    residual = experimental - model
    objective = float(
        np.sum(weights * np.abs(residual) ** 2)
        / np.sum(weights * np.abs(experimental) ** 2)
    )
    return {
        "objective": objective,
        "onset_s": fitted["onset_s"],
        "tv_s": fitted["tv_s"],
        "gamma_s2": fitted["gamma_s2"],
        "polarity": fitted["polarity"],
        "mean_local_r2": float(np.mean(local_r2)),
        "frequencies_hz": frequency.tolist(),
        "local_r2": local_r2.tolist(),
        "experimental_real": experimental.real.tolist(),
        "experimental_imag": experimental.imag.tolist(),
        "model_real": model.real.tolist(),
        "model_imag": model.imag.tolist(),
        "error_magnitude_m_per_m_s2": np.abs(residual).tolist(),
        "normalized_fit_percent": 100.0 * (1.0 - math.sqrt(objective)),
        "parameter_source": "fixed from prior 11-point fit",
    }


with PRIOR_RESULTS.open("r", encoding="utf-8") as fh:
    prior = json.load(fh)

results = {}
for path in sorted(analysis.DATA_DIR.glob("*.csv")):
    height = 1.70 if "iwamoto" in path.name else 1.78
    results[path.name] = evaluate_file(path, height, prior[path.name])
    print(
        path.name,
        {
            "points": len(results[path.name]["frequencies_hz"]),
            "frf_fit_percent": results[path.name]["normalized_fit_percent"],
            "mean_local_r2": results[path.name]["mean_local_r2"],
        },
        flush=True,
    )

analysis.write_outputs(results)
print(json.dumps({"output_dir": str(OUTPUT_DIR)}, ensure_ascii=False))
