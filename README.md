# Infinite Sugar

An emulated fruit fly, embodied and given infinite sugar.

The MuJoCo `flybody` fruit fly, simulated in WebAssembly and rendered with three.js, with a
139,255-neuron FlyWire LIF network driving feeding, head and antennal motion. Supplied command
mappings turn descending neural activity into wing movements and small foot shuffles in place.
Sensory switches, a feeding-spike counter, and a corner map of firing neurons expose the running network.
The map uses sampled FlyWire positions and actual graph connections; regenerate it with
`python3 tools/export_neural_map.py` after rebuilding the brain.

## Run

```bash
./serve.sh 7377
```

then open <http://localhost:7377>. ES modules and `fetch()` don't work over `file://`, so a
static server is required. First load compiles the model and takes a few seconds.

Any static server works: `python3 -m http.server 7377`, `npx serve web`, whatever.

## Development checks

The deployed app remains native JavaScript with no build step. TypeScript checks the project-owned
JavaScript and JSDoc types during development without emitting files:

```bash
npm ci
npm run typecheck
node tools/shuffle_test.mjs
```

## Controls

The visitor view opens with sugar on: the live fly, a feeding-signal counter, pause, and a
return-to-fly camera control. Drag to orbit and scroll to zoom. **About the work** explains the
premise, model limits and credits. **Inspect** contains sensory switches, neural readings,
physics statistics, and the existing scene-position tools.

In Inspect, **Show collisions** overlays the physics primitives. **Neural movement** toggles
body responses to the brain; **Foot shuffle** independently toggles the small leg adjustments.
Pause freezes both the fly and the ball. Reset body restores the pose while preserving the
running brain and its feeding count.

Shuffle timing follows grooming-neuron activity, and movement size follows ipsilateral steering
activity. The leg motion pattern is supplied by the application; the leg motor connectome is not
present in this dataset. See [the implementation and verification notes](docs/07-neural-shuffle.md).

## Website packaging

`npm run build` copies the complete static website to `dist/`, including the body assets and
connectome. There is still no bundler or runtime package dependency. Sites hosting is configured
in `.openai/hosting.json`; `dist/` is generated and ignored by Git.

## Where things are

| | |
|---|---|
| `CLAUDE.md` | **start here** — project context, measured facts, traps, conventions |
| `web/app.js` | physics, rendering and neural body mappings |
| `web/brain.js` | whole-brain LIF kernel |
| `docs/00-feasibility.md` | full feasibility study: compute, data sizes, stack, prior art |
| `docs/01-iteration-1.md` | build notes for what's in `web/` |
| `docs/02-decisions.md` | why things are the way they are |
| `docs/03-next-steps.md` | iteration 2 onward |
| `tools/weld_meshes.py` | the asset pipeline, reproducible |

## Credits

Built with:

- **Body** — [`flybody`](https://github.com/google-deepmind/mujoco_menagerie/tree/main/flybody)
  from MuJoCo Menagerie (Vaxenburg et al., *Whole-body physics simulation of fruit fly
  locomotion*, Nature 2025). 68 bodies, 78 actuators, 109 DoF. XML unmodified.
- **Physics** — DeepMind's official [`mujoco-js`](https://www.npmjs.com/package/mujoco-js)
  WebAssembly build.
- **Rendering** — [three.js](https://threejs.org) r185. The MuJoCo→three.js bridge follows the
  established `mujoco_wasm` demo pattern.
- **Connectome** — [FlyWire](https://flywire.ai);
  Shiu et al., *A Drosophila computational brain model reveals sensorimotor processing*,
  Nature 2024.

Runtime dependencies are vendored; project code connects the data, simulation and presentation.

Mobile rendering adapts resolution, shadows and refresh rates to sustained device performance.
The complete neural network and fixed simulation timestep are preserved; slower devices may
run below real time. See [mobile performance notes](docs/10-mobile-performance.md).

## Production deployment

Cloudflare Pages Free, connected to `cnqso/infinite-sugar` on GitHub. Production targets
`https://infinitesugar.cnqso.com`. Push to `main` to update the site once the Pages connection
is active. Build command: `node tools/build_site.mjs`; output: `dist`.
See [deployment setup](docs/11-cloudflare-pages.md) for the Git connection and DNS settings.
