# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies
- `npm run dev` — Vite dev server. Reads `.env.development`, which points the data fetcher at the bundled fixture under `public/fixture/` so the app boots offline.
- `npm run build` — `tsc -b && vite build`. Type-check first, then bundle to `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run lint` — ESLint over `**/*.{ts,tsx}`.
- `npm test` — Vitest, single run. `npm run test:watch` for watch mode, `npm run test:coverage` for v8 coverage. Run a single file with `npx vitest run path/to/file.test.tsx`. Run a single test with `npx vitest run -t "test name pattern"`.
- `npm run format` / `npm run format:check` — Prettier.

To point the dev server at the live published data instead of the fixture:

```sh
VITE_DATA_BASE=https://cdn.jsdelivr.net/gh/geneontology/go-cam-model-status@status-data/status npm run dev
```

## Architecture

### Producer and consumer in one repo; data on an orphan branch

The dashboard fetches its data cross-origin from a **`status-data` orphan branch in this repo**, via jsDelivr (`cdn.jsdelivr.net/gh/geneontology/go-cam-model-status@status-data/...`) with `raw.githubusercontent.com` as fallback. The base URL is set in `src/constants.ts:DEFAULT_DATA_BASE` (with `STATUS_DATA_*` constants); the dashboard build is published separately to gh-pages from `main`. Each data fetch is cache-busted with `?v={master_sha}` from `manifest.json`; the manifest itself rides the CDN's natural ~5–12 minute cache window, which is the data-freshness floor.

The producer (Node scripts + SPARQL/ShEx + GitHub workflow) lives in this same repo, alongside the dashboard:

- `status-scripts/` — `run-checks.mjs` (orchestrator), `update-status.mjs` (merger), `lib/{transitions,frontmatter,check-definitions,run-jena-batch,parse-materializer,extract-metadata}.mjs`, `build-go-closure.sh`, `extract-metadata.rq`.
- `sparql/status/*.rq` — per-check SPARQL with `#+`-prefixed frontmatter (id, name, description, severity). Adding a new file here auto-surfaces a facet on next page load.
- `sparql/filters/*.rq` — exclusion ASK queries.
- `sparql/closures/go-subclassof-closure.rq` — CONSTRUCT that materialises the GO `rdfs:subClassOf*` closure once per workflow run (used as ShEx context).
- `gpad-shapes.shex` / `gpad-shapes.shapeMap` and `go-cam-shapes.shex` / `go-cam-shapes.shapeMap` at the repo root.
- `.github/workflows/status-update.yml` — cron (`*/15`) + manual `workflow_dispatch`. Checks out `geneontology/noctua-models@master` into `./noctua-models/`, symlinks `models/ → noctua-models/models/` so `run-checks.mjs --repo "$PWD"` sees model TTLs and producer files as one tree. Reads `prior_sha` from this repo's `status-data` manifest, diffs `prior_sha..HEAD` of noctua-models (so any number of intervening commits is caught up losslessly — cron interval is arbitrary). Falls back to full corpus on cold start / unreachable SHA. Stamps snapshots with noctua-models's HEAD and pushes to `status-data` here.
- `.github/workflows/compact-status-history.yml` — monthly squash of `status-data` to keep the orphan branch's pack size bounded.

`noctua-models` is now purely an input: cloned fresh per workflow run, never written to. Changes to producer files in this repo (shapes / sparql / scripts) do **not** auto-trigger a full-corpus rerun — dispatch the workflow manually with `full_corpus=true` after editing them.

Schema is shared by colocation now, but `src/types.ts` still must mirror what `status-scripts/` emits. ShEx + SPARQL + metadata + exclusion filters all run in a single [`jena-batch`](https://github.com/balhoff/jena-batch) pass; OWL consistency runs separately under `materializer`. Both are Docker images pulled at the start of each workflow run.

### Exclusion filters: some models never appear

`sparql/filters/*.rq` are SPARQL ASK queries the producer evaluates per model; any match drops the model from `index.json` and removes its `models/{id}.json` (treated as a deletion in transition bookkeeping). Currently only `deleted.rq` is wired up — models with `lego:modelstate "delete"` are workflow-noise the curators never want surfaced. If a model is "missing" from the dashboard, this is the first place to check: the producer dropped it on purpose. The dashboard has no awareness of filters as a concept; it just renders whatever's in the index.

### Dynamic per-check facets, not static config

`src/config.tsx` only declares the **static** fields (id, title, modelstate, organism, contributor, etc.). The per-check facets (one per check id discovered in `manifest.checks`) are built **at runtime** by `src/runtimeFields.ts:buildExtendedFields`, then spliced into the field list passed to every hook. This is why:

- `src/hooks/useUrlState.ts` is parameterised on a `fields` array (instead of reading the static config), so URL keys for dynamic check facets round-trip correctly.
- `src/hooks/useUserSettings.ts` uses `string` field names rather than `keyof IndexedModelStatus`.
- `src/runtimeFields.ts:flattenChecks` denormalises each row's `checks: Record<id, status>` onto top-level fields named after the check id, so the existing facet/search machinery treats per-check status like any other text field.
- Adding a new SPARQL check in `sparql/status/` automatically surfaces a facet on next page load — no web-app deploy needed.

### Five statuses, with a precedence order

`CheckStatus = "pass" | "fail" | "error" | "skipped" | "unknown"`. The model's `overall` rollup is computed **once, in the producer** (`status-scripts/lib/transitions.mjs:summarizeOverall`) using precedence **error > fail > unknown > pass > skipped**, and stamped into each `IndexedModelStatus`. The consumer doesn't recompute it. `unknown` sits above `pass` on purpose: if any check on a model is unknown, the model must not roll up to `pass` — that would assert a clean bill of health we can't substantiate.

### Categorical (severity:info) checks are special

`gpad_compatibility` (and any future `severity: "info"` check) is **not pass/fail** in the curator's mental model — `fail` just means "this is a causal model, not a GPAD-compatible one." Three behaviours diverge:

1. `summarizeOverall` and `fail_count` skip categorical checks entirely (so a perfectly-good causal model rolls up to `overall: "pass"`).
2. `StatusBadge` and `CheckSummary` render with neutral blue/indigo palettes and circle-shaped icons, never warning yellow/orange/red.
3. `CheckRow` uses the `pass_label` / `fail_label` / `unknown_label` strings from the `CheckDefinition` (e.g. "GPAD-compatible" / "Causal model") in place of generic "Pass"/"Fail" wording. `SinceContext` says "Category last changed in…" instead of "Failing since…".

The `isCategorical` helper is duplicated by design in `src/types.ts` (consumer) and `status-scripts/lib/transitions.mjs` (producer) — currently `severity === "info"` in both. If broadening the predicate so a non-info check qualifies, **update both copies**; they're load-bearing on opposite sides of the index.

### Status transition bookkeeping

`since_commit` / `since_date` mark when the current status started; `last_passed_commit` / `last_passed_date` mark the most recent passing snapshot. The merge logic lives in `status-scripts/lib/transitions.mjs:mergeCheckResult` — the dashboard just reads these fields to render the "failing since [sha] on [date] — last passed [sha] on [date]" links in the drawer. `unknown` and `skipped` are explicitly **not transitions**: they preserve prior bookkeeping verbatim.

### Drawer drill-down via URL param

`useSelectedModel` in `src/hooks/useUrlState.ts` exposes the `?model=<id>` query param. `ModelDetail` opens whenever it's non-empty, lazy-fetches `models/{id}.json` via `useModelDetail`, and uses Mantine's right-positioned `Drawer` with `withOverlay={false}` so the list stays visible. The drawer auto-expands rows whose status is `fail | error | unknown` — but **not** categorical "fail" rows (categorisations don't need the eye drawn to them).

### Stack-level conventions worth knowing

- **No router.** Single SPA; `nuqs` carries all shareable state (`?q=`, `?filter=…`, `?model=…`).
- **React Query with `staleTime: Infinity`.** The published JSON is treated as immutable for the session; cache-busting is via the URL query string, not by re-fetching.
- **flexsearch's `DocumentData` constraint is too strict** for `IndexedModelStatus` (which has nested `checks`). `useSearch` carries explicit casts at the boundary — leave them be.
- **Vite `base` is `/go-cam-model-status/`** for project-pages deploy. If the published URL ever changes, this needs to change too.

### Memory worth re-reading

`/Users/jim/.claude/projects/-Users-jim-Documents-Source-go-cam-model-status/memory/` — notably the Noctua-URL note: any link to `noctua.geneontology.org` must use `http://`, not `https://`, because Noctua isn't served over TLS. The current code has it correct in `src/constants.ts:noctuaEditorUrl`; don't auto-bump it.
