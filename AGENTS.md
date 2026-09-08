# Repository Guidelines

## Project Structure & Module Organization

The browser application lives in `web/`: `index.html` defines the page and HUD, while `app.js` and `brain.js` contain the MuJoCo/three.js bridge and connectome simulation. Runtime dependencies are deliberately committed under `web/vendor/`. MuJoCo XML, OBJ meshes, props, and generated brain blobs live in `web/model/` and `web/brain/`. Python and shell utilities in `tools/` build or validate those artifacts. Research notes and generated figures belong in `docs/` and `docs/img/`; source connectome data and derived NumPy files belong in `data/`.

Read `CLAUDE.md` before changing architecture or simulation behavior. In particular, treat `web/model/*.xml` as unmodified upstream files; add an including XML for project-specific changes.

## Build, Test, and Development Commands

- `./serve.sh 7377` serves `web/` at `http://localhost:7377` with caching disabled. ES modules will not work by opening `index.html` directly.
- `npm ci && npm run typecheck` installs development types and checks project JavaScript without emitting files.
- `python3 tools/reflex_test.py --sweep` checks candidate whole-brain LIF parameters.
- `./tools/fetch_flywire.sh && python3 tools/build_brain.py` downloads public raw data and rebuilds `data/brain.npz` plus `data/roles.json`.
- `python3 tools/reflex_plot.py && python3 tools/export_web.py` regenerates the reflex figure and browser-ready brain blobs.

The Python tools require NumPy; plot generation also requires Matplotlib. npm is only for static analysis; browser code remains unbundled.

## Coding Style & Naming Conventions

Use two-space indentation in JavaScript and four spaces in Python. Prefer `camelCase` for JavaScript functions and variables, `UPPER_SNAKE_CASE` for constants, and `snake_case` in Python. Keep browser code as native ES modules and preserve the current dependency-free runtime. No formatter or linter is configured, so match nearby code and keep comments focused on non-obvious physics or data assumptions.

## Testing Guidelines

There is no automated test suite. For browser changes, load the page in Chromium, require zero page and console errors, and inspect `window.fly`. Confirm stable thorax height, decaying `max_qvel`, and no NaNs in `qpos`. When changing the render bridge, enable collision geoms and verify exact alignment with visible limbs. Re-run the relevant Python gate when changing brain data or dynamics.

## Commit & Pull Request Guidelines

History currently uses short, lowercase, descriptive subjects such as `iteration 1: flybody in MuJoCo WASM + three.js`. Keep commits focused and use an imperative or outcome-oriented subject. Pull requests should explain the behavioral change, list verification commands, link relevant issues or decision notes, and include screenshots for visual changes. Call out regenerated binary or image artifacts explicitly.
