import { useQuery } from "@tanstack/react-query";
import ky, { HTTPError } from "ky";
import { config } from "../config.tsx";
import {
  RAW_DATA_BASE_FALLBACK,
  DEFAULT_DATA_BASE,
} from "../constants.ts";
import type { IndexedModelStatus, Manifest, StatusData } from "../types.ts";

async function fetchJsonWithFallback<T>(
  primaryBase: string,
  path: string,
  query?: string,
): Promise<T> {
  const url = new URL(`${primaryBase}/${path}`, window.location.origin);
  if (query) {
    url.search = query;
  }
  try {
    return await ky(url, { timeout: 30_000 }).json<T>();
  } catch (err) {
    // Only fall back when fetching from the default jsDelivr origin — local
    // dev with VITE_DATA_BASE pointing at /fixture should fail loudly instead
    // of silently hitting raw.githubusercontent.
    if (
      primaryBase === DEFAULT_DATA_BASE &&
      err instanceof HTTPError &&
      err.response.status >= 400 &&
      err.response.status < 500
    ) {
      const fallback = new URL(
        `${RAW_DATA_BASE_FALLBACK}/${path}`,
        window.location.origin,
      );
      if (query) {
        fallback.search = query;
      }
      return await ky(fallback, { timeout: 30_000 }).json<T>();
    }
    throw err;
  }
}

export default function useQueryData() {
  return useQuery<StatusData>({
    queryKey: ["status-data", config.dataBase],
    queryFn: async () => {
      const manifest = await fetchJsonWithFallback<Manifest>(
        config.dataBase,
        "manifest.json",
      );
      const models = await fetchJsonWithFallback<IndexedModelStatus[]>(
        config.dataBase,
        "index.json",
        `v=${manifest.master_sha}`,
      );
      return { manifest, models };
    },
    staleTime: Infinity,
  });
}
