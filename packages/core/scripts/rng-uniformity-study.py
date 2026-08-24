#!/usr/bin/env python3
"""Renders the README's RNG uniformity chart.

Draws fresh samples through gen-rng-vectors.py's independent re-implementation
of reference/src/z-rand.c (the same generator checked bit-for-bit against the
TypeScript port by packages/core/src/rng.test.ts) and plots their distribution
against the theoretical shape for each draw type. This is a fresh, reproducible
measurement, not a re-derivation of issue #39's own published numbers - see
that issue for the full statistical battery (streak/serial-correlation tests,
a cross-implementation hash comparison) this chart does not attempt to redo.

Run:  python packages/core/scripts/rng-uniformity-study.py
Writes: docs/img/charts/rng-uniformity.png
Needs: matplotlib, numpy (not part of the project's own dependency tree)
"""

import importlib.util
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gen_rng_vectors", HERE / "gen-rng-vectors.py")
gen_rng_vectors = importlib.util.module_from_spec(spec)
sys.modules["gen_rng_vectors"] = gen_rng_vectors
spec.loader.exec_module(gen_rng_vectors)
Rng = gen_rng_vectors.Rng

N = 1_000_000
SEED = 20260823

rng = Rng(SEED)


def chi_square_uniform(counts):
    n = sum(counts)
    k = len(counts)
    expected = n / k
    stat = sum((c - expected) ** 2 / expected for c in counts)
    df = k - 1
    # Wilson-Hilferty approximation for the chi-square upper-tail p-value.
    if df == 0:
        return stat, 1.0
    z = ((stat / df) ** (1 / 3) - (1 - 2 / (9 * df))) / math.sqrt(2 / (9 * df))
    p = 0.5 * math.erfc(z / math.sqrt(2))
    return stat, p


def d20_samples(n):
    counts = [0] * 20
    for _ in range(n):
        counts[rng.randint1(20) - 1] += 1
    return counts


def dice_sum_samples(n, num, sides):
    lo, hi = num, num * sides
    counts = [0] * (hi - lo + 1)
    for _ in range(n):
        counts[rng.damroll(num, sides) - lo] += 1
    return counts, lo, hi


def d100_samples(n):
    counts = [0] * 100
    for _ in range(n):
        counts[rng.randint1(100) - 1] += 1
    return counts


def wide_range_samples(n, buckets=20, span=1_000_000):
    counts = [0] * buckets
    bucket_size = span // buckets
    for _ in range(n):
        counts[rng.randint0(span) // bucket_size] += 1
    return counts


def dice_sum_theoretical(num, sides, lo, hi):
    # Exact count of ways to reach each sum with `num` dice of `sides` faces.
    ways = [1]
    for _ in range(num):
        nxt = [0] * (len(ways) + sides - 1)
        for i, w in enumerate(ways):
            for face in range(sides):
                nxt[i + face] += w
        ways = nxt
    total = sides ** num
    return [w / total for w in ways]


fig, axes = plt.subplots(2, 2, figsize=(12, 8.5))
fig.suptitle(
    f"Neo Angband RNG: observed frequency over {N:,} draws (seed {SEED})",
    fontsize=13,
)

# Panel 1: d20, flat distribution.
counts = d20_samples(N)
stat, p = chi_square_uniform(counts)
ax = axes[0][0]
xs = np.arange(1, 21)
ax.bar(xs, counts, color="#3b6ea5", width=0.8)
ax.axhline(N / 20, color="#c0392b", linewidth=1.2, linestyle="--", label="expected (flat)")
ax.set_title(f"d20  (chi-sq={stat:.1f}, df=19, p={p:.3f})")
ax.set_xlabel("result")
ax.set_ylabel("count")
ax.set_xticks(xs)
ax.legend(fontsize=8)

# Panel 2: 3d6, triangular-shaped distribution (not flat - proves shape, not just spread).
counts3, lo3, hi3 = dice_sum_samples(N, 3, 6)
theo3 = dice_sum_theoretical(3, 6, lo3, hi3)
expected3 = [t * N for t in theo3]
stat3 = sum((c - e) ** 2 / e for c, e in zip(counts3, expected3))
df3 = len(counts3) - 1
z3 = ((stat3 / df3) ** (1 / 3) - (1 - 2 / (9 * df3))) / math.sqrt(2 / (9 * df3))
p3 = 0.5 * math.erfc(z3 / math.sqrt(2))
ax = axes[0][1]
xs3 = np.arange(lo3, hi3 + 1)
ax.bar(xs3, counts3, color="#3b6ea5", width=0.8, label="observed")
ax.plot(xs3, expected3, color="#c0392b", linewidth=1.6, marker="o", markersize=3, label="expected (exact)")
ax.set_title(f"3d6  (chi-sq={stat3:.1f}, df={df3}, p={p3:.3f})")
ax.set_xlabel("result")
ax.set_ylabel("count")
ax.legend(fontsize=8)

# Panel 3: d100, flat distribution.
counts100 = d100_samples(N)
stat100, p100 = chi_square_uniform(counts100)
ax = axes[1][0]
xs100 = np.arange(1, 101)
ax.bar(xs100, counts100, color="#3b6ea5", width=1.0)
ax.axhline(N / 100, color="#c0392b", linewidth=1.2, linestyle="--", label="expected (flat)")
ax.set_title(f"d100  (chi-sq={stat100:.1f}, df=99, p={p100:.3f})")
ax.set_xlabel("result")
ax.set_ylabel("count")
ax.legend(fontsize=8)

# Panel 4: wide-range draw (0..999,999), binned into 20 buckets, flat distribution.
countsw = wide_range_samples(N, buckets=20, span=1_000_000)
statw, pw = chi_square_uniform(countsw)
ax = axes[1][1]
xsw = np.arange(20)
ax.bar(xsw, countsw, color="#3b6ea5", width=0.8)
ax.axhline(N / 20, color="#c0392b", linewidth=1.2, linestyle="--", label="expected (flat)")
ax.set_title(f"wide range (0..999,999)  (chi-sq={statw:.1f}, df=19, p={pw:.3f})")
ax.set_xlabel("bucket")
ax.set_ylabel("count")
ax.legend(fontsize=8)

fig.tight_layout(rect=(0, 0, 1, 0.95))

default_out = HERE / ".." / ".." / ".." / "docs" / "img" / "charts" / "rng-uniformity.png"
out = Path(sys.argv[1]) if len(sys.argv) > 1 else default_out.resolve()
out.parent.mkdir(parents=True, exist_ok=True)
fig.savefig(out, dpi=150)
print("wrote", out)
print(f"d20:    chi-sq={stat:.2f} df=19 p={p:.4f}")
print(f"3d6:    chi-sq={stat3:.2f} df={df3} p={p3:.4f}")
print(f"d100:   chi-sq={stat100:.2f} df=99 p={p100:.4f}")
print(f"wide:   chi-sq={statw:.2f} df=19 p={pw:.4f}")
