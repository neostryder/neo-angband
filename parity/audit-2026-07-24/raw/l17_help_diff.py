#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]

ref = (ROOT / "reference/lib/help/symbols.txt").read_text(encoding="utf-8")
pairs = []
in_mon = False
for line in ref.splitlines():
    if line.startswith("Monsters"):
        in_mon = True
        continue
    if in_mon:
        if not line.strip():
            if pairs:
                break
            continue
        m = re.match(r"^(.)  (.+?)(?: {2,})(.)  (.+)$", line)
        if m:
            pairs.append((m.group(1), m.group(2).strip()))
            pairs.append((m.group(3), m.group(4).strip()))
        else:
            m = re.match(r"^(.)  (.+)$", line)
            if m:
                pairs.append((m.group(1), m.group(2).strip()))

src = (ROOT / "packages/web/src/help.ts").read_text(encoding="utf-8")
m = re.search(r"const MONSTERS: Glyphs = \[(.*?)\];", src, re.S)
body = m.group(1)
port = re.findall(r'\["(.)", "((?:\\.|[^"\\])*)"\]|\["(.)", \'((?:\\.|[^\'\\])*)\'\]', body)
# better
port = []
for mm in re.finditer(r'\[("|\')(.)\1, ("|\')(.*?)\3\]', body):
    port.append((mm.group(2), mm.group(4)))

print("ref", len(pairs), "port", len(port))
pref = {g: d for g, d in pairs}
pport = {g: d for g, d in port}
for g in sorted(set(pref) | set(pport), key=lambda x: (x.lower(), x)):
    a, b = pref.get(g), pport.get(g)
    if a != b:
        print(f"diff {g!r}: ref={a!r} port={b!r}")

# FEATURES order
print("\n--- FEATURES_NO_LOS port order ---")
m = re.search(r"const FEATURES_NO_LOS: Glyphs = \[(.*?)\];", src, re.S)
for mm in re.finditer(r'\[("|\')(.)\1, ("|\')(.*?)\3\]', m.group(1)):
    print(mm.group(2), mm.group(4))

# Does core load message colors from prf?
print("\n--- message.prf / colorDefine usage ---")
for p in (ROOT / "packages").rglob("*.ts"):
    if any(x in p.parts for x in ("node_modules", "dist", "borg")):
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    if "colorDefine" in t or "message.prf" in t or "HITPOINT_WARN" in t:
        print(p.relative_to(ROOT), [ln for ln in t.splitlines() if "colorDefine" in ln or "message.prf" in ln or "HITPOINT_WARN" in ln][:8])

# keymap default w0 / . run from pref
print("\n--- pref.prf special acts ---")
pref_txt = (ROOT / "reference/lib/customize/pref.prf").read_text(encoding="utf-8")
# find blocks for special
for act in ["w0", ".", ",", ".5"]:
    pass
# show lines around special acts
for i, line in enumerate(pref_txt.splitlines(), 1):
    if line.startswith("keymap-act:") and not re.fullmatch(r"keymap-act:[;,+][1-9]", line) and not re.fullmatch(r"keymap-act:\.[1-9]", line):
        print(i, line)
    if re.fullmatch(r"keymap-act:\.[1-9]", line):
        print(i, line, "(run dir)")
