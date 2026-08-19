# Embodied Fly Connectome Emulation — Feasibility, Compute, and Stack

**Prepared:** 19 Aug 2026 · **Scope:** whole-brain *Drosophila* connectome emulation coupled to an off-the-shelf body model, driven by continuous appetitive stimulation.

> **Note on inputs:** the Connectome project contains no proposal document, so this is written against the description in your message ("fly connectome emulation + pre-made embodiment + continuous positive stimuli"). If there's a written proposal with specific claims, send it and I'll check this against it line by line.

---

## 1. Headline verdict

**Compute is not the bottleneck. This is a laptop-to-single-GPU problem, not a datacenter problem.** The entire adult fly brain — ~140k neurons, ~50M synapses — fits in about 400 MB of RAM as a sparse weight matrix and simulates at roughly 0.05–0.5× real time on a single CPU, faster than real time on a GPU or neuromorphic chip.

**It has also already been done, twice, in public.** Eon Systems demonstrated a whole-brain LIF model driving NeuroMechFly v2 in March 2026, producing grooming, leg-stretching and drinking. In February 2026 a group posted *FlyGM*, which instantiates the FlyWire connectome as a graph-structured RL controller for the DeepMind/Janelia `flybody` model and gets stable walking and flight. So the question for any new proposal is not "can this run?" but **"what does this proposal do that those two didn't?"**

The real constraints are (a) fidelity — the standard model has no neuromodulation, no plasticity, no adaptation, so "continuous positive stimulus" resolves to a fixed point rather than anything that develops over time; and (b) the sensory and motor interfaces, which are hand-built glue, not connectome-derived.

---

## 2. How big is the file?

| Asset | Size | Needed? |
|---|---|---|
| **FlyWire v783 full synapse table** (`flywire_synapses_783.feather`) — every synapse with 3D coords + NT prediction | **9.5 GB** | No, unless doing spatial work |
| **Proofread neuron→neuron connections** (`proofread_connections_783.feather`) | **852 MB** | Optional |
| Per-neuron neuropil pre/post counts | 234 MB + 17 MB | No |
| Proofread root IDs | 1.1 MB | Yes |
| *Full Zenodo v783 record* | *10.6 GB* | — |
| **Codex CSV export** (classification, coordinates, connections, cell types) | **~60 MB** | **Yes — this is the practical one** |
| **Simulation-ready sparse matrix**, 50M edges as int32 indices + fp32 weights | **~400 MB in RAM** (measured) | Yes |
| Aggregated neuron-pair edge list (~3.5M pairs, the form most models use) | ~20–60 MB parquet | Yes |
| MuJoCo `flybody` body model + meshes | **138 MB** (measured) | Yes |
| NeuroMechFly v2 / FlyGym package + assets | tens of MB | Yes |
| Raw FAFB/BANC EM image volume | **~100 TB** | **No.** Never touch this. |

**Bottom line: your working dataset is 60–200 MB.** A phone could hold it. The 10 GB Zenodo record and the 100 TB EM volume are for connectomics research, not emulation.

### Which connectome
- **FlyWire FAFB** (female brain): 139,255 neurons / ~50M synapses in the simulated model (127,400 in the reconstructed central-brain volume). Best-supported, most tooling.
- **BANC** (Brain And Nerve Cord, released Nov 2025): **~160,000 neurons** — ~140k brain + ~20k VNC — with ~1,300 descending, ~1,900 ascending, 833 motor neurons. **This is the one that matters for embodiment**, because it's the first dataset where the brain→VNC→muscle path is actually wired rather than hand-stitched.
- **Janelia male CNS / MANC**: alternative VNC source, different animal, requires cross-registration.

If the proposal's differentiator is embodiment, using BANC instead of brain-only FlyWire is the single highest-value change — it replaces the hand-tuned descending-neuron interface with real circuitry.

---

## 3. Processing power, by fidelity tier

### Tier 1 — Point-neuron LIF (what everyone actually runs)
The Shiu et al. model: Brian2, leaky integrate-and-fire, one free parameter (`w_syn` = 0.275 mV), membrane τ = 20 ms, synaptic τ = 5 ms, threshold −45 mV, reset/rest −52 mV, refractory 2.2 ms, 1.8 ms synaptic delay. No plasticity, no adaptation, no neuromodulation, no gap junctions.

Measured wall-clock to simulate **1 second of biological time** (whole brain, dt = 0.1 ms):

| Platform | Wall time / bio-second | Real-time factor |
|---|---|---|
| Brian 2, CPU (sugar-neuron protocol) | 4.4 s | 0.23× |
| Brian 2, CPU (5 Hz mean activity) | 10.1 s | 0.10× |
| Brian 2, CPU (40 Hz mean activity) | 14.0 s | 0.07× |
| STACS, 8-process CPU | 2.7–25.7 s | 0.04–0.37× |
| **This container** (2 vCPU, plain NumPy/SciPy, 50M edges) — *my own benchmark* | **8.8 s @ 1 Hz / 11.7 s @ 5 Hz / 20.9 s @ 40 Hz** | 0.11× / 0.09× / 0.05× |
| Intel **Loihi 2**, 12 chips, dt = 1 ms | **0.012–4.8 s** | **0.2–80×** |
| Loihi 2, dt = 0.1 ms | 0.054–5.8 s | 0.17–19× |

My independent benchmark landing within ~2× of the published Brian2 numbers is a useful cross-check: **~10 s of CPU per simulated second is the honest baseline**, and it degrades with firing rate because cost scales with spikes × fanout (mean fanout ≈ 359).

**GPU:** Brian2CUDA / GeNN / a hand-rolled PyTorch sparse implementation should land in the **1–10× real-time** range on a single RTX 4090 or A100. Eon Systems benchmarked exactly this set (Brian2, Brian2CUDA, PyTorch, NEST GPU, GeNN, Brian2GeNN on an RTX 4070) but has not published the numbers — this is the one figure worth generating yourself before committing to a stack.

**Memory:** ~400 MB for the sparse connectivity, plus state vectors. Fits in 2 GB. This never becomes a constraint.

### Tier 2 — Connectome-constrained differentiable networks
The Turaga lab's `flyvis` approach: 64 cell types, 45,669 neurons, 1,513,231 connections, PyTorch, **734 free parameters** because the connectome does the structural work. Ensembles of 50 models train on ordinary GPUs. This is the right tool if you want the *visual* pathway to actually respond to naturalistic input rather than to hand-specified rates.

### Tier 3 — Multicompartment Hodgkin–Huxley (the expensive ceiling)
The published whole-brain HH attempt simulated **18,728 neurons / 344,861 synapses** at real time — and needed the **Fugaku supercomputer: 480,000 cores across 10,000 nodes, 630 TFLOPS**, at dt = 0.25 ms (2.63 s per bio-second at dt = 0.025 ms).

**Scaling that to all 140k neurons is roughly 7.5× more work — i.e. a top-20 supercomputer for real-time morphologically-detailed emulation.** This is the actual cliff. Everything below it is cheap; this is where "emulation" starts costing real money. If the proposal claims morphological realism *and* real-time embodiment, that claim needs pricing at ~5 PFLOPS sustained, not at "a laptop."

### Tier 4 — Body physics
MuJoCo `flybody`, measured here on 2 vCPUs, no rendering:

```
nq=109  nv=108  nu=78 actuators  nbody=68  ngeom=160  timestep=1e-4 s
196 µs/step → 5,098 steps/s → 0.51× real time (single fly, 2 weak vCPUs)
```

On a normal desktop core expect **1.5–3× real time**. NeuroMechFly v2 (87 joints) with GPU batching hits 11,445 steps/s aggregate across **100 parallel flies** on an RTX 3080 Ti — 1.14× real time in aggregate, i.e. ~0.011× per fly. **Batched GPU physics is for RL training, not for running one fly fast.** For a single closed-loop fly, CPU MuJoCo is the better choice.

### Tier 5 — Vision rendering
If you want real retinal input, ommatidia rendering costs ~1,258 µs/step in the NeuroMechFly GPU config — **~15% of total step time**, and it's the piece that scales worst. Consider rendering vision at 100–500 Hz rather than at the 10 kHz physics rate.

### Putting it together
Eon's approach: **sync brain and body every 15 ms** — advance the brain, read descending-neuron output, advance physics 15 ms, feed sensors back. That decoupling is what makes the whole thing tractable; you are not co-integrating a 0.1 ms neural step with a 0.1 ms physics step.

**Realistic end-to-end throughput for a single embodied fly: 0.02–0.1× real time on a good workstation.** One minute of fly-life = 10–50 minutes of wall clock. Overnight gets you a few hours of subjective fly time. That is *entirely* adequate for the experiment as described.

---

## 4. Likely development stack

```
┌─ Data ────────────────────────────────────────────────┐
│  FlyWire Codex / BANC exports (CSV/parquet, ~60 MB)   │
│  caveman / fafbseg / navis / bancr for access         │
└───────────────────────────────────────────────────────┘
                        │
┌─ Brain ───────────────────────────────────────────────┐
│  Baseline:   Brian2 (Python, C++ standalone codegen)  │
│  Fast path:  GeNN / Brian2CUDA, or hand-rolled        │
│              PyTorch sparse LIF (best control)        │
│  Vision:     flyvis (PyTorch DMN) for the optic lobe  │
│  Exotic:     Intel Loihi 2 via Lava — 3–350× faster,  │
│              but sparse-activity-dependent and a      │
│              serious porting cost                     │
└───────────────────────────────────────────────────────┘
                        │  descending neurons (DNa01, DNa02, oDN1, …)
┌─ Body ────────────────────────────────────────────────┐
│  NeuroMechFly v2 / FlyGym (MuJoCo, 87 joints)   ← or  │
│  flybody (MuJoCo Menagerie, 78 actuators, 138 MB)     │
│  Motor primitives: pretrained RL/imitation policies   │
│  (DMPO via Acme, or PPO) — do NOT train from scratch  │
└───────────────────────────────────────────────────────┘
                        │  proprioception, contact, vision, chemo
                        └──────────► back to sensory neurons
```

**Language:** Python throughout, with C++/CUDA only inside the simulator kernels. **Orchestration:** a simple fixed-timestep loop; Ray only if you're running many flies in parallel.

**The commandeering strategy is correct and I'd push it further:** take FlyGM's or Eon's descending-neuron→controller mapping wholesale, take the pretrained walking/flight policies from `flybody`, take `flyvis` for the optic lobe. The novel work should be confined to the brain–body interface and the stimulus protocol.

**Biggest hidden cost:** the interface, not the simulation. There is no principled mapping from ~1,300 descending neurons to 78 MuJoCo actuators. Both existing projects solved it by picking a handful of DNs and attaching them to pretrained behavioral controllers via imitation learning — which means **the motor system is not emulated, it's a learned prosthesis bolted onto the connectome**. Any honest version of this proposal has to say so.

---

## 5. Continuous positive stimuli — what you'd actually get

**Mechanism.** The natural handle is the sugar gustatory receptor neurons (GRNs). Shiu et al. activated sensory populations at 10–220 Hz via Poisson input and recovered the correct downstream circuit — sugar GRN activation drives proboscis extension. A reward-signal alternative is tonic drive to PAM-cluster dopaminergic neurons, the mushroom-body appetitive reinforcement pathway. Either is a one-line change: add a `PoissonInput` to a named neuron set and never turn it off.

**What happens.** The model is a pure LIF network with **no spike-frequency adaptation, no synaptic depression, no plasticity, and no neuromodulation**. Under constant input it will settle into a fixed point — a stationary firing-rate pattern — within a few hundred milliseconds and stay there indefinitely. Three consequences:

1. **Nothing develops over time.** Hour 10 looks exactly like second 10. There is no satiation, no habituation, no learning, no consolidation, because none of those mechanisms exist in the model.
2. **Downstream of the fixed point, behavior is stereotyped.** Expect continuous proboscis extension or a locked motor pattern, not "a happy fly exploring."
3. **Runaway is a real failure mode.** Without adaptation, tonic excitation of a recurrent network can drive global saturation. Watch mean population rate; the compute cost also rises ~2× from 1 Hz to 40 Hz, so a saturated network is both wrong and slow.

**If you want the stimulus to actually do something,** you must add at least one of: short-term synaptic depression, spike-frequency adaptation, a dopaminergic plasticity rule at Kenyon-cell→MBON synapses, or an internal-state variable (hunger). Each is a substantive modeling commitment and each takes you further from "the connectome determines the dynamics."

**On the framing.** "Continuous positive stimuli" imports a lot. What the model supports is *sustained activation of neurons that in a real fly signal appetitive value*. Whether that constitutes anything experienced is not something the simulation can answer, and the model's own structure — no neuromodulation, which is where a great deal of the relevant biology lives — is a reason for caution about the stronger reading. I'd flag this as worth thinking about carefully rather than either asserting or dismissing; it's also the part most likely to attract attention if the work is published, so it's better to have a considered position than an improvised one.

---

## 6. Hardware and cost

| Tier | Spec | Cost | Gets you |
|---|---|---|---|
| **Laptop** | M-series Mac or any 8-core box, 16 GB | $0 | Full LIF brain at ~0.1× RT, single-fly MuJoCo at ~1× RT. **Genuinely sufficient for the described experiment.** |
| **Workstation** | 16-core CPU + RTX 4090, 64 GB | ~$4–5k once | GPU LIF at ~1–10× RT, batched RL training for motor policies |
| **Cloud, on demand** | A100 80 GB ≈ $2/hr; H100 ≈ $2–3.3/hr; RTX 4090 on spot markets ≈ $0.3–0.7/hr | ~$100–500 for a full study | Policy training bursts, parameter sweeps |
| **Neuromorphic** | Loihi 2, 12 chips via Intel INRC | research access only | 5–80× real time; only worth it if long-duration continuous running is the *point* |
| **HPC** | ~5 PFLOPS sustained | INCITE-class allocation | Multicompartment HH whole brain at real time |

**A serious version of this project runs on hardware you already own.** If the proposal asks for a cluster, the burden is on it to explain which tier it's targeting.

---

## 7. Risks and honest failure modes

1. **Novelty.** Two public projects (Eon, March 2026; FlyGM, February 2026) already did embodied whole-brain fly emulation. Any proposal needs a clear delta — my candidates: use BANC so the motor path is real; add neuromodulation; run genuinely long durations on neuromorphic hardware; do the tonic-stimulation experiment nobody has done.
2. **The motor interface is a prosthesis.** Pretrained RL controllers doing the actual work means the "emulation" claim is much weaker than it sounds. Say it out loud in the writeup.
3. **The model has one free parameter.** `w_syn` is fit, and absolute firing rates are acknowledged by the original authors as "unlikely to be accurate." Relative/comparative claims only.
4. **Silent saturation.** Continuous drive with no adaptation → population runaway that superficially looks like rich activity. Instrument mean rate from day one.
5. **Verification is the hard part.** There is no ground truth for "a fly under continuous reward." Design the falsifiable comparison (stimulated vs. sham vs. lesioned) before running anything.
6. **Vision is expensive and optional.** If the stimulus is gustatory, skip retinal rendering entirely for v1.

---

## 8. Suggested sequencing

| Phase | Work | Time | Compute |
|---|---|---|---|
| 0 | Pull Codex/BANC data, reproduce Shiu sugar-GRN result in Brian2 | 1 week | Laptop |
| 1 | Benchmark Brian2 vs GeNN vs PyTorch sparse on your own hardware — fill the gap Eon left | 1 week | Laptop + 1 GPU |
| 2 | Stand up `flybody` or NeuroMechFly, run pretrained walking policy open-loop | 1 week | Laptop |
| 3 | Close the loop: DN readout → controller, sensors → sensory neurons, 15 ms sync | 3–4 weeks | Workstation |
| 4 | Tonic stimulation protocol + saturation instrumentation + sham/lesion controls | 2–3 weeks | Workstation |
| 5 | Add adaptation/neuromodulation if phase 4 shows the fixed-point problem | 4–8 weeks | Workstation |

**~3 months, one person, no capital expenditure**, to reach a defensible result.

---

## Sources

- [FlyWire connectome dataset v783 — Zenodo](https://zenodo.org/records/10676866)
- [Shiu et al., *A Drosophila computational brain model reveals sensorimotor processing*, Nature 2024](https://www.nature.com/articles/s41586-024-07763-9)
- [philshiu/Drosophila_brain_model — LIF model source](https://github.com/philshiu/Drosophila_brain_model)
- [Neuromorphic Simulation of Drosophila Melanogaster (Loihi 2 benchmarks), arXiv 2508.16792](https://arxiv.org/html/2508.16792v1)
- [High performance multi-compartment Hodgkin-Huxley whole-brain simulation on Fugaku, bioRxiv](https://www.biorxiv.org/content/10.1101/2022.11.01.512969v1.full)
- [Researchers simulate an entire fly brain on a laptop — Berkeley News](https://news.berkeley.edu/2024/10/02/researchers-simulate-an-entire-fly-brain-on-a-laptop-is-a-human-brain-next/)
- [How the Eon Team Produced a Virtual Embodied Fly](https://eon.systems/updates/embodied-brain-emulation)
- [eonsystemspbc/fly-brain — simulator benchmark harness](https://github.com/eonsystemspbc/fly-brain)
- [Whole-Brain Connectomic Graph Model Enables Whole-Body Locomotion Control in Fruit Fly (FlyGM), arXiv 2602.17997](https://arxiv.org/html/2602.17997)
- [NeuroMechFly v2 — GPU-accelerated simulation tutorial](https://neuromechfly.org/tutorials/3_gpu_accelerated_simulation/)
- [NeuroMechFly v2 preprint, bioRxiv](https://www.biorxiv.org/content/10.1101/2023.09.18.556649v4.full)
- [TuragaLab/flybody — MuJoCo fruit fly body model](https://github.com/TuragaLab/flybody)
- [Whole-body physics simulation of fruit fly locomotion, Nature 2025](https://www.nature.com/articles/s41586-025-09029-4)
- [Lappalainen et al., *Connectome-constrained networks predict neural activity across the fly visual system*, Nature 2024](https://www.nature.com/articles/s41586-024-07939-3)
- [Distributed control circuits across a brain-and-cord connectome (BANC), bioRxiv](https://www.biorxiv.org/content/10.1101/2025.07.31.667571v1.full.pdf)
- [The BANC: Drosophila Brain and Nerve Cord — FlyWire Blog](https://blog.flywire.ai/2025/11/03/the-banc-brain-and-nerve-cord/)
- [Researchers Upload Fly's Brain to Matrix, Let It Control Virtual Body — Futurism](https://futurism.com/science-energy/research-fly-brain-matrix)
- [GPU cloud pricing comparison 2026 — Spheron](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/)

*Benchmarks labelled "measured" were run by me in this session on a 2-vCPU / 7 GB Linux container with no GPU: a 139,255-neuron / 50M-edge sparse LIF step loop in NumPy/SciPy, and MuJoCo 3.11 stepping the `flybody` model from MuJoCo Menagerie.*
