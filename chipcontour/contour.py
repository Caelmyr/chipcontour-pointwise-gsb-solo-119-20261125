"""Measure the point where a source row first enters a bright fragment."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

from image_lab.validation import Invalid, integer, number

from .photo import decode, pixels, png, MAX_IMAGE_BYTES


LUMA = np.array([0.2126, 0.7152, 0.0722])
CROSS = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])
MIN_RUN = 4
MIN_BODY_ROWS = 8


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


def row_runs(row):
    """[start, end) spans of actual bright pixels in one mask row."""
    edges = np.flatnonzero(np.diff(np.concatenate(([np.int8(0)], row.view(np.int8), [np.int8(0)]))))
    return list(zip(edges[0::2].tolist(), edges[1::2].tolist()))


def longest_streak(rows):
    best = streak = 0
    previous = -2
    for row in sorted(rows):
        streak = streak + 1 if row == previous + 1 else 1
        previous = row
        best = max(best, streak)
    return best


def select_body(image, config):
    """Adopt one real fragment body from the measurement frame.

    A pixel counts only when its luma reaches the user's cutoff and no RGB
    channel is pinned at 0 or 255; such clipped points stay blank. Bright
    pixels connect only up/down/left/right. A candidate must touch the frame
    edge opposite the entry direction for at least MIN_BODY_ROWS consecutive
    source rows. When several qualify, the adopted body balances usable area
    against distance to the focused source row, each weighted one half.
    """
    left, right, top, bottom = (config[key] for key in ("left", "right", "top", "bottom"))
    region = image[top:bottom + 1, left:right + 1]
    luma = region @ LUMA
    clipped = ((region == 0) | (region == 255)).any(axis=2)
    mask = (luma >= config["cutoff"]) & ~clipped
    height, width = mask.shape
    at_right = config["side"] == "left"
    labels, _ = ndimage.label(mask, structure=CROSS)
    edge_labels = labels[:, width - 1 if at_right else 0]
    areas = np.bincount(labels.ravel())
    focus = config["focus"] - top
    candidates = []
    for label in np.unique(edge_labels):
        if not label:
            continue
        streak = longest_streak(np.flatnonzero(edge_labels == label))
        if streak < MIN_BODY_ROWS:
            continue
        rows = np.flatnonzero((labels == label).any(axis=1))
        candidates.append({"label": int(label), "rows": rows, "area": int(areas[label]),
                           "edge_streak": streak,
                           "focus_gap": int(np.abs(rows - focus).min())})
    if not candidates:
        return None
    peak = max(candidate["area"] for candidate in candidates)
    for candidate in candidates:
        nearness = 1 - min(1, candidate["focus_gap"] / max(1, height - 1))
        candidate["score"] = round((candidate["area"] / peak + nearness) / 2, 4)
    adopted = max(candidates, key=lambda candidate: candidate["score"])
    member = labels == adopted["label"]
    return {
        "runs": {int(row) + top: [(start + left, end + left) for start, end in row_runs(member[row])]
                 for row in adopted["rows"]},
        "area": adopted["area"],
        "rows": [int(adopted["rows"][0]) + top, int(adopted["rows"][-1]) + top],
        "edge_streak": adopted["edge_streak"],
        "focus_gap": adopted["focus_gap"],
        "candidates": [
            {"area": candidate["area"],
             "rows": [int(candidate["rows"][0]) + top, int(candidate["rows"][-1]) + top],
             "edge_streak": candidate["edge_streak"],
             "focus_gap": candidate["focus_gap"],
             "score": candidate["score"],
             "adopted": candidate is adopted}
            for candidate in sorted(candidates, key=lambda candidate: -candidate["score"])
        ],
    }


def source_outline(body, config):
    left, right, top, bottom = (config[key] for key in ("left", "right", "top", "bottom"))
    runs = (body or {}).get("runs", {})
    reverse = config["side"] == "right"
    outline = []
    for row in range(top, bottom + 1):
        x = distance = None
        spans = runs.get(row, ())
        for start, end in (reversed(spans) if reverse else spans):
            if end - start >= MIN_RUN:
                x = end - 1 if reverse else start
                distance = right - x if reverse else x - left
                break
        outline.append({"y": row, "x": x, "offset_px": distance})
    return outline


def profile(image, config, body):
    y = config["focus"]
    if not config["top"] <= y <= config["bottom"]:
        return []
    spans = (body or {}).get("runs", {}).get(y, ())
    rows = []
    for x in range(config["left"], config["right"] + 1):
        sample = point(image, x, y, config)
        sample["in_body"] = any(start <= x < end for start, end in spans)
        rows.append(sample)
    return rows


def report(image, config):
    body = select_body(image, config)
    rows = profile(image, config, body)
    outline = source_outline(body, config)
    reading = None
    if rows:
        chosen = outline[config["focus"] - config["top"]]
        if chosen["x"] is not None:
            reading = {**chosen, "offset_mm": chosen["offset_px"] * config["mm_per_px"]}
    summary = None
    if body is not None:
        summary = {key: body[key] for key in ("area", "rows", "edge_streak", "focus_gap", "candidates")}
    return {"reading": reading, "profile": rows, "outline": outline,
            "focus": config["focus"], "body": summary}


def practice():
    width, height = 772, 460
    cfg = settings({"left": 106, "right": 659, "top": 103, "bottom": 333, "focus": 172,
                    "side": "left", "cutoff": 138, "mm_per_px": 0.2}, (width, height))
    y, x = np.indices((height, width))
    left = np.floor(207 + 19 * np.sin((y - 112) / 28) + 8 * np.sin(y / 9)
                    + 60 * np.exp(-((y - 261) / 17)**2) + 4 * np.sin(y * 0.59))
    right = np.floor(700 + 17 * np.sin(y / 32) + 4 * np.sin(y * 0.34)
                     - 25 * np.exp(-((y - 302) / 21)**2))
    top = 80 + 18 * np.maximum(0, 1 - ((x - 382) / 175)**2)
    bottom = 383 - 11 * np.cos((x - 287) / 95)
    solid = (x >= left) & (x <= right) & (y >= top) & (y <= bottom)
    debris = (((x - 146) / 9)**2 + ((y - 158) / 7)**2 <= 1) \
        | (((x - 158) / 8)**2 + ((y - 250) / 6)**2 <= 1) \
        | (((x - 140) / 7)**2 + ((y - 296) / 8)**2 <= 1)
    base_noise = 3 * np.sin(x * 0.41 + y * 0.31) + 2 * np.sin(0.86 * y - x * 0.18)
    backdrop = np.array([37, 50, 54])
    mica = 10 * np.sin((x + 2.1 * y) / 51) + 6 * np.sin((x * 0.3 - y) / 17)
    resin = np.array([219, 175, 111]) + mica[..., None]
    gleam = (x >= left + 2) & (x <= left + 6)
    resin = resin + 16 * gleam[..., None]
    grit = np.array([207, 172, 119]) + 6 * np.sin((x * 1.7 + y * 0.9) / 5)[..., None]
    resin = np.where(debris[..., None], grit, resin)
    solid = solid | debris
    frame = (np.where(solid[..., None], resin, backdrop) + base_noise[..., None]).clip(0, 255)
    speck = np.zeros((height, width), bool)
    speck[180:182, 195:202] = True
    speck[220:222, 130:137] = True
    speck[200:202, 300:306] = True
    frame[speck] = 255
    photo = Image.fromarray(frame.astype("uint8"), "RGB")
    draw = ImageDraw.Draw(photo)
    draw.text((108, 36), "AMBER RESIN / FRACTURE + DEBRIS", fill="#d0dacf", font=ImageFont.load_default(size=14))
    draw.text((108, 420), "SIMULATED FRAGMENT PHOTO", fill="#b9c6bf", font=ImageFont.load_default(size=12))
    draw.line((574, 420, 624, 420), fill="#dae0d5", width=2)
    for ix in (574, 599, 624):
        draw.line((ix, 420, ix, 413), fill="#dae0d5", width=2)
    draw.text((633, 413), "10 mm", fill="#dae0d5", font=ImageFont.load_default(size=12))
    return photo.size, png(photo), cfg
