"""Align two fracture outlines by shifting whole source rows of the second card."""
import numpy as np

MIN_ROWS = 6
MAX_CANDIDATES = 10


def _series(outline):
    xs = np.array([row["x"] if row["x"] is not None else np.nan for row in outline], dtype=float)
    return outline[0]["y"], xs


def _runs(lo, shift, evidence, good_step, step):
    previous = np.concatenate(([False], evidence[:-1]))
    following = np.concatenate((evidence[1:], [False]))
    bad_before = np.concatenate(([True], ~good_step))
    bad_after = np.concatenate((~good_step, [True]))
    starts = np.flatnonzero(evidence & (~previous | bad_before))
    ends = np.flatnonzero(evidence & (~following | bad_after))
    found = []
    for start, end in zip(starts, ends):
        length = int(end - start + 1)
        if length < MIN_ROWS:
            continue
        steps = step[start:end]
        found.append({
            "shift": shift,
            "y1_first": lo + int(start),
            "y1_last": lo + int(end),
            "y2_first": lo + int(start) + shift,
            "y2_last": lo + int(end) + shift,
            "rows": length,
            "mean_diff": round(float(steps.mean()), 4),
            "max_diff": int(steps.max()),
        })
    return found


def align(first_outline, second_outline, max_shift, tolerance):
    top1, x1 = _series(first_outline)
    top2, x2 = _series(second_outline)
    bottom1 = top1 + len(x1) - 1
    bottom2 = top2 + len(x2) - 1
    candidates = []
    for shift in range(-max_shift, max_shift + 1):
        lo = max(top1, top2 - shift)
        hi = min(bottom1, bottom2 - shift)
        if hi - lo + 1 < MIN_ROWS:
            continue
        a = x1[lo - top1:hi - top1 + 1]
        b = x2[lo + shift - top2:hi + shift - top2 + 1]
        evidence = ~(np.isnan(a) | np.isnan(b))
        step = np.abs(np.diff(a) - np.diff(b))
        good_step = step <= tolerance
        candidates.extend(_runs(lo, shift, evidence, good_step, np.nan_to_num(step, nan=np.inf)))
    candidates.sort(key=lambda c: (-c["rows"], c["mean_diff"], c["max_diff"], abs(c["shift"]), c["shift"]))
    return candidates[:MAX_CANDIDATES]
