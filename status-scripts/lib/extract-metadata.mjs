// Build the per-model metadata block from the rows returned by
// extract-metadata.rq.
//
// The query intentionally uses OPTIONAL on every clause (so partial models
// don't drop out), which means contributor/provider can multi-row. We
// deduplicate and aggregate.
//
// As of the jena-batch migration the rows arrive pre-extracted from the
// batch run's NDJSON output — there's no longer a per-model `arq` fork.
// `aggregateMetadataRows` is the only thing this module exposes.

function asModelState(value) {
  if (!value) {
    return "development";
  }
  const normalized = value.toLowerCase();
  if (
    normalized === "development" ||
    normalized === "production" ||
    normalized === "review" ||
    normalized === "closed" ||
    normalized === "delete"
  ) {
    return normalized;
  }
  return "development";
}

function asBool(value) {
  if (value == null) {
    return false;
  }
  return value === "true" || value === "1";
}

/**
 * Aggregate the SELECT rows from extract-metadata.rq into the metadata
 * record stored on each per-model JSON.
 *
 * @param {Array<Record<string,string>>} rows - bindings from the SELECT.
 * @param {string} fallbackTitle - id-based default if `?title` is absent.
 */
export function aggregateMetadataRows(rows, fallbackTitle = "") {
  const contributors = new Map(); // orcid -> { orcid, name? }
  const providers = new Map(); // iri -> { iri, label? }
  let title = "";
  let date = "";
  let modelstate = "development";
  let deprecated = false;
  let comment;
  let taxon;

  for (const row of rows ?? []) {
    if (row.title && !title) {
      title = row.title;
    }
    if (row.date && !date) {
      date = row.date;
    }
    if (row.modelstate) {
      modelstate = asModelState(row.modelstate);
    }
    if (row.deprecated != null) {
      deprecated = asBool(row.deprecated) || deprecated;
    }
    if (row.comment && !comment) {
      comment = row.comment;
    }
    if (row.taxon && !taxon) {
      taxon = row.taxon;
    }
    if (row.contributor && !contributors.has(row.contributor)) {
      contributors.set(row.contributor, { orcid: row.contributor });
    }
    if (row.provider && !providers.has(row.provider)) {
      providers.set(row.provider, { iri: row.provider });
    }
  }

  return {
    title: title || fallbackTitle,
    modelstate,
    deprecated,
    date,
    comment,
    contributors: [...contributors.values()],
    providers: [...providers.values()],
    taxon: taxon ?? null,
    taxon_label: null, // label resolution is out of scope for v1
  };
}
