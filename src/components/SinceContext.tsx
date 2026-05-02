import React from "react";
import { Anchor, Text } from "@mantine/core";
import { commitUrl } from "../constants.ts";
import { isCategorical, type CheckResultDetail } from "../types.ts";

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function formatDate(iso: string): string {
  // Tolerates plain YYYY-MM-DD and full ISO timestamps alike.
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    return iso;
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface SinceContextProps {
  check: CheckResultDetail;
}

const SinceContext: React.FC<SinceContextProps> = ({ check }) => {
  // Categorical checks: "fail" isn't a defect, so use category-neutral
  // language ("Categorised since…" rather than "Failing since…").
  const isCat = check.severity ? isCategorical({ severity: check.severity }) : false;

  if (isCat) {
    if (check.since_commit && check.since_date) {
      return (
        <Text size="xs" c="dimmed">
          Category last changed in{" "}
          <Anchor
            size="xs"
            href={commitUrl(check.since_commit)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortSha(check.since_commit)}
          </Anchor>{" "}
          on {formatDate(check.since_date)}.
        </Text>
      );
    }
    return null;
  }

  const isFailing = check.status === "fail" || check.status === "error";
  if (!isFailing) {
    if (check.last_passed_commit && check.last_passed_date) {
      return (
        <Text size="xs" c="dimmed">
          Passing since{" "}
          <Anchor
            size="xs"
            href={commitUrl(check.last_passed_commit)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortSha(check.last_passed_commit)}
          </Anchor>{" "}
          on {formatDate(check.last_passed_date)}.
        </Text>
      );
    }
    return null;
  }

  return (
    <Text size="xs" c="dimmed">
      {check.since_commit && check.since_date ? (
        <>
          Failing since{" "}
          <Anchor
            size="xs"
            href={commitUrl(check.since_commit)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortSha(check.since_commit)}
          </Anchor>{" "}
          on {formatDate(check.since_date)}
        </>
      ) : (
        <>Failing (no transition history yet)</>
      )}
      {check.last_passed_commit && check.last_passed_date && (
        <>
          {" "}
          &mdash; last passed{" "}
          <Anchor
            size="xs"
            href={commitUrl(check.last_passed_commit)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {shortSha(check.last_passed_commit)}
          </Anchor>{" "}
          on {formatDate(check.last_passed_date)}
        </>
      )}
      .
    </Text>
  );
};

export default SinceContext;
