import React, { useMemo } from "react";
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Divider,
  Drawer,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";
import {
  ArrowSquareOutIcon,
  FileTextIcon,
  FunnelIcon,
  LinkIcon,
} from "@phosphor-icons/react";
import useModelDetail from "../hooks/useModelDetail.ts";
import {
  noctuaEditorUrl,
  producerSourceUrl,
  ttlSourceUrl,
  BUILTIN_CHECK_IDS,
} from "../constants.ts";
import type { CheckDefinition, Manifest } from "../types.ts";
import CheckRow from "./CheckRow.tsx";

interface ModelDetailProps {
  modelId: string;
  manifest: Manifest | undefined;
  onClose: () => void;
}

// Built-in checks first (in fixed order), then SPARQL checks alphabetised by
// name — so the drawer stays predictable as new SPARQL queries get added.
function orderedChecks(checks: CheckDefinition[]): CheckDefinition[] {
  const builtIns: CheckDefinition[] = [];
  for (const id of BUILTIN_CHECK_IDS) {
    const def = checks.find((c) => c.id === id);
    if (def) {
      builtIns.push(def);
    }
  }
  const sparql = checks
    .filter((c) => c.kind === "sparql")
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...builtIns, ...sparql];
}

const ModelDetail: React.FC<ModelDetailProps> = ({
  modelId,
  manifest,
  onClose,
}) => {
  const { data, isPending, isError, error } = useModelDetail(
    modelId,
    manifest?.master_sha,
  );

  const orderedDefs = useMemo(
    () => (manifest ? orderedChecks(manifest.checks) : []),
    [manifest],
  );

  const resultById = useMemo(() => {
    if (!data) {
      return {};
    }
    return Object.fromEntries(data.checks.map((c) => [c.id, c]));
  }, [data]);

  const defaultOpenCheckIds = useMemo(() => {
    if (!data) {
      return [];
    }
    // Auto-open the rows the curator most needs to see: real failures, errors,
    // and unknowns. Categorical "fail" (e.g. GPAD non-compatible) is a label,
    // not a defect, so we don't draw the eye to it.
    return data.checks
      .filter((c) => {
        if (c.severity === "info") {
          return false;
        }
        return (
          c.status === "fail" ||
          c.status === "error" ||
          c.status === "unknown"
        );
      })
      .map((c) => c.id);
  }, [data]);

  const handleCopyPermalink = () => {
    void navigator.clipboard.writeText(window.location.href);
  };

  return (
    <Drawer
      opened={!!modelId}
      onClose={onClose}
      position="right"
      size="xl"
      withOverlay={false}
      title={
        data ? (
          <Stack gap={2}>
            <Text fw={600}>{data.metadata.title || data.id}</Text>
            <Text size="xs" c="dimmed">
              <Code>{data.id}</Code>
            </Text>
          </Stack>
        ) : modelId ? (
          <Code>{modelId}</Code>
        ) : (
          "Model details"
        )
      }
    >
      {isPending && modelId && (
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm">Loading model details&hellip;</Text>
        </Group>
      )}
      {isError && (
        <Alert color="red" title="Could not load model details">
          {error.message}
        </Alert>
      )}
      {data && (
        <Stack gap="md">
          <MetadataSection data={data} />

          {data.filter_reasons && data.filter_reasons.length > 0 ? (
            <FilteredBanner
              reasons={data.filter_reasons}
              manifest={manifest}
            />
          ) : (
            <>
              <Divider label="Checks" labelPosition="left" />
              <Accordion
                multiple
                defaultValue={defaultOpenCheckIds}
                variant="separated"
              >
                {orderedDefs.map((def) => (
                  <CheckRow
                    key={def.id}
                    definition={def}
                    result={resultById[def.id]}
                  />
                ))}
              </Accordion>
            </>
          )}

          <Divider />
          <Group gap="xs" wrap="wrap">
            <Button
              component="a"
              href={ttlSourceUrl(data.id)}
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
              leftSection={<FileTextIcon size={16} />}
            >
              View TTL on GitHub
            </Button>
            <Button
              component="a"
              href={noctuaEditorUrl(data.id)}
              target="_blank"
              rel="noopener noreferrer"
              variant="light"
              leftSection={<ArrowSquareOutIcon size={16} />}
            >
              Open in Noctua
            </Button>
            <Button
              variant="subtle"
              leftSection={<LinkIcon size={16} />}
              onClick={handleCopyPermalink}
            >
              Copy permalink
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            Snapshot from{" "}
            <Code title={data.master_sha}>
              {data.master_sha.slice(0, 7)}
            </Code>{" "}
            generated {new Date(data.generated_at).toLocaleString()}.
          </Text>
        </Stack>
      )}
    </Drawer>
  );
};

const MetadataSection: React.FC<{
  data: NonNullable<ReturnType<typeof useModelDetail>["data"]>;
}> = ({ data }) => {
  const { metadata } = data;
  return (
    <Box>
      <Group gap="xs" mb="xs">
        <Badge variant="outline" color="primary">
          {metadata.modelstate}
        </Badge>
        {metadata.deprecated && (
          <Badge variant="filled" color="gray">
            deprecated
          </Badge>
        )}
        {metadata.taxon_label && (
          <Badge variant="light" color="secondary">
            {metadata.taxon_label}
          </Badge>
        )}
      </Group>
      <Stack gap={2}>
        {metadata.providers.length > 0 && (
          <Text size="sm">
            <Text span c="dimmed">
              Provided by:{" "}
            </Text>
            {metadata.providers.map((p, i) => (
              <span key={p.iri}>
                {i > 0 && ", "}
                <Anchor
                  href={p.iri}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                >
                  {p.label ?? p.iri}
                </Anchor>
              </span>
            ))}
          </Text>
        )}
        {metadata.contributors.length > 0 && (
          <Text size="sm">
            <Text span c="dimmed">
              Contributors:{" "}
            </Text>
            {metadata.contributors.map((c, i) => (
              <span key={c.orcid}>
                {i > 0 && ", "}
                <Anchor
                  href={c.orcid}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                >
                  {c.name ?? c.orcid}
                </Anchor>
              </span>
            ))}
          </Text>
        )}
        {metadata.date && (
          <Text size="sm">
            <Text span c="dimmed">
              Modified:{" "}
            </Text>
            {metadata.date}
          </Text>
        )}
        {metadata.comment && (
          <Text size="sm">
            <Text span c="dimmed">
              Comment:{" "}
            </Text>
            {metadata.comment}
          </Text>
        )}
      </Stack>
    </Box>
  );
};

const FilteredBanner: React.FC<{
  reasons: string[];
  manifest: Manifest | undefined;
}> = ({ reasons, manifest }) => {
  const filterById = useMemo(() => {
    return Object.fromEntries(
      (manifest?.filters ?? []).map((f) => [f.id, f]),
    );
  }, [manifest]);
  return (
    <Alert
      color="gray"
      variant="light"
      icon={<FunnelIcon size={18} />}
      title="Excluded from validation"
    >
      <Stack gap="xs">
        <Text size="sm">
          This model matched {reasons.length === 1 ? "the" : ""} exclusion
          filter{reasons.length === 1 ? "" : "s"}{" "}
          {reasons.map((r, i) => {
            const def = filterById[r];
            return (
              <span key={r}>
                {i > 0 && ", "}
                {def?.source_path ? (
                  <Anchor
                    href={producerSourceUrl(def.source_path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                  >
                    <Code>{r}</Code>
                  </Anchor>
                ) : (
                  <Code>{r}</Code>
                )}
              </span>
            );
          })}
          , so no checks were run on it.
        </Text>
        <Text size="xs" c="dimmed">
          Filters are SPARQL ASK queries under <Code>sparql/filters/</Code>{" "}
          in this dashboard's repo. Models that match are still indexed
          (so curators can confirm what's been suppressed) but are not
          validated.
        </Text>
      </Stack>
    </Alert>
  );
};

export default ModelDetail;
