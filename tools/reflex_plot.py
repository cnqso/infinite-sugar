#!/usr/bin/env python3
"""Phase 3 gate: time course of the sugar reflex. Writes docs/img/reflex.png."""
import json, os, numpy as np, matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
d=np.load("data/brain.npz",allow_pickle=True)
indptr=d["indptr"].astype(np.int64); colidx=d["colidx"]; weight=d["weight"]
roles=json.load(open("data/roles.json")); N=len(indptr)-1
G={k:np.array(v,np.int64) for k,v in roles.items()}
DECAY=np.float32(np.exp(-1/20)); TH=np.float32(1.0); RF=2; ID=4
WS, BASE, DRIVE = 0.0050, 0.06, 0.20
ON0, ON1, MS = 400, 1200, 1800

rng=np.random.default_rng(3); w=(weight*WS).astype(np.float32)
v=np.zeros(N,np.float32); refr=np.zeros(N,np.int8)
baseline=rng.uniform(0,BASE,N).astype(np.float32)
inhq=[np.zeros(N,np.float32) for _ in range(ID+1)]
watch=["grn_sweet","mn_proboscis","mn_ingestion","pam"]
tr={k:np.zeros(MS) for k in watch}; pop=np.zeros(MS)
for t in range(-300,MS):
    s=(t+300)%(ID+1); q=inhq[s]; v+=q; q.fill(0); np.maximum(v,-2,out=v)
    a=refr==0; v[a]=v[a]*DECAY+baseline[a]; v[~a]*=DECAY; refr[~a]-=1
    if ON0<=t<ON1: v[G["grn_sweet"]]+=DRIVE; v[G["grn_sweet_leg"]]+=DRIVE
    f=a&(v>=TH); idxf=np.flatnonzero(f); v[f]=0; refr[f]=RF
    if t>=0:
        for k in watch: tr[k][t]=f[G[k]].sum()*1000.0/len(G[k])
        pop[t]=len(idxf)*1000.0/N
    if len(idxf):
        c=(indptr[idxf+1]-indptr[idxf]).astype(np.int64); tot=int(c.sum())
        if tot:
            off=np.arange(tot)-np.repeat(np.cumsum(c)-c,c)
            ks=np.repeat(indptr[idxf],c)+off; tg,ww=colidx[ks],w[ks]; e=ww>=0
            v+=np.bincount(tg[e],ww[e],minlength=N).astype(np.float32)
            inhq[(s+ID)%(ID+1)]+=np.bincount(tg[~e],ww[~e],minlength=N).astype(np.float32)

def sm(x,k=40): return np.convolve(x,np.ones(k)/k,"same")
os.makedirs("docs/img",exist_ok=True)
fig,ax=plt.subplots(4,1,figsize=(9,8),sharex=True)
fig.patch.set_facecolor("#0b1017")
rows=[("grn_sweet","sweet GRN input (129)","#6fd3ff"),
      ("mn_proboscis","proboscis motor neurons (24)","#7CFF8A"),
      ("mn_ingestion","ingestion motor neurons (28)","#FFD86F"),
      ("pam","PAM dopaminergic neurons (307)","#FF7B7B")]
for i,(k,lab,c) in enumerate(rows):
    A=ax[i]; A.set_facecolor("#0e141c")
    A.axvspan(ON0/1000,ON1/1000,color="#2b6cb0",alpha=.22,lw=0)
    A.plot(np.arange(MS)/1000,sm(tr[k]),color=c,lw=1.6)
    A.set_ylabel("Hz",color="#9fb3c8"); A.tick_params(colors="#9fb3c8")
    for sp in A.spines.values(): sp.set_color("#25324a")
    base=tr[k][:ON0].mean(); onv=tr[k][ON0+100:ON1].mean()
    chg=f"{(onv-base)/base*100:+.0f}%" if base>0.05 else "n/a"
    A.set_title(f"{lab}    rest {base:.1f} Hz -> sugar {onv:.1f} Hz   ({chg})",
                color="#e6eef8",fontsize=10,loc="left")
ax[-1].set_xlabel("seconds",color="#9fb3c8")
fig.suptitle("Whole-brain LIF, FlyWire FAFB v783 (139,255 neurons / 2,700,513 edges)\n"
             "shaded = sugar on the sweet gustatory neurons",color="#e6eef8",fontsize=11)
fig.tight_layout(rect=[0,0,1,0.94])
fig.savefig("docs/img/reflex.png",dpi=130,facecolor=fig.get_facecolor())
print("wrote docs/img/reflex.png")
for k,lab,_ in rows:
    b=tr[k][:ON0].mean(); o=tr[k][ON0+100:ON1].mean(); aft=tr[k][ON1+200:].mean()
    print(f"  {k:<14} rest {b:7.2f}  sugar {o:7.2f}  after {aft:7.2f}")
print(f"  population     {pop[:ON0].mean():7.2f}  {pop[ON0+100:ON1].mean():7.2f}  {pop[ON1+200:].mean():7.2f}")
