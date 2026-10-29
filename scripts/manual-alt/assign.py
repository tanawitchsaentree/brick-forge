import json, math, statistics, sys
from collections import Counter
W = float(sys.argv[1]) if len(sys.argv) > 1 else 0.6
m = json.load(open("/tmp/pdf30714/matches.json"))
cand = json.load(open("/tmp/pdf30714/candidates.json"))
cap = Counter()
for c in cand: cap[(c["rb"], c["colorName"])] += c["qty"]
# Drawing scale: page size per stud, from the confident matches (one scale for the whole booklet).
k = statistics.median(r["diag"] / r["top"][0]["size"] for r in m if r["top"][0]["iou"] > 0.9)
for r in m:
    for t in r["top"]:
        t["sized"] = t["score"] + W * abs(math.log(r["diag"] / (k * t["size"])))
    r["top"].sort(key=lambda t: t["sized"])
pairs = []
for i, r in enumerate(m):
    best = r["top"][0]["sized"]
    for t in r["top"]:
        pairs.append((t["sized"] - best * 0.5, i, (t["part"], t["color"])))
pairs.sort()
left = Counter(cap); assigned = {}
for _, i, key in pairs:
    if i in assigned or left[key] < m[i]["qty"]: continue
    assigned[i] = key; left[key] -= m[i]["qty"]
forced = [(m[i]["step"], m[i]["top"][0]["part"], assigned[i][0]) for i in assigned if assigned[i] != (m[i]["top"][0]["part"], m[i]["top"][0]["color"])]
print(f"scale {k:.1f} pt/stud; assigned {len(assigned)}/{len(m)}; forced by the set's counts: {forced}")
json.dump([{**m[i], "part": assigned[i][0], "color": assigned[i][1]} for i in sorted(assigned)], open("/tmp/pdf30714/steps.json", "w"), indent=1)
