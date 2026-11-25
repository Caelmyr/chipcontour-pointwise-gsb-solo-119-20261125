"""Measure the point where a source row first enters a bright fragment."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from image_lab.validation import Invalid, integer, number

from .photo import decode, pixels, png, MAX_IMAGE_BYTES


LUMA = np.array([0.2126, 0.7152, 0.0722])
MIN_RUN = 4


def settings(value, size):
    width, height = size
    left = integer(value.get("left"), "左界 X", 0, width - 1)
    top = integer(value.get("top"), "上界 Y", 0, height - 1)
    side = value.get("side")
    if side not in {"left", "right"}:
        raise Invalid("请选择从左边或右边进入断片")
    return {
        "left": left, "right": integer(value.get("right"), "右界 X", left, width - 1),
        "top": top, "bottom": integer(value.get("bottom"), "下界 Y", top, height - 1),
        "focus": integer(value.get("focus"), "截线 Y", 0, height - 1),
        "side": side, "cutoff": integer(value.get("cutoff"), "亮度下限", 1, 254),
        "mm_per_px": number(value.get("mm_per_px"), "标尺", 0.001, 500),
    }


def defaults(size):
    width, height = size
    return settings({
        "left": width // 7, "right": width * 6 // 7, "top": height // 5, "bottom": height * 4 // 5,
        "focus": height // 2, "side": "left", "cutoff": 138, "mm_per_px": 1,
    }, size)


def point(image, x, y, config):
    rgb = image[y, x]
    luma = float(rgb @ LUMA)
    inside = config["left"] <= x <= config["right"] and config["top"] <= y <= config["bottom"]
    return {"x": x, "y": y, "rgb": rgb.tolist(), "brightness": luma,
            "solid": luma >= config["cutoff"] if inside else None}


def source_outline(image, config):
    left, right, top, bottom = (config[key] for key in ("left", "right", "top", "bottom"))
    bright = (image[top:bottom + 1, left:right + 1] @ LUMA) >= config["cutoff"]
    reverse = config["side"] == "right"
    if reverse:
        bright = bright[:, ::-1]
    span = bright.shape[1] - MIN_RUN + 1
    if span < 1:
        return [{"y": y, "x": None, "offset_px": None} for y in range(top, bottom + 1)]
    supported = bright[:, :span].copy()
    for dx in range(1, MIN_RUN):
        supported &= bright[:, dx:dx + span]
    outline = []
    for row, offset, valid in zip(range(top, bottom + 1), supported.argmax(axis=1), supported.any(axis=1)):
        distance = int(offset) if valid else None
        x = (right - distance if reverse else left + distance) if valid else None
        outline.append({"y": row, "x": x, "offset_px": distance})
    return outline


def profile(image, config):
    y = config["focus"]
    if not config["top"] <= y <= config["bottom"]:
        return []
    return [point(image, x, y, config) for x in range(config["left"], config["right"] + 1)]


def report(image, config):
    rows = profile(image, config)
    outline = source_outline(image, config)
    reading = None
    if rows:
        chosen = outline[config["focus"] - config["top"]]
        if chosen["x"] is not None:
            reading = {**chosen, "offset_mm": chosen["offset_px"] * config["mm_per_px"]}
    return {"reading": reading, "profile": rows, "outline": outline, "focus": config["focus"]}


def practice():
    width, height = 772, 460
    cfg = settings({"left": 106, "right": 659, "top": 103, "bottom": 333, "focus": 172,
                    "side": "left", "cutoff": 138, "mm_per_px": 0.2}, (width, height))
    y, x = np.indices((height, width))
    left = np.floor(207 + 19 * np.sin((y - 112) / 28) + 8 * np.sin(y / 9)
                    + 60 * np.exp(-((y - 261) / 17)**2) + 4 * np.sin(y * 0.59))
    right = np.floor(581 + 17 * np.sin(y / 32) + 4 * np.sin(y * 0.34)
                     - 25 * np.exp(-((y - 302) / 21)**2))
    top = 80 + 18 * np.maximum(0, 1 - ((x - 382) / 175)**2)
    bottom = 383 - 11 * np.cos((x - 287) / 95)
    solid = (x >= left) & (x <= right) & (y >= top) & (y <= bottom)
    base_noise = 3 * np.sin(x * 0.41 + y * 0.31) + 2 * np.sin(0.86 * y - x * 0.18)
    backdrop = np.array([37, 50, 54])
    mica = 10 * np.sin((x + 2.1 * y) / 51) + 6 * np.sin((x * 0.3 - y) / 17)
    resin = np.array([219, 175, 111]) + mica[..., None]
    gleam = (x >= left + 2) & (x <= left + 6)
    resin = resin + 16 * gleam[..., None]
    photo = Image.fromarray((np.where(solid[..., None], resin, backdrop)
                             + base_noise[..., None]).clip(0, 255).astype("uint8"), "RGB")
    draw = ImageDraw.Draw(photo)
    draw.text((108, 36), "AMBER RESIN / FRACTURE PROFILE", fill="#d0dacf", font=ImageFont.load_default(size=14))
    draw.text((108, 420), "SIMULATED FRAGMENT PHOTO", fill="#b9c6bf", font=ImageFont.load_default(size=12))
    draw.line((574, 420, 624, 420), fill="#dae0d5", width=2)
    for ix in (574, 599, 624):
        draw.line((ix, 420, ix, 413), fill="#dae0d5", width=2)
    draw.text((633, 413), "10 mm", fill="#dae0d5", font=ImageFont.load_default(size=12))
    return photo.size, png(photo), cfg
