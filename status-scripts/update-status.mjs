#!/usr/bin/env node
// Merge fresh check results from run-checks.mjs into a status-data worktree.
// Loads the prior `status/index.json` and per-model details, applies the
// transition rules from lib/transitions.mjs, writes new files, prunes models
// listed in --deleted-file, persists filtered-model entries from
// run.excluded, and rewrites manifest.json.
//
// The caller (workflow) is responsible for git add/commit/push of the
// resulting changes inside the data worktree.
//
// Usage:
//   node status-scripts/update-status.mjs \
//     --data-dir /path/to/data-worktree \
//     --run /path/to/run-checks-output.json \
//     --master-sha <sha> \
//     [--deleted-file deleted.txt]

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { mergeCheckResult, summarizeOverall } from "./lib/transitions.mjs";
import { BUILTIN_CHECKS } from "./lib/check-definitions.mjs";

const BUILTIN_ORDER = new Map(BUILTIN_CHECKS.map((d, i) => [d.id, i]));

// Manifest order: built-ins first, in BUILTIN_CHECKS declaration order;
// then SPARQL (and any other) checks alphabetised by display name. Mirrors
// the dashboard's `orderedChecks` so the table view matches the drawer.
function orderManifestChecks(defs) {
  return defs.slice().sort((a, b) => {
    const ai = BUILTIN_ORDER.get(a.id);
    const bi = BUILTIN_ORDER.get(b.id);
    if (ai !== undefined && bi !== undefined) {
      return ai - bi;
    }
    if (ai !== undefined) {
      return -1;
    }
    if (bi !== undefined) {
      return 1;
    }
    return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  });
}

const SCHEMA_VERSION = 1;

async function parseArgs(argv) {
  const args = {
    dataDir: undefined,
    run: undefined,
    masterSha: undefined,
    producerCommit: undefined,
    deletedFile: undefined,
  };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--data-dir":
        args.dataDir = resolve(argv[++i]);
        break;
      case "--run":
        args.run = resolve(argv[++i]);
        break;
      case "--master-sha":
        args.masterSha = argv[++i];
        break;
      case "--producer-commit":
        args.producerCommit = argv[++i];
        break;
      case "--deleted-file":
        args.deletedFile = resolve(argv[++i]);
        break;
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break; /* eslint-disable-line no-fallthrough */
      default:
        process.stderr.write(`Unknown argument: ${argv[i]}\n`);
        process.exit(2);
    }
  }
  for (const required of ["dataDir", "run", "masterSha"]) {
    if (!args[required]) {
      process.stderr.write(`Missing --${required.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}\n`);
      process.exit(2);
    }
  }
  return args;
}

const USAGE = `Usage: update-status.mjs --data-dir <dir> --run <json> --master-sha <sha> [--producer-commit <sha>] [--deleted-file <txt>]\n`;

async function readJsonOr(path, fallback) {
  if (!existsSync(path)) {
    return fallback;
  }
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

function buildIndexEntry(detail, definitions) {
  const filterReasons = detail.filter_reasons ?? [];
  const isFiltered = filterReasons.length > 0;

  // Flat checks map keyed by check id.
  const checksMap = {};
  for (const c of detail.checks) {
    checksMap[c.id] = c.status;
  }
  // Ensure every defined check has an entry so the index facets are stable.
  // Missing entries become `unknown` (not `skipped`) — `skipped` would imply
  // an explicit decision to not run the check, while in practice a missing
  // entry usually means the check is newly added and this model hasn't been
  // re-evaluated yet. Filtered models get `unknown` for every check by
  // construction, since we never run them.
  for (const def of definitions) {
    if (!(def.id in checksMap)) {
      checksMap[def.id] = "unknown";
    }
  }
  const { overall, failCount } = isFiltered
    ? { overall: "unknown", failCount: 0 }
    : summarizeOverall(detail.checks);
  return {
    id: detail.id,
    title: detail.metadata.title || detail.id,
    modelstate: detail.metadata.modelstate,
    deprecated: detail.metadata.deprecated,
    provided_by_labels: detail.metadata.providers
      .map((p) => p.label ?? p.iri)
      .filter(Boolean),
    contributor_orcids: detail.metadata.contributors
      .map((c) => c.orcid)
      .filter(Boolean),
    taxon: detail.metadata.taxon ?? null,
    taxon_label: detail.metadata.taxon_label ?? null,
    date: detail.metadata.date ?? "",
    overall,
    checks: checksMap,
    fail_count: failCount,
    filter_reasons: filterReasons,
  };
}

async function main() {
  const args = await parseArgs(process.argv);
  const generatedAt = new Date().toISOString();
  const current = { sha: args.masterSha, isoDate: generatedAt };

  const statusDir = join(args.dataDir, "status");
  const modelsDir = join(statusDir, "models");
  await mkdir(modelsDir, { recursive: true });

  const priorManifest = await readJsonOr(join(statusDir, "manifest.json"), {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    master_sha: args.masterSha,
    model_count: 0,
    checks: [],
  });
  const priorSnapshot = {
    sha: priorManifest.master_sha,
    isoDate: priorManifest.generated_at,
  };

  const priorIndex = await readJsonOr(join(statusDir, "index.json"), []);
  const priorIndexById = new Map(priorIndex.map((row) => [row.id, row]));

  const run = JSON.parse(await readFile(args.run, "utf8"));
  const definitions = run.definitions; // includes columns for sparql kind
  const definitionById = new Map(definitions.map((d) => [d.id, d]));

  // Apply transitions: load prior detail per changed model, merge each check.
  for (const [id, freshDetail] of Object.entries(run.models)) {
    const detailPath = join(modelsDir, `${id}.json`);
    const prior = await readJsonOr(detailPath, undefined);
    const priorChecksById = new Map(
      (prior?.checks ?? []).map((c) => [c.id, c]),
    );

    const mergedChecks = freshDetail.checks.map((fresh) =>
      mergeCheckResult(
        priorChecksById.get(fresh.id),
        fresh,
        current,
        priorSnapshot,
      ),
    );

    const newDetail = {
      id,
      iri: `http://model.geneontology.org/${id}`,
      ttl_path: freshDetail.ttl_path,
      master_sha: args.masterSha,
      generated_at: generatedAt,
      metadata: freshDetail.metadata,
      checks: mergedChecks,
    };
    await writeFile(detailPath, JSON.stringify(newDetail, null, 2));

    const indexEntry = buildIndexEntry(newDetail, definitions);
    priorIndexById.set(id, indexEntry);
  }

  // Filtered models: persist as index entries with empty checks, populated
  // metadata, and `filter_reasons` listing each matching filter id. The
  // dashboard hides these by default (opt-in facet) but lets curators
  // confirm what's been suppressed. Bookkeeping (since_*/last_passed_*) is
  // not preserved across a filter transition: filtered models have no
  // checks to carry it on, and if a model later un-filters, run-checks.mjs
  // produces fresh results that start a new transition window.
  if (Array.isArray(run.excluded)) {
    for (const ex of run.excluded) {
      const id = ex.id;
      if (typeof id !== "string" || !id) {
        continue;
      }
      const filteredDetail = {
        id,
        iri: `http://model.geneontology.org/${id}`,
        ttl_path: ex.ttl_path,
        master_sha: args.masterSha,
        generated_at: generatedAt,
        metadata: ex.metadata,
        checks: [],
        filter_reasons: ex.filter_ids ?? [],
      };
      await writeFile(
        join(modelsDir, `${id}.json`),
        JSON.stringify(filteredDetail, null, 2),
      );
      priorIndexById.set(id, buildIndexEntry(filteredDetail, definitions));
    }
  }

  // True deletions: --deleted-file is the master worktree's `git diff
  // --diff-filter=D` output. Drop those entries entirely from the index
  // and remove their detail files.
  if (args.deletedFile && existsSync(args.deletedFile)) {
    const deletedText = await readFile(args.deletedFile, "utf8");
    for (const rawLine of deletedText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      // Allow either bare ids or models/<id>.ttl paths.
      let id = line;
      if (line.endsWith(".ttl")) {
        const base = line.slice(line.lastIndexOf("/") + 1);
        id = base.slice(0, -4);
      }
      priorIndexById.delete(id);
      await rm(join(modelsDir, `${id}.json`), { force: true });
    }
  }

  // Sort the index for stable diffs across snapshots.
  const newIndex = [...priorIndexById.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  await writeFile(join(statusDir, "index.json"), JSON.stringify(newIndex));

  // Manifest carries the union of: previously-seen check ids and the run's
  // definitions. New definitions overwrite stale ones; obsolete definitions
  // (only present in prior) are kept so historical models still have facet
  // metadata for them. (TODO: prune when no model references them anymore.)
  const mergedDefs = new Map();
  for (const def of priorManifest.checks ?? []) {
    mergedDefs.set(def.id, def);
  }
  for (const def of definitions) {
    mergedDefs.set(def.id, def);
  }
  // Manifest's filter list mirrors manifest.checks: union of previously-seen
  // filters and this run's filters, so the dashboard's facet keeps working
  // for filtered models even if the producing filter was later renamed or
  // removed. Filters carry no frontmatter — id + source_path is the lot.
  const mergedFilters = new Map();
  for (const f of priorManifest.filters ?? []) {
    mergedFilters.set(f.id, f);
  }
  for (const f of run.filters ?? []) {
    mergedFilters.set(f.id, { id: f.id, source_path: f.source_path });
  }
  const newManifest = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    master_sha: args.masterSha,
    // Producer-side commit (this repo's HEAD at run time). Lets the next
    // workflow run detect changes to shapes / sparql / scripts and upgrade
    // an incremental run to MODE=full when the producer's behaviour has
    // shifted under it.
    ...(args.producerCommit ? { producer_commit: args.producerCommit } : {}),
    model_count: newIndex.length,
    checks: orderManifestChecks([...mergedDefs.values()]),
    filters: [...mergedFilters.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  };
  await writeFile(
    join(statusDir, "manifest.json"),
    JSON.stringify(newManifest, null, 2),
  );

  const filteredCount = Array.isArray(run.excluded) ? run.excluded.length : 0;
  process.stderr.write(
    `Updated ${Object.keys(run.models).length} model(s); ${filteredCount} filtered; index now ${newIndex.length} entries; ${definitionById.size} check definitions; ${mergedFilters.size} filter(s).\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`update-status failed: ${err?.stack ?? err}\n`);
  process.exit(1);
});
