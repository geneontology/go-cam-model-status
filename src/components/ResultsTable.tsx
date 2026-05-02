import React from "react";
import { Table, UnstyledButton } from "@mantine/core";
import type { ResultsDisplayCommonProps } from "../types.ts";
import { HEADER_HEIGHT, TH_BACKGROUND } from "../constants.ts";
import CheckSummary from "./CheckSummary.tsx";

import classes from "./ResultsTable.module.css";

const ResultsTable: React.FC<ResultsDisplayCommonProps> = ({
  displayModels,
  displayFields,
  manifest,
  onSelectModel,
}) => {
  return (
    <Table
      className={classes.resultsTable}
      highlightOnHover
      stickyHeader
      stickyHeaderOffset={HEADER_HEIGHT}
      withTableBorder
    >
      <Table.Thead>
        <Table.Tr>
          <Table.Th bg={TH_BACKGROUND}>Title</Table.Th>
          <Table.Th bg={TH_BACKGROUND}>Checks</Table.Th>
          {displayFields
            .filter((f) => !f.isId && f.field !== "title")
            .map((field) => (
              <Table.Th key={String(field.field)} bg={TH_BACKGROUND}>
                {field.label}
              </Table.Th>
            ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {displayModels.map((model) => (
          <Table.Tr key={model.id}>
            <Table.Td>
              <UnstyledButton
                onClick={() => onSelectModel(model.id)}
                style={{ fontWeight: 500, textAlign: "left" }}
              >
                {model.title || model.id}
              </UnstyledButton>
            </Table.Td>
            <Table.Td>
              <CheckSummary model={model} checks={manifest.checks} />
            </Table.Td>
            {displayFields
              .filter((f) => !f.isId && f.field !== "title")
              .map((field) => (
                <Table.Td key={String(field.field)}>
                  {field.render(model[field.field], model)}
                </Table.Td>
              ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
};

export default ResultsTable;
