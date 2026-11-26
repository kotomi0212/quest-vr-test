"""Render the four experiment stimuli at 0.2 Hz using Quest runtime semantics."""
from pathlib import Path
import math
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import imageio.v2 as imageio
import numpy as np

import generate_requested_stimulus_videos as requested
import generate_clean_stimulus_videos as clean
import generate_optic_flow_videos as base


FPS = 15
DURATION = 60
OUTPUT = ROOT / "artifacts"

# Match the values presented by the Quest runtime for these pattern types.
requested.MOTION_HZ = 0.2
requested.SPHERE_MOTION_HZ = 0.2
requested.PITCH_AMPLITUDE_DEG = 1.0       # 2 deg peak-to-peak
requested.TRANSLATION_AMPLITUDE_M = 0.10  # special-pattern fixed translation
requested.DURATION = DURATION
requested.RAMP_SECONDS = 1.5

base.FREQUENCY_HZ = 0.2
base.AMPLITUDE_RAD = math.radians(2.0)    # 4 deg peak-to-peak
base.DURATION = DURATION


def render_gray_room(t):
    return clean.render("translation", t)


def write(filename, renderer):
    path = OUTPUT / filename
    with imageio.get_writer(path, fps=FPS, codec="libx264", quality=8, macro_block_size=2) as writer:
        for frame in range(FPS * DURATION):
            writer.append_data(renderer(frame / FPS))
    preview = OUTPUT / filename.replace(".mp4", ".preview.png")
    requested.save_preview(preview.name, renderer, [0.0, 1.25, 3.75])
    print(path)


def main():
    OUTPUT.mkdir(exist_ok=True)
    jobs = [
        ("gray-grid-room-translation-4degpp-0p2hz-60s.mp4", render_gray_room),
        ("fine-grid-room-2degpp-0p2hz-60s.mp4", lambda t: requested.render_grid(requested.ROOM_LINES, t)),
        ("red-sphere-translation-2deg-setting-0p2hz-60s.mp4", requested.render_sphere),
        ("floor-only-2degpp-0p2hz-60s.mp4", lambda t: requested.render_grid(requested.FLOOR_LINES, t)),
    ]
    for filename, renderer in jobs:
        write(filename, renderer)


if __name__ == "__main__":
    main()
