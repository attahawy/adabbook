import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../data/", import.meta.url));
const manifest = JSON.parse(await readFile(`${root}manifest.json`, "utf8"));
const pages = await Promise.all(
  manifest.pages.map(async (entry) => {
    const page = JSON.parse(await readFile(`${root}${entry.file}`, "utf8"));
    assert.equal(page.pageid, entry.pageid);
    assert.equal(typeof page.text, "string");
    return { pageid: page.pageid, text: page.text };
  }),
);
const target = `${root}${manifest.searchIndex}`;
await writeFile(
  `${target}.tmp`,
  `${JSON.stringify({ schemaVersion: 1, pages }, null, 2)}\n`,
  "utf8",
);
await rename(`${target}.tmp`, target);
console.log(
  `Indexed ${pages.length} local pages without changing their source files.`,
);
