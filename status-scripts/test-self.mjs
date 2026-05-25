// Tiny self-test for the parsing libraries — runs without any external
// binaries (no arq, shex, materializer, docker). Exits non-zero on failure.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { discoverSparqlChecks } from "./lib/check-definitions.mjs";
import { parseMaterializerNQuads } from "./lib/parse-materializer.mjs";
import {
  discoverFilters,
  translateShexResult,
  translateSparqlResult,
} from "./lib/run-jena-batch.mjs";
import { aggregateMetadataRows } from "./lib/extract-metadata.mjs";
import { mergeCheckResult, summarizeOverall } from "./lib/transitions.mjs";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("parseFrontmatter basic", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fm-"));
  try {
    const path = join(dir, "x.rq");
    await writeFile(
      path,
      `#+ id: my_check\n#+ name: My Check\n#+ description: A check\n#+ severity: warning\nSELECT * WHERE { ?s ?p ?o }\n`,
    );
    const meta = await parseFrontmatter(path);
    assert.equal(meta.id, "my_check");
    assert.equal(meta.name, "My Check");
    assert.equal(meta.description, "A check");
    assert.equal(meta.severity, "warning");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoverSparqlChecks rejects duplicate id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dup-"));
  try {
    await writeFile(
      join(dir, "a.rq"),
      `#+ id: shared\n#+ name: A\nSELECT * WHERE { ?s ?p ?o }\n`,
    );
    await writeFile(
      join(dir, "b.rq"),
      `#+ id: shared\n#+ name: B\nSELECT * WHERE { ?s ?p ?o }\n`,
    );
    let threw = false;
    try {
      await discoverSparqlChecks(dir);
    } catch (e) {
      threw = /duplicate check id/.test(e.message);
    }
    assert.equal(threw, true, "should throw on duplicate id");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoverSparqlChecks rejects missing id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "noid-"));
  try {
    await writeFile(join(dir, "a.rq"), `#+ name: A\nSELECT * WHERE {}\n`);
    let threw = false;
    try {
      await discoverSparqlChecks(dir);
    } catch (e) {
      threw = /missing required key "id"/.test(e.message);
    }
    assert.equal(threw, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseMaterializerNQuads detects owl:Nothing per model graph", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nq-"));
  try {
    const nqPath = join(dir, "out.nq");
    const nq = [
      // Inconsistent individual in model A
      `<http://model.geneontology.org/abc/ind-1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Nothing> <http://model.geneontology.org/abc#inferred> .`,
      `<http://model.geneontology.org/abc/ind-1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://purl.obolibrary.org/obo/GO_0003674> <http://model.geneontology.org/abc#inferred> .`,
      // Healthy individual in model B
      `<http://model.geneontology.org/def/ind-2> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://purl.obolibrary.org/obo/GO_0003674> <http://model.geneontology.org/def#inferred> .`,
      // Non-type triple — must be ignored
      `<http://model.geneontology.org/def/ind-2> <http://purl.obolibrary.org/obo/RO_0002413> <http://model.geneontology.org/def/ind-3> <http://model.geneontology.org/def#inferred> .`,
    ].join("\n");
    await writeFile(nqPath, nq);
    const result = await parseMaterializerNQuads(nqPath);
    assert.equal(result.abc.status, "fail", "abc should be inconsistent");
    assert.equal(result.abc.violations.length, 1);
    assert.equal(
      result.abc.violations[0].individual,
      "http://model.geneontology.org/abc/ind-1",
    );
    assert.deepEqual(result.abc.violations[0].types, [
      "http://purl.obolibrary.org/obo/GO_0003674",
    ]);
    assert.equal(result.def.status, "pass", "def should be consistent");
    assert.equal(result.def.violations.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("translateShexResult: conformant → pass with empty violations", () => {
  const r = translateShexResult({
    conformant: true,
    non_conformant_nodes: [],
  });
  assert.equal(r.status, "pass");
  assert.equal(r.violations.length, 0);
});

test("translateShexResult: nonconformant rows become shex_nonconformant violations", () => {
  const r = translateShexResult({
    conformant: false,
    non_conformant_nodes: [
      {
        node: "http://x/n1",
        shape: "http://shapes/Activity",
        reason: "missing required occurs_in",
      },
    ],
  });
  assert.equal(r.status, "fail");
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].kind, "shex_nonconformant");
  assert.equal(r.violations[0].node, "http://x/n1");
  assert.equal(r.violations[0].shape, "http://shapes/Activity");
  assert.match(r.violations[0].reason ?? "", /occurs_in/);
});

test("translateShexResult: null input returns null (no shex configured)", () => {
  assert.equal(translateShexResult(undefined), null);
  assert.equal(translateShexResult(null), null);
});

test("translateSparqlResult: empty rows → pass", () => {
  const r = translateSparqlResult({ vars: ["x"], rows: [] });
  assert.equal(r.status, "pass");
  assert.equal(r.violations.length, 0);
});

test("translateSparqlResult: rows become sparql_row violations with bindings", () => {
  const r = translateSparqlResult({
    vars: ["individual", "type"],
    rows: [
      { individual: "http://x/n1", type: "GO:0003674" },
      { individual: "http://x/n2", type: "GO:0008150" },
    ],
  });
  assert.equal(r.status, "fail");
  assert.equal(r.violations.length, 2);
  assert.equal(r.violations[0].kind, "sparql_row");
  assert.deepEqual(r.violations[0].bindings, {
    individual: "http://x/n1",
    type: "GO:0003674",
  });
});

test("aggregateMetadataRows: dedupes contributors and providers", () => {
  const meta = aggregateMetadataRows([
    { title: "M", contributor: "https://orcid.org/0000-0001" },
    { contributor: "https://orcid.org/0000-0002" },
    { contributor: "https://orcid.org/0000-0001" }, // duplicate
    { provider: "http://geneontology.org" },
    { provider: "http://geneontology.org" }, // duplicate
  ]);
  assert.equal(meta.title, "M");
  assert.equal(meta.contributors.length, 2);
  assert.equal(meta.providers.length, 1);
});

test("aggregateMetadataRows: empty rows fall back to fallbackTitle", () => {
  const meta = aggregateMetadataRows([], "abc123");
  assert.equal(meta.title, "abc123");
  assert.equal(meta.modelstate, "development");
  assert.equal(meta.deprecated, false);
});

test("aggregateMetadataRows: normalises modelstate values", () => {
  const meta = aggregateMetadataRows([{ modelstate: "PRODUCTION" }]);
  assert.equal(meta.modelstate, "production");
  const odd = aggregateMetadataRows([{ modelstate: "weirdvalue" }]);
  assert.equal(odd.modelstate, "development");
});

test("discoverFilters: derives ids from filenames, sorted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filters-"));
  try {
    await writeFile(join(dir, "deleted.rq"), "ASK { ?s ?p ?o }");
    await writeFile(join(dir, "archived.rq"), "ASK { ?s ?p ?o }");
    const out = await discoverFilters(dir);
    assert.deepEqual(
      out.map((f) => f.id),
      ["archived", "deleted"],
    );
    assert.equal(out[0].source_path, "sparql/filters/archived.rq");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoverFilters: rejects invalid id (uppercase / dash)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "filters-bad-"));
  try {
    await writeFile(join(dir, "Bad-Name.rq"), "ASK {}");
    let threw = false;
    try {
      await discoverFilters(dir);
    } catch (e) {
      threw = /Invalid filter id/.test(e.message);
    }
    assert.equal(threw, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoverFilters: missing directory returns empty list", async () => {
  const out = await discoverFilters("/nonexistent/path/does/not/exist");
  assert.deepEqual(out, []);
});

test("transitions: pass → fail records since_*", () => {
  const prior = {
    id: "x",
    status: "pass",
    last_passed_commit: "old1",
    last_passed_date: "2024-01-01T00:00:00Z",
  };
  const fresh = {
    id: "x",
    kind: "sparql",
    label: "X",
    status: "fail",
    ran_at: "2024-02-01T00:00:00Z",
    violations: [],
  };
  const merged = mergeCheckResult(
    prior,
    fresh,
    { sha: "newsha", isoDate: "2024-02-01T00:00:00Z" },
    { sha: "priorsha", isoDate: "2024-01-15T00:00:00Z" },
  );
  assert.equal(merged.since_commit, "newsha");
  assert.equal(merged.since_date, "2024-02-01T00:00:00Z");
  assert.equal(merged.last_passed_commit, "priorsha");
  assert.equal(merged.last_passed_date, "2024-01-15T00:00:00Z");
});

test("transitions: fail → pass records last_passed_*", () => {
  const prior = {
    id: "x",
    status: "fail",
    since_commit: "old1",
    since_date: "2024-01-01T00:00:00Z",
  };
  const fresh = {
    id: "x",
    kind: "sparql",
    label: "X",
    status: "pass",
    ran_at: "2024-02-01T00:00:00Z",
    violations: [],
  };
  const merged = mergeCheckResult(
    prior,
    fresh,
    { sha: "newsha", isoDate: "2024-02-01T00:00:00Z" },
    { sha: "priorsha", isoDate: "2024-01-15T00:00:00Z" },
  );
  assert.equal(merged.last_passed_commit, "newsha");
  assert.equal(merged.last_passed_date, "2024-02-01T00:00:00Z");
  assert.equal(merged.since_commit, undefined);
  assert.equal(merged.since_date, undefined);
});

test("transitions: unchanged status carries forward", () => {
  const prior = {
    id: "x",
    status: "fail",
    since_commit: "abc",
    since_date: "2024-01-01T00:00:00Z",
    last_passed_commit: "old",
    last_passed_date: "2023-12-01T00:00:00Z",
  };
  const fresh = {
    id: "x",
    kind: "sparql",
    label: "X",
    status: "fail",
    ran_at: "2024-02-01T00:00:00Z",
    violations: [],
  };
  const merged = mergeCheckResult(
    prior,
    fresh,
    { sha: "newsha", isoDate: "2024-02-01T00:00:00Z" },
    { sha: "priorsha", isoDate: "2024-01-15T00:00:00Z" },
  );
  assert.equal(merged.since_commit, "abc");
  assert.equal(merged.last_passed_commit, "old");
});

test("transitions: no prior, fail → only since_*", () => {
  const fresh = {
    id: "x",
    kind: "sparql",
    label: "X",
    status: "fail",
    ran_at: "2024-02-01T00:00:00Z",
    violations: [],
  };
  const merged = mergeCheckResult(
    undefined,
    fresh,
    { sha: "newsha", isoDate: "2024-02-01T00:00:00Z" },
    { sha: "n/a", isoDate: "n/a" },
  );
  assert.equal(merged.since_commit, "newsha");
  assert.equal(merged.last_passed_commit, undefined);
});

test("summarizeOverall: error dominates", () => {
  const { overall, failCount } = summarizeOverall([
    { status: "pass" },
    { status: "fail" },
    { status: "error" },
    { status: "skipped" },
  ]);
  assert.equal(overall, "error");
  assert.equal(failCount, 2);
});

test("summarizeOverall: all pass", () => {
  const { overall, failCount } = summarizeOverall([
    { status: "pass" },
    { status: "pass" },
  ]);
  assert.equal(overall, "pass");
  assert.equal(failCount, 0);
});

test("summarizeOverall: all skipped → skipped", () => {
  const { overall, failCount } = summarizeOverall([
    { status: "skipped" },
    { status: "skipped" },
  ]);
  assert.equal(overall, "skipped");
  assert.equal(failCount, 0);
});

test("summarizeOverall: any unknown beats pass", () => {
  const { overall, failCount } = summarizeOverall([
    { status: "pass" },
    { status: "pass" },
    { status: "unknown" },
  ]);
  assert.equal(
    overall,
    "unknown",
    "a model with any unknown check must NOT roll up to pass",
  );
  assert.equal(failCount, 0);
});

test("summarizeOverall: fail beats unknown", () => {
  const { overall, failCount } = summarizeOverall([
    { status: "fail" },
    { status: "unknown" },
    { status: "pass" },
  ]);
  assert.equal(overall, "fail");
  assert.equal(failCount, 1);
});

test("transitions: pass → unknown preserves prior bookkeeping", () => {
  const prior = {
    id: "x",
    status: "pass",
    last_passed_commit: "old1",
    last_passed_date: "2024-01-01T00:00:00Z",
  };
  const fresh = {
    id: "x",
    kind: "owl_consistency",
    label: "OWL",
    status: "unknown",
    ran_at: "2024-02-01T00:00:00Z",
    violations: [],
  };
  const merged = mergeCheckResult(
    prior,
    fresh,
    { sha: "newsha", isoDate: "2024-02-01T00:00:00Z" },
    { sha: "priorsha", isoDate: "2024-01-15T00:00:00Z" },
  );
  // unknown is not a transition — last_passed should stay where it was, no
  // since_* should be set.
  assert.equal(merged.since_commit, undefined);
  assert.equal(merged.last_passed_commit, "old1");
  assert.equal(merged.last_passed_date, "2024-01-01T00:00:00Z");
});

test("transitions: unknown → fail seeds since_, carries last_passed", () => {
  const prior = {
    id: "x",
    status: "unknown",
    last_passed_commit: "old1",
    last_passed_date: "2024-01-01T00:00:00Z",
  };
  const fresh = {
    id: "x",
    kind: "owl_consistency",
    label: "OWL",
    status: "fail",
    ran_at: "2024-03-01T00:00:00Z",
    violations: [],
  };
  const merged = mergeCheckResult(
    prior,
    fresh,
    { sha: "marchsha", isoDate: "2024-03-01T00:00:00Z" },
    { sha: "priorsha", isoDate: "2024-02-15T00:00:00Z" },
  );
  assert.equal(merged.since_commit, "marchsha");
  assert.equal(merged.last_passed_commit, "old1");
});

test("summarizeOverall: categorical (severity:info) is excluded from rollup", () => {
  // A model whose only "failing" check is categorical (e.g. GPAD = causal
  // model) should roll up to pass — that's exactly the behaviour the user
  // wants: causal models are not defective.
  const { overall, failCount } = summarizeOverall([
    { status: "pass", severity: "error" }, // owl_consistency
    { status: "fail", severity: "info" }, // gpad_compatibility — categorical
    { status: "pass", severity: "warning" }, // a sparql check
  ]);
  assert.equal(overall, "pass");
  assert.equal(failCount, 0);
});

test("summarizeOverall: categorical fail does not bump fail_count", () => {
  const { failCount } = summarizeOverall([
    { status: "fail", severity: "info" },
    { status: "fail", severity: "info" },
    { status: "fail", severity: "warning" },
  ]);
  assert.equal(failCount, 1);
});

test("transitions: no prior, unknown → no bookkeeping at all", () => {
  const fresh = {
    id: "x",
    kind: "owl_consistency",
    label: "OWL",
    status: "unknown",
    ran_at: "2024-02-01T00:00:00Z",
    violations: [],
  };
  const merged = mergeCheckResult(
    undefined,
    fresh,
    { sha: "s", isoDate: "2024-02-01T00:00:00Z" },
    { sha: "n/a", isoDate: "n/a" },
  );
  assert.equal(merged.since_commit, undefined);
  assert.equal(merged.last_passed_commit, undefined);
});

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    process.stdout.write(`ok  ${t.name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL  ${t.name}\n      ${e?.message ?? e}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
