export const HEADER_HEIGHT = 60;
export const NAVBAR_WIDTH = 320;
export const TH_BACKGROUND = "gray.1";
export const RESULTS_PAGE_SIZE = 100;

// Built-in check ids — kept as constants so components can sort them
// stably ahead of dynamic SPARQL checks.
export const BUILTIN_CHECK_IDS = [
  "rdf_valid",
  "owl_consistency",
  "gpad_compatibility",
] as const;

// noctua-models repo coordinates, used to build GitHub source links to model
// TTLs and to commits in the models repo.
export const NOCTUA_MODELS_OWNER = "geneontology";
export const NOCTUA_MODELS_REPO = "noctua-models";
export const NOCTUA_MODELS_BRANCH = "master";

// Coordinates of the published status snapshot. The producer workflow in this
// repo writes to STATUS_DATA_BRANCH; the dashboard fetches it via jsDelivr
// (with raw.githubusercontent.com as fallback). Override per-deployment via
// VITE_DATA_BASE if needed.
export const STATUS_DATA_OWNER = "geneontology";
export const STATUS_DATA_REPO = "go-cam-model-status";
export const STATUS_DATA_BRANCH = "status-data";

export const DEFAULT_DATA_BASE = `https://cdn.jsdelivr.net/gh/${STATUS_DATA_OWNER}/${STATUS_DATA_REPO}@${STATUS_DATA_BRANCH}/status`;
export const RAW_DATA_BASE_FALLBACK = `https://raw.githubusercontent.com/${STATUS_DATA_OWNER}/${STATUS_DATA_REPO}/${STATUS_DATA_BRANCH}/status`;

export function commitUrl(sha: string): string {
  return `https://github.com/${NOCTUA_MODELS_OWNER}/${NOCTUA_MODELS_REPO}/commit/${sha}`;
}

export function ttlSourceUrl(modelId: string): string {
  return `https://github.com/${NOCTUA_MODELS_OWNER}/${NOCTUA_MODELS_REPO}/blob/${NOCTUA_MODELS_BRANCH}/models/${modelId}.ttl`;
}

// URL to a producer-side source file (SPARQL check, ASK filter, shape).
// These live in THIS repo's main branch alongside the dashboard, not in
// noctua-models.
export function producerSourceUrl(repoRelativePath: string): string {
  return `https://github.com/${STATUS_DATA_OWNER}/${STATUS_DATA_REPO}/blob/main/${repoRelativePath}`;
}

export function noctuaEditorUrl(modelId: string): string {
  // Noctua is currently served on plain http, not https
  return `http://noctua.geneontology.org/editor/graph/gomodel:${modelId}`;
}

export function modelIri(modelId: string): string {
  return `http://model.geneontology.org/${modelId}`;
}
