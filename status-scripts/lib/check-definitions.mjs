// Build the list of CheckDefinition records the dashboard schema expects.
// Built-in definitions are hard-coded; SPARQL definitions are discovered from
// `<repo>/sparql/status/*.rq` and validated for id uniqueness.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.mjs";

export const BUILTIN_CHECKS = [
  {
    id: "rdf_valid",
    kind: "rdf_valid",
    name: "RDF Validity",
    description:
      "Apache Jena RIOT parse with strict + checking enabled (parity with `riot --validate`). Pass = parses cleanly with no diagnostics; fail = parses but riot reports lexical / IRI / language-tag / datatype issues; error = unparseable.",
    severity: "warning",
  },
  {
    id: "owl_consistency",
    kind: "owl_consistency",
    name: "OWL Consistency",
    description:
      "Arachne reasoning over the model imported alongside go-lego. Inconsistency surfaces as individuals typed owl:Nothing.",
    severity: "error",
  },
  {
    id: "gpad_compatibility",
    kind: "gpad_compatibility",
    name: "GPAD Compatibility",
    description:
      "Categorical: does this model fit GPAD's flat triple shape? 'Causal model' is not a defect — modern GO-CAMs intentionally encode causal flow that GPAD cannot represent. Backed by ShEx validation against gpad-shapes.shex.",
    severity: "info",
    pass_label: "GPAD-compatible",
    fail_label: "Causal model",
    unknown_label: "Unknown shape",
  },
  {
    id: "go_cam_shape",
    kind: "go_cam_shape",
    name: "GO-CAM Shape",
    description:
      "ShEx validation against go-cam-shapes.shex — the structural contract every GO-CAM model is expected to satisfy (well-formed individuals, evidence on every annotated edge, references resolving to known GO/CHEBI/RO terms, etc.). Focus selection uses the SPARQL-style shape map in go-cam-shapes.shapeMap, evaluated against the model unioned with a pre-materialised GO `rdfs:subClassOf*` closure so class-membership tests can rely on a single-hop traversal.",
    severity: "error",
  },
];

const ID_RE = /^[a-z0-9][a-z0-9_]*$/;

export async function discoverSparqlChecks(sparqlStatusDir) {
  const files = (await readdir(sparqlStatusDir))
    .filter((f) => f.endsWith(".rq"))
    .sort();
  const seen = new Set();
  const defs = [];
  for (const file of files) {
    const path = join(sparqlStatusDir, file);
    const meta = await parseFrontmatter(path);
    if (!meta.id) {
      throw new Error(`${path}: frontmatter missing required key "id"`);
    }
    if (!meta.name) {
      throw new Error(`${path}: frontmatter missing required key "name"`);
    }
    if (!ID_RE.test(meta.id)) {
      throw new Error(
        `${path}: invalid id "${meta.id}" (must match ${ID_RE.source})`,
      );
    }
    if (seen.has(meta.id)) {
      throw new Error(`${path}: duplicate check id "${meta.id}"`);
    }
    seen.add(meta.id);
    defs.push({
      id: meta.id,
      kind: "sparql",
      name: meta.name,
      description: meta.description,
      severity: meta.severity ?? "warning",
      source_path: `sparql/status/${file}`,
    });
  }
  return defs;
}

export async function loadAllCheckDefinitions(sparqlStatusDir) {
  const sparql = await discoverSparqlChecks(sparqlStatusDir);
  return [...BUILTIN_CHECKS, ...sparql];
}
