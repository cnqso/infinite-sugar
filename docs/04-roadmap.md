# Roadmap — to a fly with a sign of life

Written as a handoff. Goal, stated plainly:

> A fly in a browser that visibly does something because sugar is touching it, where "we are
> stimulating its reward pathway" is a defensible sentence rather than a lie.

Every phase below has a **gate**: something that either passes or fails, that can be run and
shown. If a gate fails, the phase is not done, and the fallback is written down next to it.

This document cuts corners on purpose. Each cut is labelled **CUT** with what it costs.

---

## The honesty budget

This matters more than the code, so it goes first. At the end of this roadmap, here is what
can and cannot be said.

**Can be said, and is true:**

- The wiring is real. Neurons and synapse counts come from the FlyWire FAFB v783 connectome —
  the published adult *Drosophila* connectome, measured from a real animal's brain.
- Sweet gustatory receptor neurons (GRNs) are the fly's sugar sensors. Driving them is the
  canonical way to activate the fly's reward circuitry — this is how the actual experiments are
  done, with sugar or with optogenetics.
- **"We are stimulating the sugar pathway of a real fly connectome, and its feeding motor
  neurons fire as a result"** — true, measured at +210%, and checkable on the HUD.
- ~~The PAM dopaminergic neurons downstream are firing as a result.~~ **Retracted by
  measurement.** PAM is in the simulation and running, but it does not respond to sugar here
  (+3%). Do not claim a dopamine response. See `docs/05-results-phase1-3.md`.
- Sugar also **suppresses the bitter pathway by ~68%** — a real documented interaction that
  emerged from the measured wiring rather than from anything we wrote.
- The proboscis extends for the same reason a real fly's does: sugar on the legs, four to five
  synapses, motor neurons, muscles.

**Cannot be said, and should not be:**

- That the fly feels anything. The model has membrane voltages, not experiences.
- That it is "happy". Say *reward pathway active*, not *pleasure*. The first is a circuit claim
  and is verifiable; the second is a claim about experience and is not.
- That it is a *scan* or an *upload*. "Whole-brain emulation" is used here the way the
  connectomics literature uses it — an integrate-and-fire model over the entire measured
  connectome (cf. Shiu et al. 2024, whose title is exactly that). It does **not** mean the
  mind-uploading sense of the phrase. The two meanings sound identical to a viewer, and the
  piece stands on that ambiguity deliberately; know that you are standing on it.
- That it learns, habituates, or gets bored. There is no plasticity, deliberately
  (see `CLAUDE.md` — this is an owner decision, not an oversight).

**What is actually dark.** The whole brain runs, but almost none of it is connected to
anything. The eyes receive no light, the antennae no odour, the wings and legs no commands —
roughly a hundred motor neurons spike into nothing at all. One sense goes in (sugar) and one
muscle group comes out (proboscis). That is the honest description, and it is a better sentence
for the piece than any overclaim would be: a complete brain, running, almost entirely unobserved.

**The load-bearing weasel word is "pathway."** We stimulate a pathway. We do not stimulate a
feeling. That distinction is the whole difference between an honest piece and a fraudulent one,
and it costs nothing artistically — arguably it is more interesting.

Also inherited from the source data: FlyWire is **CC BY-NC 4.0, non-commercial**. Anything
derived from it carries that. Citations to carry are in
`docs/05-attribution.md` (written in Phase 1).

---

## What we are borrowing

`DenisSergeevitch/desktop-fly` (MIT, Denis Shiryaev) did the FlyWire→LIF pipeline for a
*different* circuit (escape/looming). Its body is procedural animation, not physics, so none of
its body code is useful to us. Two things are:

1. **`etl.py`** — Codex CSV parsing: the column layout of all four dumps, the neurotransmitter
   sign map, the strict `primary_type` matching rule (their comment records that loose matching
   pulled in near-miss cell types). We keep the parsing and the `CORE_TYPES` dict for *tagging*
   our populations, and delete their partner-selection machinery — we take every neuron.
2. **The LIF kernel in `Sim.swift`** — CSR adjacency, 1 kHz step, delayed inhibition, and a set
   of tuned constants (20 ms membrane tau, 2 ms refractory, weight scale 8e-4).

We trace these. We do not vendor the Swift. See `docs/04-prior-art-desktop-fly.md`.

---

## Phase 0 — data on disk

**Do:** download the four Codex dumps (55 MB, public GCS, no auth — verified). Write
`tools/fetch_flywire.sh` so it is reproducible. Add `data/raw/` to `.gitignore` — raw dumps are
not committed, derived files are.

**Gate:** all four files present, gunzip clean, row counts printed and recorded in the doc.

**Risk:** none meaningful. This is a download.

---

## Phase 1 — do the neurons we need exist? (THE REAL GO/NO-GO)

Everything downstream assumes FlyWire v783 has usable annotations for the taste-feeding circuit.
That assumption has not been tested. **This phase exists to try to falsify it early, cheaply.**

**Do:** grep `consolidated_cell_types.csv.gz` (0.9 MB) for each population we need:

| what | why we need it | candidate type names |
|---|---|---|
| sweet GRNs, labellar | the sugar sensor | `Gr64f`, `LB3b`, `LB3c` |
| sweet GRNs, leg | lets the fly stand *in* the sugar | `LgLG4` |
| PAM DANs | **the reward readout — the counter's source** | `PAM01`..`PAM15` |
| MN9 | rostrum protraction | `MN9` |
| MN4a | haustellum extension | `MN4a` |
| MN6, MN8 | labellar spread | `MN6`, `MN8` |

**Gate:** every row above resolves to ≥1 real neuron, printed with counts. Sweet GRNs and at
least one proboscis MN are mandatory. PAM is mandatory — without it there is no honest counter.

**If it fails:** the names differ. Fall back to searching `class`/`sub_class` in
`classification.csv.gz` (e.g. super_class `motor` restricted to the SEZ) and to the neuron lists
published in Shiu et al. 2024, which used this exact dataset for this exact circuit. This is a
lookup problem, not a science problem — but budget real time for it, per `docs/03-next-steps.md`.

**If it truly fails**, stop and report. Do not proceed to build a circuit out of guesses.

---

## Phase 2 — build the whole brain, headless Python

**Do:** adapt `etl.py` into `tools/build_brain.py`. Emit the full connectome: every neuron in
FlyWire v783, every connection at the standard ≥5-synapse threshold — **127,978 neurons,
2,613,129 edges** (`CLAUDE.md`). Sign each edge by predicted neurotransmitter
(ACh +1, GABA −1, Glut −1). Tag the Phase 1 populations with roles (`grn_sweet`, `mn9`, `pam`, …).

This is *simpler* than the subcircuit version, not harder: the borrowed script's entire two-pass
partner-selection machinery (`MAX_PARTNERS`, `strength_by_role`, the reserved-slot logic) gets
deleted. There is no selection step. Take everything.

**Why whole brain is the more honest option, not the less honest one.** Subsetting is an
editorial act: choosing 3,000 of 128,000 neurons means we decided what mattered, and whatever
comes out is partly our curation. Taking everything means we decide nothing — we run the measured
wiring and only read out the parts we understand.

**It also removes the main technical risk in Phase 1.** With a subcircuit, failing to identify an
intermediate population can leave GRN and MN in disconnected components, and nothing works. With
the whole brain, every path that exists in the fly exists in the model, whether or not we can
*name* the neurons along it. We only need to identify three things: the input (sweet GRNs), the
output (proboscis MNs), and the counter (PAM). The four-to-five hops in between come along for
free, unnamed.

**Payload.** ~7.5 MB gzipped over the wire in the packed format `CLAUDE.md` already measured
(varint row-delta edge indices 5.2 MB + uint8 weights 1.7 MB + indptr 0.5 MB), expanding to
~20 MB of typed arrays in RAM. Acceptable — `web/vendor/` is already 13 MB.

**Gate — the drive report.** For the Phase 1 populations only, print total in-circuit synaptic
in-degree. **This is the trap the borrowed project actually shipped**: they released a population
with 6 synapses of drive, so it was driven by noise rather than by the network — it looked alive
and meant nothing. Whole-brain makes this much less likely, but the identified populations are
exactly where a bad type match would show up, so check them.

**Second gate:** print the shortest path from sweet GRN to MN9. Expect 4–5 hops. If it comes back
disconnected or 12 hops, a Phase 1 identification is wrong.

---

## Phase 3 — the reflex, headless Python

**Do:** hand-rolled NumPy LIF. Constants traced from the borrowed kernel: 20 ms membrane tau,
threshold 1.0, 2 ms refractory, ~4 ms delayed inhibition, ACh +1 / GABA −1 / Glut −1. Inject
current into the sweet GRNs. Read out MN9/MN4a/MN6/MN8 and PAM firing rates.

**Gate (this is the money shot, and it is a plot):** GRN drive on → MN rate rises and PAM rate
rises. GRN drive off → both fall to baseline. Plot both against time; save the PNG.

**If the MNs don't fire:** raise the GRN drive and the weight scale before touching anything
structural — gain tuning is expected work, not failure. Document the final gains honestly as
*hand-tuned*, the way the borrowed project's own honesty section does. The wiring is measured;
the gains are not, and saying so costs nothing.

`mujoco` is not installed locally — `pip install mujoco` for this phase, or skip straight to the
browser, since the browser build is the actual deliverable and already works.

---

## Phase 4 — the loop closes in the browser

**Do:** port the LIF to `web/brain.js` — plain JS, typed arrays, CSR, no build step. Run it
inside the existing rAF loop in `app.js`.

**This is affordable. Measured, on this machine (M4 Pro), not estimated:**

| | cost per simulated second | |
|---|---|---|
| MuJoCo physics, existing page, headless Chromium | **1.16 s** | 115.8 µs/step @ 10 kHz |
| whole-brain LIF, 128k neurons, ~1 Hz mean rate | **0.10 s** | 99 µs/step @ 1 kHz |
| whole-brain LIF, ~7 Hz mean rate | **0.24 s** | 240 µs/step |
| whole-brain LIF, ~29 Hz mean rate | 0.75 s | 751 µs/step |

**The brain is cheaper than the body — roughly 10–20% of the physics cost at realistic firing
rates.** The expensive thing in this project is, and remains, MuJoCo. Adding the entire connectome
to a page that already works costs about a fifth again as much compute.

Two implementation notes that produced a 10–15× speedup in the benchmark and are not optional:
fuse the dense passes (decay + baseline + threshold in one loop over N), and make noise and the
delayed-inhibition queue **sparse** — a per-step list of touched indices, never a full scan of a
128k array. The naive version costs 1,050 µs/step; the fused sparse version costs 99–240 µs.

**CUT — brain at 1 kHz, physics at 10 kHz, loosely coupled.** Step the brain once per simulated
millisecond and hold the actuator command in between. Nobody can see the difference.

**CUT — spike rate → actuator by low-pass filter.** MN population rate, smoothed, scaled, written
to `data.ctrl[rostrum]`, `[haustellum]`, `[labrum_left]`, `[labrum_right]`. No muscle model. This
mapping is the project's actual differentiator and it stays honest because the motor neurons are
individually identified and the joints physically exist (`CLAUDE.md`). It is a *mapping*, not a
*controller* — nothing learned, nothing scripted.

**DECISION — quantize physics, never the emulation.** Owner's call, binding. When headroom is
needed, raise the MuJoCo timestep, drop substeps, or let the fly run slower than realtime —
do **not** drop neurons, prune edges, or subset the connectome. The brain is the claim; the body
is the display. This is also the cheap direction: physics costs 1.16 s per simulated second
against the brain's 0.10–0.24 s.

**CUT — accept ~0.6–0.7× realtime.** Physics alone is already 0.86×. Combined, the fly lives
slightly slower than a real one. No viewer can tell.

Start on the main thread. A Web Worker is a fallback if frame pacing suffers, not a prerequisite
— and note the multithreaded MuJoCo build's `SharedArrayBuffer`/COOP/COEP problem
(`CLAUDE.md`) does **not** apply here, because only the brain would move to the worker.

**Gate:** in headless Chromium — zero page errors, zero console errors, and a scripted A/B:
clamp GRN input on, assert `data.ctrl[rostrum]` rises and the rostrum joint angle in `qpos`
changes; clamp off, assert it returns. Assert no NaNs in `qpos`, thorax height stable, and that
whole-brain mean firing rate sits in a plausible band (single-digit Hz, not 0, not 200).
Per `CLAUDE.md`: a fly that renders is not a fly that simulates.

---

## Phase 5 — sugar in the world

**Do:** `web/model/world.xml`, which `<include>`s `scene.xml` and adds a sugar puddle geom.
**Upstream XML is not edited** (`CLAUDE.md` convention). Read MuJoCo contact pairs each step; if
a tarsal geom is touching the puddle, drive the leg sweet GRNs.

**CUT — a flat disc with a binary contact test.** Not a diffusion field, not a concentration
gradient. Foot in puddle or not.
*Cost:* less pretty. *Gain:* it satisfies the actual requirement from `CLAUDE.md` — the stimulus
is a property of the world, discovered through the body, rather than a current injected into a
neuron ID list. That is the philosophically load-bearing part, and a disc delivers it.

**Gate:** move the fly off the puddle → proboscis retracts, PAM rate falls. Move it back on →
extends. Recorded as a screen capture, not asserted from memory.

---

## Phase 6 — the counter

**Superseded by measurement — see `docs/05-results-phase1-3.md`.** The plan was to count PAM
dopaminergic spikes. **PAM does not respond to sugar in this model** (+3%, flat across every
parameter setting and all 15 subtypes). A PAM counter would tick at a constant rate whether or
not the fly is in sugar: a number we implied was meaningful that measures nothing. That is the
one failure mode this project cannot afford, so PAM is out.

**Do instead:** count **feeding motor output** — proboscis + ingestion motor neuron spikes.
Measured +210% / +26% under sugar, returning to baseline when sugar is removed.

The honest sentence: *the counter counts the fly's feeding commands. It moves when the fly is
eating.* Less mystical than a dopamine readout, more visceral, and it is measuring something.
Display the live rate next to it so the number is auditable rather than asserted.

**Gate:** counter advances only while sugar contact is live. Take sugar away and it stalls.

---

## Order of risk

| phase | risk | if it fails |
|---|---|---|
| 0 data | none | — |
| **1 neuron IDs** | **highest** — but now only 3 populations must resolve, not 8 | fall back to Shiu et al. neuron lists; may cost days |
| 2 whole brain | low — no selection step to get wrong | — |
| 3 reflex | low — this is a reproduction, not a discovery | tune gains, document as tuned |
| 4 browser | low — bridge works; cost measured at ~20% over physics | Web Worker for the brain |
| 5 sugar | low | — |
| 6 counter | none | — |

Phase 1 is the only phase that can invalidate the project, it is the cheapest phase to run, and
it needs one 0.9 MB file. It goes first for exactly that reason.

## Explicitly not doing

- **Walking.** Needs a borrowed RL policy and an unsolved descending-neuron interface. The piece
  does not require it. This is the trap both prior art projects fell into.
- **Plasticity.** Owner decision, documented in `CLAUDE.md`. Do not add it silently.
- **WebGPU.** Measured unnecessary: plain JS typed arrays run the whole brain at 4–10× realtime.
- **Bundlers.** `app.js` + `brain.js`, no build step, per `CLAUDE.md`.
- **Rewriting the render bridge.** It works and it was expensive. See the traps list.
