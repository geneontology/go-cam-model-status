import {
  createConfig,
  createFieldConfig,
  type IndexedModelStatus,
} from "./types.ts";
import { DEFAULT_DATA_BASE } from "./constants.ts";

const modelField = createFieldConfig<IndexedModelStatus>();

export const config = createConfig<IndexedModelStatus>({
  title: "GO-CAM Model Status",
  description:
    "Quality-check dashboard for GO-CAM models — OWL consistency, GPAD compatibility, and corpus-wide SPARQL checks.",
  searchPlaceholder: "Search models by id or title",
  dataBase: import.meta.env.VITE_DATA_BASE ?? DEFAULT_DATA_BASE,
  headerLinks: [
    {
      label: "Models repo",
      href: "https://github.com/geneontology/noctua-models",
      newTab: true,
    },
    {
      label: "GO-CAM Browser",
      href: "https://geneontology.github.io/go-cam-browser/",
      newTab: true,
    },
    {
      label: "Gene Ontology Home",
      href: "https://geneontology.org/",
      newTab: true,
    },
  ],
  fields: [
    modelField({
      field: "id",
      isId: true,
      label: "Model ID",
      searchable: true,
      defaultVisible: false,
    }),
    modelField({
      field: "title",
      label: "Title",
      searchable: true,
      searchFuzzy: true,
    }),
    modelField({
      field: "overall",
      label: "Overall status",
      facet: "text",
      facetHelp:
        "Worst non-skipped check status across all checks for this model.",
      facetUrlKey: "status",
    }),
    modelField({
      field: "modelstate",
      label: "Model state",
      facet: "text",
      facetHelp:
        "Curator-assigned state: development, production, review, closed, or delete.",
      facetUrlKey: "modelstate",
    }),
    modelField({
      field: "deprecated",
      label: "Deprecated",
      facet: "text",
      facetHelp: "Models marked owl:deprecated.",
      facetUrlKey: "deprecated",
      defaultVisible: false,
    }),
    modelField({
      field: "taxon_label",
      label: "Organism",
      facet: "text",
      facetHelp:
        "Primary organism declared on the model (RO:0002162 in taxon).",
      facetUrlKey: "organism",
    }),
    modelField({
      field: "provided_by_labels",
      label: "Provider",
      facet: "array",
      facetHelp: "Group(s) listed as model providers (pav:providedBy).",
      facetUrlKey: "provider",
      defaultVisible: false,
    }),
    modelField({
      field: "contributor_orcids",
      label: "Contributor",
      facet: "array",
      facetHelp:
        "ORCID(s) listed as contributors (dc:contributor) on the model.",
      facetUrlKey: "contributor",
      defaultVisible: false,
    }),
    modelField({
      field: "filter_reasons",
      label: "Filter reason",
      facet: "array",
      facetHelp:
        "Models excluded from validation by a sparql/filters/*.rq ASK query — e.g. lego:modelstate \"delete\". Use the \"Show filtered models\" toggle above to include them in results, then narrow by reason here.",
      facetUrlKey: "filter",
      defaultVisible: false,
    }),
    modelField({
      field: "fail_count",
      label: "Failing check count",
      facet: "numeric",
      facetHelp: "Number of checks not passing for this model.",
      facetUrlKey: "fail_count",
      defaultVisible: false,
    }),
  ],
});
