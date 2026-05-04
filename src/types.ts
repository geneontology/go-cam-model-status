import type { ReactNode } from "react";

// =============================================================================
// Status data schema (mirrored by the JSON producer in noctua-models)
// =============================================================================

// Status states for a single check on a single model.
//   pass     ran successfully, no violations
//   fail     ran successfully, found violations
//   error    tried to run, broke (we have an error_message)
//   skipped  intentionally not run (e.g. --skip-owl)
//   unknown  no signal either way — model wasn't covered by the run, or a new
//            check definition exists but this model hasn't been re-evaluated yet
export type CheckStatus =
  | "pass"
  | "fail"
  | "error"
  | "skipped"
  | "unknown";

export type Severity = "info" | "warning" | "error";

// Built-in check kinds are reserved; SPARQL check ids are discovered from
// noctua-models/sparql/status/*.rq frontmatter at workflow time.
// `gpad_compatibility` uses `gpad-shapes.shex` and is informational —
// non-conformance does not mean the model is wrong, only that it does not
// translate cleanly to GPAD output. A future "main_shex_conformance" kind
// will be added once ontology-closure preprocessing is in place (v2+).
// `rdf_valid` consumes Apache Jena RIOT diagnostics emitted during the parse
// phase of jena-batch (with strict + checking enabled, matching `riot --validate`).
export type CheckKind =
  | "rdf_valid"
  | "owl_consistency"
  | "gpad_compatibility"
  | "sparql";

export interface CheckDefinition {
  id: string;
  kind: CheckKind;
  name: string;
  description?: string;
  severity: Severity;
  source_path?: string;
  // For SPARQL checks: SELECT variable order, used to lay out the violation
  // table columns in the drill-down deterministically.
  columns?: string[];
  // For severity: "info" checks where the two states are categories rather
  // than verdicts (e.g. GPAD-compatible vs. causal-model). The badge text
  // uses these in place of the generic "Pass"/"Fail" wording, and the UI
  // renders both states with neutral colours.
  pass_label?: string;
  fail_label?: string;
  unknown_label?: string;
}

// True iff the check is categorical (informational) rather than a verdict.
// Categorical checks are skipped from `overall` rollup and from `fail_count`,
// since "fail" doesn't mean the model is broken — it means the model belongs
// to a different category.
export function isCategorical(def: { severity: Severity }): boolean {
  return def.severity === "info";
}

export type ModelState =
  | "development"
  | "production"
  | "review"
  | "closed"
  | "delete";

export interface IndexedModelStatus {
  id: string;
  title: string;
  modelstate: ModelState;
  deprecated: boolean;
  provided_by_labels: string[];
  contributor_orcids: string[];
  taxon?: string | null;
  taxon_label?: string | null;
  date: string;
  overall: CheckStatus;
  checks: Record<string, CheckStatus>;
  fail_count: number;
  // Per-check status is also flattened to a top-level field at runtime
  // (see runtimeFields.ts:flattenChecks) so the facet/search machinery can
  // treat each check id as a normal text field. The index signature also
  // satisfies flexsearch's DocumentData requirement.
  [extraField: string]: unknown;
}

export interface ModelStatusDetail {
  id: string;
  iri: string;
  ttl_path: string;
  master_sha: string;
  generated_at: string;
  metadata: {
    title: string;
    modelstate: ModelState;
    deprecated: boolean;
    date: string;
    comment?: string;
    contributors: { orcid: string; name?: string }[];
    providers: { iri: string; label?: string }[];
    taxon?: string | null;
    taxon_label?: string | null;
  };
  checks: CheckResultDetail[];
}

export interface CheckResultDetail {
  id: string;
  kind: CheckKind;
  label: string;
  // Denormalised from the CheckDefinition so the drawer can colour and label
  // each row without an extra manifest lookup.
  severity?: Severity;
  pass_label?: string;
  fail_label?: string;
  unknown_label?: string;
  status: CheckStatus;
  ran_at: string;
  duration_ms?: number;
  since_commit?: string;
  since_date?: string;
  last_passed_commit?: string;
  last_passed_date?: string;
  error_message?: string;
  violations: Violation[];
}

export type Violation =
  | {
      kind: "owl_inconsistent_individual";
      individual: string;
      types: string[];
    }
  | {
      kind: "shex_nonconformant";
      node: string;
      shape: string;
      reason?: string;
    }
  | {
      kind: "sparql_row";
      bindings: Record<string, string>;
    }
  | {
      kind: "riot_diagnostic";
      severity: "WARN" | "ERROR" | "FATAL";
      line: number;
      col: number;
      message: string;
    };

export interface Manifest {
  schema_version: number;
  generated_at: string;
  master_sha: string;
  model_count: number;
  checks: CheckDefinition[];
}

export interface StatusData {
  manifest: Manifest;
  models: IndexedModelStatus[];
}

// =============================================================================
// Field config (static fields only; per-check facets are derived dynamically
// at runtime from manifest.checks — see useFacets).
// =============================================================================

export interface FieldConfig<
  TData,
  TField extends keyof TData = keyof TData,
> {
  field: TField;
  isId: boolean;
  label: string;
  searchable: boolean;
  searchFuzzy: boolean;
  facet?: "text" | "array" | "numeric";
  facetHelp?: ReactNode;
  facetUrlKey?: string;
  defaultVisible: boolean;
  render(value: TData[TField], row: TData): ReactNode;
}

export interface AppConfig<
  TData,
  TFields extends readonly FieldConfig<
    TData,
    keyof TData
  >[] = readonly FieldConfig<TData, keyof TData>[],
> {
  title: string;
  description: string;
  searchPlaceholder: string;
  // Base URL for the published status data (manifest.json, index.json,
  // models/{id}.json all live under this). Falls back at runtime to a sibling
  // path if VITE_DATA_BASE is not set.
  dataBase: string;
  headerLinks?: {
    label: string;
    href: string;
    newTab: boolean;
  }[];
  fields: TFields;
}

export function createFieldConfig<TData>() {
  return function <TField extends keyof TData>(
    config: Partial<Omit<FieldConfig<TData, TField>, "field" | "render">> & {
      field: TField;
      render?: (value: TData[TField], row: TData) => ReactNode;
    },
  ): FieldConfig<TData, TField> {
    return {
      field: config.field,
      isId: config.isId ?? false,
      label: config.label ?? String(config.field),
      searchable: config.searchable ?? false,
      searchFuzzy: config.searchFuzzy ?? false,
      facet: config.facet,
      facetHelp: config.facetHelp,
      facetUrlKey: config.facetUrlKey,
      defaultVisible: config.defaultVisible ?? true,
      render(value: TData[TField], row: TData) {
        if (config.render) {
          return config.render(value, row);
        }
        return value == null ? "N/A" : String(value);
      },
    };
  };
}

export function createConfig<
  TData,
  const TFields extends readonly FieldConfig<
    TData,
    keyof TData
  >[] = readonly FieldConfig<TData, keyof TData>[],
>(config: AppConfig<TData, TFields>): AppConfig<TData, TFields> {
  if (config.fields.length === 0) {
    throw new Error("At least one field must be defined in config");
  }
  const idFields = config.fields.filter((f) => f.isId);
  if (idFields.length === 0) {
    throw new Error("No ID field defined in config");
  }
  if (idFields.length > 1) {
    throw new Error("Multiple ID fields defined in config");
  }
  const facetUrlKeys = new Set<string>();
  for (const field of config.fields) {
    if (field.facetUrlKey === undefined) {
      continue;
    }
    if (facetUrlKeys.has(field.facetUrlKey)) {
      throw new Error(
        `Duplicate facetUrlKey "${field.facetUrlKey}" found in config`,
      );
    }
    if (
      field.facetUrlKey.trim() === "" ||
      field.facetUrlKey.includes(":") ||
      field.facetUrlKey.includes(",")
    ) {
      throw new Error(
        `Invalid facetUrlKey "${field.facetUrlKey}" found in config. facetUrlKey must be non-empty and cannot contain ":" or "," characters.`,
      );
    }
    facetUrlKeys.add(field.facetUrlKey);
  }
  return config;
}

export const ResultsDisplayType = {
  CARDS: "Cards",
  TABLE: "Table",
} as const;

export type ResultsDisplayType =
  (typeof ResultsDisplayType)[keyof typeof ResultsDisplayType];

export interface ResultsDisplayProps {
  data: IndexedModelStatus[];
  displayIndexes: number[];
  manifest: Manifest;
  onSelectModel: (id: string) => void;
}

export interface ResultsDisplayCommonProps {
  displayModels: IndexedModelStatus[];
  displayFields: FieldConfig<IndexedModelStatus>[];
  manifest: Manifest;
  onSelectModel: (id: string) => void;
}
