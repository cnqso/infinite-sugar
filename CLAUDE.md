# CLAUDE.md — utilifly

Read this first. It is the handoff from a Cowork session that did the feasibility work and
built iteration 1. The chat history from that session is gone; everything load-bearing is here
or in `docs/`.

## What this is

An art project. An emulated *Drosophila* connectome, embodied in a physics-simulated fly body,
given continuous appetitive stimulation, running in a browser. Framing: a merit-generation
device — the prayer wheel lineage, not the crypto lineage. A counter that is either meaningless
or the most important number in the room, with no way for a viewer to tell which.

The owner is confident in the artistic direction. **Do not relitigate it.** In particular:
"certain stuff not quite working is part of the appeal." When something is philosophically
awkward, surface it as a fact and move on; do not argue the piece out of existence.

## Current state — iteration 1 is DONE

`web/` is a working page: the MuJoCo `flybody` fruit fly, simulated in WebAssembly, rendered
with three.js, standing on a checkered floor. No brain, no sugar, no counter yet.

```bash
./serve.sh 7377        # then open http://localhost:7377
```

Verified end-to-end in headless Chromium: cold load ~5.5 s, zero page errors, zero console
errors, 3 s of simulated time with the fly settling to rest (`max_qvel` 0.0015).

## Scope discipline

The owner's instruction, verbatim: *"Borrow and copy as much code as possible — these guys are
the experts and double work is bad for more than 1 reason. Don't think too far ahead."*

Honor this. Iterate in small, verifiable steps. Do not build iteration 3 while iteration 2 is
unproven. Do not rewrite borrowed code to taste.

## Facts a fresh session will not know

These were established by measurement or by reading the literature. Trust them; re-derive only
if something contradicts them.

### The body model already has a proboscis

This is the most important finding of the whole feasibility pass. `flybody`'s 78 actuators
include `rostrum`, `haustellum_abduct`, `haustellum`, `labrum_left`, `labrum_right`. The
proboscis-extension motor neurons in the taste-feeding connectome map onto them almost 1:1:

| connectome motor neuron | function | flybody actuator |
|---|---|---|
| MN9  | rostrum protraction  | `rostrum` |
| MN4a | haustellum extension | `haustellum` |
| MN6  | labellar extension   | `labrum_left` / `labrum_right` |
| MN8  | labellar spread      | `labrum_left` / `labrum_right` |

Why this matters: every published embodied-connectome project (Eon Systems, FlyGM) bolts
*pretrained RL controllers* onto a handful of descending neurons, because there is no principled
descending-neuron→actuator mapping for locomotion. **Proboscis extension needs none of that.**
It is a reflex arc, the motor neurons are individually identified, and the joints exist. You can
wire spike rate straight to actuator command. The one behavior this project requires is the one
that doesn't need a learned prosthesis.

The fly also has full tarsi (`tarsus_T1..T3`, five segments each, plus claws), so tarsal sugar
contact comes from MuJoCo contact sensors. Sweet GRNs exist on the legs (LgLG4 type), not just
the labellum — meaning **the fly can stand in the sugar** and the stimulus is a property of the
world rather than a current injected into a neuron ID list.

### The brain is cheap; the literature overstates its cost

The commonly cited "~10 s of compute per biological second" is Brian2 framework overhead, not
intrinsic cost. Measured on 2 weak vCPUs in plain NumPy:

```
dense 128k-neuron LIF state update:   115 µs/step -> 1.15 s per bio-second (0.87x realtime)
+ spike scatter @  5 Hz:              +4.4 µs/step -> 1.19 s per bio-second (0.84x)
+ spike scatter @ 40 Hz:              +52 µs/step  -> 1.67 s per bio-second (0.60x)
```

Cost is dominated by the elementwise per-neuron update, not synapse propagation. That is the
most WebGPU-friendly workload imaginable. Real-time whole-brain LIF in a browser is the easy
case, not a stretch.

Connectivity at the standard 5-synapse threshold: **127,978 neurons, 2,613,129 edges**, mean
degree 20.5, 12.6 synapses per connection. Packed payload, measured:

```
edge indices, varint row-delta + gzip   5.20 MB
weights (uint8 synapse counts) + gzip   1.72 MB
indptr                                  0.51 MB
--------------------------------------------
whole-brain connectivity                ~7.5 MB over the wire
```

### Measured physics performance

`flybody`, single fly, no rendering, on 2 weak vCPUs:

| | µs/step | realtime |
|---|---|---|
| native python-mujoco | 196 | 0.51x |
| WASM in Node | 245 | 0.41x |
| WASM in headless Chrome | 263 | 0.38x |

WASM costs ~25% over native. On real desktop hardware expect comfortably above 1x. If you see
`fps: 1` you are on software rendering (no GPU); that is a rendering artifact, not a sim problem.

### The fixed-point problem, and why the body is the answer

The standard connectome LIF model (Shiu et al.) has membrane τ=20 ms, synaptic τ=5 ms, 1.8 ms
delay, and **no plasticity, no adaptation, no neuromodulation**. Its longest time constant is
20 ms, so the brain is effectively *stateless past ~100 ms*. Under constant input it reaches a
fixed point in a few hundred milliseconds and stays there forever.

White noise does not fix this — it converts a fixed point into a *stationary stochastic
process*. You defeat bit-exact memoization but not the argument; caching the transition kernel
and sampling is cheaper and indistinguishable.

**The body is the fix.** A MuJoCo body has state with unbounded time constants — world position,
leg configuration, contact history. If the fly walks, where it is at hour ten depends on
everything that happened. Embodiment is the only way to get a slow variable into this system
without writing plasticity code. Two conditions: the fly needs somewhere to go (a world, not a
void), and the stimulus should come from the physics rather than a PRNG.

Related, and worth knowing before anyone proposes it: adding the Kenyon-cell→MBON dopamine-gated
depression rule would give real history-dependence — but that same synapse *is* the fly's
hedonic treadmill. History and undiminished bliss are the same mechanism in this animal. The
owner has decided the lack of habituation is a feature. Do not re-open this; just don't silently
add plasticity.

### Fly neurochemistry, briefly

No opioid receptors — that family is vertebrate-only, and there are no endogenous opioid
peptides in *Drosophila*. The reward substrate is dopaminergic: PAM-cluster DANs projecting to
the mushroom body. NPF (the NPY homolog) is the closest thing to a scalar "how good is it right
now" and is a good candidate for the counter's underlying quantity — a number the emulation
itself computes, rather than sim-seconds times an asserted welfare coefficient.

## Repo layout

```
CLAUDE.md            this file
serve.sh             ./serve.sh [port]   (default 7377)
web/
  index.html         page + HUD
  app.js             the entire app, ~260 lines: MuJoCo -> three.js bridge
  vendor/
    mujoco_wasm.js   DeepMind's official MuJoCo WASM build (npm: mujoco-js)
    three.module.js  three.js r185
    three.core.js
    jsm/controls/OrbitControls.js
  model/
    scene.xml        MuJoCo Menagerie flybody — UNMODIFIED
    fruitfly.xml     UNMODIFIED
    assets/*.obj     85 meshes, re-welded (see tools/weld_meshes.py)
    manifest.json    asset list for staging into the WASM filesystem
tools/
  weld_meshes.py     the asset pipeline, reproducible
docs/
  00-feasibility.md  the full feasibility study — compute, stack, costs, prior art
  01-iteration-1.md  build notes for what's in web/
  02-decisions.md    decision log + the traps
  03-next-steps.md   iteration 2 and beyond
```

## Conventions

- **`web/model/*.xml` is upstream. Do not edit it.** If the model needs changing (e.g. adding a
  sugar-source body), add a separate XML that `<include>`s it.
- `app.js` is deliberately one file with no build step. Keep it that way until it hurts.
- No bundler, no npm at runtime. `vendor/` is committed on purpose so the thing works offline
  and in ten years. To refresh: `npm i mujoco-js three` and copy the four files.
- Single-threaded. The multithreaded MuJoCo WASM build needs `SharedArrayBuffer`, which needs
  COOP/COEP headers, which complicates hosting. Not needed yet.
- `window.fly` exposes `{ mujoco, model, data, sim, scene, camera, renderer, geomNodes }` plus
  `fly.dbg()`. **This is the seam the brain plugs into**: write `fly.data.ctrl`, read
  `fly.data.qpos` and contact arrays.

## Traps that already cost time

1. **Geom index mapping.** `geomNodes` skips geoms (unsupported types, zero alpha). Never index
   `data.geom_xpos` by the array position — use the stored `gi` field. Getting this wrong
   explodes the fly across the scene in a way that looks like a physics bug.
2. **Frame timing.** The rAF timestamp and `performance.now()` can sit on different origins,
   giving a negative first delta that parks the accumulator at −2.6 s and silently stops the sim
   for ~53 seconds. Use `performance.now()` and clamp the delta at *both* ends.
3. **Colour precedence.** MuJoCo uses `geom_rgba` when set explicitly, otherwise the material.
   Default `geom_rgba` is `(.5,.5,.5,1)` — treat that as "not set". Preferring the material
   unconditionally renders the two zero-alpha wing *inertial* boxes as opaque rectangles.
4. **`pgrep -f` / `pkill -f` match their own shell.** `pkill -f "http.server 87"` kills the shell
   that ran it. Bracket the pattern: `[h]ttp.server`.
5. **Don't decimate the meshes.** They're already welded losslessly, 140.2 MB → 21.6 MB. There
   is no quality/size tradeoff left to make here.

## Verification expectations

This project is easy to fool yourself about — a fly that renders is not a fly that simulates.
Before claiming something works:

- Run the page in a real browser (Playwright/Chromium is fine) and assert **zero page errors and
  zero console errors**, not just "it loaded".
- Step the sim and assert physical plausibility: `max_qvel` decaying, thorax height stable,
  no NaNs in `qpos`.
- When touching the render bridge, toggle collision geoms on. The primitives must land exactly
  on the mesh limbs. That is the fastest check that index mapping is intact.
