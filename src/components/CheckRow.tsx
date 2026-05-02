import React from "react";
import { Accordion, Alert, Group, Stack, Text, Tooltip } from "@mantine/core";
import { InfoIcon } from "@phosphor-icons/react";
import StatusBadge from "./StatusBadge.tsx";
import SinceContext from "./SinceContext.tsx";
import ViolationTable from "./ViolationTable.tsx";
import {
  isCategorical,
  type CheckDefinition,
  type CheckResultDetail,
  type CheckStatus,
} from "../types.ts";

interface CheckRowProps {
  definition: CheckDefinition;
  result?: CheckResultDetail;
}

function badgeText(
  def: CheckDefinition,
  status: CheckStatus,
): string | undefined {
  if (!isCategorical(def)) {
    return undefined;
  }
  if (status === "pass") {
    return def.pass_label;
  }
  if (status === "fail") {
    return def.fail_label;
  }
  if (status === "unknown") {
    return def.unknown_label;
  }
  return undefined;
}

const CheckRow: React.FC<CheckRowProps> = ({ definition, result }) => {
  const status = result?.status ?? "skipped";
  const isCat = isCategorical(definition);
  return (
    <Accordion.Item value={definition.id}>
      <Accordion.Control>
        <Group gap="sm" wrap="nowrap">
          <StatusBadge
            status={status}
            severity={definition.severity}
            text={badgeText(definition, status)}
          />
          <Text fw={500}>{definition.name}</Text>
          {definition.description && (
            <Tooltip
              label={definition.description}
              multiline
              w={320}
              withArrow
            >
              <InfoIcon size={16} />
            </Tooltip>
          )}
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="xs">
          {result ? (
            <>
              <SinceContext check={result} />
              {result.status === "error" && result.error_message && (
                <Alert color="grape" variant="light">
                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                    {result.error_message}
                  </Text>
                </Alert>
              )}
              {result.status === "unknown" && (
                <Alert color="gray" variant="light">
                  <Text size="sm">
                    {result.error_message ??
                      "No result recorded yet for this check on this model."}
                  </Text>
                </Alert>
              )}
              {/* Categorical checks: show the prose detail (per-shape ShEx
                  hits, etc.) only as supplementary context — neither state
                  is a defect, so the framing matters. */}
              {isCat && result.status === "fail" && result.violations.length > 0 && (
                <Text size="sm" c="dimmed">
                  Shapes that did not match (this is informational, not a
                  defect):
                </Text>
              )}
              {(result.status === "fail" || result.status === "error") &&
                result.violations.length > 0 && (
                  <ViolationTable
                    definition={definition}
                    violations={result.violations}
                  />
                )}
              {!isCat && result.status === "pass" && (
                <Text size="sm" c="dimmed">
                  No issues detected.
                </Text>
              )}
              {isCat && result.status === "pass" && (
                <Text size="sm" c="dimmed">
                  Model fits this category cleanly.
                </Text>
              )}
            </>
          ) : (
            <Text size="sm" c="dimmed">
              No result recorded for this check.
            </Text>
          )}
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
};

export default CheckRow;
