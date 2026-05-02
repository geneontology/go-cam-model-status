import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Charset,
  Document,
  type DocumentData,
  type FieldOptions,
} from "flexsearch";
import type { FieldConfig } from "../types.ts";

interface UseSearchOptions<TData> {
  data?: TData[];
  fields: readonly FieldConfig<TData, keyof TData>[];
  query?: string;
}

interface UseSearchResult<TData> {
  isIndexing: boolean;
  results: TData[];
  search: (query: string) => Promise<void>;
}

// Generic over arbitrary record-like data. flexsearch's `DocumentData` is
// strict about value types, but at runtime it only reads the named index
// fields (which are always strings here), so we erase the constraint and
// cast at the boundary.
export default function useSearch<TData extends Record<string, unknown>>(
  options: UseSearchOptions<TData>,
) {
  const { data, query, fields } = options;
  const [isIndexing, setIsIndexing] = useState<boolean>(false);
  const [results, setResults] = useState<TData[]>([]);

  const idField = useMemo(() => fields.find((f) => f.isId), [fields]);
  const searchFields = useMemo(
    () => fields.filter((f) => f.searchable),
    [fields],
  );

  const index = useMemo(() => {
    if (!idField) {
      throw new Error("No ID field defined for search");
    }
    return new Document<DocumentData>({
      id: String(idField.field),
      store: true,
      index: searchFields.map(
        (f) =>
          ({
            field: String(f.field),
            tokenize: "forward",
            encoder: f.searchFuzzy ? Charset.LatinBalance : Charset.Default,
            context: true,
          }) as FieldOptions<DocumentData>,
      ),
    });
  }, [idField, searchFields]);

  useEffect(() => {
    const reIndex = async () => {
      index.clear();
      setResults(data || []);
      if (!data) {
        return;
      }
      setIsIndexing(true);
      for (const item of data) {
        await index.addAsync(item as unknown as DocumentData);
      }
      setIsIndexing(false);
    };
    void reIndex();
  }, [data, index]);

  const search = useCallback(
    async (query: string) => {
      if (query.trim() === "") {
        setResults(data || []);
        return;
      }
      const searchResults = await index.searchAsync(query, {
        merge: true,
        enrich: true,
        limit: data?.length || 0,
      });
      setResults(
        searchResults.map((result) => result.doc!) as unknown as TData[],
      );
    },
    [data, index],
  );

  useEffect(() => {
    if (isIndexing) {
      return;
    }
    void search(query || "");
  }, [query, data, index, isIndexing, search]);

  return {
    isIndexing: isIndexing,
    results,
    search,
  } as UseSearchResult<TData>;
}
