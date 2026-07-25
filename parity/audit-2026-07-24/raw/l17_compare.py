#!/usr/bin/env python3
"""Compare L17 reference assets vs port embeddings."""
from pathlib import Path
import re
import hashlib

ROOT = Path(__file__).resolve().parents[3]


def unesc(s: str) -> str:
    return bytes(s, "utf-8").decode("unicode_escape")


def extract_ts_string_array(src: str, name: str) -> list[str]:
    m = re.search(rf"const {name}: readonly string\[\] = \[(.*?)\];", src, re.S)
    if not m:
        raise SystemExit(f"array {name} not found")
    body = m.group(1)
    # match "..." or '...'
    parts = re.findall(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'', body)
    out = []
    for p in parts:
        out.append(unesc(p[1:-1]))
    return out


def cmp_lines(label: str, ref: list[str], port: list[str]) -> int:
    print(f"\n=== {label} ===")
    print(f"ref={len(ref)} port={len(port)}")
    n = 0
    for i, (a, b) in enumerate(zip(ref, port)):
        if a != b:
            n += 1
            print(f"  mismatch[{i}]")
            print(f"    R: {a!r}")
            print(f"    P: {b!r}")
    if len(ref) > len(port):
        print(f"  extra ref lines {len(port)}..{len(ref)-1}: {ref[len(port):]!r}")
        n += len(ref) - len(port)
    if len(port) > len(ref):
        print(f"  extra port lines {len(ref)}..{len(port)-1}: {port[len(ref):]!r}")
        n += len(port) - len(ref)
    if n == 0:
        print("  OK exact match")
    return n


def main() -> None:
    screens = (ROOT / "packages/web/src/screens.ts").read_text(encoding="utf-8")
    news_ts = (ROOT / "packages/web/src/news.ts").read_text(encoding="utf-8")

    dead_ref = (ROOT / "reference/lib/screens/dead.txt").read_text(encoding="utf-8").splitlines()
    dead_port = extract_ts_string_array(screens, "DEAD_TOMB_ART")
    cmp_lines("dead.txt vs DEAD_TOMB_ART", dead_ref, dead_port)

    crown_ref = (ROOT / "reference/lib/screens/crown.txt").read_text(encoding="utf-8").splitlines()
    # C skips first line (width) then dumps rest starting at row i=2
    crown_port = extract_ts_string_array(screens, "CROWN_ART")
    cmp_lines("crown.txt[1:] vs CROWN_ART", crown_ref[1:], crown_port)

    retire_ref = (ROOT / "reference/lib/screens/retire.txt").read_text(encoding="utf-8").splitlines()
    print("\n=== retire.txt ===")
    print(f"ref lines={len(retire_ref)}")
    if "RETIRE" in screens or "retire.txt" in screens:
        print("screens.ts mentions retire")
    else:
        print("screens.ts has NO retire art constant")
    # search whole packages/web/src for retire art fragment
    found = False
    for p in (ROOT / "packages/web/src").rglob("*.ts"):
        t = p.read_text(encoding="utf-8", errors="replace")
        if "___________" in t and "H    *|" in t:
            print(f"  retire art fragment in {p}")
            found = True
        if "retire.txt" in t:
            print(f"  retire.txt mentioned in {p.relative_to(ROOT)}")
    if not found:
        print("  NO retire art embedded anywhere in packages/web/src")

    news_ref = (ROOT / "reference/lib/screens/news.txt").read_text(encoding="utf-8").splitlines()
    news_port = extract_ts_string_array(news_ts, "NEWS")
    cmp_lines("news.txt vs NEWS", news_ref, news_port)

    # trailing space / whitespace note for dead
    print("\n=== dead trailing whitespace check ===")
    for i, (a, b) in enumerate(zip(dead_ref, dead_port)):
        if a.rstrip() == b.rstrip() and a != b:
            print(f"  trail ws only [{i}]: Rlen={len(a)} Plen={len(b)}")

    # fonts
    print("\n=== fonts in packages ===")
    fonts = list((ROOT / "packages").rglob("*.fon"))
    fonts = [f for f in fonts if "node_modules" not in f.parts and "dist" not in f.parts]
    woff = list((ROOT / "packages").rglob("*.woff"))
    woff = [f for f in woff if "node_modules" not in f.parts and "dist" not in f.parts]
    print("fon files:", fonts)
    print("woff files:", woff)
    font_ts = list((ROOT / "packages/web/src").glob("font-*.ts"))
    print("font-*.ts:", [p.name for p in font_ts])

    # customize prf mentions
    print("\n=== customize prf presence ===")
    for name in [
        "font.prf", "font-gcu.prf", "font-ibm.prf", "font-sdl.prf",
        "font-sdl2.prf", "font-win.prf", "font-x11.prf",
        "message.prf", "pref.prf", "sound.prf", "user.prf",
    ]:
        hits = []
        for p in (ROOT / "packages").rglob("*"):
            if p.is_file() and name in p.name and "node_modules" not in p.parts and "dist" not in p.parts and "borg" not in p.parts:
                hits.append(str(p.relative_to(ROOT)))
        # content references
        content_hits = []
        for p in (ROOT / "packages").rglob("*.{ts,mjs,js,json,md}"):
            pass
        print(f"  {name}: files={hits or 'NONE'}")


if __name__ == "__main__":
    main()
