# Decision log

Why things are the way they are. Written at the end of iteration 1.

## Body model: `flybody`, not NeuroMechFly v2

Both are MuJoCo. `flybody` (MuJoCo Menagerie / Vaxenburg et al., Nature 2025) won for iteration 1
because it ships in Menagerie as a clean, self-contained XML pair with no Python framework
wrapped around it — which is exactly what a browser build needs.

**This may need revisiting.** NeuroMechFly v2 / FlyGym ships *sensory* models — contact,
proprioception, olfaction, ommatidia rendering — and `flybody` does not. Eon Systems chose NMF v2
for precisely that reason. Since the two share MuJoCo, the likely end state is `flybody`'s body
and pretrained policies plus NMF's sensor implementations. Defer until sensing is actually needed.

## Physics: official `mujoco-js` WASM, not a fork

DeepMind publishes an official WASM build on npm. It is 11 MB with the wasm embedded, so it
loads as a single file from any static server with no extra fetch. Measured 25% slower than
native. There are several community forks (zalo, danieldugas, idiap, menloresearch); none of
them are worth the maintenance surface when the official one works.

The *bridge pattern* is borrowed from those community demos — one three.js mesh per mjModel geom,
transforms copied from `data.geom_xpos` / `data.geom_xmat` each frame. That is the standard
approach and there's no reason to invent another.

## Assets: welded, not decimated

Upstream ships 140.2 MB of ASCII OBJ as unindexed triangle soup — every triangle carrying its
own three vertices, so `vertices = 3 × faces` exactly. Welding duplicate
`(position, texcoord, normal)` triples and writing indexed faces:

```
817,650 -> 138,147 vertices    (identical 272,550 faces)
140.2 MB -> 21.6 MB            (4.9 MB gzipped)
```

Lossless — same triangles, same surface, same shading. Verified against the upstream model:
body masses match to 7e-11, inertias to 1e-6 relative, geom placement to 1.5e-4 model units on a
model 0.3 units across (that residual is from trimming float precision to 6 significant figures).

300k triangles is nothing for a GPU, so **do not decimate**. The size win was a storage-format
problem, not a geometry problem, and it's already banked.

### A dead end worth not repeating

The first attempt exported vertices from a loaded `mjModel` rather than welding the source OBJs.
That fails: MuJoCo recenters and reorients mesh vertices into a canonical inertial frame and
records the transform in `mesh_pos` / `mesh_quat`. Re-loading already-canonicalised vertices
applies the transform a second time — every mesh geom shifts (up to 0.18 units, on a 0.3-unit
model) and body inertias drift ~4%. Weld the *source* files, in their original frame.

## All meshes are visual-only

Collision in `flybody` is entirely primitives: 47 capsules, 22 ellipsoids, 6 cylinders, 1 sphere,
2 boxes. All 85 meshes are group 1 and non-colliding. This means mesh
geometry can be changed freely without touching physics at all.

## Standing: keyframe pose held by position servos

64 of the 78 actuators are position servos (`actuator_biastype != 0`). On reset the model loads
its single keyframe and every servo is commanded to hold that pose. A fly with zero control input
collapses into a heap under gravity, which reads as dead.

This is not a controller and should not be described as one. There is no policy, no RL, no
imitation learning. It is a held posture. Verified stable: 3 s of sim, thorax settles 4.3 mm from
spawn, `max_qvel` decays to 0.0015.

`idle motion` adds a small sinusoid to five actuators (antennae, head, abdomen). Purely cosmetic,
toggleable, changes nothing about the physics being correct. It exists so the demo doesn't look
like a corpse.

## Single-threaded, no build step, vendored deps

Three related choices, same reasoning: the failure mode for this project is a build that stops
working. No bundler means no bundler upgrade. Vendored `vendor/` means no registry dependency.
Single-threaded means no COOP/COEP headers, which means it deploys to any static host including
the ones that don't let you set headers.

Revisit only when something concrete demands it. Multithreading in particular is a *hosting*
decision as much as a performance one.

## Open questions

- **Which connectome.** FlyWire FAFB (brain only, 139,255 neurons) is best-supported and is the
  one the published LIF model uses. BANC (Nov 2025, ~160k neurons = ~140k brain + ~20k nerve
  cord, 1,300 descending / 1,900 ascending / 833 motor) is the one where the brain→VNC→muscle
  path is real connectivity rather than hand-stitched glue. For proboscis extension specifically,
  FlyWire alone is sufficient — the whole 4–5 hop path is inside the brain volume.
- **Where the brain runs.** WebGPU compute shader is the right answer on capable machines; a
  WASM SIMD fallback is needed for the rest. The measured numbers say the fallback is genuinely
  viable, not a token gesture.
- **What the counter counts.** Integral of an NPF-proxy over time is more defensible than
  sim-seconds × a welfare coefficient, because it's a quantity the emulation itself produces.
  Undecided.
- **Whether the fly gets a world.** The fixed-point argument says the body only supplies a slow
  variable if it has somewhere to go. A hamster-cage environment was discussed. Not yet built.

## Constraints discovered, not chosen

- **Background tab throttling.** `requestAnimationFrame` halts entirely when a tab is hidden;
  timers drop to ~1 Hz; Web Workers are throttled too. The fly only lives while someone is
  looking at it. Treat as a design fact — it's a better version of "closing the tab kills your
  colony" — rather than something to fight.
- **Mobile is not viable** for the full sim. Plan a prerecorded fallback.
- **WebGPU is not universal.** Chrome/Edge desktop and Safari 26+ are fine.
