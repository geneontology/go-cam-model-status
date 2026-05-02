import {
  useQueryState,
  parseAsString,
  createParser,
  type SingleParser,
  createMultiParser,
} from "nuqs";
import { useMemo } from "react";
import type {
  ActiveFilters,
  Filter,
  NumericFilter,
  TextFilter,
} from "./useFacets.ts";
import type { FieldConfig } from "../types.ts";

const parseAsNumericFilter = createParser<NumericFilter>({
  parse: (value) => {
    const split = value.split("~");
    if (split.length !== 2) {
      return null;
    }
    const min = parseFloat(split[0]);
    const max = parseFloat(split[1]);
    if (isNaN(min) || isNaN(max)) {
      return null;
    }
    return { type: "numeric", min, max };
  },
  serialize: (value) => `${value.min}~${value.max}`,
});

const parseAsTextFilter = createParser<TextFilter>({
  parse: (value) => {
    const values = value.split("~").filter((v) => v.trim() !== "");
    if (values.length === 0) {
      return null;
    }
    return { type: "text", values: new Set(values) };
  },
  serialize: (value) => Array.from(value.values).sort().join("~"),
});

function makeKeyValueParser(urlKeyToFieldName: Record<string, string>) {
  return createParser<{ key: string; value: string }>({
    parse: (value) => {
      const index = value.indexOf(":");
      if (index === -1) {
        return null;
      }
      const urlKey = value.slice(0, index);
      const val = value.slice(index + 1);
      if (!urlKey || !val) {
        return null;
      }
      const fieldName = urlKeyToFieldName[urlKey] || urlKey;
      return { key: fieldName, value: val };
    },
    serialize: ({ key, value }) => {
      // We invert later by looking up fieldName -> urlKey at serialization site.
      return `${key}:${value}`;
    },
  });
}

function makeFiltersParser(
  fieldNameToFacetType: Record<string, "text" | "array" | "numeric">,
  fieldNameToUrlKey: Record<string, string>,
  urlKeyToFieldName: Record<string, string>,
  numericParser: SingleParser<NumericFilter>,
  textParser: SingleParser<TextFilter>,
) {
  const kvParser = makeKeyValueParser(urlKeyToFieldName);
  return createMultiParser<ActiveFilters>({
    parse: (values) => {
      const keyValue = values.map(kvParser.parse).filter((v) => v !== null);
      const result = Object.fromEntries(
        keyValue.flatMap(({ key, value }) => {
          if (!(key in fieldNameToFacetType)) {
            return [];
          }
          const facetType = fieldNameToFacetType[key];
          const itemParser =
            facetType === "numeric" ? numericParser : textParser;
          const parsedValue: Filter | null = itemParser.parse(value);
          return parsedValue === null ? [] : [[key, parsedValue]];
        }),
      );
      return Object.keys(result).length === 0 ? null : result;
    },
    serialize: (values) => {
      return Object.entries(values)
        .map(([key, value]) => {
          let valueStr: string | null = null;
          if (value.type === "numeric" && numericParser.serialize) {
            valueStr = numericParser.serialize(value);
          } else if (value.type === "text" && textParser.serialize) {
            valueStr = textParser.serialize(value);
          }
          if (valueStr === null) {
            return null;
          }
          const urlKey = fieldNameToUrlKey[key] || key;
          return `${urlKey}:${valueStr}`;
        })
        .filter((v) => v !== null);
    },
    eq(a, b) {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);
      if (aKeys.length === 0 && bKeys.length === 0) {
        return true;
      }
      return a === b;
    },
  });
}

/**
 * Hook to manage search query and facet filters in the URL using `nuqs`.
 *
 * Accepts the runtime list of fields so it can include dynamic per-check facets
 * (which only become known once the manifest has loaded). For initial render
 * before the manifest arrives, pass the static config.fields — extra unknown
 * URL keys will be ignored gracefully and re-parsed once the full field list
 * is supplied.
 */
export function useUrlState<T>(fields: readonly FieldConfig<T, keyof T>[]) {
  const [search, setSearch] = useQueryState("q", parseAsString.withDefault(""));

  const filtersParser = useMemo(() => {
    const fieldNameToFacetType: Record<string, "text" | "array" | "numeric"> =
      {};
    const fieldNameToUrlKey: Record<string, string> = {};
    for (const field of fields) {
      const name = String(field.field);
      if (field.facet) {
        fieldNameToFacetType[name] = field.facet;
      }
      if (field.facetUrlKey) {
        fieldNameToUrlKey[name] = field.facetUrlKey;
      }
    }
    const urlKeyToFieldName = Object.fromEntries(
      Object.entries(fieldNameToUrlKey).map(([f, k]) => [k, f]),
    );
    return makeFiltersParser(
      fieldNameToFacetType,
      fieldNameToUrlKey,
      urlKeyToFieldName,
      parseAsNumericFilter,
      parseAsTextFilter,
    ).withDefault({});
  }, [fields]);

  const [filters, setFilters] = useQueryState("filter", filtersParser);

  return {
    search,
    setSearch,
    filters,
    setFilters,
  };
}

/**
 * Independent URL state for the currently-selected model in the drill-down
 * Drawer. Empty string means "no model selected / drawer closed".
 */
export function useSelectedModel() {
  return useQueryState("model", parseAsString.withDefault(""));
}
