# status-scripts

Per-commit pipeline that produces the JSON snapshot consumed by [`go-cam-model-status`](https://github.com/geneontology/go-cam-model-status). Runs OWL consistency (Arachne via [`materializer`](https://github.com/balhoff/materializer)), GPAD-compatibility ShEx (`gpad-shapes.shex`), GO-CAM structural ShEx (`go-cam-shapes.shex`, with a SPARQL-style shape map evaluated against a pre-materialised GO `rdfs:subClassOf*` closure), every query under [`sparql/status/`](../sparql/status/), and per-model metadata extraction across the changed models in a push, then merges results into the [`status-data`](https://github.com/geneontology/noctua-models/tree/status-data) orphan branch in this repo. ShEx + SPARQL + metadata + exclusion filters all run in a **single** [`jena-batch`](https://github.com/balhoff/jena-batch) pass — one JVM, every schema and query loaded once, models streamed through.

## Files

- [`run-checks.mjs`](run-checks.mjs) — orchestrates one check pass. Two batch tools do the heavy lifting:
  - [`jena-batch`](https://github.com/balhoff/jena-batch) handles ShEx, every SPARQL `sparql/status/*.rq` query, metadata extraction, and exclusion filters in one streaming pass.
  - [`materializer`](https://github.com/balhoff/materializer) handles OWL consistency via Arachne reasoning under go-lego.
  Emits a single JSON document with all per-model results, the discovered `CheckDefinition` list, and an `excluded_ids` list of models matched by an exclusion filter.
- [`build-go-closure.sh`](build-go-closure.sh) — wraps Apache Jena `arq` to build the materialised `rdfs:subClassOf*` closure over the `riot` merge of `go-lego.owl`, `neo.owl`, and `reacto.owl`, with the JAXP entity-size limits disabled.
- [`update-status.mjs`](update-status.mjs) — merges the run output into a `status-data` worktree. Loads the prior snapshot, applies transition rules ([`lib/transitions.mjs`](lib/transitions.mjs)) so each `(model, check)` pair carries `since_commit` / `last_passed_commit`, prunes models listed in `--deleted-file` **and** in the run's `excluded_ids`, rewrites `manifest.json` + `index.json` + `models/{id}.json`.
- [`run-checks-local.sh`](run-checks-local.sh) — laptop wrapper for one-off / backfill runs.
- [`extract-metadata.rq`](extract-metadata.rq) — single SELECT pulling `dct:title`, `dc:contributor`, `pav:providedBy`, `lego:modelstate`, `owl:deprecated`, `dct:date`, `RO:0002162` (in_taxon), `rdfs:comment` from a model file. Run inside jena-batch (`--metadata-query`) and aggregated row-wise by [`lib/extract-metadata.mjs`](lib/extract-metadata.mjs).
- [`test-self.mjs`](test-self.mjs) — self-test of the parsing & transition libraries (no external binaries required).
- [`lib/`](lib/) — supporting modules: `frontmatter`, `check-definitions`, `parse-materializer`, `run-jena-batch`, `extract-metadata`, `transitions`.

## Adding a new SPARQL check

1. Drop a new `*.rq` under [`../sparql/status/`](../sparql/status/) with `#+`-frontmatter at the top:

   ```sparql
   #+ id: my_check
   #+ name: My Check
   #+ description: Short prose explaining what this finds.
   #+ severity: warning   # info | warning | error
   PREFIX owl: <http://www.w3.org/2002/07/owl#>
   SELECT DISTINCT ?some ?context  WHERE { ... }
   ```

2. The query is run **per-model TTL** — model attribution is the input file, so `?model` is **not** required in the SELECT. Any other variables become drill-down table columns (the dashboard reads `head.vars` from the SPARQL JSON results to lay out the table).

3. Push to `master`. The next [`status-update.yml`](../.github/workflows/status-update.yml) run will re-execute the new query against the entire corpus (a "shape changed" full-corpus rerun is triggered whenever `sparql/status/` changes).

## Adding an exclusion filter

`sparql/filters/*.rq` files are SPARQL **ASK** queries. Any model for which any filter returns true is dropped from the run entirely: no checks run, no per-model JSON gets written, the index entry is removed if it existed before. Use this for models that shouldn't appear in the dashboard at all (e.g. `lego:modelstate "delete"`).

1. Drop a `*.rq` under [`../sparql/filters/`](../sparql/filters/). The filename stem is the filter id (lowercase ASCII, digits, underscore).

   ```sparql
   PREFIX owl:  <http://www.w3.org/2002/07/owl#>
   PREFIX lego: <http://geneontology.org/lego/>

   ASK { ?m a owl:Ontology ; lego:modelstate "delete" }
   ```

2. Push to `master`. Filters trigger a full-corpus rerun (same path-trigger logic as `sparql/status/`).

## Running locally

```sh
# Once: download the three source ontologies, riot-merge them, build the closure.
mkdir -p /tmp/cache
wget -q -O /tmp/cache/go-lego.owl http://purl.obolibrary.org/obo/go/extensions/go-lego.owl
wget -q -O /tmp/cache/neo.owl     http://purl.obolibrary.org/obo/go/noctua/neo.owl
wget -q -O /tmp/cache/reacto.owl  http://purl.obolibrary.org/obo/go/extensions/reacto.owl
JVM_ARGS="-Xmx4G -Djdk.xml.maxGeneralEntitySizeLimit=0 -Djdk.xml.totalEntitySizeLimit=0" \
  riot --output=Turtle \
  /tmp/cache/go-lego.owl /tmp/cache/neo.owl /tmp/cache/reacto.owl \
  > /tmp/cache/closure-source.ttl
bash status-scripts/build-go-closure.sh \
    --input /tmp/cache/closure-source.ttl \
    --output /tmp/cache/go-closure.ttl

# Run on one model
bash status-scripts/run-checks-local.sh \
    --go-lego /tmp/cache/go-lego.owl \
    --go-closure /tmp/cache/go-closure.ttl \
    --output /tmp/run.json \
    models/abc123.ttl

# Or full backfill (warning: hours)
bash status-scripts/run-checks-local.sh \
    --go-lego /tmp/cache/go-lego.owl \
    --go-closure /tmp/cache/go-closure.ttl \
    --output /tmp/run.json \
    models/*.ttl

# Merge into a worktree of the data branch
git worktree add ../noctua-models-status-data status-data
node status-scripts/update-status.mjs \
    --data-dir ../noctua-models-status-data \
    --run /tmp/run.json \
    --master-sha "$(git rev-parse HEAD)"

# Then commit & push from inside ../noctua-models-status-data
```

## Self-tests

```sh
node status-scripts/test-self.mjs
```

These cover the parsers and transition rules (no Java/Docker/network required).

## Required tools

- Node.js 20+
- Docker, for two images:
  - `balhoff/materializer:latest` (override via `MATERIALIZER_CMD`; `{WORKDIR}` is the bind-mount placeholder)
  - `ghcr.io/balhoff/jena-batch:v0.6.0` (override via `JENA_BATCH_CMD`; same `{WORKDIR}` placeholder)
- Apache Jena CLI on PATH (`riot` for the closure-source merge, `arq` for the closure CONSTRUCT)
- `go-lego.owl` downloaded somewhere on disk (used by materializer for the OWL-consistency check)
- The materialised `rdfs:subClassOf*` closure as a Turtle file (`--go-closure`), built from a `riot` merge of go-lego + neo + reacto:

  ```sh
  JVM_ARGS="-Xmx4G -Djdk.xml.maxGeneralEntitySizeLimit=0 -Djdk.xml.totalEntitySizeLimit=0" \
    riot --output=Turtle \
    /tmp/go-lego.owl /tmp/neo.owl /tmp/reacto.owl \
    > /tmp/closure-source.ttl
  bash status-scripts/build-go-closure.sh \
      --input /tmp/closure-source.ttl \
      --output /tmp/go-closure.ttl
  ```

  The wrapper sets `JVM_ARGS` for `arq`, including `-Djdk.xml.maxGeneralEntitySizeLimit=0` and `-Djdk.xml.totalEntitySizeLimit=0`, because current JDK XML parser defaults reject `go-lego.owl`'s entity usage. The closure only changes when any of the source ontologies do, so re-use it across runs. The CI workflow caches it weekly alongside the source ontologies.

## Related workflows in this repo

- [`.github/workflows/status-update.yml`](../.github/workflows/status-update.yml) — per-push pipeline.
- [`.github/workflows/compact-status-history.yml`](../.github/workflows/compact-status-history.yml) — monthly orphan-branch squash.
- [`.github/workflows/check-models.yml`](../.github/workflows/check-models.yml) — **unrelated, untouched**: keeps opening GitHub issues for new SPARQL violations.
