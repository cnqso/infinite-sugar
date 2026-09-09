# Mobile presentation and adaptive performance

The artwork now uses the title Infinite Sugar alone. The tagline and orbit hint are removed;
the counter reads “positive feeding signals.” Its quantity is unchanged: feeding-population
spikes while sugar is enabled. About retains the explanation of what the number measures.

Phone layouts cover narrow portrait and short landscape viewports. Safe-area padding, dynamic
viewport height, a scaled loading title, and 44px stimulus buttons accommodate phone screens.
The neural inset remains visible; landscape places controls beside it instead of squeezing
three columns across the screen. Browser zoom remains available.

`web/performance.ts` selects an initial profile using screen/pointer, CPU and optional memory
hints, then measures completed frame intervals and CPU work. It ignores startup and suspension
stalls, steps down after sustained overload, and requires 15 seconds of headroom before trying
a higher level. Mobile has a balanced quality ceiling. No user agent strings or required
hardware APIs are used; missing hints have conservative screen-based fallbacks.

| Profile | Pixel-ratio cap | Shadows | Render limit | Neural-map limit | Simulation budget/frame |
| --- | --- | --- | --- | --- | --- |
| High | 2 | 2048px | 60 fps | 30 fps | 12 ms |
| Balanced | 1.25 | 1024px | 30 fps | 20 fps | 8 ms |
| Low | 0.85 | Off | 30 fps | 12 fps | 5 ms |

Low quality also removes CSS backdrop blur. Mobile starts without multisample antialiasing.
Inspector readouts update at 5 Hz only when open. The inset's resolution follows quality.
Startup calibration yields every 25 neural milliseconds and produces exactly the same state
as synchronous calibration. Visibility changes clear wall-clock backlog and performance
samples; a hidden page performs no simulation/render work. Returning preserves user pause.

All 139,255 neurons still run. The 0.1ms body timestep and one neural millisecond per ten body
steps are unchanged. An underpowered device advances simulation time more slowly; no neural
steps are replaced by a timer or skipped within the simulated timeline. Asset sizes and the
full connectome memory footprint remain unchanged; adaptive rendering cannot guarantee
compatibility with old browsers or devices lacking adequate memory/WebGL support.

Validation: typecheck and static build; deterministic quality downgrade/recovery tests;
actual frame-handler hidden-work suppression, backlog reset and pause preservation;
exact synchronous/yielded calibration equality; neural-map tests; full MuJoCo shuffle/feeding/
settling checks. Browser tests cover 320×568 portrait and 667×375 landscape, inspector controls,
sugar synchronization, and injected 65ms frame stalls. The real browser switched balanced →
low (DPR .85, shadows off) under load and recovered to balanced after load removal. Brain/body
clock error stayed zero and qpos remained finite. Neural-off velocity decayed to .0089.
These are desktop-browser viewport/load tests, not physical iOS/Android device certification.

References: [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
and [Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API).
