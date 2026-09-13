"""Synthesize the STILL LIFE soundtrack + SFX straight to Ogg Vorbis.

Everything here is generated - no samples. The house style is:
detuned pads that beat slowly against each other, tape wow, a room that is
too big, and a 120 Hz fluorescent hum sitting under all of it.
"""
import math, os, sys
import numpy as np
import soundfile as sf

SR = 22050
ROOT = os.path.join(os.path.dirname(__file__), "..")
SND = os.path.join(ROOT, "packs", "StillLife_RP", "sounds")
rng = np.random.default_rng(20250913)


def t(sec):
    return np.arange(int(sec * SR)) / SR


def sine(f, sec, phase=0.0):
    return np.sin(2 * np.pi * f * t(sec) + phase)


def saw(f, sec):
    x = t(sec) * f
    return 2 * (x - np.floor(x + 0.5))


def noise(sec):
    return rng.standard_normal(int(sec * SR))


def env(sig, a=0.01, d=0.1, s=0.7, r=0.3):
    n = len(sig)
    ai, di = int(a * SR), int(d * SR)
    ri = int(r * SR)
    si = max(0, n - ai - di - ri)
    e = np.concatenate([
        np.linspace(0, 1, ai, endpoint=False) if ai else np.array([]),
        np.linspace(1, s, di, endpoint=False) if di else np.array([]),
        np.full(si, s),
        np.linspace(s, 0, ri) if ri else np.array([]),
    ])
    e = np.resize(e, n)
    return sig * e


def lp_fast(sig, cut, order=2):
    """FFT brick-ish lowpass with a soft knee - much faster for long pads."""
    n = len(sig)
    S = np.fft.rfft(sig)
    f = np.fft.rfftfreq(n, 1 / SR)
    S *= 1.0 / (1.0 + (f / max(1e-6, cut)) ** (2 * order))
    return np.fft.irfft(S, n)


def hp_fast(sig, cut, order=2):
    n = len(sig)
    S = np.fft.rfft(sig)
    f = np.fft.rfftfreq(n, 1 / SR)
    with np.errstate(divide="ignore"):
        S *= 1.0 / (1.0 + (max(1e-6, cut) / np.maximum(f, 1e-6)) ** (2 * order))
    return np.fft.irfft(S, n)


def _comb(x, d, g):
    """y[n] = x[n] + g*y[n-d], vectorised by folding the signal into rows of d."""
    n = len(x)
    y = np.concatenate([x, np.zeros((-n) % d)]).reshape(-1, d)
    for i in range(1, y.shape[0]):
        y[i] += g * y[i - 1]
    return y.reshape(-1)[:n]


def _allpass(x, d, g):
    v = _comb(x, d, g)
    return -g * v + np.concatenate([np.zeros(d), v[:-d]])


def reverb(sig, room=0.86, mix=0.45, pre=0.02):
    """The backrooms are a very large carpeted box."""
    x = np.concatenate([np.zeros(int(pre * SR)), sig])
    wet = np.zeros(len(x))
    for dly, g in ((1687, 0.84), (1601, 0.86), (2053, 0.82),
                   (2251, 0.80), (2999, 0.78), (3331, 0.76)):
        wet += _comb(x, int(dly * (room / 0.86)), min(0.96, g * room)) / 6.0
    for dly, g in ((389, 0.7), (127, 0.7), (53, 0.7)):
        wet = _allpass(wet, dly, g)
    wet = wet[:len(sig)] if len(wet) >= len(sig) else np.concatenate(
        [wet, np.zeros(len(sig) - len(wet))])
    return sig * (1 - mix) + wet * mix


def wow(sig, depth=0.0035, rate=0.23, rate2=1.7):
    """Tape wow + flutter: the world's recording of itself is not stable."""
    n = len(sig)
    ti = np.arange(n) / SR
    warp = (np.sin(2 * np.pi * rate * ti) * depth
            + np.sin(2 * np.pi * rate2 * ti + 1.1) * depth * 0.28)
    idx = np.clip(np.arange(n) + warp * SR, 0, n - 1)
    return np.interp(idx, np.arange(n), sig)


def pad(freqs, sec, detune=0.4, bright=900):
    out = np.zeros(int(sec * SR))
    for f in freqs:
        for k, dt in enumerate((-detune, 0.0, detune)):
            ph = rng.random() * 6.283
            out += saw(f + dt, sec) * (0.5 if k == 1 else 0.32)
            out += sine(f * 2, sec, ph) * 0.10
    out /= max(1.0, len(freqs) * 1.6)
    return lp_fast(out, bright)


def hum(sec, f=120.0, level=0.05):
    """Fluorescent ballast: 120 Hz + odd harmonics + a whine at 6.2k."""
    o = sine(f, sec) * 1.0 + sine(f * 3, sec) * 0.28 + sine(f * 5, sec) * 0.12
    o += sine(6200, sec) * 0.05 * (1 + 0.3 * sine(0.7, sec))
    o += lp_fast(noise(sec), 400) * 0.35
    return o * level


def swell(sec, f0, f1, level=0.5):
    k = np.linspace(f0, f1, int(sec * SR))
    ph = 2 * np.pi * np.cumsum(k) / SR
    return np.sin(ph) * level


def loopify(sig, xf=4.0):
    """Crossfade the tail into the head so the track loops seamlessly."""
    n = int(xf * SR)
    if n * 2 >= len(sig):
        return sig
    head, tail = sig[:n].copy(), sig[-n:].copy()
    f = np.linspace(0, 1, n)
    sig = sig[:-n]
    sig[:n] = head * f + tail * (1 - f)
    return sig


def norm(sig, peak=0.85):
    m = np.max(np.abs(sig))
    return sig * (peak / m) if m > 0 else sig


def soft(sig, k=1.4):
    return np.tanh(sig * k) / math.tanh(k)


# Vorbis overshoots hard on razor transients; these three get extra headroom
# so nothing clips on decode. Playback volume is set in sound_definitions.json.
PEAK_OVERRIDE = {"sl_betray": 0.48, "sl_jumpscare": 0.48,
                 "sl_noclip": 0.50, "sl_camera": 0.62}


def save(name, sig, sub="music", peak=0.85):
    peak = PEAK_OVERRIDE.get(name, peak)
    d = os.path.join(SND, sub)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".ogg")
    sf.write(p, norm(sig, peak).astype(np.float32), SR, format="OGG", subtype="VORBIS")
    print(f"  {sub}/{name}.ogg  {len(sig)/SR:5.1f}s  {os.path.getsize(p)//1024:4d} KB")


# --------------------------------------------------------------- the music
def m_liminal_1():
    """EMPTY ROOMS - the overworld when the world starts noticing you."""
    L = 76
    A = 55.0
    chords = [[A, A * 1.5, A * 2.5, A * 3.0],          # min-ish open
              [A * 0.89, A * 1.335, A * 2.225, A * 2.67],
              [A * 1.19, A * 1.5, A * 2.38, A * 3.17],
              [A * 0.94, A * 1.41, A * 2.35, A * 2.82]]
    out = np.zeros(int(L * SR))
    seg = L / len(chords)
    for i, c in enumerate(chords):
        s = env(pad(c, seg + 3, detune=0.35, bright=780), a=3.0, d=2.0, s=0.85, r=4.0)
        o = int(i * seg * SR)
        out[o:o + len(s)] += s[:max(0, len(out) - o)] * 0.55
    out += hum(L, 120, 0.035)
    # a far-off room tone that breathes
    br = lp_fast(noise(L), 300) * 0.10 * (0.6 + 0.4 * sine(0.06, L))
    out += br
    out = wow(out, 0.004, 0.19, 1.3)
    out = reverb(out, room=0.9, mix=0.55)
    return loopify(soft(out, 1.2), 5.0)


def m_liminal_2():
    """WRONG SUN - daylight that does not feel like daylight."""
    L = 80
    out = np.zeros(int(L * SR))
    base = [65.4, 98.0, 130.8, 196.0]
    out += env(pad(base, L, detune=0.5, bright=620), a=6, d=4, s=0.9, r=8) * 0.5
    # detuned celeste figure, slightly out of time on purpose
    notes = [523.25, 587.33, 698.46, 784.0, 880.0, 659.25]
    tt = 0.0
    i = 0
    while tt < L - 4:
        f = notes[i % len(notes)] * (1.0 + rng.normal(0, 0.004))
        dur = 3.4
        b = (env(sine(f, dur), a=0.004, d=1.2, s=0.18, r=2.0)
             + env(sine(f * 2.01, dur), a=0.004, d=0.6, s=0.08, r=1.4) * 0.4)
        o = int(tt * SR)
        n = min(len(b), len(out) - o)
        out[o:o + n] += b[:n] * 0.20
        tt += rng.uniform(2.1, 4.6)
        i += 1
    out += hum(L, 120, 0.02)
    out = wow(out, 0.0055, 0.13, 2.1)
    return loopify(soft(reverb(out, 0.88, 0.5), 1.1), 5.0)


def m_liminal_3():
    """IT IS STANDING BEHIND YOU - almost nothing, and that is the point."""
    L = 78
    out = np.zeros(int(L * SR))
    out += env(pad([41.2, 61.7], L, detune=0.22, bright=260), a=8, d=6, s=0.95, r=10) * 0.6
    # tinnitus tone that fades in and out
    out += sine(3130, L) * 0.018 * np.clip(sine(0.045, L), 0, 1) ** 2
    # sub thuds at irregular intervals - footsteps in another room
    tt = 5.0
    while tt < L - 3:
        d = 1.6
        b = env(sine(46, d) + sine(31, d) * 0.6, a=0.002, d=0.5, s=0.1, r=1.0)
        b += lp_fast(noise(d), 180) * 0.25 * np.linspace(1, 0, len(b)) ** 3
        o = int(tt * SR)
        n = min(len(b), len(out) - o)
        out[o:o + n] += b[:n] * 0.35
        tt += rng.uniform(5.5, 11.0)
    out += lp_fast(noise(L), 220) * 0.06
    return loopify(soft(reverb(out, 0.93, 0.42), 1.1), 5.0)


def m_backrooms_hum():
    """LEVEL 0 - 600 million square miles of wet carpet."""
    L = 72
    out = hum(L, 120, 0.55)
    out += hum(L, 121.4, 0.30)          # a second ballast, slightly off - beating
    out += sine(60, L) * 0.10
    out += lp_fast(noise(L), 900) * 0.09
    # a fixture somewhere failing
    for start in (11.0, 29.5, 51.0):
        d = 2.2
        flick = (noise(d) * 0.30 + sine(120, d) * 0.5) * (rng.random(int(d * SR)) > 0.35)
        o = int(start * SR)
        n = min(len(flick), len(out) - o)
        out[o:o + n] += hp_fast(flick[:n], 700) * 0.5
    out = reverb(out, 0.95, 0.35)
    return loopify(soft(out, 1.05), 5.0)


def m_theme_tall():
    """THE TALL ONE - a boss theme built on a heartbeat that is not yours."""
    L = 74
    out = np.zeros(int(L * SR))
    out += env(pad([36.7, 55.0, 73.4], L, detune=0.7, bright=420), a=2, d=3, s=0.9, r=6) * 0.55
    bpm = 46.0
    step = 60.0 / bpm
    tt = 0.0
    while tt < L - 2:
        for off, amp in ((0.0, 1.0), (0.30, 0.62)):     # lub-dub
            d = 0.9
            b = env(sine(52, d) * 1.0 + sine(35, d) * 0.8, a=0.001, d=0.20, s=0.0, r=0.3)
            b += lp_fast(noise(d), 140) * 0.4 * np.linspace(1, 0, len(b)) ** 4
            o = int((tt + off) * SR)
            n = min(len(b), len(out) - o)
            if n > 0:
                out[o:o + n] += b[:n] * 0.55 * amp
        tt += step
    # metal dragged along a wall
    for start in (17.0, 40.0, 62.0):
        d = 3.0
        sc = hp_fast(noise(d), 1800) * np.linspace(0.1, 1.0, int(d * SR)) ** 2
        sc *= (0.5 + 0.5 * sine(9.0, d))
        o = int(start * SR)
        n = min(len(sc), len(out) - o)
        out[o:o + n] += sc[:n] * 0.16
    out += hum(L, 120, 0.03)
    return loopify(soft(reverb(out, 0.9, 0.4), 1.3), 4.0)


def m_theme_clark():
    """CAPTAIN CLARK - something that still thinks it is on duty."""
    L = 70
    out = np.zeros(int(L * SR))
    out += env(pad([49.0, 73.4, 98.0, 116.5], L, detune=0.9, bright=700), a=1.5, d=2, s=0.85, r=5) * 0.5
    # a drum cadence gone wrong
    bpm = 96.0
    step = 60.0 / bpm
    pat = [1, 0, 0.5, 0, 1, 0, 0.6, 0.4] * 2
    tt = 2.0
    i = 0
    while tt < L - 1:
        a = pat[i % len(pat)]
        if a:
            d = 0.35
            b = hp_fast(noise(d), 900) * np.linspace(1, 0, int(d * SR)) ** 5
            b += env(sine(190, d), a=0.001, d=0.05, s=0, r=0.08) * 0.5
            o = int(tt * SR)
            n = min(len(b), len(out) - o)
            out[o:o + n] += b[:n] * 0.28 * a
        tt += step * (1.0 if i % 7 else 1.5)   # it drops a beat now and then
        i += 1
    # a distant siren, detuned
    for start, dur in ((8.0, 9.0), (38.0, 11.0)):
        k = np.concatenate([np.linspace(320, 520, int(dur * SR / 2)),
                            np.linspace(520, 320, int(dur * SR) - int(dur * SR / 2))])
        ph = 2 * np.pi * np.cumsum(k) / SR
        sr_ = np.sin(ph) * 0.14 * np.hanning(len(ph))
        o = int(start * SR)
        n = min(len(sr_), len(out) - o)
        out[o:o + n] += sr_[:n]
    out += hum(L, 120, 0.03)
    return loopify(soft(reverb(out, 0.88, 0.45), 1.25), 4.0)


def m_deep_distortion():
    """THE WORLD IS DONE PRETENDING - plays once corruption gets high."""
    L = 76
    out = np.zeros(int(L * SR))
    out += env(pad([32.7, 46.2, 51.9], L, detune=1.6, bright=380), a=4, d=4, s=0.92, r=8) * 0.6
    # ring modulation: harmony that does not resolve to anything
    out *= (1.0 + 0.35 * sine(7.3, L)) * (1.0 + 0.22 * sine(0.9, L))
    # reversed swells
    for start in (6.0, 23.0, 44.0, 60.0):
        d = 5.0
        sw = env(pad([98.0, 146.8, 233.1], d, detune=1.1, bright=1400), a=0.01, d=0.5, s=0.9, r=0.2)
        sw = sw[::-1] * np.linspace(0, 1, len(sw)) ** 2
        o = int(start * SR)
        n = min(len(sw), len(out) - o)
        out[o:o + n] += sw[:n] * 0.30
    out += hum(L, 118.6, 0.05)
    out += lp_fast(noise(L), 160) * 0.12
    return loopify(soft(reverb(out, 0.94, 0.5), 1.6), 5.0)


# --------------------------------------------------------------- the sfx
def voice(f0, sec, formants, breath=0.25, vib=4.0, vibd=0.02):
    """Crude vocal-tract model - enough for a 'hrm' that is not quite right."""
    ph = 2 * np.pi * np.cumsum(f0 * (1 + vibd * np.sin(2 * np.pi * vib * t(sec)))) / SR
    src = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph) + 0.2 * np.sin(4 * ph)
    src += noise(sec) * breath
    out = np.zeros(len(src))
    for fc, q, g in formants:
        band = hp_fast(lp_fast(src, fc * 1.18, 3), fc * 0.84, 3)
        out += band * g
    return out


def s_still_idle():
    d = 1.5
    o = env(voice(np.linspace(112, 96, int(d * SR)), d,
                  [(500, 8, 1.0), (1100, 8, 0.6), (2400, 8, 0.25)], breath=0.30),
            a=0.10, d=0.4, s=0.55, r=0.7)
    return reverb(o, 0.85, 0.4)


def s_still_hurt():
    d = 0.8
    o = env(voice(np.linspace(190, 120, int(d * SR)), d,
                  [(620, 8, 1.0), (1400, 8, 0.7), (3000, 8, 0.4)], breath=0.55),
            a=0.005, d=0.25, s=0.35, r=0.4)
    return reverb(o, 0.8, 0.35)


def s_still_death():
    d = 2.2
    o = env(voice(np.linspace(150, 38, int(d * SR)), d,
                  [(500, 8, 1.0), (900, 8, 0.6), (2000, 8, 0.3)], breath=0.7, vibd=0.05),
            a=0.01, d=0.8, s=0.4, r=1.2)
    o += lp_fast(noise(d), 500) * 0.2 * np.linspace(1, 0, int(d * SR)) ** 2
    return reverb(o, 0.9, 0.5)


def s_befriend():
    d = 1.6
    o = np.zeros(int(d * SR))
    for i, f in enumerate((392.0, 523.25, 659.25, 784.0)):
        b = env(sine(f, d - i * 0.12) + sine(f * 2, d - i * 0.12) * 0.3,
                a=0.01, d=0.5, s=0.2, r=0.8)
        o[int(i * 0.12 * SR):int(i * 0.12 * SR) + len(b)] += b * 0.35
    return reverb(o, 0.85, 0.45)


def s_betray():
    d = 1.4
    o = hp_fast(noise(0.06), 1200) * 3.0                  # the wet snap
    o = np.concatenate([o, np.zeros(int(d * SR) - len(o))])
    o += env(swell(d, 700, 60, 0.8), a=0.001, d=0.3, s=0.2, r=0.9)
    o += env(voice(np.linspace(300, 70, int(d * SR)), d,
                   [(700, 8, 1.0), (1800, 8, 0.8)], breath=0.9), a=0.002, d=0.4, s=0.3, r=0.7) * 0.8
    return soft(reverb(o, 0.8, 0.35), 2.0)


def s_jumpscare():
    d = 1.8
    o = hp_fast(noise(d), 300) * np.concatenate(
        [np.linspace(0, 1, int(0.02 * SR)) ** 0.3,
         np.linspace(1, 0, int(d * SR) - int(0.02 * SR)) ** 2.2])
    o += env(swell(d, 1400, 40, 1.0), a=0.001, d=0.5, s=0.25, r=1.0)
    o += env(sine(52, d) + sine(38, d), a=0.001, d=0.2, s=0.5, r=1.2) * 0.7
    pre = np.zeros(int(0.35 * SR))                        # the half-second of nothing
    return soft(np.concatenate([pre, reverb(o, 0.82, 0.3)]), 2.4)


def s_noclip():
    d = 2.4
    o = env(swell(d, 90, 900, 0.55), a=0.4, d=0.6, s=0.6, r=1.0)
    o += lp_fast(noise(d), 2200) * np.linspace(0.05, 0.8, int(d * SR)) ** 2 * 0.5
    tear = hp_fast(noise(0.18), 1600) * np.linspace(1, 0, int(0.18 * SR))
    o[int(1.1 * SR):int(1.1 * SR) + len(tear)] += tear * 1.4
    return soft(reverb(o, 0.9, 0.55), 1.6)


def s_buzz():
    d = 4.0
    o = hum(d, 120, 0.8) + hum(d, 119.2, 0.4)
    o += hp_fast(noise(d), 5000) * 0.06
    return loopify(reverb(o, 0.8, 0.2), 0.5)


def s_whisper():
    d = 3.2
    o = np.zeros(int(d * SR))
    tt = 0.0
    while tt < d - 0.4:
        seg = rng.uniform(0.12, 0.3)
        f = rng.uniform(700, 2600)
        b = hp_fast(lp_fast(noise(seg), f * 1.3, 3), f * 0.7, 3)
        b *= np.hanning(len(b))
        i = int(tt * SR)
        n = min(len(b), len(o) - i)
        o[i:i + n] += b[:n] * rng.uniform(0.4, 1.0)
        tt += seg * rng.uniform(0.7, 1.5)
    return reverb(o * 0.5, 0.92, 0.6)


def s_tall_step():
    d = 1.1
    o = env(sine(41, d) + sine(28, d) * 0.7, a=0.001, d=0.18, s=0.05, r=0.5)
    o += lp_fast(noise(d), 200) * 0.6 * np.linspace(1, 0, int(d * SR)) ** 4
    o[:int(0.04 * SR)] += hp_fast(noise(0.04), 1500) * 0.4
    return soft(reverb(o, 0.9, 0.4), 1.5)


def s_tall_roar():
    d = 3.4
    f0 = np.concatenate([np.linspace(70, 44, int(d * SR * 0.6)),
                         np.linspace(44, 30, int(d * SR) - int(d * SR * 0.6))])
    o = voice(f0, d, [(320, 8, 1.0), (760, 8, 0.7), (1500, 8, 0.35)], breath=0.6, vib=2.5, vibd=0.06)
    o = env(o, a=0.25, d=0.9, s=0.6, r=1.4)
    o += env(sine(33, d), a=0.2, d=1.0, s=0.6, r=1.2) * 0.7
    return soft(reverb(o, 0.94, 0.55), 1.8)


def s_clark_roar():
    d = 2.8
    f0 = np.linspace(150, 82, int(d * SR))
    o = voice(f0, d, [(560, 8, 1.0), (1250, 8, 0.8), (2600, 8, 0.4)], breath=0.5, vib=6.0, vibd=0.05)
    o = env(o, a=0.05, d=0.5, s=0.65, r=1.1)
    # radio squelch on top - he is still calling it in
    sq = hp_fast(noise(d), 1400) * (rng.random(int(d * SR)) > 0.7) * 0.25
    return soft(reverb(o + sq, 0.85, 0.4), 1.7)


def s_sanity_low():
    d = 4.0
    o = np.zeros(int(d * SR))
    tt = 0.0
    while tt < d - 1:
        for off, amp in ((0.0, 1.0), (0.26, 0.6)):
            b = env(sine(58, 0.5) + sine(40, 0.5) * 0.8, a=0.002, d=0.12, s=0, r=0.2)
            i = int((tt + off) * SR)
            n = min(len(b), len(o) - i)
            if n > 0:
                o[i:i + n] += b[:n] * amp * 0.7
        tt += 0.85
    o += sine(4100, d) * 0.05 + sine(6350, d) * 0.03
    return loopify(reverb(o, 0.8, 0.3), 0.4)


def s_recreate():
    """The sound of the world building a copy of something you made."""
    d = 3.6
    o = env(pad([49.0, 65.4, 98.0], d, detune=1.4, bright=900), a=0.3, d=1.0, s=0.7, r=1.5)
    o = o[::-1] * np.linspace(0.1, 1.0, len(o)) ** 1.6
    for _ in range(26):
        i = int(rng.uniform(0.3, d - 0.4) * SR)
        b = hp_fast(noise(0.07), 700) * np.linspace(1, 0, int(0.07 * SR)) ** 2
        n = min(len(b), len(o) - i)
        o[i:i + n] += b[:n] * rng.uniform(0.2, 0.6)
    return soft(reverb(o, 0.9, 0.5), 1.4)


def s_camera():
    d = 0.7
    o = hp_fast(noise(0.03), 2500) * 2.0
    o = np.concatenate([o, np.zeros(int(d * SR) - len(o))])
    o[int(0.10 * SR):int(0.10 * SR) + int(0.02 * SR)] += hp_fast(noise(0.02), 1800) * 1.5
    whir = lp_fast(noise(0.45), 1200) * 0.25 * (0.5 + 0.5 * np.sin(2 * np.pi * 38 * t(0.45)))
    o[int(0.14 * SR):int(0.14 * SR) + len(whir)] += whir
    return soft(o, 1.5)


def s_drink():
    d = 1.5
    o = np.zeros(int(d * SR))
    for k in range(4):
        i = int((0.10 + k * 0.30) * SR)
        b = env(lp_fast(noise(0.16), 900), a=0.005, d=0.06, s=0.2, r=0.08)
        b += env(sine(180 - k * 18, 0.16), a=0.005, d=0.05, s=0.1, r=0.06) * 0.5
        n = min(len(b), len(o) - i)
        o[i:i + n] += b[:n] * 0.8
    return soft(o, 1.2)


def s_door():
    d = 2.6
    o = lp_fast(noise(d), 700) * np.concatenate(
        [np.linspace(0, 1, int(0.4 * SR)), np.linspace(1, 0.15, int(d * SR) - int(0.4 * SR))]) * 0.5
    o += env(swell(d, 60, 220, 0.4), a=0.3, d=0.8, s=0.5, r=1.0)
    o += env(pad([196.0, 293.7, 392.0], d, detune=0.3, bright=1800), a=0.6, d=0.8, s=0.5, r=1.0) * 0.35
    return soft(reverb(o, 0.9, 0.5), 1.3)


MUSIC = {
    "sl_liminal_1": m_liminal_1, "sl_liminal_2": m_liminal_2,
    "sl_liminal_3": m_liminal_3, "sl_backrooms_hum": m_backrooms_hum,
    "sl_theme_tall": m_theme_tall, "sl_theme_clark": m_theme_clark,
    "sl_deep_distortion": m_deep_distortion,
}
MOB = {
    "sl_still_idle": s_still_idle, "sl_still_hurt": s_still_hurt,
    "sl_still_death": s_still_death, "sl_befriend": s_befriend,
    "sl_betray": s_betray, "sl_tall_step": s_tall_step,
    "sl_tall_roar": s_tall_roar, "sl_clark_roar": s_clark_roar,
}
AMB = {"sl_buzz": s_buzz, "sl_whisper": s_whisper, "sl_sanity_low": s_sanity_low}
FX = {"sl_jumpscare": s_jumpscare, "sl_noclip": s_noclip, "sl_recreate": s_recreate,
      "sl_camera": s_camera, "sl_drink": s_drink, "sl_door": s_door}

if __name__ == "__main__":
    only = sys.argv[1:] or None
    for sub, group in (("music", MUSIC), ("mob", MOB), ("ambient", AMB), ("effect", FX)):
        for n, fn in group.items():
            if only and n not in only:
                continue
            save(n, fn(), sub, peak=0.88 if sub == "music" else 0.78)
