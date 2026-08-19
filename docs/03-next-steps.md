# Next steps

Iteration 1 (a rendered, simulating fly in a page) is done. This is the suggested order after
that, smallest verifiable step first. It is a suggestion, not a plan of record.

## Iteration 2 — the reflex arc, headless

The goal is to see proboscis extension driven by connectome-derived input, with no rendering
and no browser involved. Python, native MuJoCo, one script.

1. Pull the FlyWire connectivity (Codex CSV export, ~60 MB) and build the sparse graph:
   127,978 neurons, 2,613,129 edges at the 5-synapse threshold.
2. Reproduce the published sugar-GRN → proboscis-extension result in Brian2 or a hand-rolled
   NumPy LIF. This is a *reproduction*, not a discovery — Shiu et al. benchmarked exactly this.
   Low risk. Budget the time for neuron-ID lookup and gain tuning, not for whether it works.
3. Identify the sweet GRNs (labellar LB3b–c; leg LgLG4) and the motor neurons
   (MN9, MN4a, MN6, MN8). The path is 4–5 synaptic hops, entirely within the brain volume.
4. Map MN spike rate → actuator command per the table in `CLAUDE.md`, and watch the proboscis
   extend in native MuJoCo.

**Acceptance:** clamp sugar GRNs on, `rostrum` / `haustellum` actuators move; clamp them off,
they don't. Plot MN9 firing rate against actuator position.

## Iteration 3 — the loop closes in the browser

1. Port the LIF kernel to WebGPU compute (dense state update + spike scatter), with a WASM SIMD
   fallback.
2. Ship the packed connectivity (~7.5 MB gzipped — see `CLAUDE.md` for the format).
3. Run brain and body in a Web Worker, exchanging every 15 ms (the cadence Eon used). Render on
   the main thread at 60 fps, decoupled — frame jank must not corrupt the physics cadence.
4. Sugar as a property of the world: a field on the floor, tarsal contact sensors driving the
   leg GRNs. Not an injected current.

**Acceptance:** the page renders a fly whose proboscis extends because its feet are in sugar.

## Iteration 4 — presentation

Deliberately last. The counter, the framing, the leaderboard. All of it is downstream of a
working loop and none of it should be built before one exists.

Open: whether the counter is NPF-proxy integral or something simpler. See `docs/02-decisions.md`.

## Things to resist

- **Building a world before the reflex works.** The hamster cage is more fun than the neuron-ID
  lookup, which is exactly why it will eat the schedule.
- **Adding plasticity.** The Kenyon-cell→MBON rule would give real history-dependence, and it is
  also the fly's habituation mechanism. The owner has decided undiminished stimulus is the point.
  Don't add it silently.
- **Locomotion.** Walking needs a borrowed RL policy and a descending-neuron interface that
  nobody has solved principledly. Proboscis extension needs neither. The project does not
  require the fly to walk; if it ever does, take FlyGM's or Eon's mapping wholesale.
- **Rebuilding MuJoCo or three.js.** Vendored on purpose.
- **Decimating meshes.** Already lossless. See `docs/02-decisions.md`.

## Prior art to stay aware of

Two public projects did embodied whole-brain fly emulation in the six months before this repo
started, so "has this been done" has a real answer:

- **Eon Systems** (March 2026) — whole-brain LIF driving NeuroMechFly v2; grooming, leg
  stretching, drinking. Brain/body sync every 15 ms. Descending neurons DNa01, DNa02, oDN1 mapped
  to behavioral controllers trained by imitation learning.
- **FlyGM** (arXiv 2602.17997, Feb 2026) — FlyWire connectome instantiated as a graph-structured
  RL controller over `flybody`. Walking and flight, trained with imitation learning then PPO on
  A100s.

Both bolt learned controllers onto a few descending neurons because locomotion has no principled
mapping. This project's differentiator is that **proboscis extension does**, plus the tonic
stimulation regime neither of them ran.

See `docs/00-feasibility.md` for the full survey, compute analysis, and cost tiers.
