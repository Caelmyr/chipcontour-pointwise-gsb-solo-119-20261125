"""Export a fracture observation using its real source data."""
from io import BytesIO, StringIO
from zipfile import ZipFile, ZIP_DEFLATED
import csv
import json

from PIL import Image, ImageDraw

from .photo import png


def trace_table(result):
    target = StringIO()
    writer = csv.writer(target)
    writer.writerow(("x_px", "y_px", "red", "green", "blue", "luma", "solid", "in_body"))
    for point in result["profile"]:
        writer.writerow((point["x"], point["y"], *point["rgb"], f'{point["brightness"]:.3f}',
                         int(point["solid"]), int(point["in_body"])))
    return target.getvalue().encode()


def proof(image, card, result):
    height, width = image.shape[:2]
    output = Image.new("RGB", (max(430, width), height + 64), "#1d3233")
    output.paste(Image.fromarray(image), (0, 0))
    draw = ImageDraw.Draw(output)
    cfg = card["settings"]
    draw.rectangle((cfg["left"], cfg["top"], cfg["right"], cfg["bottom"]), outline="#69a39e", width=2)
    for row in result["outline"]:
        if row["x"] is not None:
            draw.point((row["x"], row["y"]), fill="#f6f4d7")
    if result["profile"]:
        draw.line((cfg["left"], cfg["focus"], cfg["right"], cfg["focus"]), fill="#869ea9", width=1)
    body = result.get("body")
    reading = result["reading"]
    if reading:
        x, y = reading["x"], reading["y"]
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), outline="#b04c72", width=3)
        detail = f'Source edge ({x}, {y}) | {reading["offset_px"]} px / {reading["offset_mm"]:.2f} mm from frame'
    elif body is None:
        detail = "No adopted body: nothing touches the far frame edge for 8+ straight rows"
    else:
        detail = "No supported edge on this source row"
    if body:
        detail += f' | adopted body {body["area"]} px / {len(body["candidates"])} candidate(s)'
    draw.text((14, height + 13), f'Source row {cfg["focus"]} / from {cfg["side"]} / luminance {cfg["cutoff"]}', fill="#dbe7dd")
    draw.text((14, height + 35), detail, fill="#edd59a")
    return png(output)


def package(card, original, image, result):
    memory = BytesIO()
    with ZipFile(memory, "w", ZIP_DEFLATED) as stream:
        stream.writestr("fragment.png", original)
        stream.writestr("reading.json", json.dumps({"card": card, "reading": result["reading"],
                                                    "body": result["body"]},
                                                   ensure_ascii=False, indent=2))
        stream.writestr("chip-profile.csv", trace_table(result))
        stream.writestr("chip-proof.png", proof(image, card, result))
    return memory.getvalue()
