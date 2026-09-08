#!/usr/bin/env python3
"""Export a compact, deterministic view of the existing v783 graph; never alter the brain.

Coordinates are representative FlyWire points, not reconstructed neuron morphologies.
Mean multiple recorded points per neuron. Classification row order matches build_brain.py.
"""
import csv
import gzip
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw'

def rows(name):
    with gzip.open(RAW / f'{name}.csv.gz', 'rt') as f:
        return list(csv.DictReader(f))

classification = rows('classification')
ids = {r['root_id']: i for i, r in enumerate(classification)}
meta = json.loads((ROOT / 'web/brain/meta.json').read_text())
assert len(ids) == meta['N']
positions = np.zeros((meta['N'], 3), dtype=np.float64)
counts = np.zeros(meta['N'], dtype=np.int32)
for row in rows('coordinates'):
    i = ids[row['root_id']]
    positions[i] += np.fromstring(row['position'].strip('[]'), sep=' ')
    counts[i] += 1
assert np.all(counts > 0)
positions /= counts[:, None]
# Preserve aspect ratio and depth. In the source frame, y increases dorsal to ventral.
center = (positions.max(axis=0) + positions.min(axis=0)) / 2
positions = (positions - center) / np.ptp(positions[:, 0])
roles = meta['roles']
category = np.ones(meta['N'], dtype=np.uint8)  # internal, pink
for key, group in roles.items():
    if key.startswith('mn_') or key.startswith('dn_'):
        category[group] = 2  # motor and descending commands, yellow
    elif key in ('grn_sweet', 'grn_sweet_leg', 'grn_bitter', 'orn', 'mechano',
                 'thermo', 'hygro', 'visual', 'lc4', 'lplc2'):
        category[group] = 0  # sensory, blue

# Evenly spaced indices avoid platform-dependent randomness; smaller identified pools stay whole.
seeds = set(np.linspace(0, meta['N'] - 1, 850, dtype=int).tolist())
for key, group in roles.items():
    if key.endswith(('_l', '_r')):
        continue
    seeds.update(group if len(group) <= 350 else np.asarray(group)[np.linspace(0, len(group)-1, 100, dtype=int)].tolist())
graph = np.load(ROOT / 'data/brain.npz', allow_pickle=True)
indptr, colidx, weight = graph['indptr'], graph['colidx'], graph['weight']
edges = []
selected = set(seeds)
for i in sorted(seeds):
    a, b = int(indptr[i]), int(indptr[i + 1])
    if a == b:
        continue
    # The strongest outgoing connection, with its actual graph endpoints.
    k = a + int(np.argmax(np.abs(weight[a:b])))
    j = int(colidx[k])
    if j == i:
        continue
    selected.add(j)
    edges.append([i, j])
selected = sorted(selected)
lookup = {i: j for j, i in enumerate(selected)}
reference = np.linspace(0, meta['N'] - 1, 9000, dtype=int)
result = {
    'source': 'FlyWire FAFB v783 coordinates and simulation graph',
    'representation': 'Mean recorded positions; straight links, not neuron morphology. Sampled for display.',
    'neuronCount': meta['N'],
    'ids': selected,
    'positions': np.round(positions[selected], 5).ravel().tolist(),
    'categories': category[selected].tolist(),
    'reference': np.round(positions[reference], 5).ravel().tolist(),
    'edges': [[lookup[a], lookup[b]] for a, b in edges],
}
assert all(0 <= i < meta['N'] for i in selected)
assert all(int(colidx[int(indptr[a]):int(indptr[a+1])].tolist().count(b)) > 0 for a, b in edges)
out = ROOT / 'web/brain/neural-map.json'
out.write_text(json.dumps(result, separators=(',', ':')) + '\n')
print(f'{len(selected)} live neurons, {len(edges)} real connections, {len(reference)} reference points; {out.stat().st_size:,} bytes')
