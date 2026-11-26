from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))

from PIL import Image, ImageDraw, ImageFont

OUT = ROOT / "artifacts" / "hip-strategy-contribution-chart.png"
W, H = 1600, 980
img = Image.new("RGB", (W, H), "white")
draw = ImageDraw.Draw(img)

font_path = Path(r"C:\Windows\Fonts\YuGothM.ttc")
bold_path = Path(r"C:\Windows\Fonts\YuGothB.ttc")
def font(size, bold=False):
    path = bold_path if bold and bold_path.exists() else font_path
    return ImageFont.truetype(str(path), size)

title_font = font(48, True)
axis_font = font(27)
label_font = font(28)
value_font = font(25, True)
legend_font = font(25)

data = [
    ("刺激なし", 53.9, None),
    ("股関節中心 0.2 Hz", 53.5, 50.9),
    ("股関節中心 0.5 Hz", 51.7, 52.6),
    ("足関節中心 0.2 Hz", 61.0, 52.9),
    ("足関節中心 0.5 Hz", 51.3, 51.2),
    ("並進 0.2 Hz", 51.9, 52.6),
    ("並進 0.5 Hz", 50.9, 55.5),
]

left, right, top, bottom = 430, 90, 190, 120
plot_w = W - left - right
plot_h = H - top - bottom
xmax = 70
blue = "#3976B8"
orange = "#D9822B"
grid = "#D7DCE2"
text = "#17212B"

title = "刺激条件別の股関節戦略寄与率"
tw = draw.textbbox((0, 0), title, font=title_font)[2]
draw.text(((W - tw) / 2, 36), title, fill=text, font=title_font)

# Legend
ly = 112
draw.ellipse((left, ly, left + 22, ly + 22), fill=blue)
draw.text((left + 34, ly - 6), "測定値1", fill=text, font=legend_font)
lx2 = left + 190
draw.rectangle((lx2, ly, lx2 + 22, ly + 22), fill=orange)
draw.text((lx2 + 34, ly - 6), "測定値2", fill=text, font=legend_font)

# Grid and x ticks
for tick in range(0, xmax + 1, 10):
    x = left + plot_w * tick / xmax
    draw.line((x, top, x, H - bottom), fill=grid, width=2)
    label = str(tick)
    box = draw.textbbox((0, 0), label, font=axis_font)
    draw.text((x - (box[2] - box[0]) / 2, H - bottom + 14), label, fill=text, font=axis_font)

row_h = plot_h / len(data)
bar_h = 27
for i, (condition, v1, v2) in enumerate(data):
    cy = top + row_h * (i + 0.5)
    label_box = draw.textbbox((0, 0), condition, font=label_font)
    draw.text((left - 26 - (label_box[2] - label_box[0]), cy - (label_box[3] - label_box[1]) / 2 - 4), condition, fill=text, font=label_font)
    if i:
        draw.line((left, top + row_h * i, W - right, top + row_h * i), fill="#EEF1F4", width=1)

    entries = [(v1, blue, -19)] if v2 is None else [(v1, blue, -20), (v2, orange, 20)]
    for value, color, offset in entries:
        y = cy + offset
        x2 = left + plot_w * value / xmax
        draw.rounded_rectangle((left, y - bar_h / 2, x2, y + bar_h / 2), radius=8, fill=color)
        draw.text((x2 + 10, y - 17), f"{value:.1f}", fill=text, font=value_font)

draw.line((left, top, left, H - bottom), fill="#65717D", width=2)
draw.line((left, H - bottom, W - right, H - bottom), fill="#65717D", width=2)
axis_title = "股関節戦略寄与率［%］"
ab = draw.textbbox((0, 0), axis_title, font=axis_font)
draw.text((left + (plot_w - (ab[2] - ab[0])) / 2, H - 54), axis_title, fill=text, font=axis_font)

OUT.parent.mkdir(exist_ok=True)
img.save(OUT, quality=95)
print(OUT)
