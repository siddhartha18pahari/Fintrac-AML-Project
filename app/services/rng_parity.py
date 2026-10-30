"""Uint32 PRNG shared with web/src/lib/bank-sim/rng.ts. Do not retune the mixer."""

from __future__ import annotations

import math


def _i32(value: int) -> int:
    value &= 0xFFFFFFFF
    if value >= 0x80000000:
        value -= 0x100000000
    return value


def _u32(value: int) -> int:
    return value & 0xFFFFFFFF


def _imul(left: int, right: int) -> int:
    return _i32(_i32(left) * _i32(right))


def quantize(value: float) -> float:
    return math.floor(value * 1e9 + 0.5) / 1e9


class Rng:
    def __init__(self, seed: int) -> None:
        self.state = int(seed) & 0xFFFFFFFF

    def random(self) -> float:
        self.state = _u32(self.state + 0x6D2B79F5)
        t = self.state
        t = _imul(t ^ (t >> 15), _i32(t) | 1)
        mixed = _imul(_u32(t) ^ (_u32(t) >> 7), _i32(t) | 61)
        t = _i32(_i32(t) ^ _i32(_i32(t) + mixed))
        tu = _u32(t)
        return (tu ^ (tu >> 14)) / 4294967296

    def gauss(self, center: float, sigma: float) -> float:
        u = max(1e-9, self.random())
        v = self.random()
        z = quantize(math.sqrt(-2.0 * math.log(u)) * math.cos(2.0 * math.pi * v))
        return quantize(center + sigma * z)

    def integer(self, span: int) -> int:
        return math.floor(self.random() * span)
