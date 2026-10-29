"""Reads a LEGO building-instructions PDF into data the engine can use.

    python3 scripts/read-manual.py booklets/6566090.pdf [--elements /tmp/rb/elements.csv]

What a booklet holds, and how each is read:

  * The parts list (last pages): every element as a picture with its count
    ("4x") and LEGO element ID ("6296132") printed as text. Pairs are made by
    position: the count and the ID sit under their picture.
  * Each step: a callout box at the top with the step's parts (a picture
    and its "1x"), and the step number in large type under it. A "2x" in
    bigger type marks a sub-assembly built more than once.
  * Callout pictures are matched to parts-list pictures by appearance: both
    composited on white (their transparency masks applied) and shrunk to
    24 x 24, then compared by colour distance; the parts list names them.

Accuracy is checked, not assumed: summing every step's parts must give the
parts list's counts (reconciliation). The report says how close it came.

Writes <pdf>.manual.json next to the PDF: {inventory, steps, check}.
"""
import json
import math
import re
import sys
from collections import Counter, defaultdict

import fitz  # PyMuPDF

pdf = sys.argv[1]
elements_csv = sys.argv[sys.argv.index("--elements") + 1] if "--elements" in sys.argv else None
doc = fitz.open(pdf)

SIZE = 24
LOOSE = 12  # an unlabelled picture counts only when it matches this closely


def picture(xref):
    """An image as SIZE x SIZE RGB on white (alpha applied), or None."""
    try:
        base = fitz.Pixmap(doc, xref)
        info = doc.xref_get_key(xref, "SMask")
        if info[0] == "xref":
            mask = fitz.Pixmap(doc, int(info[1].split()[0]))
            if mask.width == base.width and mask.height == base.height:
                base = fitz.Pixmap(base, mask)
        if base.n - base.alpha < 3:
            base = fitz.Pixmap(fitz.csRGB, base)
        if base.width < 10 or base.height < 10:
            return None
        small = fitz.Pixmap(base, SIZE, SIZE, None)
        s, n, a = small.samples, small.n, small.alpha
        out = []
        for i in range(SIZE * SIZE):
            px = s[i * n:(i + 1) * n]
            alpha = px[-1] / 255 if a else 1
            out += [px[c] * alpha + 255 * (1 - alpha) for c in range(3)]
        return (base.width / base.height, out)
    except Exception:
        return None


def distance(p, q):
    if p is None or q is None:
        return math.inf
    # Aspect ratio must agree (a 1x4 plate isn't a 1x1 drawn small).
    if abs(math.log(p[0] / q[0])) > 0.35:
        return math.inf
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(p[1], q[1])) / len(p[1]))


def spans(page):
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                t = s["text"].strip()
                if t:
                    yield t, s["size"], fitz.Rect(s["bbox"])


def placements(page):
    return [(i["xref"], fitz.Rect(i["bbox"])) for i in page.get_image_info(xrefs=True) if i["xref"]]


def picture_above(rect, imgs, used):
    """The image just above a label (bottom near the label's top, overlapping in x)."""
    best, bd = None, math.inf
    for xref, r in imgs:
        if (xref, tuple(r)) in used or r.width > 120 or r.height > 120:
            continue
        dy = rect.y0 - r.y1
        dx = max(0, r.x0 - rect.x1, rect.x0 - r.x1)
        if -4 <= dy <= 18 and dx <= 12:
            d = dy + dx * 2
            if d < bd:
                best, bd = (xref, r), d
    return best


# ---- the parts list ---------------------------------------------------------------
inventory = []  # {element, qty, xref}
inv_pages = []
for pno in range(doc.page_count - 1, max(-1, doc.page_count - 8), -1):
    page = doc[pno]
    ss = list(spans(page))
    ids = [(t, r) for t, sz, r in ss if re.fullmatch(r"\d{6,8}", t)]
    if len(ids) < 5:
        continue
    inv_pages.append(pno)
    qtys = [(int(t[:-1]), r) for t, sz, r in ss if re.fullmatch(r"\d+x", t)]
    imgs = placements(page)
    used = set()
    for t, r in ids:
        # Its count: the "Nx" right above the ID.
        q = min(qtys, key=lambda qr: abs(qr[1].x0 - r.x0) + abs(r.y0 - qr[1].y1) * 2 if qr[1].y1 <= r.y0 + 2 else math.inf, default=None)
        if not q:
            continue
        pic = picture_above(q[1], imgs, used)
        if pic:
            used.add((pic[0], tuple(pic[1])))
        inventory.append({"element": t, "qty": q[0], "xref": pic[0] if pic else None})
inv_pics = {e["element"]: picture(e["xref"]) for e in inventory if e["xref"]}

# ---- element → part and colour -----------------------------------------------------
part_of = {}
if elements_csv:
    for line in open(elements_csv):
        f = line.rstrip("\n").split(",")
        if len(f) >= 3:
            part_of[f[0]] = (f[1], f[2])
for e in inventory:
    if e["element"] in part_of:
        e["part"], e["rbColor"] = part_of[e["element"]]

# ---- the steps ---------------------------------------------------------------------
steps = []
cache = {}


def pic(xref):
    if xref not in cache:
        cache[xref] = picture(xref)
    return cache[xref]


for pno in range(doc.page_count):
    if pno in inv_pages:
        continue
    page = doc[pno]
    ss = list(spans(page))
    numbers = [(int(t), r) for t, sz, r in ss if re.fullmatch(r"\d{1,3}", t) and sz >= 20]
    if not numbers:
        continue
    labels = [(int(t[:-1]), r) for t, sz, r in ss if re.fullmatch(r"\d+x", t) and sz < 12]
    multipliers = [(int(t[:-1]), r) for t, sz, r in ss if re.fullmatch(r"\d+x", t) and sz >= 12]
    imgs = placements(page)
    used = set()
    found = defaultdict(list)
    for qty, r in labels:
        p = picture_above(r, imgs, used)
        if not p:
            continue
        used.add((p[0], tuple(p[1])))
        # The step it belongs to: the step number nearest below-left of the callout.
        step = min(numbers, key=lambda n: abs(n[1].x0 - r.x0) * 0.5 + abs(n[1].y0 - r.y1) if n[1].y0 >= r.y0 - 5 else math.inf)
        # Which element: the parts-list picture it looks most like.
        best, bd = None, math.inf
        for el, q in inv_pics.items():
            d = distance(pic(p[0]), q)
            if d < bd:
                best, bd = el, d
        found[step[0]].append({"element": best, "qty": qty, "distance": round(bd, 1), "page": pno + 1})
    # Pictures with no count under them (a minifigure's parts, drawn on their
    # own): a close match to a parts-list picture counts as one, at the step
    # whose number is nearest.
    for xref, r in imgs:
        if (xref, tuple(r)) in used or r.width > 60 or r.height > 60 or r.width < 6:
            continue
        best, bd = None, math.inf
        for el, q in inv_pics.items():
            d = distance(pic(xref), q)
            if d < bd:
                best, bd = el, d
        if bd < LOOSE:
            step = min(numbers, key=lambda n: abs(n[1].x0 - r.x0) * 0.5 + abs(n[1].y0 - r.y1))
            found[step[0]].append({"element": best, "qty": 1, "distance": round(bd, 1), "page": pno + 1, "unlabelled": True})
    for n, parts in found.items():
        steps.append({"step": n, "page": pno + 1, "parts": parts, "multipliers": [m for m, _ in multipliers]})

steps.sort(key=lambda s: (s["page"], s["step"]))
# Steps run 1, 2, 3…: anything out of sequence (a bag-intro page's "1x", the
# cover's age) isn't a step. A new booklet in a set may restart at 1.
seq, expected = [], 1
for st in steps:
    if st["step"] == expected or (st["step"] == 1 and expected > 10) or (expected > 1 and expected < st["step"] <= expected + 2):
        seq.append(st)
        expected = st["step"] + 1
steps = seq

# ---- reconciliation ------------------------------------------------------------------
want = {e["element"]: e["qty"] for e in inventory}
got = Counter()
for s in steps:
    for p in s["parts"]:
        if p["element"] and p["distance"] < 40 and not p.get("unlabelled"):
            got[p["element"]] += p["qty"]
# Unlabelled pictures fill only what the labelled ones left short (drawings repeat a part already counted).
for s in steps:
    keep = []
    for p in s["parts"]:
        if p.get("unlabelled"):
            if got[p["element"]] >= want.get(p["element"], 0):
                continue
            got[p["element"]] += 1
        keep.append(p)
    s["parts"] = keep
# Minifigure parts a booklet shows only as a finished figure (never drawn on their own).
categories = {}
try:
    import os
    cat = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "catalog.json")))
    categories = {p["id"]: p["c"] for p in cat["parts"]}
except Exception:
    pass
figure = []
for e in inventory:
    base = re.sub(r"(pr|pat|c|h)\d.*$", "", e.get("part", ""))
    if not got.get(e["element"]) and (categories.get(e.get("part"), "").startswith("Minifig") or re.match(r"^(3626|973|970|971|972|3624|3833|92081|4006|7071|3815|3816|3817|3818|3819|3820)", e.get("part", ""))):
        figure.append(e["element"])
        e["figure"] = True
exact = sum(1 for el, q in want.items() if got.get(el) == q)
pieces = sum(want.values())
placed = sum(min(got.get(el, 0), q) for el, q in want.items())
check = {
    "inventoryKinds": len(want),
    "inventoryPieces": pieces,
    "steps": len(steps),
    "kindsExact": exact,
    "piecesAccounted": placed,
    "accuracy": round(placed / max(1, pieces), 3),
    # The same, leaving out minifigure parts shown only as a finished figure.
    "figureParts": sum(want[el] for el in figure),
    "accuracyBuilt": round(placed / max(1, pieces - sum(want[el] for el in figure)), 3),
    "overCounted": sum(max(0, got.get(el, 0) - q) for el, q in want.items()),
    "unmatchedCallouts": sum(1 for s in steps for p in s["parts"] if p["distance"] >= 40),
}
# ---- into the engine's terms: LDraw part ids and colour codes ------------------------------
# Rebrickable numbers colours its own way; match them to LDraw's by name.
try:
    import csv, os
    here = os.path.dirname(os.path.abspath(__file__))
    cat = json.load(open(os.path.join(here, "..", "public", "catalog.json")))
    ids = {p["id"] for p in cat["parts"]}
    moved = cat.get("moved", {})
    key = lambda n: re.sub(r"[^a-z]", "", n.lower().replace("grey", "gray"))
    by_name = {key(c["name"]): c["code"] for c in cat.get("colors", [])}
    rgb_of = lambda h: tuple(int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    ldraw_rgb = [(c["code"], rgb_of(c["hex"]), bool(c.get("alpha"))) for c in cat.get("colors", []) if c.get("hex")]
    rb_colors = {}
    colors_csv = os.path.join(os.path.dirname(elements_csv or ""), "colors.csv")
    if os.path.exists(colors_csv):
        for r in csv.DictReader(open(colors_csv)):
            rb_colors[r["id"]] = (r["name"], r["rgb"], r["is_trans"] in ("t", "True", "true"))
    for e in inventory:
        part = e.get("part", "")
        base = re.sub(r"(pr|pat)\d+.*$", "", part)  # a printed part: its plain mould
        for cand in (part, moved.get(part), re.sub(r"[a-z]$", "", part), base, moved.get(base)):
            if cand in ids:
                e["ldraw"] = cand
                if cand == base and base != part:
                    e["printed"] = True  # the print isn't in the library; the shape is exact
                break
        name, rgb, trans = rb_colors.get(e.get("rbColor", ""), ("", "", False))
        if key(name) in by_name:
            e["color"] = by_name[key(name)]
        elif rgb:
            # Nearest LDraw colour by RGB, same transparency.
            r0 = rgb_of(rgb)
            near = min((c for c in ldraw_rgb if c[2] == trans) or ldraw_rgb, key=lambda c: sum((a - b) ** 2 for a, b in zip(c[1], r0)))
            e["color"] = near[0]
    check["ldrawParts"] = sum(1 for e in inventory if "ldraw" in e)
    check["ldrawColors"] = sum(1 for e in inventory if "color" in e)
except Exception as err:
    check["ldrawError"] = str(err)

out = {"pdf": pdf, "inventory": inventory, "steps": steps, "check": check}
json.dump(out, open(re.sub(r"\.pdf$", "", pdf) + ".manual.json", "w"), indent=1)
print(json.dumps(check))
