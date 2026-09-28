#!/usr/bin/env python3
"""Build a pixel-exact web font from an Angband .fon, for the window chrome.

Upstream's SDL2 front end draws its menus and dialogs in the 8x13 bitmap font
(DEFAULT_DIALOG_FONT in reference/src/main-sdl2.c). The panel title bars, tabs
and buttons here use the same font so the chrome matches the game. Each set
pixel becomes one square in the outline, so at a CSS font-size equal to the
font's pixel height every glyph lands on whole pixels.

The .fon glyphs are GPL (reference/docs/copying.rst): by Leon Marrick, Sheldon
Simms III and/or Nick McConnell. reference/ is not tracked in this repo, so this
is a dev-time regeneration step; the generated .woff2 is what ships. Needs
fontTools and brotli.

Usage (from the repo root):
    python packages/web/scripts/fon-to-woff2.py \
        reference/lib/fonts/8x13x.fon packages/web/public/fonts/angband-8x13.woff2
"""
import importlib.util
import os
import struct
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

UNIT = 64  # font units per source pixel

_spec = importlib.util.spec_from_file_location(
    "extract_fon", os.path.join(os.path.dirname(__file__), "extract-fon.py")
)
extract_fon = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(extract_fon)


def glyph_for(rows, w, h, ascent):
    """Draw one glyph as horizontal runs of pixels, top row first."""
    pen = TTGlyphPen(None)
    for r, mask in enumerate(rows):
        top = (ascent - r) * UNIT
        bottom = top - UNIT
        x = 0
        while x < w:
            if mask >> (w - 1 - x) & 1:
                start = x
                while x < w and mask >> (w - 1 - x) & 1:
                    x += 1
                left, right = start * UNIT, x * UNIT
                pen.moveTo((left, bottom))
                pen.lineTo((left, top))
                pen.lineTo((right, top))
                pen.lineTo((right, bottom))
                pen.closePath()
            else:
                x += 1
    return pen.glyph()


def main():
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, "rb") as f:
        data = f.read()
    off, _ = extract_fon.find_first_fnt(data)
    ver, w, h, glyphs = extract_fon.parse_fnt(data, off)
    ascent = struct.unpack_from("<H", data, off + 0x4A)[0]
    family = f"Angband {w}x{h}"

    order = [".notdef"]
    outlines = {".notdef": TTGlyphPen(None).glyph()}
    cmap = {}
    # The X11-derived .fon files are Latin-1 above ASCII, not CP437, and some
    # of those slots are blank. Only ASCII and drawn Latin-1 glyphs are mapped.
    for code in [*range(32, 127), *range(0xA0, 256)]:
        rows = glyphs.get(code, [0] * h)
        if code > 0x20 and code != 0xA0 and not any(rows):
            continue
        char = chr(code)
        name = f"g{code:03d}"
        order.append(name)
        outlines[name] = glyph_for(rows, w, h, ascent)
        cmap[ord(char)] = name

    fb = FontBuilder(h * UNIT, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(outlines)
    fb.setupHorizontalMetrics({name: (w * UNIT, 0) for name in order})
    fb.setupHorizontalHeader(ascent=ascent * UNIT, descent=-(h - ascent) * UNIT)
    fb.setupNameTable({"familyName": family, "styleName": "Regular"})
    fb.setupOS2(
        sTypoAscender=ascent * UNIT,
        sTypoDescender=-(h - ascent) * UNIT,
        sTypoLineGap=0,
        usWinAscent=ascent * UNIT,
        usWinDescent=(h - ascent) * UNIT,
        xAvgCharWidth=w * UNIT,
    )
    fb.setupPost(isFixedPitch=1)
    fb.font.flavor = "woff2"
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    fb.save(dst)
    sys.stderr.write(
        f"wrote {dst}: FNT v0x{ver:04x} {w}x{h}, {len(cmap)} characters, family '{family}'\n"
    )


if __name__ == "__main__":
    main()
