# Infinite Sugar

An emulated fruit fly, embodied and given infinite sugar.

[infinitesugar.cnqso.com](https://infinitesugar.cnqso.com/)

A whole-brain emulation using the FlyWire connectome: 139,255 neurons driving a simulated
fruit fly in a terrarium. Its sweet-sensing neurons receive continuous stimulation. Feeding,
head and antennal motion follow neural activity; wing movements and small foot shuffles use
supplied patterns. The corner map shows sampled FlyWire positions and connections lighting up
as neurons fire.

Inspired by *Infinite Pain* (2025) by Harris Rosenblum.

## Run locally

```sh
npm ci
./serve.sh 7377
```

Open [localhost:7377](http://localhost:7377). The first load takes a few seconds.
The browser code is TypeScript, compiled to unbundled JavaScript in `dist/`.
`npm run typecheck` checks the source; `npm test` builds and checks the simulation.
The local server builds once at startup; restart it after editing source files.

## Controls

Name the fly to begin. Drag to orbit and scroll to zoom. Sugar, pause and recenter controls
sit below the fly. About contains the premise, technical summary, credits and further reading;
Inspect shows neural activity and simulation statistics.

## Credits

- [FlyWire](https://flywire.ai) — connectome data, [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).
- [FlyBody](https://github.com/TuragaLab/flybody), via [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/main/flybody) — body model.
- [MuJoCo](https://mujoco.org), [three.js](https://threejs.org) and [cannon-es](https://github.com/pmndrs/cannon-es) — physics and rendering.
- Shiu et al., *A Drosophila computational brain model reveals sensorimotor processing* (2024), and [desktop-fly](https://github.com/DenisSergeevitch/desktop-fly) by Denis Shiryaev — LIF implementation references.
- [Prop models and artists](web/model/props/CREDITS.md).

Research, measurements and implementation notes are in [docs/](docs/).
