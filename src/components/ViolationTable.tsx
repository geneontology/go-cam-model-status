import React from "react";
import { Code, Table, Text } from "@mantine/core";
import type { CheckDefinition, Violation } from "../types.ts";

interface ViolationTableProps {
  definition: CheckDefinition;
  violations: Violation[];
}

// Strip a known IRI down to its last segment for compact display while keeping
// the full IRI in a tooltip-friendly title attribute on the cell.
function shortenIri(iri: string): string {
  const hashIdx = iri.lastIndexOf("#");
  if (hashIdx >= 0) {
    return iri.slice(hashIdx + 1);
  }
  const slashIdx = iri.lastIndexOf("/");
  if (slashIdx >= 0) {
    return iri.slice(slashIdx + 1) || iri;
  }
  return iri;
}

const TermCell: React.FC<{ term: string }> = ({ term }) => (
  <Code title={term}>{shortenIri(term)}</Code>
);

const ViolationTable: React.FC<ViolationTableProps> = ({
  definition,
  violations,
}) => {
  if (violations.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No violation details recorded.
      </Text>
    );
  }

  // RDF validity rendering: one row per riot diagnostic.
  if (definition.kind === "rdf_valid") {
    return (
      <Table withTableBorder withColumnBorders striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Severity</Table.Th>
            <Table.Th>Line:Col</Table.Th>
            <Table.Th>Message</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {violations.map((v, i) => {
            if (v.kind !== "riot_diagnostic") {
              return null;
            }
            return (
              <Table.Tr key={i}>
                <Table.Td>
                  <Code>{v.severity}</Code>
                </Table.Td>
                <Table.Td>
                  <Code>
                    {v.line}:{v.col}
                  </Code>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{v.message}</Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    );
  }

  // OWL inconsistency rendering: one row per inconsistent individual.
  if (definition.kind === "owl_consistency") {
    return (
      <Table withTableBorder withColumnBorders striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Individual</Table.Th>
            <Table.Th>Inferred types</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {violations.map((v, i) => {
            if (v.kind !== "owl_inconsistent_individual") {
              return null;
            }
            return (
              <Table.Tr key={i}>
                <Table.Td>
                  <TermCell term={v.individual} />
                </Table.Td>
                <Table.Td>
                  {v.types.map((t, ti) => (
                    <span key={ti} style={{ marginRight: 6 }}>
                      <TermCell term={t} />
                    </span>
                  ))}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    );
  }

  // ShEx (gpad_compatibility) rendering: node + shape + reason.
  if (definition.kind === "gpad_compatibility") {
    return (
      <Table withTableBorder withColumnBorders striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Node</Table.Th>
            <Table.Th>Shape</Table.Th>
            <Table.Th>Reason</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {violations.map((v, i) => {
            if (v.kind !== "shex_nonconformant") {
              return null;
            }
            return (
              <Table.Tr key={i}>
                <Table.Td>
                  <TermCell term={v.node} />
                </Table.Td>
                <Table.Td>
                  <TermCell term={v.shape} />
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{v.reason ?? "—"}</Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    );
  }

  // SPARQL: column order from CheckDefinition.columns; falls back to discovered
  // binding keys in insertion order if columns are missing.
  if (definition.kind === "sparql") {
    const columns =
      definition.columns ??
      Array.from(
        new Set(
          violations.flatMap((v) =>
            v.kind === "sparql_row" ? Object.keys(v.bindings) : [],
          ),
        ),
      );
    return (
      <Table withTableBorder withColumnBorders striped>
        <Table.Thead>
          <Table.Tr>
            {columns.map((col) => (
              <Table.Th key={col}>?{col}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {violations.map((v, i) => {
            if (v.kind !== "sparql_row") {
              return null;
            }
            return (
              <Table.Tr key={i}>
                {columns.map((col) => {
                  const value = v.bindings[col];
                  return (
                    <Table.Td key={col}>
                      {value ? <TermCell term={value} /> : "—"}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    );
  }

  return null;
};

export default ViolationTable;
