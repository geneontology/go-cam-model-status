import { Anchor, type AnchorProps, type ElementProps } from "@mantine/core";

interface ExternalLinkProps
  extends AnchorProps,
    ElementProps<"a", keyof AnchorProps> {}

const ExternalLink = (props: ExternalLinkProps) => {
  return (
    <Anchor
      {...props}
      component="a"
      target="_blank"
      rel="noreferrer noopener"
      inherit
    />
  );
};

export default ExternalLink;
