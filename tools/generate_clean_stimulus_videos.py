"""Render clean 60 s videos containing only the configured gray-grid stimulus."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw
import generate_optic_flow_videos as base


def render(condition, t):
    image = Image.new("RGB", (base.WIDTH, base.HEIGHT), (156, 164, 168))
    draw = ImageDraw.Draw(image)
    for line in base.LINES:
        projected, valid = base.project(base.transform(line, condition, t))
        run = []
        for point, keep in zip(projected, valid):
            if keep:
                run.append(tuple(point))
            elif len(run) > 1:
                draw.line(run, fill=(75, 83, 88), width=1)
                run = []
        if len(run) > 1:
            draw.line(run, fill=(75, 83, 88), width=1)
    return np.asarray(image)


def main():
    for condition in ("ankle", "hip", "translation"):
        path = base.OUTPUT / f"stimulus-only-{condition}-60s.mp4"
        with imageio.get_writer(path, fps=base.FPS, codec="libx264", quality=8, macro_block_size=2) as writer:
            for frame in range(base.FPS * base.DURATION):
                writer.append_data(render(condition, frame / base.FPS))
        print(path)


if __name__ == "__main__":
    main()
