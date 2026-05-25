// Single-pass batch runner that delegates ShEx, SPARQL, metadata extraction,
// and exclusion filtering to the jena-batch Docker image. Replaces the
// per-model `arq` and `shex` CLI forks the pipeline used pre-jena-batch.
//
// Why one Scala JVM rather than thousands of CLI processes: per-model JVM
// cold start dominates wall time at corpus scale (50K+ models × N queries
// each). jena-batch loads schemas/queries once and streams models through
// them, turning days of shell loops into minutes of real work. See
// https://github.com/balhoff/jena-batch.

import { copyFile, mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, join } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const DEFAULT_JENA_BATCH_CMD =
  "docker run --rm -v {WORKDIR}:/work ghcr.io/balhoff/jena-batch:v0.6.0";

/**
 * Stage every input jena-batch needs into the workDir, invoke it, and
 * parse its NDJSON output.
 *
 * @param {object} opts
 * @param {string} opts.repoRoot       - noctua-models clone root.
 * @param {string} opts.workDir        - tempdir; staged inputs go here.
 * @param {string} opts.modelsStageDir - dir of staged TTLs (already populated).
 * @param {Array<{id:string, source_path:string}>} opts.sparqlDefs
 *                                       sparql/status check definitions.
 * @param {Array<{id:string, source_path:string}>} opts.filters
 *                                       sparql/filters exclusion ASK queries.
 * @param {boolean} opts.skipShex      - omit both --shex flags if true (skips
 *                                       gpad_compatibility AND go_cam_shape).
 * @param {string}  [opts.goClosurePath]
 *                                     - host path to the materialised GO
 *                                       `rdfs:subClassOf*` closure TTL. Required
 *                                       when skipShex is false; staged into
 *                                       workDir as the `--shex-context go_cam=…`
 *                                       auxiliary graph for the GO-CAM ShEx
 *                                       check.
 * @param {string} [opts.jenaBatchCmd] - override the docker invocation;
 *                                       use {WORKDIR} as the bind-mount placeholder.
 * @param {string} [opts.maxHeap]      - JVM heap ceiling (e.g. "8G").
 * @param {number} [opts.parallelism]  - --parallelism passed to jena-batch.
 * @param {number} [opts.timeoutMs]    - wall-time cap; 0/undefined = unlimited.
 * @returns {Promise<{
 *   excluded: Array<{id:string, path:string, model_iri:string|undefined,
 *                    filter_ids:string[], duration_ms:number,
 *                    metadata:{vars:string[], rows:Array<Record<string,string>>}|null}>,
 *   models: Record<string, {
 *     path:string, model_iri:string|undefined, parse_failed:boolean,
 *     error:string|null, riot_diagnostics:Array<object>,
 *     shex:Record<string, {conformant:boolean, non_conformant_nodes:Array<object>}>,
 *     sparql:Record<string, {vars:string[], rows:Array<Record<string,string>>}>,
 *     metadata:{vars:string[], rows:Array<Record<string,string>>}|null,
 *     duration_ms:number
 *   }>,
 *   filtersUsed: Array<{id:string, source_path:string}>,
 *   sparqlVars: Record<string, string[]>
 * }>}
 */
export async function runJenaBatch(opts) {
  const {
    repoRoot,
    workDir,
    modelsStageDir,
    sparqlDefs,
    filters,
    skipShex,
    goClosurePath,
    jenaBatchCmd = process.env.JENA_BATCH_CMD ?? DEFAULT_JENA_BATCH_CMD,
    maxHeap = process.env.JENA_BATCH_MAX_HEAP ?? "24G",
    parallelism = parseInt(process.env.JENA_BATCH_PARALLELISM ?? "4", 10),
    timeoutMs = 0,
  } = opts;

  const queriesDir = join(workDir, "queries");
  const filtersDir = join(workDir, "filters");
  await mkdir(queriesDir, { recursive: true });
  if (filters.length > 0) {
    await mkdir(filtersDir, { recursive: true });
  }

  // Stage shex schemas + shape maps (only if --shex will actually be passed).
  // gpad: pass/fail (semantic: GPAD-compatible vs causal) — no auxiliary graph.
  // go_cam: pass/fail against the structural GO-CAM contract — needs the GO
  // `rdfs:subClassOf*` closure unioned in so class-membership shape-map queries
  // can rely on single-hop traversal.
  const shexSchemaSrc = join(repoRoot, "gpad-shapes.shex");
  const shexMapSrc = join(repoRoot, "gpad-shapes.shapeMap");
  const shexSchemaDst = join(workDir, "gpad-shapes.shex");
  const shexMapDst = join(workDir, "gpad-shapes.shapeMap");
  const goCamSchemaSrc = join(repoRoot, "go-cam-shapes.shex");
  const goCamMapSrc = join(repoRoot, "go-cam-shapes.shapeMap");
  const goCamSchemaDst = join(workDir, "go-cam-shapes.shex");
  const goCamMapDst = join(workDir, "go-cam-shapes.shapeMap");
  const goClosureDst = join(workDir, "go-closure.ttl");
  if (!skipShex) {
    await copyFile(shexSchemaSrc, shexSchemaDst);
    await copyFile(shexMapSrc, shexMapDst);
    await copyFile(goCamSchemaSrc, goCamSchemaDst);
    await copyFile(goCamMapSrc, goCamMapDst);
    if (!goClosurePath) {
      throw new Error(
        "runJenaBatch: goClosurePath is required when skipShex is false (build it with `bash status-scripts/build-go-closure.sh --input closure-source.owl --output go-closure.ttl`; see status-scripts/README.md for the ROBOT merge step)",
      );
    }
    await copyFile(goClosurePath, goClosureDst);
  }

  // Stage metadata query.
  const metadataQuerySrc = join(repoRoot, "status-scripts", "extract-metadata.rq");
  const metadataQueryDst = join(workDir, "extract-metadata.rq");
  await copyFile(metadataQuerySrc, metadataQueryDst);

  // Stage sparql/status/*.rq → workDir/queries/<file>
  for (const def of sparqlDefs) {
    const src = join(repoRoot, def.source_path);
    const dst = join(queriesDir, basename(def.source_path));
    await copyFile(src, dst);
  }

  // Stage sparql/filters/*.rq → workDir/filters/<file>
  for (const f of filters) {
    const src = join(repoRoot, f.source_path);
    const dst = join(filtersDir, basename(f.source_path));
    await copyFile(src, dst);
  }

  const isDocker = jenaBatchCmd.includes("docker run");
  const cmd = jenaBatchCmd.replace("{WORKDIR}", workDir);
  const tokens = cmd.split(/\s+/);
  const program = tokens[0];
  const baseArgs = tokens.slice(1);

  // sbt-native-packager passthrough: -J-Xmx wins over the launcher's
  // baked-in -Xmx8G. Same trick the materializer wrapper uses.
  const ndjsonOut = isDocker ? "/work/jena-batch.ndjson" : join(workDir, "jena-batch.ndjson");
  const inputDir = isDocker ? "/work/changed-models" : modelsStageDir;
  const cliArgs = [
    ...baseArgs,
    `-J-Xmx${maxHeap}`,
    "--input",
    inputDir,
    "--output",
    ndjsonOut,
    "--parallelism",
    String(parallelism),
  ];
  if (!skipShex) {
    const gpadSchemaArg = isDocker ? "/work/gpad-shapes.shex" : shexSchemaDst;
    const gpadMapArg = isDocker ? "/work/gpad-shapes.shapeMap" : shexMapDst;
    cliArgs.push("--shex", `gpad=${gpadSchemaArg}=${gpadMapArg}`);

    const goCamSchemaArg = isDocker ? "/work/go-cam-shapes.shex" : goCamSchemaDst;
    const goCamMapArg = isDocker ? "/work/go-cam-shapes.shapeMap" : goCamMapDst;
    const goCamContextArg = isDocker ? "/work/go-closure.ttl" : goClosureDst;
    cliArgs.push("--shex", `go_cam=${goCamSchemaArg}=${goCamMapArg}`);
    cliArgs.push("--shex-context", `go_cam=${goCamContextArg}`);
  }
  for (const def of sparqlDefs) {
    const file = basename(def.source_path);
    const path = isDocker ? `/work/queries/${file}` : join(queriesDir, file);
    cliArgs.push("--query", `${def.id}=${path}`);
  }
  for (const f of filters) {
    const file = basename(f.source_path);
    const path = isDocker ? `/work/filters/${file}` : join(filtersDir, file);
    cliArgs.push("--filter", `${f.id}=${path}`);
  }
  cliArgs.push(
    "--metadata-query",
    isDocker ? "/work/extract-metadata.rq" : metadataQueryDst,
  );

  process.stderr.write(
    `[run-checks] invoking jena-batch: ${program} ${cliArgs.join(" ")}\n`,
  );

  await new Promise((resolveP, rejectP) => {
    const child = spawn(program, cliArgs, { stdio: "inherit" });
    let timer = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectP(new Error(`jena-batch timed out after ${timeoutMs} ms`));
      }, timeoutMs);
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
        rejectP(new Error(`jena-batch killed by signal ${signal}`));
      } else if (code !== 0) {
        rejectP(new Error(`jena-batch exited with code ${code}`));
      } else {
        resolveP();
      }
    });
  });

  // Parse NDJSON output. Each line is either a normal ModelResult or an
  // ExcludedRecord (distinguished by `kind: "excluded"`).
  const ndjsonHostPath = join(workDir, "jena-batch.ndjson");
  const excluded = [];
  const models = {};
  const sparqlVars = {};

  const rl = createInterface({
    input: createReadStream(ndjsonHostPath, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (err) {
      throw new Error(
        `Could not parse jena-batch NDJSON line: ${err.message}\nLine: ${line}`,
      );
    }
    const id = modelIdFromPath(obj.path);
    if (obj.kind === "excluded") {
      excluded.push({
        id,
        path: obj.path,
        model_iri: obj.model_iri,
        filter_ids: obj.filter_ids ?? [],
        duration_ms: obj.duration_ms,
        metadata: obj.metadata ?? null,
      });
      continue;
    }
    models[id] = {
      path: obj.path,
      model_iri: obj.model_iri,
      parse_failed: !!obj.parse_failed,
      error: obj.error ?? null,
      riot_diagnostics: obj.riot_diagnostics ?? [],
      shex: obj.shex ?? {},
      sparql: obj.sparql ?? {},
      metadata: obj.metadata ?? null,
      duration_ms: obj.duration_ms ?? 0,
    };
    // Track the columns each query reported so the consumer can populate
    // CheckDefinition.columns without re-parsing the original .rq file.
    for (const [qid, sr] of Object.entries(obj.sparql ?? {})) {
      if (Array.isArray(sr?.vars) && !sparqlVars[qid]) {
        sparqlVars[qid] = sr.vars;
      }
    }
  }

  return { excluded, models, filtersUsed: filters, sparqlVars };
}

/**
 * Discover SPARQL ASK exclusion filters under `<repo>/sparql/filters/`.
 * Filters are intentionally lighter-weight than checks: no required
 * frontmatter, no severity, no labels — they're internal pipeline plumbing,
 * not user-facing facets. The id is the filename stem.
 */
export async function discoverFilters(filtersDir) {
  let entries;
  try {
    entries = await readdir(filtersDir);
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const files = entries.filter((f) => f.endsWith(".rq")).sort();
  const ID_RE = /^[a-z0-9][a-z0-9_]*$/;
  const seen = new Set();
  const out = [];
  for (const file of files) {
    const id = file.slice(0, -".rq".length);
    if (!ID_RE.test(id)) {
      throw new Error(
        `Invalid filter id "${id}" derived from ${file}; must match ${ID_RE.source}`,
      );
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate filter id "${id}"`);
    }
    seen.add(id);
    out.push({ id, source_path: `sparql/filters/${file}` });
  }
  return out;
}

function modelIdFromPath(p) {
  const file = basename(p);
  return file.endsWith(".ttl") ? file.slice(0, -4) : file;
}

// Convert a jena-batch ShEx result `{conformant, non_conformant_nodes}`
// into the consumer's `{status, violations}` shape. Exported because
// run-checks.mjs needs it; kept here to keep all jena-batch translation
// logic in one place.
export function translateShexResult(jbShex) {
  if (!jbShex) {
    return null;
  }
  const violations = (jbShex.non_conformant_nodes ?? []).map((n) => ({
    kind: "shex_nonconformant",
    node: n.node,
    shape: n.shape,
    reason: n.reason,
  }));
  return {
    status: jbShex.conformant ? "pass" : "fail",
    violations,
  };
}

// Convert a jena-batch SPARQL SELECT result `{vars, rows}` into the
// consumer's `{status, violations}` shape (status fail iff any row).
export function translateSparqlResult(jbSparql) {
  if (!jbSparql) {
    return null;
  }
  const rows = jbSparql.rows ?? [];
  return {
    status: rows.length > 0 ? "fail" : "pass",
    violations: rows.map((bindings) => ({
      kind: "sparql_row",
      bindings,
    })),
  };
}
