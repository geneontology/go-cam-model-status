// Parse N-Quads output from `materializer ... --output-inconsistent true`.
// Each output line is `<s> <p> <o> <g> .` where <g> is the named graph
// `<http://model.geneontology.org/{id}#inferred>` (or similar suffix).
// We collect, per model id, the set of individuals typed `owl:Nothing` plus
// (best-effort) their inferred non-Nothing types for context in the drawer.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const NOTHING = "<http://www.w3.org/2002/07/owl#Nothing>";
const RDF_TYPE = "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type>";

// Match a Turtle/N-Quads IRI-or-literal token at a position. We only need
// IRI parsing; literals never appear as subjects/predicates and the graph
// column is always an IRI in materializer output.
function parseQuadLine(line) {
  // Quick reject: require trailing " ." and at least 4 tokens.
  if (!line.endsWith(" .") && !line.endsWith(" ."[0] + ".")) {
    return null;
  }
  // The first three positions are always angle-bracketed for our use here
  // (subject IRI, predicate IRI, object IRI-or-literal), but the object can
  // be a literal ("..."). Graph (4th term) is always an IRI for materializer.
  // Use a simple state machine.
  const tokens = [];
  let i = 0;
  const n = line.length;
  while (tokens.length < 4 && i < n) {
    while (i < n && line[i] === " ") {
      i++;
    }
    if (i >= n) {
      break;
    }
    const ch = line[i];
    if (ch === "<") {
      const end = line.indexOf(">", i + 1);
      if (end < 0) {
        return null;
      }
      tokens.push(line.slice(i, end + 1));
      i = end + 1;
    } else if (ch === '"') {
      // Find matching closing quote, accounting for backslash escapes.
      let j = i + 1;
      while (j < n) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === '"') {
          break;
        }
        j++;
      }
      if (j >= n) {
        return null;
      }
      // Optional language tag or datatype after the closing quote.
      let end = j + 1;
      if (line[end] === "@") {
        while (end < n && line[end] !== " ") {
          end++;
        }
      } else if (line[end] === "^" && line[end + 1] === "^") {
        end += 2;
        if (line[end] === "<") {
          const closeIri = line.indexOf(">", end + 1);
          if (closeIri < 0) {
            return null;
          }
          end = closeIri + 1;
        }
      }
      tokens.push(line.slice(i, end));
      i = end;
    } else if (ch === "_") {
      // Blank node.
      const end = line.indexOf(" ", i);
      tokens.push(line.slice(i, end < 0 ? n : end));
      i = end < 0 ? n : end;
    } else {
      return null;
    }
  }
  if (tokens.length < 4) {
    return null;
  }
  return { s: tokens[0], p: tokens[1], o: tokens[2], g: tokens[3] };
}

// Pull the bare model id ("60a5cabc00000123") out of a graph IRI like
// `<http://model.geneontology.org/60a5cabc00000123#inferred>`.
function modelIdFromGraph(graphIri) {
  const m = graphIri.match(
    /^<http:\/\/model\.geneontology\.org\/([^/#>]+)(?:#[^>]*)?>$/,
  );
  return m ? m[1] : null;
}

// Two-pass to keep memory bounded by the (small) inconsistent-individual set
// rather than the (huge) full set of typed individuals. A full-corpus run
// produces an N-Quads file with hundreds of millions of `rdf:type` triples;
// retaining all of them in JS Maps blows past the default 4 GB heap.
//
// Pass 1: stream the file, record which model ids appear at all (so consistent
// models can roll up to "pass" rather than "unknown"), and within that, which
// (modelId, individual) pairs have `owl:Nothing` among their inferred types.
//
// Pass 2: only if pass 1 found any inconsistency, stream the file again and
// gather the non-Nothing types for the known-bad individuals — those are the
// ones we'll surface in violation context.
export async function parseMaterializerNQuads(path) {
  const seenModels = new Set();
  // modelId -> Set<individualIri> of nodes typed owl:Nothing
  const nothingByModel = new Map();

  for await (const quad of streamTypeQuads(path)) {
    const id = modelIdFromGraph(quad.g);
    if (!id) {
      continue;
    }
    seenModels.add(id);
    if (quad.o !== NOTHING) {
      continue;
    }
    let bag = nothingByModel.get(id);
    if (!bag) {
      bag = new Set();
      nothingByModel.set(id, bag);
    }
    bag.add(quad.s);
  }

  // modelId -> Map<individualIri, Set<typeIri>> (non-Nothing types)
  const contextByModel = new Map();
  if (nothingByModel.size > 0) {
    for await (const quad of streamTypeQuads(path)) {
      if (quad.o === NOTHING) {
        continue;
      }
      const id = modelIdFromGraph(quad.g);
      if (!id) {
        continue;
      }
      const bag = nothingByModel.get(id);
      if (!bag || !bag.has(quad.s)) {
        continue;
      }
      let inds = contextByModel.get(id);
      if (!inds) {
        inds = new Map();
        contextByModel.set(id, inds);
      }
      let types = inds.get(quad.s);
      if (!types) {
        types = new Set();
        inds.set(quad.s, types);
      }
      types.add(quad.o);
    }
  }

  const out = {};
  for (const id of seenModels) {
    const nothingInds = nothingByModel.get(id);
    if (!nothingInds || nothingInds.size === 0) {
      out[id] = { status: "pass", violations: [] };
      continue;
    }
    const ctx = contextByModel.get(id);
    const violations = [...nothingInds].map((iri) => {
      const types = ctx?.get(iri);
      const nonNothingTypes = types
        ? [...types].map(stripAngles).sort()
        : [];
      return {
        kind: "owl_inconsistent_individual",
        individual: stripAngles(iri),
        types: nonNothingTypes,
      };
    });
    out[id] = { status: "fail", violations };
  }
  return out;
}

// Stream rdf:type quads from an N-Quads file, line-by-line, parsing only the
// minimum needed (subject IRI, type IRI, graph IRI). Skips comments, blanks,
// and lines that don't parse as quads.
async function* streamTypeQuads(path) {
  const rl = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const quad = parseQuadLine(line);
    if (!quad) {
      continue;
    }
    if (quad.p !== RDF_TYPE) {
      continue;
    }
    yield quad;
  }
}

function stripAngles(t) {
  if (t.startsWith("<") && t.endsWith(">")) {
    return t.slice(1, -1);
  }
  return t;
}
