# Simulation model

## Connectome

The model uses the FlyWire FAFB v783 adult fruit fly connectome: 139,255 neurons and 2,700,513
connections after aggregating neuropil rows and applying the synapse-count threshold.
Connections are stored as a sparse graph; neurotransmitter signs are predicted, and gains are
hand-tuned. The data is licensed under CC BY-NC 4.0.

The leaky integrate-and-fire kernel is informed by Shiu et al. (2024) and Denis Shiryaev's
[desktop-fly](https://github.com/DenisSergeevitch/desktop-fly). It does not model learning,
habituation or neuromodulation. The simulation does not establish whether subjective
experience occurs.

## Input and output

Sugar directly stimulates sweet-sensing gustatory neurons. The terrarium supplies no visual,
olfactory or contact feedback to the brain.

Identified feeding motor populations drive proboscis actuator targets through smoothed firing
rates. Head and antennal responses also follow neural activity. Wing movements and foot
adjustments use supplied patterns driven by descending populations; these are not reconstructed
ventral nerve cord circuits or learned locomotion.

| Population | Body output |
|---|---|
| MN9 | rostrum protraction |
| MN4a | haustellum extension |
| MN6 | labellar extension |
| MN8 | labellar spread |

The on-screen counter accumulates proboscis and ingestion motor spikes while sugar is enabled.
It excludes calibration and holds when sugar is off. It includes background activity during
sugar stimulation and is not a measurement of pleasure.

Earlier parameter sweeps found increased feeding output under sugar but little PAM dopamine
population response. The measured responses and parameter choices are recorded in
[simulation results](05-results-phase1-3.md).

## Timing and performance

The brain advances one millisecond per ten MuJoCo steps. Rendering quality adapts to the device;
the neuron count, connectivity and simulation timesteps stay fixed. Slower devices can run below
real time. Pause and hidden tabs stop advancement.

The kernel fuses decay, baseline input and threshold detection in one dense pass. Spike
propagation, noise and delayed inhibition use sparse updates. Retain this structure when
changing the implementation; per-neuron allocations and additional dense scans are expensive.

See [shuffle mechanics](07-neural-shuffle.md), [neural visualization](09-neural-view.md) and
[adaptive rendering](10-mobile-performance.md) for implementation details.
