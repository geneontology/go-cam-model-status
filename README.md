# go-cam-model-status

Quality-check dashboard for [GO-CAM](https://geneontology.org/docs/gocam-overview/) models. Faceted browsing of every model in [`geneontology/noctua-models`](https://github.com/geneontology/noctua-models) with per-check status (OWL consistency, GPAD compatibility, SPARQL checks), drill-down to specific violations, and "failing since commit X / last passed on date Y" context.

Sister project to [`go-cam-browser`](https://github.com/geneontology/go-cam-browser); shares its stack (React 19 + Vite + Mantine + Zustand + React Query + nuqs + flexsearch) and look.

## Architecture at a glance

- **Static SPA** — deployed to GitHub Pages at `geneontology.github.io/go-cam-model-status/` from this repo's `main` branch.
- **Data lives in this repo**, on a dedicated `status-data` orphan branch. The web app fetches `manifest.json`, then `index.json?v={master_sha}`, then `models/{id}.json?v={master_sha}` on drill-down — all via jsDelivr (`cdn.jsdelivr.net/gh/geneontology/go-cam-model-status@status-data/...`) with `raw.githubusercontent.com` as fallback.
- **Producer pipeline** in `.github/workflows/status-update.yml` runs on a 15-minute cron, checks out `geneontology/noctua-models@master` as input, runs the checks against any models that have changed since the prior snapshot, and pushes the result to `status-data`.
- **Extensible SPARQL checks** live under `sparql/status/*.rq` in this repo; each `.rq` carries `#+ key: value` frontmatter (`id`, `name`, `description`, `severity`). Adding a new query and dispatching the workflow with `full_corpus=true` populates the new check across the corpus, after which it auto-surfaces as a facet on next page load.

## Develop

```sh
npm install
npm run dev
```

The dev server reads `.env.development` which points the data fetcher at the bundled `public/fixture/` data — five hand-crafted models exercising every status state. Production builds default to the live `status-data` branch on jsDelivr.

To point dev at the live data instead:

```sh
VITE_DATA_BASE=https://cdn.jsdelivr.net/gh/geneontology/go-cam-model-status@status-data/status npm run dev
```

## Build

```sh
npm run build      # → dist/
npm run preview    # serve dist/ locally
```

## Layout

```
src/
  App.tsx                 -- top-level shell, wires hooks → components
  config.tsx              -- static field/facet config
  constants.ts            -- URLs, link helpers (commitUrl, ttlSourceUrl, noctuaEditorUrl)
  types.ts                -- IndexedModelStatus, ModelStatusDetail, CheckDefinition, Violation
  runtimeFields.ts        -- builds extended fields list (static + per-check) from manifest
  hooks/
    useQueryData.ts       -- fetches manifest then index, with sha cache-bust + raw fallback
    useModelDetail.ts     -- fetches a single model's detail JSON on demand
    useUrlState.ts        -- nuqs-backed search + filter URL state (parameterised on fields)
    useSelectedModel      -- (in useUrlState.ts) ?model=<id> for the drawer
    useFacets.ts          -- counts + filtering, ported from go-cam-browser
    useSearch.ts          -- flexsearch wrapper
    useUserSettings.ts    -- visible columns + cards/table toggle (persisted)
  components/
    Header / Footer / HeaderLinks / SearchInput / Facet / TextFacetList /
    NumericFacetSlider / UserSettingsMenu / ExternalLink   -- ported from go-cam-browser
    StatusBadge.tsx       -- pass/fail/error/skipped pill (severity-aware colour)
    CheckSummary.tsx      -- per-row mini-icon cluster
    ResultsCards.tsx      -- card grid view
    ResultsTable.tsx      -- table view
    ResultsDisplay.tsx    -- card/table switcher + paging
    ModelDetail.tsx       -- right-side Drawer (opened by ?model=<id>)
    CheckRow.tsx          -- accordion row per check inside the drawer
    ViolationTable.tsx    -- discriminated render by violation kind
    SinceContext.tsx      -- "Failing since {sha} on {date} — last passed {sha} on {date}"
public/
  fixture/                -- offline dev data
```

## Status data schema

See `src/types.ts`. Key invariants:

- `manifest.checks` is the source of truth for which checks exist. Per-check facets in the UI are generated from this list at runtime, so adding a new SPARQL check in `sparql/status/` automatically surfaces a facet on next page load (after the producer has run it against the corpus).
- Each model row's `checks` is a flat `Record<checkId, status>`. The web app additionally splices each check id onto the row as a top-level field (`runtimeFields.ts:flattenChecks`) so the existing facet/search machinery treats per-check status like any other text field.
- Per-check `since_commit` / `last_passed_commit` are maintained by the workflow when status transitions. They drive the "failing since…" links in the drill-down.
