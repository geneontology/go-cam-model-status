import React from "react";
import { ActionIcon, Checkbox, Group, Menu, Radio } from "@mantine/core";
import { GearIcon } from "@phosphor-icons/react";
import {
  type FieldConfig,
  type IndexedModelStatus,
  ResultsDisplayType,
} from "../types.ts";
import useUserSettings from "../hooks/useUserSettings.ts";

import classes from "./UserSettingsMenu.module.css";

interface UserSettingsMenuProps {
  fields: readonly FieldConfig<IndexedModelStatus, keyof IndexedModelStatus>[];
}

const UserSettingsMenu: React.FC<UserSettingsMenuProps> = ({ fields }) => {
  const visibleFields = useUserSettings((state) => state.visibleFields);
  const toggleField = useUserSettings((state) => state.toggleField);
  const resultsDisplayType = useUserSettings(
    (state) => state.resultsDisplayType,
  );
  const setResultsDisplayType = useUserSettings(
    (state) => state.setResultsDisplayType,
  );

  return (
    <Menu shadow="md" position="bottom-end" closeOnItemClick={false}>
      <Menu.Target>
        <ActionIcon variant="light" size="input-lg">
          <GearIcon size="70%" />
        </ActionIcon>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>Visible Fields</Menu.Label>
        {fields.map((field) => (
          <Checkbox.Card
            key={String(field.field)}
            withBorder={false}
            checked={visibleFields.includes(String(field.field))}
            onChange={() => toggleField(String(field.field))}
          >
            <Group
              className={classes.menuInput}
              wrap="nowrap"
              align="center"
              gap="sm"
            >
              <Checkbox.Indicator />
              {field.label}
            </Group>
          </Checkbox.Card>
        ))}
        <Menu.Divider />
        <Menu.Label>Results Display</Menu.Label>
        <Radio.Group
          value={resultsDisplayType}
          onChange={(value) =>
            setResultsDisplayType(value as ResultsDisplayType)
          }
        >
          {Object.values(ResultsDisplayType).map((type) => (
            <Radio.Card key={type} withBorder={false} value={type}>
              <Group
                className={classes.menuInput}
                wrap="nowrap"
                align="center"
                gap="sm"
              >
                <Radio.Indicator />
                {type}
              </Group>
            </Radio.Card>
          ))}
        </Radio.Group>
      </Menu.Dropdown>
    </Menu>
  );
};

export default UserSettingsMenu;
