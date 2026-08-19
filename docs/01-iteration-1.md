# fly — iteration 1

The MuJoCo `flybody` fruit fly, simulated in WebAssembly and rendered with three.js, in a page.
No brain, no sugar, no counter. Just the body, standing, with physics running.

## Run it

Any static file server — ES modules and `fetch` don't work over `file://`.

```
cd flyweb
python3 -m http.server 8000
```

then open <http://localhost:8000>. First load compiles the model and takes a few seconds.

## What's here

```
index.html          page + HUD
app.js              the whole thing (~260 lines): MuJoCo → three.js bridge
vendor/
  mujoco_wasm.js    DeepMind's official MuJoCo WASM build (npm: mujoco-js)
  three.module.js   three.js r185
  three.core.js
  jsm/controls/OrbitControls.js
model/
  scene.xml         MuJoCo Menagerie flybody, unmodified
  fruitfly.xml      unmodified
  assets/*.obj      85 meshes, re-welded (see below)
  manifest.json     asset list for staging into the WASM filesystem
```

## Borrowed, not written

- **Body model**: `flybody` from MuJoCo Menagerie (Vaxenburg et al., Nature 2025). 68 bodies,
  78 actuators, 109 DoF. XML untouched.
- **Physics**: DeepMind's official `mujoco-js` WASM build. Not a fork, not a rebuild.
- **Bridge pattern**: the standard `mujoco_wasm` demo approach — one three.js mesh per mjModel
  geom, transforms copied from `data.geom_xpos` / `data.geom_xmat` each frame.

The only original code is `app.js`, and most of that is scene setup.

## The one asset change

Upstream ships 140.2 MB of ASCII OBJ as unindexed triangle soup — every triangle carries its own
three vertices. Welding duplicate `(position, texcoord, normal)` triples and writing indexed faces:

```
817,650 → 138,147 vertices     (identical 272,550 faces)
140.2 MB → 21.6 MB             (4.9 MB gzipped)
```

Lossless: same triangles, same surface. Verified against the upstream model —
body masses match to 7e-11, inertias to 1e-6 relative, geom placement to 1.5e-4 model units
(from trimming float precision to 6 significant figures; the model is 0.3 units across).

## Standing, not collapsing

64 of the 78 actuators are position servos. On reset the model loads its keyframe and every
servo is commanded to hold that pose. That's the whole "controller" — no policy, no RL, no
imitation learning. A fly with zero control input just collapses.

`idle motion` adds a small sinusoid to five actuators (antennae, head, abdomen). Purely
cosmetic, off by unchecking the box. It changes nothing about the physics being correct.

## Measured

MuJoCo `flybody`, single fly, no rendering, 2 weak vCPUs:

| | µs/step | real-time |
|---|---|---|
| native (python-mujoco) | 196 | 0.51× |
| WASM in Node | 245 | 0.41× |
| WASM in headless Chrome | 263 | 0.38× |

WASM costs ~25% over native. On real desktop hardware expect comfortably above 1× real time.

The `fps` readout will look bad under software rendering (headless CI, no GPU) because it's
drawing 300k triangles with shadows. On a real GPU that's a non-issue.

## Debug handle

`window.fly` exposes `{ mujoco, model, data, sim, scene, camera, renderer, geomNodes }` plus
`fly.dbg()`. Stepping the model by hand from the console works:

```js
for (let i = 0; i < 5000; i++) fly.mujoco.mj_step(fly.model, fly.data);
```

This is the seam the brain plugs into later: write to `fly.data.ctrl`, read from
`fly.data.qpos` / contact arrays.

## Known rough edges

- Single-threaded. The multithreaded MuJoCo WASM build needs `SharedArrayBuffer`, which needs
  COOP/COEP headers. Not needed yet.
- Mobile untested and unlikely to be good.
- Fixed 12 ms/frame stepping budget. Fine for now; will want revisiting once anything is
  driving the actuators.
