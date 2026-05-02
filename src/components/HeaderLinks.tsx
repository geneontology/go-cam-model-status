import React from "react";
import { Anchor } from "@mantine/core";
import { config } from "../config.tsx";

const HeaderLinks: React.FC = () => {
  return config.headerLinks?.map((link) => (
    <Anchor
      key={link.href}
      href={link.href}
      target={link.newTab ? "_blank" : undefined}
      rel={link.newTab ? "noopener noreferrer" : undefined}
      size="sm"
    >
      {link.label}
    </Anchor>
  ));
};

export default HeaderLinks;
