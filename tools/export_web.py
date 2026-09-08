#!/usr/bin/env python3
"""brain.npz -> web/brain/ : binary blobs the browser LIF loads."""
import gzip, json, os, numpy as np
d=np.load("data/brain.npz",allow_pickle=True)
indptr=d["indptr"].astype(np.int64); colidx=d["colidx"]; weight=d["weight"]
roles=json.load(open("data/roles.json")); N=len(indptr)-1; E=len(colidx)
OUT="web/brain"; os.makedirs(OUT,exist_ok=True)

# weight = syn * sign; recover magnitude + sign, store lossless as int16 (syn*2*sign)
w2=np.rint(weight*2).astype(np.int16)
assert np.abs(weight*2 - w2).max() < 1e-3, "int16 scaling lost precision"

blobs={"indptr":indptr.astype(np.uint32),"colidx":colidx.astype(np.uint32),"w2":w2}
meta={"N":int(N),"E":int(E),"roles":{k:v for k,v in roles.items()},"files":{}}
for name,arr in blobs.items():
    raw=arr.tobytes()
    gz=gzip.compress(raw,6)
    p=os.path.join(OUT,f"{name}.bin.gz")
    open(p,"wb").write(gz)
    meta["files"][name]={"dtype":arr.dtype.name,"len":int(arr.size),
                         "raw_bytes":len(raw),"gz_bytes":len(gz)}
    print(f"  {name:<8} {arr.dtype.name:<7} {arr.size:>10,}  raw {len(raw)/1048576:>6.1f} MB  gz {len(gz)/1048576:>6.1f} MB")
json.dump(meta,open(os.path.join(OUT,"meta.json"),"w"))
tot=sum(f["gz_bytes"] for f in meta["files"].values())
print(f"  {'TOTAL':<8} {'':<7} {'':>10}  {'':>13} gz {tot/1048576:>6.1f} MB")
