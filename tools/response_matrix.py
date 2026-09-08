#!/usr/bin/env python3
"""Drive each sensory population alone; measure every motor population.
Decides what is worth wiring into the browser. Nothing here is assumed."""
import json, numpy as np
d=np.load("data/brain.npz",allow_pickle=True)
indptr=d["indptr"].astype(np.int64); colidx=d["colidx"]; weight=d["weight"]
roles=json.load(open("data/roles.json")); N=len(indptr)-1
G={k:np.array(v,np.int64) for k,v in roles.items()}
DECAY=np.float32(np.exp(-1/20)); TH=np.float32(1.0); RF=2; ID=4
WS,BASE,DRIVE=0.0050,0.06,0.20

def run(ms, stim, seed=1, warm=400):
    rng=np.random.default_rng(seed); w=(weight*WS).astype(np.float32)
    v=np.zeros(N,np.float32); refr=np.zeros(N,np.int8)
    baseline=rng.uniform(0,BASE,N).astype(np.float32)
    inhq=[np.zeros(N,np.float32) for _ in range(ID+1)]
    cnt=np.zeros(N,np.int64)
    tgt=np.concatenate([G[k] for k in stim]) if stim else None
    for t in range(-warm,ms):
        s=(t+warm)%(ID+1); q=inhq[s]; v+=q; q.fill(0); np.maximum(v,-2,out=v)
        a=refr==0; v[a]=v[a]*DECAY+baseline[a]; v[~a]*=DECAY; refr[~a]-=1
        if tgt is not None and t>=0: v[tgt]+=DRIVE
        f=a&(v>=TH); idxf=np.flatnonzero(f); v[f]=0; refr[f]=RF
        if t>=0: cnt[idxf]+=1
        if len(idxf):
            c=(indptr[idxf+1]-indptr[idxf]).astype(np.int64); tot=int(c.sum())
            if tot:
                off=np.arange(tot)-np.repeat(np.cumsum(c)-c,c)
                ks=np.repeat(indptr[idxf],c)+off; tg,ww=colidx[ks],w[ks]; e=ww>=0
                v+=np.bincount(tg[e],ww[e],minlength=N).astype(np.float32)
                inhq[(s+ID)%(ID+1)]+=np.bincount(tg[~e],ww[~e],minlength=N).astype(np.float32)
    return cnt/(ms/1000.0)

OUTS=["mn_proboscis","mn_neck","mn_antenna","dn_gf","dn_escwing","dn_steer","dn_walk","dn_groom","pam"]
INS=[("(none)",[]),("sweet",["grn_sweet","grn_sweet_leg"]),("bitter",["grn_bitter"]),
     ("odour",["orn"]),("touch",["mechano"]),("heat",["thermo"]),
     ("humid",["hygro"]),("light",["visual"]),("looming",["lc4","lplc2"])]
MS=1200
base=None
print(f"  {'stimulus':<10}{'pop':>6} | " + "".join(f"{o.replace(chr(109)+chr(110)+chr(95),chr(0)).replace(chr(0),''):>12}" for o in OUTS))
print("  " + "-"*(18+12*len(OUTS)))
for name,stim in INS:
    r=run(MS,stim)
    pop=r.mean()
    if base is None: base=r
    cells=[]
    for o in OUTS:
        a,b=base[G[o]].mean(), r[G[o]].mean()
        if not stim: cells.append(f"{b:>9.1f}Hz")
        else:
            pct=(b-a)/a*100 if a>0.05 else float('nan')
            mark="*" if abs(pct)>=25 else " "
            cells.append(f"{b:>8.1f}{mark}{'':1}" if np.isnan(pct) else f"{pct:>+10.0f}%{mark}")
    print(f"  {name:<10}{pop:>6.1f} | " + "".join(cells))
print("\n  row '(none)' is absolute Hz; other rows are % change vs (none).  * = |change| >= 25%")
