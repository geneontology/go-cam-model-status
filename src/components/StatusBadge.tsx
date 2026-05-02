import React from "react";
import { Badge, Tooltip, type MantineColor } from "@mantine/core";
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
import type { CheckStatus, Severity } from "../types.ts";
import { isCategorical } from "../types.ts";

interface StatusStyling {
  color: MantineColor;
  Icon: Icon;
  label: string;
}

function styleFor(status: CheckStatus, severity?: Severity): StatusStyling {
  // Categorical (info-severity) checks render with neutral palettes — both
  // "pass" and "fail" are categories, not verdicts, so neither should look
  // alarming. Custom per-state labels are supplied by the caller.
  if (severity && isCategorical({ severity })) {
    switch (status) {
      case "pass":
        return { color: "blue", Icon: CircleIcon, label: "Category A" };
      case "fail":
        return { color: "indigo", Icon: CircleHalfIcon, label: "Category B" };
      case "error":
        return { color: "grape", Icon: WarningCircleIcon, label: "Error" };
      case "skipped":
        return { color: "gray", Icon: MinusCircleIcon, label: "Skipped" };
      case "unknown":
        return { color: "gray", Icon: QuestionIcon, label: "Unknown" };
    }
  }
  switch (status) {
    case "pass":
      return { color: "teal", Icon: CheckCircleIcon, label: "Pass" };
    case "fail":
      if (severity === "warning") {
        return { color: "orange", Icon: WarningCircleIcon, label: "Fail" };
      }
      return { color: "red", Icon: XCircleIcon, label: "Fail" };
    case "error":
      return { color: "grape", Icon: WarningCircleIcon, label: "Error" };
    case "skipped":
      return { color: "gray", Icon: MinusCircleIcon, label: "Skipped" };
    case "unknown":
      return { color: "gray", Icon: QuestionIcon, label: "Unknown" };
  }
}

interface StatusBadgeProps {
  status: CheckStatus;
  severity?: Severity;
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "filled" | "light" | "outline" | "dot";
  tooltip?: string;
  // Override the badge's text. For categorical checks the caller typically
  // passes the matching `pass_label` / `fail_label` from the CheckDefinition.
  text?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  severity,
  size = "sm",
  variant = "light",
  tooltip,
  text,
}) => {
  const { color, Icon, label } = styleFor(status, severity);
  const badge = (
    <Badge
      color={color}
      variant={variant}
      size={size}
      leftSection={<Icon size={14} weight="fill" />}
    >
      {text ?? label}
    </Badge>
  );
  if (tooltip) {
    return <Tooltip label={tooltip}>{badge}</Tooltip>;
  }
  return badge;
};

export default StatusBadge;
