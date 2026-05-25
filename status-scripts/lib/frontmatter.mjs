// Parse leading "#+ key: value" lines from a SPARQL .rq file.
// Frontmatter ends at the first non-frontmatter line (anything that is not
// blank, not a #+ line, and not a non-#+ comment line; we tolerate other
// comment lines mixed in).
import { readFile } from "node:fs/promises";

export async function parseFrontmatter(path) {
  const text = await readFile(path, "utf8");
  const meta = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith("#+")) {
      const body = line.slice(2).trim();
      const colon = body.indexOf(":");
      if (colon < 0) {
        continue;
      }
      const key = body.slice(0, colon).trim();
      const value = body.slice(colon + 1).trim();
      if (key) {
        meta[key] = value;
      }
      continue;
    }
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    break;
  }
  return meta;
}
