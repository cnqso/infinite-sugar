# utilifly

An emulated fruit fly, embodied and given infinite sugar.

Iteration 1: the MuJoCo `flybody` fruit fly, simulated in WebAssembly, rendered with three.js,
standing in a page. No brain, no sugar, no counter yet — just the body, with physics running.

## Run

```bash
./serve.sh 7377
```

then open <http://localhost:7377>. ES modules and `fetch()` don't work over `file://`, so a
static server is required. First load compiles the model and takes a few seconds.

Any static server works: `python3 -m http.server 7377`, `npx serve web`, whatever.

## Controls

Drag to orbit, scroll to zoom. `collision geoms` overlays the physics primitives on the visual
mesh — useful as a sanity check that the render bridge is intact. `idle motion` adds a cosmetic
sinusoid to the antennae, head and abdomen so it doesn't look like a corpse; it changes nothing
about the simulation.

## Where things are

| | |
|---|---|
| `CLAUDE.md` | **start here** — project context, measured facts, traps, conventions |
| `web/app.js` | the whole app, ~260 lines |
| `docs/00-feasibility.md` | full feasibility study: compute, data sizes, stack, prior art |
| `docs/01-iteration-1.md` | build notes for what's in `web/` |
| `docs/02-decisions.md` | why things are the way they are |
| `docs/03-next-steps.md` | iteration 2 onward |
| `tools/weld_meshes.py` | the asset pipeline, reproducible |

## Credits

Everything load-bearing is borrowed:

- **Body** — [`flybody`](https://github.com/google-deepmind/mujoco_menagerie/tree/main/flybody)
  from MuJoCo Menagerie (Vaxenburg et al., *Whole-body physics simulation of fruit fly
  locomotion*, Nature 2025). 68 bodies, 78 actuators, 109 DoF. XML unmodified.
- **Physics** — DeepMind's official [`mujoco-js`](https://www.npmjs.com/package/mujoco-js)
  WebAssembly build.
- **Rendering** — [three.js](https://threejs.org) r185. The MuJoCo→three.js bridge follows the
  established `mujoco_wasm` demo pattern.
- **Connectome** (not yet wired in) — [FlyWire](https://flywire.ai);
  Shiu et al., *A Drosophila computational brain model reveals sensorimotor processing*,
  Nature 2024.

The only original code here is `web/app.js` and `tools/weld_meshes.py`.
