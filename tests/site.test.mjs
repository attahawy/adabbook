import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "cheerio";
import { prepareBook } from "../src/lib/book.js";
import { renderPageMarkdown } from "../src/lib/markdown.js";
import {
  pagePath,
  pageIdFromUrl,
  pageMetadata,
  canonicalPageUrl,
  serializeStructuredData,
} from "../src/lib/site.js";
import { generatePages } from "../scripts/generate-pages.mjs";
import { verifySite } from "../scripts/verify-site.mjs";

const fixture = () => ({
  schemaVersion: 2,
  sourceUrl: "https://example.org/wiki/index.php?title=All_pages",
  fetchedAt: "2026-10-20T00:00:00Z",
  pages: [
    {
      pageid: 10,
      title: "مقدمة",
      revisionId: 1,
      tags: [],
      markdown: "# مقدمة\n\nنص المقدمة [جزء](?page=11#جزء).",
    },
    {
      pageid: 11,
      title: "اسم المصدر",
      revisionId: 1,
      tags: ["أدب الكلام"],
      markdown:
        "# عنوان القراءة\n\nنص **مهم** وآمن.\n\n## جزء\n\nتفصيل آخر[^1].\n\n[^1]: مرجع.",
    },
  ],
});

test("stable numbered URLs support deployment prefixes, legacy shares and fragments", () => {
  assert.equal(pagePath(629, "/adabbook/"), "/adabbook/pages/629/");
  assert.equal(pagePath(629), "/pages/629/");
  for (const path of [
    "/adabbook/pages/629/",
    "/adabbook/pages/629/index.html",
    "/adabbook/?page=629#جزء",
  ])
    assert.equal(
      pageIdFromUrl(`https://example.org${path}`, "/adabbook/"),
      629,
    );
  for (const path of [
    "/adabbook/pages/629index.html",
    "/adabbook/pages/0/",
    "/other/pages/629/",
    "/adabbook/?page=NaN",
    "/adabbook/?page=-1",
  ])
    assert.equal(
      pageIdFromUrl(`https://example.org${path}`, "/adabbook/"),
      null,
    );
  assert.throws(() => pagePath(-1));
  assert.throws(() => canonicalPageUrl(0));
});

test("metadata uses the reading title and real text, keeping IDs stable when headings change", () => {
  const book = prepareBook(fixture());
  const page = book.pages[1];
  const metadata = pageMetadata(page);
  assert.match(metadata.title, /^عنوان القراءة \| أدب الرجل/);
  assert.ok(!metadata.description.includes("عنوان القراءة"));
  assert.equal(metadata.structuredData["@graph"][1].headline, "عنوان القراءة");
  assert.deepEqual(metadata.structuredData["@graph"][1].keywords, [
    "أدب الكلام",
  ]);
  assert.equal(
    pageMetadata({ ...page, readingTitle: "عنوان جديد" }).url,
    metadata.url,
  );
  const long = pageMetadata({ ...page, text: "نص طويل ".repeat(80) });
  assert.ok(long.description.length <= 160);
  const serialized = serializeStructuredData({
    text: "</script><script>alert(1)</script>",
  });
  assert.ok(!serialized.includes("<"));
  assert.equal(
    JSON.parse(serialized).text,
    "</script><script>alert(1)</script>",
  );
});

test("shared reader markup preserves anchors and notes, resolves links and keeps unsafe Markdown inert", () => {
  const raw = fixture();
  raw.pages[0].markdown +=
    "\n\n![صورة](image.png)\n\n[خارجي](https://example.net/)\n\n<script>alert(1)</script>\n\n[خطر](javascript:alert(1))";
  const book = prepareBook(raw);
  const doc = load(renderPageMarkdown(book.pages[0], book.pages, "/adabbook/"));
  assert.equal(doc("h1").length, 0);
  assert.ok(
    doc("[id]")
      .toArray()
      .some((node) => doc(node).attr("id") === "مقدمة"),
  );
  assert.equal(
    doc('a[data-page-id="11"]').attr("href"),
    `/adabbook/pages/11/#${encodeURIComponent("جزء")}`,
  );
  assert.equal(
    doc('a[href="https://example.net/"]').attr("rel"),
    "noopener noreferrer",
  );
  assert.equal(doc("img").attr("src"), "https://example.org/wiki/image.png");
  assert.equal(doc("img").attr("loading"), "lazy");
  assert.equal(doc('script, a[href^="javascript:"]').length, 0);
  const notes = load(renderPageMarkdown(book.pages[1], book.pages));
  assert.equal(notes(".footnote-ref").length, 1);
  assert.equal(notes(".footnote-item").length, 1);
});

test("generation follows edits and removals from the source, with complete prefixed HTML and a current sitemap", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "adabbook-static-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "dist/assets"), { recursive: true });
  const source = join(root, "data/book.json");
  const raw = fixture();
  await writeFile(source, JSON.stringify(raw));
  await writeFile(join(root, "dist/assets/app.js"), "// fixture");
  await writeFile(
    join(root, "dist/index.html"),
    '<!doctype html><html lang="ar" dir="rtl"><head><title>الكتاب</title><meta name="description" content="الكتاب"></head><body><div id="root"></div><script type="module" src="/adabbook/assets/app.js"></script></body></html>',
  );
  const options = { root, basePath: "/adabbook/" };
  await generatePages(options);
  await verifySite(options);
  const first = load(
    await readFile(join(root, "dist/pages/11/index.html"), "utf8"),
  );
  assert.equal(first(".book-content p").first().text(), "نص مهم وآمن.");
  assert.equal(first('a.chapter-link[href="/adabbook/pages/10/"]').length, 1);
  raw.pages = [
    {
      ...raw.pages[1],
      markdown: "# عنوان محدّث\n\nالنص الأخير.",
      tags: ["العلاقات"],
      revisionId: 2,
    },
  ];
  await writeFile(source, JSON.stringify(raw));
  await generatePages(options);
  await verifySite(options);
  await assert.rejects(readFile(join(root, "dist/pages/10/index.html")), {
    code: "ENOENT",
  });
  const final = load(
    await readFile(join(root, "dist/pages/11/index.html"), "utf8"),
  );
  assert.equal(final(".chapter-heading h1").text(), "عنوان محدّث");
  assert.equal(final(".book-content p").text(), "النص الأخير.");
  assert.deepEqual(
    final(".chapter-tags button")
      .map((_, node) => final(node).text())
      .get(),
    ["العلاقات"],
  );
});
