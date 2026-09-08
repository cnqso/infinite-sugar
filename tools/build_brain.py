#!/usr/bin/env python3
"""FlyWire Codex FAFB v783 -> whole-brain graph for utilifly.

Unlike the borrowed desktop-fly etl.py, there is NO neuron selection step: every
classified neuron and every connection at the Codex >=5-synapse threshold is kept.
Roles tag the populations we wire I/O to; everything else runs anyway, unnamed.

Usage: python3 tools/build_brain.py [data/raw] [data]
"""
import csv, gzip, json, os, sys
from collections import defaultdict, deque
import numpy as np

RAW = sys.argv[1] if len(sys.argv) > 1 else "data/raw"
OUT = sys.argv[2] if len(sys.argv) > 2 else "data"
os.makedirs(OUT, exist_ok=True)

# nt_type -> sign. Predicted, not measured (see docs/04-roadmap.md honesty budget).
NT_SIGN = {"ACH": 1.0, "GABA": -1.0, "GLUT": -1.0, "DA": 0.5, "SER": 0.5, "OCT": 0.5}

def rows(name):
    with gzip.open(os.path.join(RAW, name), "rt", newline="") as f:
        r = csv.reader(f); next(r); yield from r

# ---- classification: identity of every neuron -------------------------------
ids, sup, cls, sub, side = [], [], [], [], []
for row in rows("classification.csv.gz"):
    ids.append(int(row[0])); sup.append(row[2]); cls.append(row[3])
    sub.append(row[4]); side.append(row[6])
N = len(ids)
idx = {r: i for i, r in enumerate(ids)}
print(f"neurons in classification: {N:,}")

ptype = ["" ] * N
for row in rows("consolidated_cell_types.csv.gz"):
    i = idx.get(int(row[0]))
    if i is not None: ptype[i] = row[1].strip()

# ---- roles: the populations we wire I/O to ----------------------------------
role = [""] * N
for i in range(N):
    s, c, p = sub[i], cls[i], ptype[i]
    # --- outputs: brain motor neurons that map onto flybody joints -------------
    if   s == "proboscis_motor_neuron":                      role[i] = "mn_proboscis"
    elif s == "haustellum_motor_neuron":                     role[i] = "mn_haustellum"
    elif s == "ingestion_motor_neuron":                      role[i] = "mn_ingestion"
    elif s == "neck_motor_neuron":                           role[i] = "mn_neck"
    elif s == "antennal_motor_neuron":                       role[i] = "mn_antenna"
    # (neck + antenna are also split by side below, so left/right move independently)
    # --- descending neurons: identified command cells ---------------------------
    # These do NOT map to muscles. FAFB is brain-only; wing and leg motor neurons live in the
    # ventral nerve cord (MANC), which is not in this dataset. A DN says "escape" — the posture
    # it produces is supplied by us. Kept separate from the motor pools for that reason.
    elif p == "DNp01":                                       role[i] = "dn_gf"        # giant fiber
    elif p in ("DNp02", "DNp04", "DNp11"):                   role[i] = "dn_escwing"   # escape wing
    elif p in ("DNa01", "DNa02"):                            role[i] = "dn_steer"     # steering
    elif p == "DNp09":                                       role[i] = "dn_walk"
    elif p == "DNg11":                                       role[i] = "dn_groom"
    elif p == "MDN":                                         role[i] = "dn_back"
    # --- looming detectors: the biologically correct trigger for the giant fiber -
    elif p == "LC4":                                         role[i] = "lc4"
    elif p == "LPLC2":                                       role[i] = "lplc2"
    # --- inputs: sensory populations -------------------------------------------
    elif s == "sugar/water":                                 role[i] = "grn_sweet"
    elif s == "SA_VTV_pro_meso_meta" and c == "gustatory":   role[i] = "grn_sweet_leg"
    elif s == "bitter":                                      role[i] = "grn_bitter"
    elif c == "olfactory":                                   role[i] = "orn"
    elif c == "mechanosensory":                              role[i] = "mechano"
    elif c == "thermosensory":                               role[i] = "thermo"
    elif c == "hygrosensory":                                role[i] = "hygro"
    elif c == "visual":                                      role[i] = "visual"
    # --- the reward readout ----------------------------------------------------
    elif p.startswith("PAM"):                                role[i] = "pam"
groups = defaultdict(list)
for i, r in enumerate(role):
    if r: groups[r].append(i)
# side-split the paired motor pools so the two sides can drive their joints independently
for r in ("mn_neck", "mn_antenna", "dn_steer", "dn_escwing"):
    for sd in ("left", "right"):
        g = [i for i in groups[r] if side[i] == sd]
        if g: groups[f"{r}_{sd[0]}"] = g
print("\nroles:")
for r in sorted(groups): print(f"  {r:<16} {len(groups[r]):>4}")

# ---- connections: aggregate (pre,post) across neuropils ---------------------
pre_l, post_l, syn_l, nt_l = [], [], [], []
NT_CODE = {k: i for i, k in enumerate(NT_SIGN)}
for row in rows("connections.csv.gz"):
    a, b = idx.get(int(row[0])), idx.get(int(row[1]))
    if a is None or b is None: continue
    pre_l.append(a); post_l.append(b); syn_l.append(int(row[3]))
    nt_l.append(NT_CODE.get(row[4].strip().upper(), 0))
pre = np.array(pre_l, np.int32); post = np.array(post_l, np.int32)
syn = np.array(syn_l, np.int32); ntc = np.array(nt_l, np.int8)
del pre_l, post_l, syn_l, nt_l
print(f"\nconnection rows (per-neuropil): {len(pre):,}")

key = pre.astype(np.int64) * N + post
order = np.argsort(key, kind="stable")
key, pre, post, syn, ntc = key[order], pre[order], post[order], syn[order], ntc[order]
uniq, start = np.unique(key, return_index=True)
agg_syn = np.add.reduceat(syn, start)
agg_pre, agg_post, agg_nt = pre[start], post[start], ntc[start]   # nt of first (dominant) row
E = len(uniq)
print(f"aggregated edges (pre,post):   {E:,}")
print(f"total synapses:                {agg_syn.sum():,}")

sign = np.array([NT_SIGN[k] for k in NT_SIGN], np.float32)[agg_nt]
w = (agg_syn * sign).astype(np.float32)

# ---- CSR ---------------------------------------------------------------------
indptr = np.zeros(N + 1, np.int64)
np.add.at(indptr, agg_pre + 1, 1)
np.cumsum(indptr, out=indptr)
colidx, weight = agg_post.astype(np.int32), w      # already sorted by (pre,post)

np.savez_compressed(os.path.join(OUT, "brain.npz"),
                    indptr=indptr, colidx=colidx, weight=weight,
                    role=np.array(role), side=np.array(side), ptype=np.array(ptype))
with open(os.path.join(OUT, "roles.json"), "w") as f:
    json.dump({r: groups[r] for r in groups}, f)
print(f"\nwrote {OUT}/brain.npz  ({os.path.getsize(OUT+'/brain.npz')/1048576:.1f} MB)")

# ---- GATE 1: synaptic drive onto each population ----------------------------
print("\nGATE 1 — in-circuit synaptic drive (must be hundreds, not single digits):")
absw = np.abs(w)
for r in sorted(groups):
    tgt = np.zeros(N, bool); tgt[groups[r]] = True
    indeg = absw[tgt[colidx]].sum()
    print(f"  onto {r:<16} {indeg:>10,.0f} syn   ({indeg/len(groups[r]):>8,.0f} per neuron)")

# ---- GATE 2: shortest path sweet GRN -> proboscis MN ------------------------
print("\nGATE 2 — shortest path, sweet GRN -> proboscis motor neuron:")
targets = set(groups["mn_proboscis"]) | set(groups["mn_haustellum"])
for src_role in ("grn_sweet", "grn_sweet_leg"):
    dist = np.full(N, -1, np.int32)
    q = deque()
    for i in groups[src_role]: dist[i] = 0; q.append(i)
    hit = None
    while q:
        u = q.popleft()
        if u in targets: hit = (u, dist[u]); break
        for k in range(indptr[u], indptr[u + 1]):
            v = colidx[k]
            if dist[v] < 0: dist[v] = dist[u] + 1; q.append(v)
    reach = sum(1 for t in targets if dist[t] >= 0)
    hops = [int(dist[t]) for t in targets if dist[t] >= 0]
    print(f"  {src_role:<14} -> {reach}/{len(targets)} MNs reachable, "
          f"min {min(hops) if hops else '-'} hops, median {int(np.median(hops)) if hops else '-'}")
