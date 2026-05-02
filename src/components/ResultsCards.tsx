import React from "react";
import {
  Card,
  Group,
  SimpleGrid,
  Stack,
  Table,
  UnstyledButton,
} from "@mantine/core";
import type { ResultsDisplayCommonProps } from "../types.ts";
import { TH_BACKGROUND } from "../constants.ts";
import CheckSummary from "./CheckSummary.tsx";

const ResultsCards: React.FC<ResultsDisplayCommonProps> = ({
  displayModels,
  displayFields,
  manifest,
  onSelectModel,
}) => {
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      {displayModels.map((model) => (
        <Card key={model.id} shadow="sm" padding="lg" radius="md" withBorder>
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <UnstyledButton
                onClick={() => onSelectModel(model.id)}
                style={{ fontWeight: 600, lineHeight: 1.3, textAlign: "left" }}
              >
                {model.title || model.id}
              </UnstyledButton>
              <CheckSummary model={model} checks={manifest.checks} />
            </Group>
          </Stack>
          <Card.Section mt="sm">
            <Table variant="vertical" layout="fixed">
              <Table.Tbody>
                {displayFields.map((field) => (
                  <Table.Tr key={String(field.field)}>
                    <Table.Th w={140} bg={TH_BACKGROUND}>
                      {field.label}
                    </Table.Th>
                    <Table.Td>
                      {field.render(model[field.field], model)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card.Section>
        </Card>
      ))}
    </SimpleGrid>
  );
};

export default ResultsCards;
