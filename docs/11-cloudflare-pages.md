# Production hosting: Cloudflare Pages

Production domain: `infinitesugar.cnqso.com`.

This is a static site. Every visitor runs MuJoCo and the connectome locally; no Pages Functions,
Workers, R2, database, API keys or paid compute are needed. Use Cloudflare Pages Free with its
native GitHub integration. Do not migrate the entire cnqso.com DNS zone just for this subdomain.

## Git-connected Pages setup

- Repository: `cnqso/infinite-sugar` (private).
- Project name: `infinite-sugar` (or the available name returned by Cloudflare).
- Production branch: `main`.
- Framework preset: None.
- Root directory: repository root.
- Build command: `node tools/build_site.mjs`.
- Build output directory: `dist`.
- Build environment: `SKIP_DEPENDENCY_INSTALL=true` (the static build uses only Node built-ins).
- Node major: 22, recorded in `.node-version`.

Create a **Git-integrated** Pages project initially. A Direct Upload project cannot later be
converted to native Git integration. Native Pages builds mean no GitHub Actions workflow or
Cloudflare token stored in GitHub is required. Each push to main automatically builds and
publishes; preview deployments can be disabled if unwanted.

Add `infinitesugar.cnqso.com` through Pages → Custom domains **before** adding its DNS record.
At the existing DNS provider, add a CNAME named `infinitesugar`, pointing to the exact
`*.pages.dev` hostname assigned by Cloudflare. Do not guess that hostname. Wait for domain
verification and TLS activation, then check the page and brain blob responses over HTTPS.

Keep Pages' default caching/ETag behavior. This project uses stable asset filenames; long
immutable browser caches would make future updates inconsistent. Do not add a service worker.
The existing `.openai/hosting.json` belongs to the older private Sites preview; Cloudflare
builds only `web/` into `dist/` and does not publish that manifest or research/source files.
Future production updates should go through this GitHub → Pages setup.

## Cost and size checks (2026-09-08)

Cloudflare lists unlimited static requests and bandwidth on Pages Free, 500 builds/month,
20,000 files/site and 25 MiB/file. This artifact is about 45 MB unpacked, with 113 files and a
largest file of 10.5 MiB. The build enforces file-size/count limits before publishing. Usage
remains subject to Cloudflare's applicable service terms and limits; a free plan is not an SLA.

- https://www.cloudflare.com/products/pages/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/get-started/git-integration/
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/pages/configuration/serving-pages/
