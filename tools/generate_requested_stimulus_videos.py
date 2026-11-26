"""Generate the three requested 60 s visual-stimulus videos.

The renderer is intentionally dependency-light and uses the same simple pinhole
camera convention as generate_optic_flow_videos.py (+X right, +Y up, -Z forward).
All experiment-facing dimensions and motion parameters live in the constants
below so the assumptions are visible and easy to revise.
"""
from pathlib import Path
import math
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw


WIDTH, HEIGHT, FPS, DURATION = 960, 540, 15, 60
HFOV_RAD = math.radians(90)
FOCAL_PX = WIDTH / (2 * math.tan(HFOV_RAD / 2))
OUTPUT = ROOT / "artifacts"

# Anthropometric/room assumptions requested for the revised grid room.
BODY_HEIGHT_M = 1.70
ROOM_HEIGHT_M = 1.7 * BODY_HEIGHT_M  # 2.89 m
EYE_HEIGHT_M = ROOM_HEIGHT_M / 2     # exactly halfway up the room
ROOM_WIDTH_M = 6.0
ROOM_DEPTH_M = 6.0
GRID_SPACING_M = 0.5

# The room/floor undergo simultaneous sinusoidal pitch and fore-aft translation.
MOTION_HZ = 0.1
PITCH_AMPLITUDE_DEG = 1.0
TRANSLATION_AMPLITUDE_M = 0.10
RAMP_SECONDS = 1.5

# The isolated sphere is 3 cm in radius and moves only fore/aft at eye height.
SPHERE_RADIUS_M = 0.03
SPHERE_CENTER_DISTANCE_M = 1.50
SPHERE_TRAVEL_AMPLITUDE_M = 0.50
SPHERE_MOTION_HZ = 0.1

BACKGROUND = (156, 164, 168)
GRID_COLOR = (68, 75, 79)
EMPTY_SPACE_COLOR = (8, 8, 10)


def envelope(t):
    """Short cosine ramp so a loop starts and ends without a velocity step."""
    attack = min(1.0, max(0.0, t / RAMP_SECONDS))
    release = min(1.0, max(0.0, (DURATION - t) / RAMP_SECONDS))
    return math.sin(math.pi * attack / 2) * math.sin(math.pi * release / 2)


def project(points):
    relative = points - np.array([0.0, EYE_HEIGHT_M, 0.0])
    depth = -relative[:, 2]
    valid = depth > 0.04
    safe_depth = np.maximum(depth, 1e-9)
    x = WIDTH / 2 + FOCAL_PX * relative[:, 0] / safe_depth
    y = HEIGHT / 2 - FOCAL_PX * relative[:, 1] / safe_depth
    return np.column_stack([x, y]), valid


def segment(a, b, samples=50):
    u = np.linspace(0.0, 1.0, samples)[:, None]
    return a + (b - a) * u


def grid_values(limit):
    count = round(limit / GRID_SPACING_M)
    return np.linspace(-limit / 2, limit / 2, count + 1)


def build_grid(include_walls):
    """Build a 6 x 6 m floor; optionally add front/side walls and ceiling."""
    lines = []
    x_values = grid_values(ROOM_WIDTH_M)
    z_values = grid_values(ROOM_DEPTH_M)
    y_values = np.arange(0.0, ROOM_HEIGHT_M + GRID_SPACING_M / 2, GRID_SPACING_M)
    z_front, z_back = -ROOM_DEPTH_M / 2, ROOM_DEPTH_M / 2
    x_left, x_right = -ROOM_WIDTH_M / 2, ROOM_WIDTH_M / 2

    # Floor.
    for x in x_values:
        lines.append(segment(np.array([x, 0.0, z_front]), np.array([x, 0.0, z_back])))
    for z in z_values:
        lines.append(segment(np.array([x_left, 0.0, z]), np.array([x_right, 0.0, z])))

    if not include_walls:
        return lines

    # Front wall and side walls. The back is left open, as in the camera view.
    for x in x_values:
        lines.append(segment(np.array([x, 0.0, z_front]), np.array([x, ROOM_HEIGHT_M, z_front])))
    for y in y_values:
        lines.append(segment(np.array([x_left, y, z_front]), np.array([x_right, y, z_front])))
        lines.append(segment(np.array([x_left, y, z_front]), np.array([x_left, y, z_back])))
        lines.append(segment(np.array([x_right, y, z_front]), np.array([x_right, y, z_back])))
    for z in z_values:
        lines.append(segment(np.array([x_left, 0.0, z]), np.array([x_left, ROOM_HEIGHT_M, z])))
        lines.append(segment(np.array([x_right, 0.0, z]), np.array([x_right, ROOM_HEIGHT_M, z])))

    # Ceiling.
    for x in x_values:
        lines.append(segment(np.array([x, ROOM_HEIGHT_M, z_front]), np.array([x, ROOM_HEIGHT_M, z_back])))
    for z in z_values:
        lines.append(segment(np.array([x_left, ROOM_HEIGHT_M, z]), np.array([x_right, ROOM_HEIGHT_M, z])))
    return lines


ROOM_LINES = build_grid(True)
FLOOR_LINES = build_grid(False)


def transform_environment(points, t):
    """Apply simultaneous in-phase pitch about the eye and Z translation."""
    wave = math.sin(2 * math.pi * MOTION_HZ * t) * envelope(t)
    theta = math.radians(PITCH_AMPLITUDE_DEG) * wave
    c, s = math.cos(theta), math.sin(theta)
    moved = points.copy()
    y = points[:, 1] - EYE_HEIGHT_M
    z = points[:, 2]
    moved[:, 1] = EYE_HEIGHT_M + c * y - s * z
    moved[:, 2] = s * y + c * z - TRANSLATION_AMPLITUDE_M * wave
    return moved


def draw_clipped_polyline(draw, points, valid):
    run = []
    for point, keep in zip(points, valid):
        on_canvas = keep and -100 <= point[0] <= WIDTH + 100 and -100 <= point[1] <= HEIGHT + 100
        if on_canvas:
            run.append(tuple(point))
        elif len(run) > 1:
            draw.line(run, fill=GRID_COLOR, width=1)
            run = []
        else:
            run = []
    if len(run) > 1:
        draw.line(run, fill=GRID_COLOR, width=1)


def render_grid(lines, t):
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    for line in lines:
        screen, valid = project(transform_environment(line, t))
        draw_clipped_polyline(draw, screen, valid)
    return np.asarray(image)


def render_sphere(t):
    image = Image.new("RGB", (WIDTH, HEIGHT), EMPTY_SPACE_COLOR)
    phase = math.sin(2 * math.pi * SPHERE_MOTION_HZ * t) * envelope(t)
    distance = SPHERE_CENTER_DISTANCE_M + SPHERE_TRAVEL_AMPLITUDE_M * phase
    radius_px = FOCAL_PX * SPHERE_RADIUS_M / distance
    cx, cy = WIDTH / 2, HEIGHT / 2
    # Concentric offset discs give a restrained 3-D cue without adding a scene.
    draw = ImageDraw.Draw(image)
    draw.ellipse((cx-radius_px, cy-radius_px, cx+radius_px, cy+radius_px), fill=(148, 8, 10))
    for q in np.linspace(0.88, 0.18, 18):
        r = radius_px * q
        offset = radius_px * (1-q) * 0.48
        shade = round(185 + 65 * (1-q))
        draw.ellipse((cx-r-offset, cy-r-offset, cx+r-offset, cy+r-offset), fill=(shade, 18, 20))
    return np.asarray(image)


def write_video(filename, renderer):
    path = OUTPUT / filename
    with imageio.get_writer(path, fps=FPS, codec="libx264", quality=8, macro_block_size=2) as writer:
        for frame in range(FPS * DURATION):
            writer.append_data(renderer(frame / FPS))
    return path


def save_preview(filename, renderer, times):
    frames = [Image.fromarray(renderer(t)) for t in times]
    preview = Image.new("RGB", (WIDTH, HEIGHT * len(frames)))
    for index, frame in enumerate(frames):
        preview.paste(frame, (0, HEIGHT * index))
    path = OUTPUT / filename
    preview.save(path)
    return path


def main():
    OUTPUT.mkdir(exist_ok=True)
    jobs = [
        ("red-sphere-fore-aft-60s.mp4", render_sphere),
        ("compact-grid-room-pitch-translation-60s.mp4", lambda t: render_grid(ROOM_LINES, t)),
        ("grid-floor-only-pitch-translation-60s.mp4", lambda t: render_grid(FLOOR_LINES, t)),
    ]
    for filename, renderer in jobs:
        print(write_video(filename, renderer))
        preview_name = filename.replace(".mp4", ".preview.png")
        print(save_preview(preview_name, renderer, [0.0, 2.5, 7.5]))


if __name__ == "__main__":
    main()
