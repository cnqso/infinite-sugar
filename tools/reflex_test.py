#!/usr/bin/env python3
"""Whole-brain LIF over the FlyWire graph. Does sugar make the proboscis motor neurons fire?

Kernel traced from desktop-fly Sim.swift: 20 ms membrane tau, threshold 1.0, 2 ms refractory,
4 ms delayed inhibition. Wiring is measured; gains below are hand-tuned (see honesty budget).
"""
import json, sys, time
import numpy as np

d = np.load("data/brain.npz", allow_pickle=True)
indptr, colidx, weight = d["indptr"].astype(np.int64), d["colidx"], d["weight"]
roles = json.load(open("data/roles.json"))
N = len(indptr) - 1
G = {k: np.array(v, np.int64) for k, v in roles.items()}

DECAY = np.float32(np.exp(-1/20)); THRESH = np.float32(1.0); REFRACT = 2; INH_DELAY = 4
exc = weight >= 0

def simulate(ms, wscale, base_mu, grn_drive, seed=0, warmup=300):
    rng = np.random.default_rng(seed)
    w = (weight * wscale).astype(np.float32)
    v = np.zeros(N, np.float32); refr = np.zeros(N, np.int8)
    baseline = rng.uniform(0.0, base_mu, N).astype(np.float32)
    inhq = [np.zeros(N, np.float32) for _ in range(INH_DELAY + 1)]
    watch = ["mn_proboscis", "mn_haustellum", "mn_ingestion", "pam", "grn_sweet", "grn_bitter"]
    trace = {k: np.zeros(ms) for k in watch}; pop = np.zeros(ms)
    for t in range(-warmup, ms):
        slot = (t + warmup) % (INH_DELAY + 1)
        q = inhq[slot]; v += q; q.fill(0)
        np.maximum(v, -2, out=v)
        active = refr == 0
        v[active] = v[active] * DECAY + baseline[active]
        v[~active] *= DECAY; refr[~active] -= 1
        if grn_drive and t >= 0:
            v[G["grn_sweet"]] += grn_drive
            v[G["grn_sweet_leg"]] += grn_drive
        fired = active & (v >= THRESH)
        idxf = np.flatnonzero(fired)
        v[fired] = 0; refr[fired] = REFRACT
        if len(idxf):
            cnt = (indptr[idxf + 1] - indptr[idxf]).astype(np.int64)
            tot = int(cnt.sum())
            if tot:
                off = np.arange(tot) - np.repeat(np.cumsum(cnt) - cnt, cnt)
                ks = np.repeat(indptr[idxf], cnt) + off
                tg, ww = colidx[ks], w[ks]
                e = ww >= 0
                v += np.bincount(tg[e], ww[e], minlength=N).astype(np.float32)
                inhq[(slot + INH_DELAY) % (INH_DELAY + 1)] += \
                    np.bincount(tg[~e], ww[~e], minlength=N).astype(np.float32)
        if t >= 0:
            for k in watch: trace[k][t] = fired[G[k]].sum() * 1000.0 / len(G[k])
            pop[t] = len(idxf) * 1000.0 / N
    return trace, pop

if __name__ == "__main__":
    if "--sweep" in sys.argv:
        print(f"{'wscale':>8} {'base':>6} | {'pop Hz':>7} {'MNprob':>8} {'PAM':>7}")
        for wscale in (0.0004, 0.0008, 0.0016, 0.0030):
            for base in (0.02, 0.04, 0.06):
                tr, pop = simulate(300, wscale, base, 0.0, warmup=200)
                print(f"{wscale:>8.4f} {base:>6.2f} | {pop.mean():>7.2f} "
                      f"{tr['mn_proboscis'].mean():>8.1f} {tr['pam'].mean():>7.1f}")
        sys.exit()
    wscale, base, drive = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
    t0 = time.time()
    off, _ = simulate(600, wscale, base, 0.0)
    on,  _ = simulate(600, wscale, base, drive)
    print(f"  ({time.time()-t0:.1f}s for 1.2 s of brain time)")
    print(f"\n  wscale={wscale} baseline<{base} grn_drive={drive}\n")
    print(f"  {'population':<16} {'sugar OFF':>12} {'sugar ON':>12}   {'change':>9}")
    for k in ("grn_sweet","grn_bitter","mn_proboscis","mn_haustellum","mn_ingestion","pam"):
        a, b = off[k].mean(), on[k].mean()
        print(f"  {k:<16} {a:>9.1f} Hz {b:>9.1f} Hz   {('%+.0f%%'%((b-a)/a*100)) if a>0.05 else '   n/a':>9}")
