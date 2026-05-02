import type { FieldConfig } from "../types.ts";
import { useMemo, useCallback } from "react";

export interface TextFacet {
  type: "text" | "array";
  values: Record<string, number>;
}
export interface NumericFacet {
  type: "numeric";
  values: [number, number];
}

export type FacetCounts = TextFacet | NumericFacet;

export interface Facets {
  [field: string]: FacetCounts;
}

// Active filter variants
export interface TextFilter {
  type: "text";
  values: Set<string>;
}
export interface NumericFilter {
  type: "numeric";
  min: number | null;
  max: number | null;
}
export type Filter = TextFilter | NumericFilter;
export interface ActiveFilters {
  [field: string]: Filter;
}

function extractFacetValues(
  value: unknown,
  facetType: FieldConfig<unknown>["facet"],
): string[] {
  if (value == null) {
    return [];
  }
  switch (facetType) {
    case "array":
      return Array.isArray(value)
        ? [...new Set(value as unknown[])].map((v) => String(v))
        : [];
    case "text":
      return typeof value === "boolean"
        ? [String(value)]
        : typeof value === "string"
          ? [value]
          : [];
    case "numeric":
      return typeof value === "number" ? [String(value)] : [];
    default:
      return [];
  }
}

// Helper function to apply text filters to data
function applyTextFilters<TData>(
  data: TData[],
  textFilters: [string, TextFilter][],
  facetFieldMap: Record<string, FieldConfig<TData, keyof TData>>,
  excludeField?: string,
): number[] {
  let filteredIndexes = data.map((_, idx) => idx);

  for (const [filterField, filter] of textFilters) {
    if (excludeField && filterField === excludeField) {
      continue; // Skip excluded field
    }

    const fieldCfg = facetFieldMap[filterField];
    if (!fieldCfg) {
      continue;
    }

    filteredIndexes = filteredIndexes.filter((idx) => {
      const item = data[idx];
      const rawValue = item[fieldCfg.field];
      const values = extractFacetValues(rawValue, fieldCfg.facet);

      if (fieldCfg.facet === "array") {
        return Array.from(filter.values).every((v) => values.includes(v));
      } else if (fieldCfg.facet === "text") {
        const selected = filter.values.values().next().value as string;
        return values.length === 1 && values[0] === selected;
      }
      return true;
    });
  }

  return filteredIndexes;
}

// Helper function to apply numeric filters to data
function applyNumericFilters<TData>(
  data: TData[],
  filteredIndexes: number[],
  numericFilters: [string, NumericFilter][],
  facetFieldMap: Record<string, FieldConfig<TData, keyof TData>>,
  excludeField?: string,
): number[] {
  let result = [...filteredIndexes];

  for (const [filterField, filter] of numericFilters) {
    if (excludeField && filterField === excludeField) {
      continue; // Skip excluded field
    }

    const fieldCfg = facetFieldMap[filterField];
    if (!fieldCfg) {
      continue;
    }

    result = result.filter((idx) => {
      const item = data[idx];
      const rawValue = item[fieldCfg.field];
      if (typeof rawValue !== "number") {
        return false;
      }
      if (filter.min != null && rawValue < filter.min) {
        return false;
      }
      if (filter.max != null && rawValue > filter.max) {
        return false;
      }
      return true;
    });
  }

  return result;
}

interface UseFaceterOptions<TData> {
  data: TData[];
  fields: readonly FieldConfig<TData, keyof TData>[];
  activeFilters: ActiveFilters;
  setActiveFilters: (
    filters: ActiveFilters | ((prev: ActiveFilters) => ActiveFilters),
  ) => Promise<unknown>;
}

export interface UseFaceterResult {
  facets: Facets;
  activeFilters: ActiveFilters;
  matchingIndexes: number[];
  toggleFacet: (field: string, value: string) => void;
  setNumericRange: (
    field: string,
    min: number | null,
    max: number | null,
  ) => void;
  clearNumericRange: (field: string) => void;
  clearFacet: (field: string) => void;
  clearAllFacets: () => void;
}

export default function useFacets<TData>(
  options: UseFaceterOptions<TData>,
): UseFaceterResult {
  const { data, fields, activeFilters, setActiveFilters } = options;

  const facetFields = useMemo(() => fields.filter((f) => f.facet), [fields]);
  const facetFieldMap = useMemo(() => {
    const map: Record<string, FieldConfig<TData, keyof TData>> = {};
    for (const f of facetFields) {
      map[f.field as string] = f;
    }
    return map;
  }, [facetFields]);

  const textFilters = useMemo(
    () =>
      Object.entries(activeFilters).filter(
        ([, filter]) => filter.type === "text" && filter.values.size > 0,
      ) as [string, TextFilter][],
    [activeFilters],
  );
  const numericFilters = useMemo(
    () =>
      Object.entries(activeFilters).filter(
        ([, filter]) =>
          filter.type === "numeric" && filter.min != null && filter.max != null,
      ) as [string, NumericFilter][],
    [activeFilters],
  );

  const textFacets: Record<string, TextFacet> = useMemo(() => {
    const _textFacets: Record<string, TextFacet> = {};

    for (const facetField of facetFields) {
      if (facetField.facet !== "text" && facetField.facet !== "array") {
        continue;
      }

      const key = facetField.field as string;

      let filteredIndexes = applyTextFilters(data, textFilters, facetFieldMap);
      filteredIndexes = applyNumericFilters(
        data,
        filteredIndexes,
        numericFilters,
        facetFieldMap,
      );

      _textFacets[key] = { type: facetField.facet, values: {} };
      for (const idx of filteredIndexes) {
        const item = data[idx];
        const rawValue = item[facetField.field];
        if (rawValue == null) {
          continue;
        }

        const vals = extractFacetValues(rawValue, facetField.facet);
        for (const v of vals) {
          _textFacets[key].values[v] = (_textFacets[key].values[v] ?? 0) + 1;
        }
      }
    }

    return _textFacets;
  }, [data, facetFields, textFilters, numericFilters, facetFieldMap]);

  const numericFacets: Record<string, NumericFacet> = useMemo(() => {
    const _numericFacets: Record<string, NumericFacet> = {};

    for (const facetField of facetFields) {
      if (facetField.facet !== "numeric") {
        continue;
      }

      const key = facetField.field as string;

      let filteredIndexes = applyTextFilters(data, textFilters, facetFieldMap);
      filteredIndexes = applyNumericFilters(
        data,
        filteredIndexes,
        numericFilters,
        facetFieldMap,
        key,
      );

      for (const idx of filteredIndexes) {
        const item = data[idx];
        const rawValue = item[facetField.field];
        if (typeof rawValue !== "number") {
          continue;
        }

        if (!(key in _numericFacets)) {
          _numericFacets[key] = {
            type: "numeric",
            values: [rawValue, rawValue],
          };
        } else {
          const [min, max] = _numericFacets[key].values;
          if (rawValue < min) {
            _numericFacets[key].values[0] = rawValue;
          }
          if (rawValue > max) {
            _numericFacets[key].values[1] = rawValue;
          }
        }
      }
    }

    return _numericFacets;
  }, [data, facetFields, textFilters, numericFilters, facetFieldMap]);

  const facets: Facets = useMemo(() => {
    return { ...textFacets, ...numericFacets };
  }, [textFacets, numericFacets]);

  const matchingIndexes = useMemo<number[]>(() => {
    const filteredIndexes = applyTextFilters(data, textFilters, facetFieldMap);
    return applyNumericFilters(
      data,
      filteredIndexes,
      numericFilters,
      facetFieldMap,
    );
  }, [data, textFilters, numericFilters, facetFieldMap]);

  const toggleFacet = useCallback(
    (field: string, value: string) => {
      void setActiveFilters((prev) => {
        const fieldFilter = prev[field];
        const fieldFacet = facetFieldMap[field]?.facet;
        const next: ActiveFilters = { ...prev };

        if (fieldFacet === "numeric") {
          const num = Number(value);
          if (!Number.isFinite(num)) {
            return prev;
          }
          if (
            fieldFilter &&
            fieldFilter.type === "numeric" &&
            fieldFilter.min === num &&
            fieldFilter.max === num
          ) {
            delete next[field];
          } else {
            next[field] = { type: "numeric", min: num, max: num };
          }
          return next;
        }

        if (fieldFacet === "text") {
          if (
            fieldFilter &&
            fieldFilter.type === "text" &&
            fieldFilter.values.has(value)
          ) {
            delete next[field];
          } else {
            next[field] = { type: "text", values: new Set([value]) };
          }
        } else if (fieldFacet === "array") {
          let set: Set<string>;
          if (fieldFilter && fieldFilter.type === "text") {
            set = new Set(fieldFilter.values);
          } else {
            set = new Set<string>();
          }
          if (set.has(value)) {
            set.delete(value);
          } else {
            set.add(value);
          }
          if (set.size === 0) {
            delete next[field];
          } else {
            next[field] = { type: "text", values: set };
          }
        }
        return next;
      });
    },
    [facetFieldMap, setActiveFilters],
  );

  const setNumericRange = useCallback(
    (field: string, min: number | null, max: number | null) => {
      void setActiveFilters((prev) => {
        const fieldFacet = facetFieldMap[field]?.facet;
        if (fieldFacet !== "numeric") {
          return prev;
        }
        let a = min;
        let b = max;
        if (a != null && b != null && a > b) {
          const tmp = a;
          a = b;
          b = tmp;
        }
        const next: ActiveFilters = { ...prev };
        if (a == null && b == null) {
          delete next[field];
        } else {
          next[field] = { type: "numeric", min: a, max: b };
        }
        return next;
      });
    },
    [facetFieldMap, setActiveFilters],
  );

  const clearNumericRange = useCallback(
    (field: string) => {
      void setActiveFilters((prev) => {
        if (!prev[field]) {
          return prev;
        }
        const fieldFacet = facetFieldMap[field]?.facet;
        if (fieldFacet !== "numeric") {
          return prev;
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [facetFieldMap, setActiveFilters],
  );

  const clearFacet = useCallback(
    (field: string) => {
      void setActiveFilters((prev) => {
        if (!(field in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    [setActiveFilters],
  );

  const clearAllFacets = useCallback(() => {
    void setActiveFilters({});
  }, [setActiveFilters]);

  return {
    facets,
    activeFilters,
    matchingIndexes,
    toggleFacet,
    setNumericRange,
    clearNumericRange,
    clearFacet,
    clearAllFacets,
  };
}
