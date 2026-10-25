import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { load } from "cheerio";
import { createHash } from "node:crypto";
import { prepareBook } from "../src/lib/book.js";
import {
  pageMetadata,
  pageBodyText,
  pageIdFromUrl,
  siteUrl,
} from "../src/lib/site.js";
import { renderPageMarkdown } from "../src/lib/markdown.js";

export async function verifySite({
  root = fileURLToPath(new URL("../", import.meta.url)),
  output = join(
    root,
    process.env.GITHUB_PAGES === "true" ? "dist-pages" : "dist",
  ),
  basePath = "/",
} = {}) {
  const raw = await readFile(join(root, "data/book.json"), "utf8");
  const book = prepareBook(JSON.parse(raw));
  const digest = createHash("sha256").update(raw).digest("hex");
  const knownIds = new Set(book.pages.map((page) => page.pageid));
  const checkedAssets = new Set();
  assert.deepEqual(
    new Set(await readdir(join(output, "pages"))),
    new Set([...knownIds].map(String)),
  );
  const sitemap = load(await readFile(join(output, "sitemap.xml"), "utf8"), {
    xml: true,
  });
  assert.deepEqual(
    sitemap("url > loc")
      .map((_, node) => sitemap(node).text())
      .get(),
    book.pages.map((page) => pageMetadata(page).url),
  );
  for (const page of book.pages) {
    const document = load(
      await readFile(
        join(output, "pages", String(page.pageid), "index.html"),
        "utf8",
      ),
    );
    const expected = pageMetadata(page);
    assert.equal(document("title").text(), expected.title);
    assert.equal(
      document('meta[name="description"]').attr("content"),
      expected.description,
    );
    assert.equal(document('link[rel="canonical"]').length, 1);
    assert.equal(document('link[rel="canonical"]').attr("href"), expected.url);
    assert.equal(document(".chapter-heading h1").text(), page.readingTitle);
    assert.equal(document("#root").attr("data-page-id"), String(page.pageid));
    assert.equal(document("#root").attr("data-book-digest"), digest);
    const content = load(renderPageMarkdown(page, book.pages, basePath));
    assert.equal(document(".book-content").text(), content("body").text());
    const plain = load(document(".book-content").html());
    plain(".footnote-ref, .footnote-backref").remove();
    plain("img").each((_, node) =>
      plain(node).replaceWith(plain(node).attr("alt") ?? ""),
    );
    plain("p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th").append(" ");
    assert.equal(
      plain("body").text().replace(/\s+/g, " ").trim(),
      pageBodyText(page),
      `${page.pageid}: rendered text changed`,
    );
    assert.deepEqual(
      JSON.parse(document("#page-structured-data").text()),
      expected.structuredData,
    );
    assert.equal(document('meta[name="robots"]').attr("content"), undefined);
    assert.equal(document("a.chapter-link[href]").length, book.pages.length);
    assert.equal(document(".chapter-tags").length, page.tags.length ? 1 : 0);
    const anchors = document("[id]")
      .map((_, node) => document(node).attr("id"))
      .get();
    assert.equal(
      anchors.length,
      new Set(anchors).size,
      `${page.pageid}: duplicate HTML anchors`,
    );
    for (const node of document("a[href], script[src], link[href]").toArray()) {
      const href = document(node).attr("href") ?? document(node).attr("src");
      if (href.startsWith("#")) {
        assert.ok(
          anchors.includes(decodeURIComponent(href.slice(1))),
          `${page.pageid}: missing fragment ${href}`,
        );
      } else if (href.startsWith(basePath)) {
        const url = new URL(href, siteUrl);
        if (url.pathname.includes("/pages/"))
          assert.ok(knownIds.has(pageIdFromUrl(url, basePath)));
        else if (!url.search && !url.hash) {
          const relative = url.pathname.slice(basePath.length);
          if (relative && !checkedAssets.has(relative)) {
            await readFile(join(output, relative));
            checkedAssets.add(relative);
          }
        }
      }
    }
  }
  const home = load(await readFile(join(output, "index.html"), "utf8"));
  assert.equal(
    home('link[rel="canonical"]').attr("href"),
    pageMetadata(book.pages[0]).url,
  );
  const missing = load(await readFile(join(output, "404.html"), "utf8"));
  assert.equal(
    missing('meta[name="robots"]').attr("content"),
    "noindex,follow",
  );
  assert.equal(missing('link[rel="canonical"]').length, 0);
  console.log(
    `Verified ${book.pages.length} complete HTML documents, canonical URLs, metadata, JSON-LD, crawlable navigation, assets, anchors and sitemap.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  verifySite().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
