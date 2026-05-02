import { config } from "./config.tsx";
import {
  createFieldConfig,
  type FieldConfig,
  type IndexedModelStatus,
  type Manifest,
} from "./types.ts";

const modelField = createFieldConfig<IndexedModelStatus>();

/**
 * Build the runtime list of facetable/searchable fields by extending the
 * static config with one text facet per check id discovered in the manifest.
 *
 * The check status is exposed at runtime as a top-level field on each row
 * (see `flattenChecks`), so existing facet/search machinery can treat it like
 * any other text field. Field names are the bare check ids; URL keys are the
 * bare check ids too — making URLs like `?filter=disconnected_individuals:fail`
 * shareable and meaningful.
 */
export function buildExtendedFields(
  manifest: Manifest | undefined,
): readonly FieldConfig<IndexedModelStatus, keyof IndexedModelStatus>[] {
  if (!manifest) {
    return config.fields;
  }
  const checkFields = manifest.checks.map((def) =>
    modelField({
      // The flattenChecks step ensures this field exists on each row.
      field: def.id as keyof IndexedModelStatus,
      label: def.name,
      facet: "text",
      facetHelp: def.description,
      facetUrlKey: def.id,
      defaultVisible: true,
    }),
  );
  return [...config.fields, ...checkFields];
}

/**
 * Flatten `checks: Record<id, status>` onto the row so that per-check facets
 * can read the value via a normal property lookup. Mutates a shallow copy.
 */
export function flattenChecks(
  models: IndexedModelStatus[],
): IndexedModelStatus[] {
  return models.map((m) => {
    const flat: Record<string, unknown> = { ...m };
    for (const [id, status] of Object.entries(m.checks)) {
      flat[id] = status;
    }
    return flat as unknown as IndexedModelStatus;
  });
}
