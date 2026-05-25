#!/usr/bin/env node
// Run OWL consistency, GPAD-compatibility ShEx, exclusion filters, every
// sparql/status/*.rq check, and metadata extraction across a set of model
// TTLs. Emits a JSON payload of fresh (untransitioned) results that
// update-status.mjs will then merge into the status-data branch.
//
// Two batch tools do all the heavy lifting:
//
//   1. jena-batch (single JVM) handles ShEx + SPARQL + metadata + exclusion
//      filters in one streaming pass. See lib/run-jena-batch.mjs.
//   2. materializer (Arachne) reasons each model under go-lego and emits
//      N-Quads of inferred types; we read it back and surface
//      owl:Nothing-typed individuals as inconsistency violations.
//
// Models matched by any sparql/filters/*.rq ASK query are excluded from
// both passes — they're staged into the workdir initially, jena-batch
// emits their `excluded` lines, then we delete those staged TTLs before
// materializer runs so they incur no reasoning cost. Excluded ids flow
// through to update-status.mjs which removes them from the index.
//
// Usage:
//   node status-scripts/run-checks.mjs \
//     --repo /path/to/noctua-models \
//     --models models/abc.ttl models/def.ttl ... \
//     --go-lego /tmp/cache/go-lego.owl \
//     --output out/run.json \
//     [--materializer 'docker run ...balhoff/materializer'] \
//     [--jena-batch 'docker run ...ghcr.io/balhoff/jena-batch']

import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, resolve, dirname } from "node:path";
import {
  loadAllCheckDefinitions,
  BUILTIN_CHECKS,
} from "./lib/check-definitions.mjs";
import { parseMaterializerNQuads } from "./lib/parse-materializer.mjs";
import {
  runJenaBatch,
  discoverFilters,
  translateShexResult,
  translateSparqlResult,
} from "./lib/run-jena-batch.mjs";
import { aggregateMetadataRows } from "./lib/extract-metadata.mjs";

async function parseArgs(argv) {
  const args = {
    repo: process.cwd(),
    models: [],
    materializerCmd:
      process.env.MATERIALIZER_CMD ??
      "docker run --rm -v {WORKDIR}:/work balhoff/materializer:latest",
    // Override materializer's baked-in -Xmx8G — go-lego is too big to fit
    // comfortably in 8 GB once Arachne builds the rule engine, and the JVM
    // will OOM mid-batch. 14 GB is a safe corpus-scale default; lower it via
    // --max-heap (or MATERIALIZER_MAX_HEAP) if you don't have the RAM.
    maxHeap: process.env.MATERIALIZER_MAX_HEAP ?? "14G",
    // Where to keep materializer's N-Quads output AFTER the run, outside the
    // tempdir that gets nuked. Defaults to alongside --output. Set
    // explicitly with --keep-materialized <path> or pass empty string ""
    // to disable preservation.
    keepMaterialized: undefined,
    // Cap on materializer wall time. 0 = unlimited (right default for
    // backfill; per-commit workflows should set their own via shell).
    materializerTimeoutMs: 0,
    // jena-batch wiring: invocation, heap, parallelism, timeout. Defaults
    // come from lib/run-jena-batch.mjs (env-overridable there too).
    jenaBatchCmd: undefined,
    jenaBatchMaxHeap: undefined,
    jenaBatchParallelism: undefined,
    jenaBatchTimeoutMs: 0,
    output: "-",
    goLego: undefined,
    goClosure: undefined,
    skipOwl: false,
    skipShex: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--repo":
        args.repo = resolve(argv[++i]);
        break;
      case "--models":
        while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
          args.models.push(argv[++i]);
        }
        break;
      case "--models-file": {
        const file = argv[++i];
        const fs = await import("node:fs/promises");
        const text = await fs.readFile(file, "utf8");
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) {
            args.models.push(trimmed);
          }
        }
        break;
      }
      case "--materializer":
        args.materializerCmd = argv[++i];
        break;
      case "--max-heap":
        args.maxHeap = argv[++i];
        break;
      case "--keep-materialized":
        args.keepMaterialized = argv[++i];
        break;
      case "--materializer-timeout-ms":
        args.materializerTimeoutMs = parseInt(argv[++i], 10) || 0;
        break;
      case "--jena-batch":
        args.jenaBatchCmd = argv[++i];
        break;
      case "--jena-batch-max-heap":
        args.jenaBatchMaxHeap = argv[++i];
        break;
      case "--jena-batch-parallelism":
        args.jenaBatchParallelism = parseInt(argv[++i], 10);
        break;
      case "--jena-batch-timeout-ms":
        args.jenaBatchTimeoutMs = parseInt(argv[++i], 10) || 0;
        break;
      case "--go-lego":
        args.goLego = resolve(argv[++i]);
        break;
      case "--go-closure":
        args.goClosure = resolve(argv[++i]);
        break;
      case "--output":
        args.output = argv[++i];
        break;
      case "--skip-owl":
        args.skipOwl = true;
        break;
      case "--skip-shex":
        args.skipShex = true;
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break; /* eslint-disable-line no-fallthrough */
      default:
        process.stderr.write(`Unknown argument: ${a}\n`);
        process.exit(2);
    }
  }
  if (args.models.length === 0) {
    process.stderr.write("No --models supplied. Nothing to do.\n");
    process.exit(2);
  }
  if (!args.skipOwl && !args.goLego) {
    process.stderr.write("Missing --go-lego (required unless --skip-owl).\n");
    process.exit(2);
  }
  if (!args.skipShex && !args.goClosure) {
    process.stderr.write(
      "Missing --go-closure (required unless --skip-shex). " +
        "Build it from the ROBOT merge of go-lego + neo + reacto via " +
        "`bash status-scripts/build-go-closure.sh --input closure-source.owl " +
        "--output go-closure.ttl` (see status-scripts/README.md).\n",
    );
    process.exit(2);
  }
  return args;
}

const USAGE = `Usage: run-checks.mjs --repo <dir> --models <ttl>... --go-lego <owl> --output <json>

Optional:
  --models-file <path>    Read model paths (one per line) instead of --models.
  --materializer <cmd>    Override materializer invocation. Use {WORKDIR} as a
                          placeholder for the bind-mount path. Default uses Docker.
  --max-heap <size>       JVM heap ceiling for materializer (default: 14G).
                          Passed as -J-Xmx<size>; a later -Xmx wins over the
                          launcher's baked-in default. Lower this on machines
                          without 16+ GB RAM. Also: MATERIALIZER_MAX_HEAP env.
  --keep-materialized <path>
                          Where to copy materializer's N-Quads output before
                          downstream phases run. Default: alongside --output as
                          <base>.materialized.nq. Pass empty string to disable.
                          Lets you recover OWL data if a later phase crashes.
  --materializer-timeout-ms <int>
                          Wall-time cap on materializer (default: 0 = no cap).
                          Per-commit workflows may set e.g. 3600000 (1 hour);
                          full-corpus backfill should leave it unlimited.
  --jena-batch <cmd>      Override jena-batch invocation. Default uses Docker
                          (ghcr.io/balhoff/jena-batch). {WORKDIR} placeholder.
                          Also: JENA_BATCH_CMD env.
  --jena-batch-max-heap <size>
                          JVM heap ceiling for jena-batch (default: 8G). ShEx +
                          SPARQL is much lighter than Arachne, so 8G usually
                          suffices. Also: JENA_BATCH_MAX_HEAP env.
  --jena-batch-parallelism <int>
                          Concurrent models in flight inside jena-batch (default
                          8). Also: JENA_BATCH_PARALLELISM env.
  --jena-batch-timeout-ms <int>
                          Wall-time cap on jena-batch (default 0 = no cap).
  --skip-owl              Skip materializer / OWL consistency.
  --skip-shex             Skip both ShEx checks (gpad_compatibility and
                          go_cam_shape). jena-batch is still invoked to do
                          SPARQL + metadata + filters.
  --go-closure <ttl>      Path to the materialised GO rdfs:subClassOf* closure
                          that the GO-CAM ShEx shape-map queries union with each
                          model. Required unless --skip-shex. Build with:
                            bash status-scripts/build-go-closure.sh \\
                                --go-lego go-lego.owl \\
                                --output go-closure.ttl
  --output <file>         Write JSON to this path (default: stdout).
`;

// Stage a host file into workDir as a regular file. We use copyFile rather
// than symlink (Docker bind-mount can't follow symlinks whose targets sit
// outside the mounted volume) and rather than hardlink (hardlinks share an
// inode and therefore permissions with the source — if a TTL in the noctua-
// models clone has restrictive mode bits, the container can't read it
// either, and chmoding the hardlink would mutate the source repo).
//
// copyFile creates a fresh inode with the current umask's default mode, so
// the staged copy is always readable by the container regardless of the
// source's permissions. Cost: ~3 KB per model × 55K models ≈ 165 MB of
// disk + ~30s of copy time at full corpus, negligible against the multi-
// hour Arachne pass.
async function stageFile(src, dest) {
  await copyFile(src, dest);
}

async function stageModels(args, stageDir, modelPaths) {
  await mkdir(stageDir, { recursive: true });
  for (const m of modelPaths) {
    await stageFile(resolve(args.repo, m), join(stageDir, basename(m)));
  }
}

async function runMaterializerBatch(args, workDir, stageDir) {
  // Stage go-lego under workDir so the docker bind-mount can see it.
  const stagedGoLego = join(workDir, "go-lego.owl");
  await stageFile(args.goLego, stagedGoLego);
  const outPath = join(workDir, "materialized.nq");

  const isDocker = args.materializerCmd.includes("docker run");
  const cmd = args.materializerCmd.replace("{WORKDIR}", workDir);
  const tokens = cmd.split(/\s+/);
  const program = tokens[0];
  const baseArgs = tokens.slice(1);
  // -J-Xmx is sbt-native-packager's passthrough syntax for JVM flags; it
  // comes BEFORE the subcommand. A later -Xmx wins over the launcher's
  // baked-in default, so this lifts the heap ceiling without rebuilding the
  // materializer image.
  //
  // The published image's CLI requires the `file` subcommand before any of
  // the per-mode flags. Don't drop it — the README at one point omitted it.
  const cliArgs = [
    ...baseArgs,
    `-J-Xmx${args.maxHeap}`,
    "file",
    "--ontology-file",
    isDocker ? "/work/go-lego.owl" : stagedGoLego,
    "--input",
    isDocker ? "/work/changed-models" : stageDir,
    "--output",
    isDocker ? "/work/materialized.nq" : outPath,
    "--output-inconsistent",
    "true",
    "--reasoner",
    "arachne",
    // Without these, materializer loads every input TTL into the default
    // graph and emits ungraphed triples — parseMaterializerNQuads then has
    // no way to attribute inferences back to a model. `--suffix-graph true`
    // appends the suffix to each input graph IRI, so the output for model
    // <http://model.geneontology.org/{id}> lands on
    // <http://model.geneontology.org/{id}#inferred>, which the parser keys
    // off.
    "--output-graph-name",
    "#inferred",
    "--suffix-graph",
    "true",
  ];

  // Stream materializer's stdout/stderr through to ours. The default
  // execFileAsync swallows them on success and only surfaces on throw, which
  // hides progress logs and OOM warnings during long runs. Pipe to inherit
  // so the user sees what's happening in real time.
  process.stderr.write(
    `[run-checks] invoking materializer: ${program} ${cliArgs.join(" ")}\n`,
  );
  const { spawn } = await import("node:child_process");
  await new Promise((resolveP, rejectP) => {
    const child = spawn(program, cliArgs, { stdio: "inherit" });
    // Only arm a timer when the caller explicitly opts in. Backfill runs over
    // the full corpus can legitimately take many hours; a hardcoded cap here
    // would silently throw away progress for no good reason.
    let timer = null;
    if (args.materializerTimeoutMs && args.materializerTimeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectP(
          new Error(
            `materializer timed out after ${args.materializerTimeoutMs} ms`,
          ),
        );
      }, args.materializerTimeoutMs);
    }
    child.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      rejectP(err);
    });
    child.on("exit", (code, signal) => {
      if (timer) {
        clearTimeout(timer);
      }
      if (signal) {
        rejectP(new Error(`materializer killed by signal ${signal}`));
      } else if (code !== 0) {
        rejectP(new Error(`materializer exited with code ${code}`));
      } else {
        resolveP();
      }
    });
  });

  // Preserve the materialized N-Quads outside workDir BEFORE the per-model
  // loop runs (and well before any cleanup), so a later failure or ^C
  // doesn't lose hours of materializer time. The user can recover it from
  // the keep path and re-run downstream phases without redoing reasoning.
  await stashMaterializedNQuads(args, outPath);

  return parseMaterializerNQuads(outPath);
}

async function stashMaterializedNQuads(args, outPath) {
  // Default keep location: alongside --output, named "<base>.materialized.nq".
  // Empty string explicitly disables (`--keep-materialized ""`).
  let keepPath = args.keepMaterialized;
  if (keepPath === "") {
    return;
  }
  if (keepPath === undefined) {
    if (args.output && args.output !== "-") {
      const base = args.output.replace(/\.json$/i, "");
      keepPath = `${base}.materialized.nq`;
    } else {
      // No --output given (writing to stdout) — drop the keep file in CWD.
      keepPath = "materialized.nq";
    }
  }
  try {
    await copyFile(outPath, keepPath);
    process.stderr.write(
      `[run-checks] preserved materializer output → ${keepPath}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[run-checks] WARNING could not preserve materializer output: ${err.message}\n`,
    );
  }
}

function modelIdFromPath(p) {
  const file = basename(p);
  return file.endsWith(".ttl") ? file.slice(0, -4) : file;
}

// Build a parse-failed metadata stub for models jena-batch could not read.
// The id is the only thing we know for sure; everything else gets a sane
// default so the dashboard still has something to render.
function buildParseFailedMetadata(id, errorMessage) {
  return {
    title: id,
    modelstate: "development",
    deprecated: false,
    date: "",
    contributors: [],
    providers: [],
    taxon: null,
    taxon_label: null,
    comment: errorMessage
      ? `metadata extraction failed: ${errorMessage}`
      : "metadata extraction failed",
  };
}

async function main() {
  const args = await parseArgs(process.argv);
  const sparqlStatusDir = join(args.repo, "sparql", "status");
  const sparqlFiltersDir = join(args.repo, "sparql", "filters");
  const definitions = await loadAllCheckDefinitions(sparqlStatusDir);
  const sparqlDefs = definitions.filter((d) => d.kind === "sparql");
  const filters = await discoverFilters(sparqlFiltersDir);
  process.stderr.write(
    `[run-checks] ${sparqlDefs.length} SPARQL check(s), ${filters.length} filter(s) discovered\n`,
  );

  const workDir = await mkdtemp(join(tmpdir(), "go-cam-status-"));
  const stageDir = join(workDir, "changed-models");
  try {
    // Stage every candidate TTL once. jena-batch and materializer both
    // read from this directory; we delete excluded models from it after
    // jena-batch identifies them so materializer doesn't waste reasoning
    // time on models that won't appear in the index anyway.
    await stageModels(args, stageDir, args.models);

    // Phase 1: jena-batch — ShEx + SPARQL + metadata + exclusion filters.
    process.stderr.write(`[run-checks] starting jena-batch phase\n`);
    const jb = await runJenaBatch({
      repoRoot: args.repo,
      workDir,
      modelsStageDir: stageDir,
      sparqlDefs,
      filters,
      skipShex: args.skipShex,
      goClosurePath: args.goClosure,
      jenaBatchCmd: args.jenaBatchCmd,
      maxHeap: args.jenaBatchMaxHeap,
      parallelism: args.jenaBatchParallelism,
      timeoutMs: args.jenaBatchTimeoutMs,
    });
    process.stderr.write(
      `[run-checks] jena-batch returned: ${Object.keys(jb.models).length} model result(s), ${jb.excluded.length} excluded record(s)\n`,
    );

    // Build the excluded id set (one model can match multiple filters, so
    // dedupe ids — but keep the full record list for the run.json audit).
    const excludedIds = new Set(jb.excluded.map((e) => e.id));

    // Phase 2: drop excluded TTLs from the staging dir, then run
    // materializer over what's left. Skipped if --skip-owl.
    let owlByModel = {};
    if (!args.skipOwl) {
      for (const id of excludedIds) {
        await rm(join(stageDir, `${id}.ttl`), { force: true });
      }
      process.stderr.write(`[run-checks] starting materializer phase\n`);
      owlByModel = await runMaterializerBatch(args, workDir, stageDir);
    }

    // Phase 3: assemble per-model output. Excluded models contribute no
    // entry; their ids ride out via `excluded_ids` for update-status.mjs.
    const ranAt = new Date().toISOString();
    const perModel = {};

    const rdfValidDef = BUILTIN_CHECKS.find((d) => d.id === "rdf_valid");
    const owlDef = BUILTIN_CHECKS.find((d) => d.id === "owl_consistency");
    const shexDef = BUILTIN_CHECKS.find((d) => d.id === "gpad_compatibility");
    const goCamDef = BUILTIN_CHECKS.find((d) => d.id === "go_cam_shape");

    for (const m of args.models) {
      const id = modelIdFromPath(m);
      if (excludedIds.has(id)) {
        continue;
      }

      const jbResult = jb.models[id];
      const parseFailed = jbResult?.parse_failed ?? false;
      const parseError = jbResult?.error ?? null;
      const riotDiagnostics = jbResult?.riot_diagnostics ?? [];

      const checks = [];

      // RDF validity from jena-batch's riot diagnostics. Pass = clean parse,
      // no warnings; fail = parsed but riot complained (the common case for
      // URI-hygiene issues); error = unparseable.
      if (!jbResult) {
        checks.push({
          ...rdfValidDef,
          label: rdfValidDef.name,
          status: "unknown",
          violations: [],
          ran_at: ranAt,
          error_message: "jena-batch returned no result for this model.",
        });
      } else if (parseFailed) {
        checks.push({
          ...rdfValidDef,
          label: rdfValidDef.name,
          status: "error",
          violations: [],
          ran_at: ranAt,
          error_message: parseError ?? "model failed to parse",
        });
      } else if (riotDiagnostics.length > 0) {
        checks.push({
          ...rdfValidDef,
          label: rdfValidDef.name,
          status: "fail",
          violations: riotDiagnostics.map((d) => ({
            kind: "riot_diagnostic",
            severity: d.severity,
            line: d.line,
            col: d.col,
            message: d.message,
          })),
          ran_at: ranAt,
        });
      } else {
        checks.push({
          ...rdfValidDef,
          label: rdfValidDef.name,
          status: "pass",
          violations: [],
          ran_at: ranAt,
        });
      }

      // OWL consistency from materializer.
      if (args.skipOwl) {
        checks.push({
          ...owlDef,
          label: owlDef.name,
          status: "skipped",
          ran_at: ranAt,
          violations: [],
        });
      } else if (owlByModel[id]) {
        checks.push({
          ...owlDef,
          label: owlDef.name,
          status: owlByModel[id].status,
          violations: owlByModel[id].violations,
          ran_at: ranAt,
        });
      } else {
        // Materializer ran but produced no inferences attributed to this
        // model graph — most likely the input file failed to parse, or
        // materializer skipped it. We can't claim pass; mark as unknown so
        // the curator can investigate without polluting the corpus stats.
        checks.push({
          ...owlDef,
          label: owlDef.name,
          status: "unknown",
          violations: [],
          ran_at: ranAt,
          error_message:
            "No inferences attributed to this model graph in the materializer output. Likely a parse failure or other materializer skip — re-run on this model alone to investigate.",
        });
      }

      // GPAD compatibility (ShEx) from jena-batch.
      if (args.skipShex) {
        checks.push({
          ...shexDef,
          label: shexDef.name,
          status: "skipped",
          ran_at: ranAt,
          violations: [],
        });
      } else if (parseFailed) {
        checks.push({
          ...shexDef,
          label: shexDef.name,
          status: "unknown",
          violations: [],
          error_message: parseError ?? "model failed to parse",
          ran_at: ranAt,
        });
      } else {
        const shex = translateShexResult(jbResult?.shex?.gpad);
        if (shex) {
          checks.push({
            ...shexDef,
            label: shexDef.name,
            status: shex.status,
            violations: shex.violations,
            ran_at: ranAt,
          });
        } else {
          // jena-batch returned a result but no ShEx block — shouldn't
          // happen unless --skip-shex was used (handled above) or the run
          // misconfigured the schema. Surface as unknown.
          checks.push({
            ...shexDef,
            label: shexDef.name,
            status: "unknown",
            violations: [],
            ran_at: ranAt,
            error_message: "jena-batch returned no ShEx result for this model.",
          });
        }
      }

      // GO-CAM shape (ShEx) from jena-batch. Pass/fail (severity:error), with
      // the GO subClassOf closure unioned in by jena-batch via --shex-context.
      if (args.skipShex) {
        checks.push({
          ...goCamDef,
          label: goCamDef.name,
          status: "skipped",
          ran_at: ranAt,
          violations: [],
        });
      } else if (parseFailed) {
        checks.push({
          ...goCamDef,
          label: goCamDef.name,
          status: "unknown",
          violations: [],
          error_message: parseError ?? "model failed to parse",
          ran_at: ranAt,
        });
      } else {
        const goCamShex = translateShexResult(jbResult?.shex?.go_cam);
        if (goCamShex) {
          checks.push({
            ...goCamDef,
            label: goCamDef.name,
            status: goCamShex.status,
            violations: goCamShex.violations,
            ran_at: ranAt,
          });
        } else {
          checks.push({
            ...goCamDef,
            label: goCamDef.name,
            status: "unknown",
            violations: [],
            ran_at: ranAt,
            error_message:
              "jena-batch returned no GO-CAM ShEx result for this model.",
          });
        }
      }

      // SPARQL checks from jena-batch.
      for (const def of sparqlDefs) {
        if (parseFailed) {
          checks.push({
            id: def.id,
            kind: "sparql",
            label: def.name,
            severity: def.severity,
            pass_label: def.pass_label,
            fail_label: def.fail_label,
            unknown_label: def.unknown_label,
            status: "unknown",
            violations: [],
            error_message: parseError ?? "model failed to parse",
            ran_at: ranAt,
          });
          continue;
        }
        const sr = translateSparqlResult(jbResult?.sparql?.[def.id]);
        // Capture column metadata on the definition (first time we see a
        // populated `vars` array). Used by the dashboard's drill-down table.
        if (!def.columns && jb.sparqlVars[def.id]) {
          def.columns = jb.sparqlVars[def.id];
        }
        if (sr) {
          checks.push({
            id: def.id,
            kind: "sparql",
            label: def.name,
            severity: def.severity,
            pass_label: def.pass_label,
            fail_label: def.fail_label,
            unknown_label: def.unknown_label,
            status: sr.status,
            violations: sr.violations,
            ran_at: ranAt,
          });
        } else {
          checks.push({
            id: def.id,
            kind: "sparql",
            label: def.name,
            severity: def.severity,
            pass_label: def.pass_label,
            fail_label: def.fail_label,
            unknown_label: def.unknown_label,
            status: "unknown",
            violations: [],
            error_message: "jena-batch returned no result for this query.",
            ran_at: ranAt,
          });
        }
      }

      // Metadata.
      let metadata;
      if (parseFailed) {
        metadata = buildParseFailedMetadata(id, parseError);
      } else if (jbResult?.metadata?.rows) {
        metadata = aggregateMetadataRows(jbResult.metadata.rows, id);
      } else {
        metadata = buildParseFailedMetadata(id, "no metadata rows returned");
      }

      perModel[id] = {
        id,
        ttl_path: m,
        metadata,
        checks,
      };
    }

    // Build the excluded-model audit consumed by update-status.mjs. Each
    // entry carries the matching filter ids and aggregated metadata so the
    // dashboard can list filtered models with title / contributors / taxon
    // alongside non-filtered ones — without their checks (those don't run).
    const modelPathsById = new Map(
      args.models.map((m) => [modelIdFromPath(m), m]),
    );
    const excluded = jb.excluded.map((e) => ({
      id: e.id,
      ttl_path: modelPathsById.get(e.id) ?? e.path,
      filter_ids: e.filter_ids,
      metadata: e.metadata?.rows
        ? aggregateMetadataRows(e.metadata.rows, e.id)
        : buildParseFailedMetadata(
            e.id,
            "no metadata rows returned for excluded model",
          ),
    }));

    const payload = {
      ran_at: ranAt,
      definitions, // CheckDefinition[] — sparql kind has columns populated
      models: perModel,
      // Filtered-model audit. Each entry is a model that matched one or
      // more sparql/filters/*.rq ASK queries; checks are not run on them
      // but metadata is still extracted so the dashboard can keep them
      // visible (under an opt-in facet).
      excluded,
      filters: filters.map((f) => ({ id: f.id, source_path: f.source_path })),
    };

    if (args.output === "-") {
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    } else {
      await mkdir(dirname(resolve(args.output)), { recursive: true });
      await writeFile(args.output, JSON.stringify(payload, null, 2));
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`run-checks failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
