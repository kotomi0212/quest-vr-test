"""Compare forward/back (assumed Z) PSD near 0.2 Hz across four stimuli."""
from pathlib import Path
import csv
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / ".video-tools"))

from PIL import Image, ImageDraw, ImageFont

ARTIFACTS = ROOT / "artifacts"
TARGET_HZ = 0.2
CONDITIONS = [
    ("6m細密グリッド\n並進 2°", "a-20261027-193044528-skip5s-next20s-lowpass10hz-forward-back-z-welch-psd.csv", (49, 126, 184)),
    ("赤点\n並進 2°", "a-20261027-193508978-skip5s-next20s-lowpass10hz-forward-back-z-welch-psd.csv", (220, 76, 70)),
    ("地面のみ\n並進 2°", "a-20261027-地面-skip5s-next20s-lowpass10hz-forward-back-z-welch-psd.csv", (88, 166, 110)),
    ("グレーグリッド\n並進 4°", "a-20261027-192141648-skip5s-next20s-lowpass10hz-forward-back-z-welch-psd.csv", (142, 92, 173)),
]


def font(size, bold=False):
    candidates = [
        Path(r"C:\Windows\Fonts\YuGothB.ttc" if bold else r"C:\Windows\Fonts\YuGothM.ttc"),
        Path(r"C:\Windows\Fonts\meiryob.ttc" if bold else r"C:\Windows\Fonts\meiryo.ttc"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def nearest_value(path):
    rows = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            rows.append((float(row["frequency_hz"]), float(row["forward_back_z_psd_raw2_per_hz"])))
    return min(rows, key=lambda row: abs(row[0] - TARGET_HZ))


def main():
    values = [(label, *nearest_value(ARTIFACTS / filename), color) for label, filename, color in CONDITIONS]
    width, height = 1400, 900
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    title, body, small = font(34, True), font(24), font(20)
    draw.text((70, 35), "4条件における前後方向の頭部加速度PSD比較", font=title, fill=(24, 33, 40))
    draw.text((70, 88), "0.2 Hzに最も近い周波数ビン（0.1953125 Hz）・Z軸を前後方向と仮定", font=body, fill=(78, 91, 101))

    left, top, right, bottom = 125, 165, 1340, 725
    maximum = 500000
    for tick in range(0, maximum + 1, 100000):
        y = bottom - tick / maximum * (bottom - top)
        draw.line((left, y, right, y), fill=(220, 226, 230), width=2)
        draw.text((18, y - 13), f"{tick:,}", font=small, fill=(80, 91, 100))
    draw.line((left, top, left, bottom), fill=(90, 103, 112), width=2)
    draw.line((left, bottom, right, bottom), fill=(90, 103, 112), width=2)

    slot = (right - left) / len(values)
    bar_width = 170
    for index, (label, frequency, value, color) in enumerate(values):
        center = left + slot * (index + 0.5)
        x0, x1 = center - bar_width / 2, center + bar_width / 2
        y = bottom - value / maximum * (bottom - top)
        draw.rounded_rectangle((x0, y, x1, bottom), radius=10, fill=color)
        value_text = f"{value:,.0f}"
        text_width = draw.textlength(value_text, font=body)
        draw.text((center - text_width / 2, y - 38), value_text, font=body, fill=(35, 44, 50))
        lines = label.split("\n")
        for line_index, line in enumerate(lines):
            line_width = draw.textlength(line, font=body)
            draw.text((center-line_width/2, bottom+25+line_index*34), line, font=body, fill=(35, 44, 50))

    draw.text((18, 400), "PSD\n(raw²/Hz)", font=small, fill=(55, 67, 76))
    draw.text((125, 830), "解析条件：開始5秒を除外後の20秒間、10 Hzローパス、Welch法（周波数分解能 0.09765625 Hz）", font=small, fill=(78, 91, 101))
    output = ARTIFACTS / "head-acceleration-psd-0p2hz-four-condition-comparison.png"
    image.save(output)

    csv_output = ARTIFACTS / "head-acceleration-psd-0p2hz-four-condition-comparison.csv"
    with csv_output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["condition", "frequency_bin_hz", "forward_back_z_psd_raw2_per_hz"])
        for label, frequency, value, _ in values:
            writer.writerow([label.replace("\n", " "), f"{frequency:.9f}", f"{value:.9f}"])
    print(output)
    print(csv_output)


if __name__ == "__main__":
    main()
