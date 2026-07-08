#!/usr/bin/env python3
"""Golden-vector generator for the Neo Angband RNG port.

Independent re-implementation of reference/src/z-rand.c (Angband 4.2.6) with
explicit uint32 masking, used as a cross-implementation oracle: the TypeScript
port (packages/core/src/rng.ts) must reproduce these outputs exactly.

Run:  python packages/core/scripts/gen-rng-vectors.py
Writes: packages/core/vectors/rng-vectors.json
"""

import json
import os

M32 = 0xFFFFFFFF
RAND_DEG = 32
MAX_RAND_DEPTH = 128


def lcrng(x: int) -> int:
    return (x * 1103515245 + 12345) & M32


RAND_NORMAL_TABLE = [
    206, 613, 1022, 1430, 1838, 2245, 2652, 3058,
    3463, 3867, 4271, 4673, 5075, 5475, 5874, 6271,
    6667, 7061, 7454, 7845, 8234, 8621, 9006, 9389,
    9770, 10148, 10524, 10898, 11269, 11638, 12004, 12367,
    12727, 13085, 13440, 13792, 14140, 14486, 14828, 15168,
    15504, 15836, 16166, 16492, 16814, 17133, 17449, 17761,
    18069, 18374, 18675, 18972, 19266, 19556, 19842, 20124,
    20403, 20678, 20949, 21216, 21479, 21738, 21994, 22245,
    22493, 22737, 22977, 23213, 23446, 23674, 23899, 24120,
    24336, 24550, 24759, 24965, 25166, 25365, 25559, 25750,
    25937, 26120, 26300, 26476, 26649, 26818, 26983, 27146,
    27304, 27460, 27612, 27760, 27906, 28048, 28187, 28323,
    28455, 28585, 28711, 28835, 28955, 29073, 29188, 29299,
    29409, 29515, 29619, 29720, 29818, 29914, 30007, 30098,
    30186, 30272, 30356, 30437, 30516, 30593, 30668, 30740,
    30810, 30879, 30945, 31010, 31072, 31133, 31192, 31249,
    31304, 31358, 31410, 31460, 31509, 31556, 31601, 31646,
    31688, 31730, 31770, 31808, 31846, 31882, 31917, 31950,
    31983, 32014, 32044, 32074, 32102, 32129, 32155, 32180,
    32205, 32228, 32251, 32273, 32294, 32314, 32333, 32352,
    32370, 32387, 32404, 32420, 32435, 32450, 32464, 32477,
    32490, 32503, 32515, 32526, 32537, 32548, 32558, 32568,
    32577, 32586, 32595, 32603, 32611, 32618, 32625, 32632,
    32639, 32645, 32651, 32657, 32662, 32667, 32672, 32677,
    32682, 32686, 32690, 32694, 32698, 32702, 32705, 32708,
    32711, 32714, 32717, 32720, 32722, 32725, 32727, 32729,
    32731, 32733, 32735, 32737, 32739, 32740, 32742, 32743,
    32745, 32746, 32747, 32748, 32749, 32750, 32751, 32752,
    32753, 32754, 32755, 32756, 32757, 32757, 32758, 32758,
    32759, 32760, 32760, 32761, 32761, 32761, 32762, 32762,
    32763, 32763, 32763, 32764, 32764, 32764, 32764, 32765,
    32765, 32765, 32765, 32766, 32766, 32766, 32766, 32767,
]
assert len(RAND_NORMAL_TABLE) == 256


class Rng:
    """Mirror of the z-rand.c state machine (complex WELL1024a + quick LCRNG)."""

    def __init__(self, seed: int, quick: bool = False):
        self.quick = quick
        self.value = seed & M32  # Rand_value (quick mode)
        self.state = [0] * RAND_DEG
        self.i = 0
        self.fixed = False
        self.fixval = 0
        if not quick:
            self.state_init(seed)

    def state_init(self, seed: int) -> None:
        self.state = [0] * RAND_DEG
        self.i = 0
        self.state[0] = seed & M32
        for i in range(1, RAND_DEG):
            self.state[i] = lcrng(self.state[i - 1])
        for _ in range(RAND_DEG * 10):
            j = (self.i + 1) % RAND_DEG
            self.state[j] = (self.state[j] + self.state[self.i]) & M32
            self.i = j

    def well(self) -> int:
        s, i = self.state, self.i
        v0 = s[i]
        vm1 = s[(i + 3) & 31]
        vm2 = s[(i + 24) & 31]
        vm3 = s[(i + 10) & 31]
        vrm1 = s[(i + 31) & 31]
        z0 = vrm1
        z1 = (v0 ^ (vm1 ^ (vm1 >> 8))) & M32
        z2 = ((vm2 ^ ((vm2 << 19) & M32)) ^ (vm3 ^ ((vm3 << 14) & M32))) & M32
        s[i] = (z1 ^ z2) & M32
        new_v0 = ((z0 ^ ((z0 << 11) & M32))
                  ^ (z1 ^ ((z1 << 7) & M32))
                  ^ (z2 ^ ((z2 << 13) & M32))) & M32
        s[(i + 31) & 31] = new_v0
        self.i = (i + 31) & 31
        return s[self.i]

    def rand_div(self, m: int) -> int:
        assert m <= 0x10000000
        if m <= 1:
            return 0
        if self.fixed:
            # C evaluates rand_fixval * 1000 * (m - 1) in uint32 with wrap.
            t = (self.fixval * 1000) & M32
            t = (t * (m - 1)) & M32
            return t // (100 * 1000)
        n = 0x10000000 // m
        while True:
            if self.quick:
                self.value = lcrng(self.value)
                r = ((self.value >> 4) & 0x0FFFFFFF) // n
            else:
                r = ((self.well() >> 4) & 0x0FFFFFFF) // n
            if r < m:
                return r

    def randint0(self, m: int) -> int:
        return self.rand_div(m)

    def randint1(self, m: int) -> int:
        return self.rand_div(m) + 1

    def one_in(self, x: int) -> bool:
        return self.randint0(x) == 0

    def rand_range(self, a: int, b: int) -> int:
        if a == b:
            return a
        assert a < b
        return a + self.rand_div(1 + b - a)

    def rand_normal(self, mean: int, stand: int) -> int:
        if stand < 1:
            return mean
        tmp = self.randint0(32768)
        low, high = 0, 256
        while low < high:
            mid = (low + high) >> 1
            if RAND_NORMAL_TABLE[mid] < tmp:
                low = mid + 1
            else:
                high = mid
        offset = (stand * low) // 64
        if self.one_in(2):
            return mean - offset
        return mean + offset

    def rand_sample(self, mean, upper, lower, stand_u, stand_l):
        pick = self.rand_normal(0, 1000)
        if pick > 0:
            pick = pick * (upper - mean)
            pick = pick // (100 * stand_u)  # positive: floor == trunc
        elif pick < 0:
            pick = pick * (mean - lower)
            # C int division truncates toward zero; pick is negative here
            q = abs(pick) // (100 * stand_l)
            pick = -q
        return mean + pick

    def damroll(self, num: int, sides: int) -> int:
        if sides <= 0:
            return 0
        return sum(self.randint1(sides) for _ in range(num))

    def _simulate_division(self, dividend: int, divisor: int) -> int:
        q = dividend // divisor
        r = dividend % divisor
        if self.randint0(divisor) < r:
            q += 1
        return q

    def m_bonus(self, max_: int, level: int) -> int:
        if level >= MAX_RAND_DEPTH:
            level = MAX_RAND_DEPTH - 1
        bonus = self._simulate_division(max_ * level, MAX_RAND_DEPTH)
        stand = self._simulate_division(max_, 4)
        value = self.rand_normal(bonus, stand)
        if value < 0:
            return 0
        if value > max_:
            return max_
        return value


def seq(fn, n):
    return [fn() for _ in range(n)]


def main() -> None:
    out = {"baseline": "4.2.6", "source": "reference/src/z-rand.c", "seeds": {}}

    for seed in [1, 42, 123456789, 0xDEADBEEF]:
        r = Rng(seed)
        entry = {
            "state_after_init": list(r.state),
            "state_i_after_init": r.i,
        }
        # Sequential consumption; the TS test must replay in this exact order.
        entry["raw28"] = seq(lambda: r.rand_div(0x10000000), 40)
        entry["div10"] = seq(lambda: r.rand_div(10), 20)
        entry["div6"] = seq(lambda: r.rand_div(6), 20)
        entry["div100"] = seq(lambda: r.rand_div(100), 20)
        entry["normal_100_10"] = seq(lambda: r.rand_normal(100, 10), 20)
        entry["damroll_3d6"] = seq(lambda: r.damroll(3, 6), 20)
        entry["mbonus_10_50"] = seq(lambda: r.m_bonus(10, 50), 20)
        entry["rand_range_5_15"] = seq(lambda: r.rand_range(5, 15), 20)
        entry["sample_10_20_0_15_10"] = seq(
            lambda: r.rand_sample(10, 20, 0, 15, 10), 20)
        out["seeds"][str(seed)] = entry

    q = Rng(42, quick=True)
    out["quick_seed_42"] = {
        "div100": seq(lambda: q.rand_div(100), 20),
        "final_value": q.value,
    }

    fixed = {}
    for val in [0, 37, 50, 100]:
        r = Rng(1)
        r.fixed = True
        r.fixval = val
        fixed[str(val)] = {
            str(m): r.rand_div(m) for m in [2, 10, 100, 0x10000000]
        }
    out["fixed"] = fixed

    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.normpath(os.path.join(here, "..", "vectors"))
    os.makedirs(dest, exist_ok=True)
    path = os.path.join(dest, "rng-vectors.json")
    with open(path, "w", newline="\n") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print("wrote", path)


if __name__ == "__main__":
    main()
