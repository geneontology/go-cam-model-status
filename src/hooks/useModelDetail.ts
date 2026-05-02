import { useQuery } from "@tanstack/react-query";
import ky, { HTTPError } from "ky";
import { config } from "../config.tsx";
import {
  RAW_DATA_BASE_FALLBACK,
  DEFAULT_DATA_BASE,
} from "../constants.ts";
import type { ModelStatusDetail } from "../types.ts";

export default function useModelDetail(id: string, masterSha?: string) {
  return useQuery<ModelStatusDetail>({
    queryKey: ["model-detail", config.dataBase, id, masterSha],
    enabled: !!id,
    queryFn: async () => {
      const path = `models/${id}.json`;
      const query = masterSha ? `v=${masterSha}` : undefined;
      const url = new URL(
        `${config.dataBase}/${path}`,
        window.location.origin,
      );
      if (query) {
        url.search = query;
      }
      try {
        return await ky(url, { timeout: 30_000 }).json<ModelStatusDetail>();
      } catch (err) {
        if (
          config.dataBase === DEFAULT_DATA_BASE &&
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
          return await ky(fallback, { timeout: 30_000 }).json<ModelStatusDetail>();
        }
        throw err;
      }
    },
    staleTime: Infinity,
  });
}
