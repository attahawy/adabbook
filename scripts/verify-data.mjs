import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { prepareBook } from "../src/lib/book.js";
import { renderMarkdown } from "../src/lib/markdown.js";
import { filterBookPages } from "./lib/book-pages.mjs";

const root = fileURLToPath(new URL("../data/", import.meta.url));
const raw = await readFile(`${root}book.json`, "utf8");
assert.doesNotMatch(raw, /[٠-٩۰-۹]/, "Use 0–9 in the saved JSON");
assert.deepEqual(await readdir(root), ["book.json"], "Keep one book data file");
const book = prepareBook(JSON.parse(raw));
const filtered = filterBookPages(book.pages);
assert.deepEqual(filtered.blankTitles, [], "Remove blank or title-only pages");
assert.deepEqual(filtered.excludedTitles, [], "Remove excluded pages");
const ids = new Set(book.pages.map((page) => page.pageid));
let words = 0;
let links = 0;
let notes = 0;
for (const page of book.pages) {
  // The introduction stays in the reading order without an advice topic.
  assert.ok(
    page.tags.length || page.pageid === 2,
    `${page.title}: add topic tags to advice before publishing`,
  );
  const doc = load(renderMarkdown(page.markdown));
  assert.ok(page.text.trim(), `${page.title}: text is empty`);
  assert.doesNotMatch(
    page.markdown,
    /<!--|mw-parser-output|\[\[(?:Category|File):/i,
  );
  const anchors = doc("[id]")
    .map((_, element) => doc(element).attr("id"))
    .get();
  assert.equal(
    new Set(anchors).size,
    anchors.length,
    `${page.title}: duplicate anchors`,
  );
  for (const element of doc("a[href]").toArray()) {
    const href = doc(element).attr("href");
    if (href.startsWith("#")) {
      assert.ok(
        anchors.includes(decodeURIComponent(href.slice(1))),
        `${page.title}: broken fragment ${href}`,
      );
    } else if (href.startsWith("?page=")) {
      const url = new URL(href, page.sourceUrl);
      const targetId = Number(url.searchParams.get("page"));
      assert.ok(ids.has(targetId), `${page.title}: missing page ${targetId}`);
      if (url.hash) {
        const target = book.pages.find((entry) => entry.pageid === targetId);
        const destination = load(renderMarkdown(target.markdown));
        assert.ok(
          destination("[id]")
            .toArray()
            .some(
              (node) =>
                destination(node).attr("id") ===
                decodeURIComponent(url.hash.slice(1)),
            ),
          `${page.title}: broken destination fragment ${href}`,
        );
      }
      links++;
    }
  }
  notes += doc(".footnote-ref").length;
  words += page.wordCount;
}
console.log(
  `Verified ${book.pages.length} ordered Markdown pages, ${words} words, ${links} internal links, ${notes} footnote references, and heading/footnote fragments in one JSON file.`,
);
