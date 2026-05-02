import React from "react";
import { Group } from "@mantine/core";
import logoUrl from "../assets/go-logo.svg";
import { config } from "../config.tsx";
import HeaderLinks from "./HeaderLinks.tsx";

import classes from "./Header.module.css";

const Header: React.FC = () => {
  return (
    <>
      <img src={logoUrl} alt="GO Logo" className={classes.logoImage} />
      <div className={classes.title}>{config.title}</div>
      <Group visibleFrom="sm" gap="xl" ml="xl">
        <HeaderLinks />
      </Group>
    </>
  );
};

export default Header;
