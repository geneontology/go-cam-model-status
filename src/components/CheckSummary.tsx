import React from "react";
import { Group, Tooltip, Box } from "@mantine/core";
import {
  CheckCircleIcon,
  XCircleIcon,
  WarningCircleIcon,
  MinusCircleIcon,
  QuestionIcon,
  CircleIcon,
  CircleHalfIcon,
  type Icon,
} from "@phosphor-icons/react";
import {
  isCategorical,
  type CheckDefinition,
  type CheckStatus,
  type IndexedModelStatus,
  type Severity,
} from "../types.ts";

interface CheckSummaryProps {
  model: IndexedModelStatus;
  checks: readonly CheckDefinition[];
}

function pickIcon(
  status: CheckStatus,
  severity: Severity,
): { Icon: Icon; color: string } {
  // Categorical (info-severity) checks render as neutral category markers —
  // both states use the same blue family so neither looks like a defect.
  if (isCategorical({ severity })) {
    switch (status) {
      case "pass":
        return { Icon: CircleIcon, color: "var(--mantine-color-blue-6)" };
      case "fail":
        return { Icon: CircleHalfIcon, color: "var(--mantine-color-indigo-6)" };
      case "error":
        return {
          Icon: WarningCircleIcon,
          color: "var(--mantine-color-grape-6)",
        };
      case "skipped":
        return { Icon: MinusCircleIcon, color: "var(--mantine-color-gray-5)" };
      case "unknown":
        return { Icon: QuestionIcon, color: "var(--mantine-color-gray-6)" };
    }
  }
  switch (status) {
    case "pass":
      return { Icon: CheckCircleIcon, color: "var(--mantine-color-teal-6)" };
    case "fail":
      if (severity === "warning") {
        return {
          Icon: WarningCircleIcon,
          color: "var(--mantine-color-orange-6)",
        };
      }
      return { Icon: XCircleIcon, color: "var(--mantine-color-red-6)" };
    case "error":
      return { Icon: WarningCircleIcon, color: "var(--mantine-color-grape-6)" };
    case "skipped":
      return { Icon: MinusCircleIcon, color: "var(--mantine-color-gray-5)" };
    case "unknown":
      return { Icon: QuestionIcon, color: "var(--mantine-color-gray-6)" };
  }
}

function tooltipFor(def: CheckDefinition, status: CheckStatus): string {
  if (isCategorical(def)) {
    const label =
      status === "pass"
        ? def.pass_label
        : status === "fail"
          ? def.fail_label
          : status === "unknown"
            ? def.unknown_label
            : undefined;
    if (label) {
      return `${def.name}: ${label}`;
    }
  }
  return `${def.name}: ${status}`;
}

const CheckSummary: React.FC<CheckSummaryProps> = ({ model, checks }) => {
  return (
    <Group gap={4} wrap="nowrap">
      {checks.map((def) => {
        const status: CheckStatus = model.checks[def.id] ?? "skipped";
        const { Icon, color } = pickIcon(status, def.severity);
        return (
          <Tooltip
            key={def.id}
            label={tooltipFor(def, status)}
            withArrow
            openDelay={200}
          >
            <Box style={{ color, display: "flex", alignItems: "center" }}>
              <Icon size={18} weight="fill" />
            </Box>
          </Tooltip>
        );
      })}
    </Group>
  );
};

export default CheckSummary;
