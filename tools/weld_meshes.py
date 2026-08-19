#!/usr/bin/env python3
"""
Weld flybody's mesh assets from unindexed triangle soup into indexed OBJ.

Upstream MuJoCo Menagerie ships flybody's 85 meshes as ASCII OBJ where every triangle carries
its own three vertices (vertices == 3 x faces, exactly). Deduplicating the
(position, texcoord, normal) triples and writing indexed faces is lossless and cuts the bundle
by ~6.5x:

    817,650 -> 138,147 vertices    (identical 272,550 faces)
    140.2 MB -> 21.6 MB            (4.9 MB gzipped)

IMPORTANT: weld the SOURCE .obj files, in their original frame. Do not export vertices from a
loaded mjModel -- MuJoCo canonicalises mesh vertices into an inertial frame and records the
transform in mesh_pos / mesh_quat, so re-loading canonicalised vertices applies it twice and
every mesh geom shifts. See docs/02-decisions.md.

Usage:
    python3 tools/weld_meshes.py <src_assets_dir> <dst_assets_dir>

where <src_assets_dir> is mujoco_menagerie/flybody/assets. The XML files need no changes --
filenames and the default mesh scale are preserved.

Verify afterwards by loading both scene.xml files with python-mujoco and comparing
body_mass, body_inertia and geom_pos. Expected agreement: mass ~7e-11, inertia ~1e-6 relative,
geom_pos ~1.5e-4 model units (from the 6-significant-figure precision trim below).
"""

import glob
import os
import sys
import time

POS_FMT = "%.6g"   # positions: model is ~0.3 units across, 6 sig figs is far below visual resolution
AUX_FMT = "%.4g"   # normals and texcoords


def weld_obj(path: str) -> str:
    verts, norms, texs, faces = [], [], [], []
    with open(path) as fh:
        for line in fh:
            if line.startswith("v "):
                verts.append(line[2:].split())
            elif line.startswith("vn "):
                norms.append(line[3:].split())
            elif line.startswith("vt "):
                texs.append(line[3:].split())
            elif line.startswith("f "):
                faces.append([tuple(int(x) - 1 for x in tok.split("/")) for tok in line[2:].split()])

    seen: dict = {}
    out_v, out_t, out_n, out_f = [], [], [], []
    for tri in faces:
        row = []
        for vi, ti, ni in tri:
            key = (*verts[vi], *texs[ti], *norms[ni])
            j = seen.get(key)
            if j is None:
                j = len(out_v)
                seen[key] = j
                out_v.append(verts[vi])
                out_t.append(texs[ti])
                out_n.append(norms[ni])
            row.append(j + 1)          # OBJ indices are 1-based
        out_f.append(row)

    g6 = lambda x: POS_FMT % float(x)
    g4 = lambda x: AUX_FMT % float(x)
    lines = [f"v {g6(a)} {g6(b)} {g6(c)}" for a, b, c in out_v]
    lines += [f"vt {g4(a)} {g4(b)}" for a, b in (t[:2] for t in out_t)]
    lines += [f"vn {g4(a)} {g4(b)} {g4(c)}" for a, b, c in out_n]
    lines += ["f " + " ".join(f"{i}/{i}/{i}" for i in row) for row in out_f]
    return "\n".join(lines) + "\n", len(verts), len(out_v)


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    os.makedirs(dst, exist_ok=True)

    t0 = time.time()
    bytes_in = bytes_out = v_in = v_out = 0
    paths = sorted(glob.glob(os.path.join(src, "*.obj")))
    if not paths:
        print(f"no .obj files in {src}")
        return 1

    for p in paths:
        bytes_in += os.path.getsize(p)
        text, nv_before, nv_after = weld_obj(p)
        v_in += nv_before
        v_out += nv_after
        with open(os.path.join(dst, os.path.basename(p)), "w") as fh:
            fh.write(text)
        bytes_out += len(text)

    print(f"{len(paths)} meshes")
    print(f"{v_in:,} -> {v_out:,} vertices ({v_out / v_in:.1%})")
    print(f"{bytes_in / 1e6:.1f} MB -> {bytes_out / 1e6:.2f} MB in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
