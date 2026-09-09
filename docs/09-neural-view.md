# Neural activity inset

Infinite Sugar now has a fixed bottom-left neural view beneath the feeding count. A gray
reference cloud locates the brain; blue sensory, pink internal and yellow motor/descending
neurons flash from their actual simulated firing times. The fly remains the main view.

`tools/export_neural_map.py` reads the existing FlyWire FAFB v783 coordinate and classification
exports and the exact `brain.npz` graph. It averages multiple recorded positions per neuron,
retains 9,000 reference points, and samples 3,221 live neurons and 1,975 measured edges.
Smaller identified populations are retained whole. Each seed contributes its strongest outgoing
connection. The generated `web/brain/neural-map.json` is about 354 KB, with no remote runtime
requests. Rerun the exporter after rebuilding the brain; it uses the same classification order.

This is a projection of representative positions with straight connection lines, not neuron
morphology or synapse locations. A lit connection indicates its presynaptic neuron fired;
it does not assert successful transmission or reconstruct axonal propagation. The About notes
explain this. The source frame is described by the [FlyWire Codex FAQ](https://codex.flywire.ai/faq).

`Brain.lastSpikeMs` records each spike during the existing sparse role-counting pass. It neither
adds input nor changes any state used by the kernel. `web/neural-map.ts` projects the data onto
a 2D canvas, caches gray geometry, and batches colored edges. Flashes decay over 65 simulated
milliseconds. No simulation steps means no animation, including on pause. Resize rebuilds the
canvas even while paused. The inset adds no WebGL context or independent animation loop.
A missing map reports its unavailable state while allowing the artwork to continue running.

Sensory spikes have a brighter cyan core, a restrained blue halo and a soft connection glow.
The halo is a cached radial-gradient sprite, keeping the effect inexpensive on mobile.
The extra emphasis is enabled only while sugar is on; sugar off restores the original sensory
appearance, including when paused. Brightness follows the same spikes and simulated-time decay.

Validation: static typecheck/build; every sampled edge checked against the loaded CSR graph;
per-millisecond timestamps checked against actual spike totals; pause/resume and resize render
checks; full MuJoCo shuffle/feeding/settling regression; browser desktop and 360px layout, with
no page errors or warnings. Map and controls remain within the viewport without overlap.
