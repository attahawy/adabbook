import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const root = fileURLToPath(new URL("../data/", import.meta.url));
const manifest = JSON.parse(await readFile(`${root}manifest.json`, "utf8"));
const assertLatinDigits = (value, label) =>
  assert.doesNotMatch(
    JSON.stringify(value),
    /[٠-٩۰-۹]/,
    `${label}: use 0–9 in the saved JSON`,
  );
assertLatinDigits(manifest, "Manifest");
assert.equal(manifest.searchIndex, "search-index.json");
const searchIndex = JSON.parse(
  await readFile(`${root}${manifest.searchIndex}`, "utf8"),
);
assertLatinDigits(searchIndex, "Search index");
assert.equal(searchIndex.pages.length, manifest.totalPages);
const searchById = new Map(
  searchIndex.pages.map((entry) => [entry.pageid, entry.text]),
);
assert.equal(
  searchById.size,
  manifest.totalPages,
  "Duplicate search-index page IDs",
);
assert.equal(
  manifest.totalPages,
  manifest.pages.length,
  "Manifest count differs from page count",
);
assert.equal(
  new Set(manifest.pages.map((page) => page.pageid)).size,
  manifest.totalPages,
  "Duplicate page IDs",
);
assert.equal(
  new Set(manifest.readingOrder).size,
  manifest.totalPages,
  "Incomplete reading order",
);
const ids = new Set(manifest.pages.map((page) => page.pageid));
for (const id of manifest.readingOrder)
  assert.ok(ids.has(id), `Reading-order page ${id} is missing`);
let wordCount = 0;
let internalLinks = 0;
let imageCount = 0;
for (const entry of manifest.pages) {
  const page = JSON.parse(await readFile(`${root}${entry.file}`, "utf8"));
  assertLatinDigits(page, entry.file);
  assert.equal(page.schemaVersion, 1);
  assert.equal(page.pageid, entry.pageid);
  assert.equal(page.title, entry.title);
  assert.equal(
    searchById.get(entry.pageid),
    page.text,
    `${entry.title}: incomplete search text`,
  );
  for (const field of ["searchText", "excerpt", "html", "text", "wikitext"])
    assert.ok(
      !(field in entry),
      `${entry.title}: content must not be embedded in the manifest`,
    );
  assert.equal(page.revisionId, entry.revisionId);
  assert.ok(page.html.trim(), `${entry.title}: HTML is empty`);
  assert.equal(typeof page.wikitext, "string");
  assert.ok(page.text.trim(), `${entry.title}: text is empty`);
  assert.ok(
    page.sourceUrl.startsWith("https://attahawy.com/books/wiki/lifebook/"),
  );
  assert.equal(page.namespace, 0);
  const doc = load(page.html);
  const firstHeading = doc("h1,h2,h3,h4,h5,h6")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  assert.equal(
    entry.readingTitle,
    firstHeading || page.title,
    `${entry.title}: displayed title must use the first content heading`,
  );
  assert.equal(
    doc(".mw-parser-output").length,
    1,
    `${entry.title}: not parser HTML`,
  );
  internalLinks += page.links.filter(
    (link) => link.ns === 0 && link.exists,
  ).length;
  imageCount += page.images.length;
  wordCount += entry.wordCount;
}
console.log(
  `Verified ${manifest.totalPages} UTF-8 JSON pages, ${wordCount} words, ${internalLinks} internal links, ${imageCount} images, complete reading order, and the separate search index.`,
);
