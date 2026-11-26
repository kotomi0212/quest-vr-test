"""Render 60 s optic-flow vector videos for the three default motion conditions."""
from pathlib import Path
import math
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS, DURATION = 960, 540, 15, 60
EYE = np.array([0.0, 1.5, 0.0])
ANKLE_Y, HIP_Y = 0.088, 0.9
AMPLITUDE_RAD, FREQUENCY_HZ = math.radians(1.0), 0.2  # 2 deg peak-to-peak
HFOV = math.radians(90)
FOCAL = WIDTH / (2 * math.tan(HFOV / 2))
OUTPUT = ROOT / "artifacts"
OUTPUT.mkdir(exist_ok=True)

FONT_PATH = Path(r"C:\Windows\Fonts\YuGothM.ttc")
FONT = ImageFont.truetype(str(FONT_PATH), 22) if FONT_PATH.exists() else ImageFont.load_default()
SMALL = ImageFont.truetype(str(FONT_PATH), 17) if FONT_PATH.exists() else ImageFont.load_default()


def envelope(t):
    return min(1.0, t / 1.5, max(0.0, (DURATION - t) / 1.5))


def angle(t):
    return AMPLITUDE_RAD * math.sin(2 * math.pi * FREQUENCY_HZ * t) * envelope(t)


def transform(points, condition, t):
    theta = angle(t)
    if condition == "translation":
        moved = points.copy()
        moved[:, 2] -= (EYE[1] - ANKLE_Y) * theta
        return moved
    center_y = ANKLE_Y if condition == "ankle" else HIP_Y
    c, s = math.cos(theta), math.sin(theta)
    moved = points.copy()
    y = points[:, 1] - center_y
    z = points[:, 2]
    moved[:, 1] = center_y + c * y - s * z
    moved[:, 2] = s * y + c * z
    return moved


def project(points):
    relative = points - EYE
    depth = -relative[:, 2]
    valid = depth > 0.08
    x = WIDTH / 2 + FOCAL * relative[:, 0] / np.maximum(depth, 1e-9)
    y = HEIGHT / 2 - FOCAL * relative[:, 1] / np.maximum(depth, 1e-9)
    valid &= (x > -80) & (x < WIDTH + 80) & (y > -80) & (y < HEIGHT + 80)
    return np.column_stack([x, y]), valid


def visual_angles(points):
    relative = points - EYE
    yaw = np.degrees(np.arctan2(relative[:, 0], -relative[:, 2]))
    pitch = np.degrees(np.arctan2(relative[:, 1], np.hypot(relative[:, 0], relative[:, 2])))
    return np.column_stack([yaw, pitch])


def segment(a, b, count):
    u = np.linspace(0, 1, count)[:, None]
    return a + (b - a) * u


def build_geometry():
    lines = []
    # Front wall, floor, ceiling and side-wall metre grid lines.
    for x in np.arange(-4, 4.01, 1):
        lines.append(segment(np.array([x, 0, -4.0]), np.array([x, 4, -4.0]), 20))
        lines.append(segment(np.array([x, 0, -4.0]), np.array([x, 0, 4.0]), 30))
        lines.append(segment(np.array([x, 4, -4.0]), np.array([x, 4, 4.0]), 30))
    for y in np.arange(0, 4.01, 1):
        lines.append(segment(np.array([-4.0, y, -4.0]), np.array([4.0, y, -4.0]), 30))
        lines.append(segment(np.array([-4.0, y, -4.0]), np.array([-4.0, y, 4.0]), 30))
        lines.append(segment(np.array([4.0, y, -4.0]), np.array([4.0, y, 4.0]), 30))
    for z in np.arange(-4, 4.01, 1):
        lines.append(segment(np.array([-4.0, 0, z]), np.array([4.0, 0, z]), 30))
        lines.append(segment(np.array([-4.0, 4, z]), np.array([4.0, 4, z]), 30))
        lines.append(segment(np.array([-4.0, 0, z]), np.array([-4.0, 4, z]), 20))
        lines.append(segment(np.array([4.0, 0, z]), np.array([4.0, 4, z]), 20))

    pts = []
    # Sample the visible room surfaces at regular 1 m intersections.
    for x in np.arange(-3.5, 3.51, 1):
        for y in np.arange(.5, 3.51, 1):
            pts.append([x, y, -4])
    for z in np.arange(-3.5, -.49, 1):
        for y in np.arange(.5, 3.51, 1):
            pts.extend([[-4, y, z], [4, y, z]])
        for x in np.arange(-3.5, 3.51, 1):
            pts.extend([[x, 0, z], [x, 4, z]])
    return lines, np.asarray(pts, dtype=float)


LINES, VECTOR_POINTS = build_geometry()


def vector_data(condition, t):
    dt = 1 / 1000
    p0, ok0 = project(transform(VECTOR_POINTS, condition, t))
    p1, ok1 = project(transform(VECTOR_POINTS, condition, min(DURATION, t + dt)))
    velocity = (p1 - p0) / dt
    a0 = visual_angles(transform(VECTOR_POINTS, condition, t))
    a1 = visual_angles(transform(VECTOR_POINTS, condition, min(DURATION, t + dt)))
    angular_speed = np.linalg.norm((a1 - a0) / dt, axis=1)
    return p0, velocity, angular_speed, ok0 & ok1


def color_for(value, maximum):
    q = min(1.0, value / maximum) if maximum else 0
    # blue -> cyan -> yellow -> red
    stops = [(0.0, (35, 92, 210)), (.4, (20, 190, 230)), (.72, (250, 205, 40)), (1.0, (225, 45, 35))]
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        if q <= b:
            u = (q - a) / (b - a)
            return tuple(round(ca[i] + u * (cb[i] - ca[i])) for i in range(3))
    return stops[-1][1]


def draw_arrow(draw, start, vector, magnitude, global_max):
    if magnitude < global_max * .002:
        draw.ellipse((start[0]-1.5, start[1]-1.5, start[0]+1.5, start[1]+1.5), fill=color_for(0, global_max))
        return
    length = 5 + 58 * min(1, magnitude / global_max)
    unit = vector / magnitude
    end = start + unit * length
    color = color_for(magnitude, global_max)
    draw.line((tuple(start), tuple(end)), fill=color, width=3)
    side = np.array([-unit[1], unit[0]])
    back = end - unit * 9
    draw.polygon([tuple(end), tuple(back + side * 4.5), tuple(back - side * 4.5)], fill=color)


def render_frame(condition, t, global_max):
    image = Image.new("RGB", (WIDTH, HEIGHT), (156, 164, 168))
    draw = ImageDraw.Draw(image)
    for line in LINES:
        p, valid = project(transform(line, condition, t))
        run = []
        for point, keep in zip(p, valid):
            if keep:
                run.append(tuple(point))
            elif len(run) > 1:
                draw.line(run, fill=(75, 83, 88), width=1); run = []
        if len(run) > 1:
            draw.line(run, fill=(75, 83, 88), width=1)

    positions, velocities, angular_speeds, valid = vector_data(condition, t)
    for pos, velocity, magnitude, keep in zip(positions, velocities, angular_speeds, valid):
        if keep:
            pixel_magnitude = float(np.linalg.norm(velocity))
            if pixel_magnitude:
                draw_arrow(draw, pos, velocity / pixel_magnitude * magnitude, magnitude, global_max)

    names = {"ankle": "足関節中心回転", "hip": "股関節中心回転（既存角度）", "translation": "前後並進（足関節眼速度換算）"}
    draw.rectangle((14, 12, 385, 75), fill=(245, 247, 248))
    draw.text((25, 18), names[condition], font=FONT, fill=(25, 31, 34))
    draw.text((25, 48), f"t={t:05.1f} s  sin 0.2 Hz  2 deg pp", font=SMALL, fill=(45, 53, 58))
    # Shared color legend.
    x0, y0, x1 = 620, 464, 925
    draw.rectangle((606, 432, 944, 522), fill=(235, 237, 238))
    for x in range(x0, x1):
        q = (x - x0) / (x1 - x0 - 1)
        draw.line((x, y0, x, y0 + 12), fill=color_for(q * global_max, global_max))
    draw.text((x0, y0 - 24), "optic-flow angular speed", font=SMALL, fill=(25, 31, 34))
    draw.text((x0, y0 + 15), "0 (blue / short)", font=SMALL, fill=(25, 31, 34))
    right = f"{global_max:.2f} deg/s (red / long)"
    draw.text((x1 - draw.textlength(right, font=SMALL), y0 + 15), right, font=SMALL, fill=(25, 31, 34))
    return np.asarray(image)


def main():
    conditions = ["ankle", "hip", "translation"]
    probe_times = np.linspace(0, DURATION - 1 / FPS, 900)
    global_max = 0.0
    for condition in conditions:
        for t in probe_times:
            _, _, angular_speed, valid = vector_data(condition, float(t))
            if np.any(valid):
                global_max = max(global_max, float(angular_speed[valid].max()))
    print(f"shared optic-flow scale: 0..{global_max:.3f} deg/s")
    for condition in conditions:
        path = OUTPUT / f"optic-flow-{condition}-60s.mp4"
        with imageio.get_writer(path, fps=FPS, codec="libx264", quality=8, macro_block_size=2) as writer:
            for frame in range(FPS * DURATION):
                writer.append_data(render_frame(condition, frame / FPS, global_max))
        print(path)


if __name__ == "__main__":
    main()
