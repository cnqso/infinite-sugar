# Repository notes

- `web/` contains the browser app, vendored runtime dependencies, body assets and connectome.
  `tools/` builds and checks the data and simulation; `docs/` holds research and measurements.
- Run `npm ci`, then `./serve.sh 7377`. `npm run build` produces `dist/`;
  `npm run typecheck` checks the project sources. Keep browser modules unbundled.
- Preserve upstream `web/model/*.xml`; use an including XML for project-specific changes.
  Meshes are already welded losslessly. Preserve the full connectome and fixed simulation timing.
- No learning or habituation is modeled. Changes to neural dynamics or supplied movement
  patterns should be explicit. See [model notes](docs/04-roadmap.md).
- Use two-space indentation in JavaScript/TypeScript and four in Python. Match nearby code.
- For browser changes, check Chromium for page/console errors and inspect `window.fly` for
  finite state and stable posture. When changing the render bridge, check collision alignment;
  geom nodes must retain their MuJoCo indices, and explicit geom colors override materials.
- Run the relevant checks in `tools/`: `performance_test.mjs`, `neural_map_test.mjs` and
  `shuffle_test.mjs`. For brain-data changes, use `python3 tools/reflex_test.py --sweep`.
- Keep commits focused and report what was checked. Identify regenerated data or assets.
