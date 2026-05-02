import React, { useMemo, useState } from "react";
import {
  type FieldConfig,
  type IndexedModelStatus,
  type ResultsDisplayProps,
  ResultsDisplayType,
} from "../types.ts";
import { Box, Button } from "@mantine/core";
import ResultsCards from "./ResultsCards.tsx";
import ResultsTable from "./ResultsTable.tsx";
import { RESULTS_PAGE_SIZE } from "../constants.ts";
import useUserSettings from "../hooks/useUserSettings.ts";

interface ResultsDisplayWithFieldsProps extends ResultsDisplayProps {
  // The full extended fields list (static + per-check facets) — passed in from
  // App.tsx so the cards/table can render dynamic fields without re-deriving.
  fields: readonly FieldConfig<IndexedModelStatus, keyof IndexedModelStatus>[];
}

const ResultsDisplay: React.FC<ResultsDisplayWithFieldsProps> = ({
  data,
  displayIndexes,
  manifest,
  onSelectModel,
  fields,
}) => {
  const [limit, setLimit] = useState(RESULTS_PAGE_SIZE);
  const visibleFields = useUserSettings((state) => state.visibleFields);
  const resultsDisplayType = useUserSettings(
    (state) => state.resultsDisplayType,
  );
  const displayModels = useMemo(() => {
    return displayIndexes.slice(0, limit).map((index) => data[index]);
  }, [data, displayIndexes, limit]);
  const displayFields = useMemo(() => {
    return fields.filter((field) =>
      visibleFields.includes(String(field.field)),
    );
  }, [visibleFields, fields]);
  return (
    <>
      {displayIndexes.length > 0 && (
        <Box mb="lg">
          {resultsDisplayType === ResultsDisplayType.CARDS && (
            <ResultsCards
              displayFields={displayFields}
              displayModels={displayModels}
              manifest={manifest}
              onSelectModel={onSelectModel}
            />
          )}
          {resultsDisplayType === ResultsDisplayType.TABLE && (
            <ResultsTable
              displayFields={displayFields}
              displayModels={displayModels}
              manifest={manifest}
              onSelectModel={onSelectModel}
            />
          )}
        </Box>
      )}
      {limit < displayIndexes.length && (
        <Button
          fullWidth
          onClick={() => setLimit((prev) => prev + RESULTS_PAGE_SIZE)}
        >
          Load more...
        </Button>
      )}
    </>
  );
};

export default ResultsDisplay;
