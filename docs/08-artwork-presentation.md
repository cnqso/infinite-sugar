# Artwork presentation

2026-09-05: package the working simulation as an artwork with minimal visible explanation.

The initial screen presents the live fly, the name Infinite Sugar, “A small life.”,
the cumulative feeding-signal counter, and sugar/pause/recenter controls. Sugar starts enabled
after the existing resting calibration. There is no landing-page gate or recorded substitute.

About the work is a native modal with a short premise, followed by optional model notes and
attribution. Inspect is a separate modal drawer containing every sensory switch, body controls,
live neural rates, physics statistics and the former top-right scene-position inputs. Both
support Escape, close buttons, focus containment and returning focus to the opening control.
The primary sugar control and the inspector's sugar button share the actual stimulus state.

The counter reports proboscis and ingestion population spikes only while sugar is enabled.
It excludes calibration and holds its accumulated value when sugar is off, then resumes when
sugar returns. The raw `feedSpikes` diagnostic still includes all activity. The displayed
`sugarFeedSpikes` includes background spikes during sugar; it does not isolate causal effects
or measure pleasure or welfare. Model notes state this distinction explicitly.

The presentation uses local system typography, a dark overlay, warm sugar accents, and native
HTML/CSS. Narrow screens use a wider vertical field of view to preserve horizontal framing.
The camera can be returned to its original position without resetting the simulation. Reset
body now synchronizes render transforms immediately, including when paused. The physics, brain
kernel, connectome, shuffle and upstream XML are unchanged by this presentation pass.

`npm run build` stages `web/` into an ignored `dist/` directory. The output remains static and
unbundled, with committed runtime dependencies and no external font or image requests.

Validation: typechecking; browser startup and normal-page console checks; about/inspector
navigation; synchronized sugar buttons; stable feeding count when paused; resumed counter;
recenter control; desktop and narrow-screen layout checks. A temporary browser health check
read `window.fly` after 27 simulated seconds: sugar enabled, 25 shuffles, finite qpos throughout,
and brain/body clocks within one millisecond. The browser automation injected an unrelated
MutationObserver error into the temporary iframe test; the standalone artwork page's error and
warning log remained empty. The temporary test page is not shipped.

Counter correction: verified calibration exclusion, sugar-off hold despite continuing raw
activity, sugar-on accumulation and resumption, and pause in the browser. Both sugar controls
stay synchronized. Typecheck, static build, and the complete MuJoCo shuffle/settling gate pass.
The standalone browser error and warning log is empty.

The artwork is now titled Infinite Sugar. The page, loading screen, favicon, browser/social
titles and Site display name share this identity. The existing site address is retained.
