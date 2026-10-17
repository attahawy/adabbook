import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { prepareBook, validateBook } from "../src/lib/book.js";
import { markdownDetails, renderMarkdown } from "../src/lib/markdown.js";
import { convertWikiPage, titleKey } from "../scripts/lib/wiki-markdown.mjs";

const page = {
  pageid: 10,
  title: "عنوان الويكي",
  revisionId: 20,
  markdown: "## عنوان **القراءة**\n\nنص الصفحة [رابط](?page=11).",
};
const book = {
  schemaVersion: 2,
  sourceUrl: "https://example.com/wiki/index.php?title=All_pages",
  fetchedAt: "2026-10-15T02:42:12.502Z",
  pages: [page],
};

test("derives display titles, text, and reading metadata without changing saved Markdown", () => {
  const prepared = prepareBook(book);
  assert.deepEqual(book.pages[0], page);
  assert.equal(prepared.pages[0].readingTitle, "عنوان القراءة");
  assert.equal(prepared.pages[0].text, "عنوان القراءة نص الصفحة رابط.");
  assert.equal(prepared.pages[0].wordCount, 5);
  assert.equal(prepared.pages[0].readingMinutes, 1);
  assert.equal(
    new URL(prepared.pages[0].sourceUrl).searchParams.get("title"),
    "عنوان_الويكي",
  );
  assert.equal(
    markdownDetails("نص بلا عنوان", "عنوان بديل").readingTitle,
    "عنوان بديل",
  );
});

test("rejects duplicate IDs, empty content, and obsolete data properties", () => {
  assert.throws(() => validateBook({ ...book, pages: [page, page] }));
  assert.throws(() => validateBook({ ...book, readingOrder: [10] }));
  assert.throws(() =>
    validateBook({ ...book, pages: [{ ...page, html: "<p>نص</p>" }] }),
  );
  assert.throws(() =>
    validateBook({ ...book, pages: [{ ...page, markdown: " " }] }),
  );
});

test("renders GFM tables, task lists, strikethrough, and bare URL links", () => {
  const doc = load(
    renderMarkdown(
      "| أ | ب |\n| - | - |\n| س | ص |\n\n- [x] مكتمل\n- [ ] لاحقًا\n\n~~محذوف~~ https://example.com",
    ),
  );
  assert.equal(doc("table td").text(), "سص");
  assert.equal(doc('input[type="checkbox"][disabled]').length, 2);
  assert.equal(doc("input[checked]").length, 1);
  assert.equal(doc("s").text(), "محذوف");
  assert.equal(doc("a").attr("href"), "https://example.com");
});

test("keeps Arabic and legacy heading anchors and distinguishes repeated headings", () => {
  const doc = load(renderMarkdown("## عنوان عربي\n\n## عنوان عربي"));
  const ids = doc("[id]")
    .map((_, element) => doc(element).attr("id"))
    .get();
  assert.ok(ids.includes("عنوان_عربي"));
  assert.ok(ids.includes("عنوان_عربي_2"));
  assert.ok(
    ids.includes(".D8.B9.D9.86.D9.88.D8.A7.D9.86_.D8.B9.D8.B1.D8.A8.D9.8A"),
  );
  assert.equal(new Set(ids).size, ids.length);
});

test("footnotes keep their text, links, backlinks, and original wiki fragment targets", () => {
  const doc = load(
    renderMarkdown(
      "نص[^1] ثم نص[^1].\n\n[^1]: [مرجع](https://example.com/reference)",
    ),
  );
  assert.equal(doc(".footnote-ref").length, 2);
  assert.equal(doc(".footnote-item").length, 1);
  assert.equal(
    doc(".footnote-item a[href='https://example.com/reference']").text(),
    "مرجع",
  );
  for (const id of ["cite_ref-1", "cite_note-1", "fnref1", "fnref1:1", "fn1"])
    assert.ok(
      doc("[id]")
        .toArray()
        .some((node) => doc(node).attr("id") === id),
    );
  assert.equal(markdownDetails("نص[^1]\n\n[^1]: مرجع").text, "نص مرجع");
});

test("raw HTML and executable links cannot become active markup", () => {
  const doc = load(
    renderMarkdown(
      "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[رابط](javascript:alert(1))",
    ),
  );
  assert.equal(doc("script, img, a[href^='javascript:']").length, 0);
  assert.ok(doc("body").text().includes("<script>"));
});

test("imports parsed wiki content as portable Markdown with footnotes and reader links", () => {
  const converted = convertWikiPage(
    {
      pageid: 10,
      title: "عنوان الويكي",
      revisionId: 20,
      sourceUrl: "https://example.com/wiki/index.php?title=Original",
      html: '<div class="mw-parser-output"><h2><span id="قديم">عنوان القراءة</span></h2><p>نص <b>مهم</b> ٤٢ <a href="/wiki/index.php?title=صفحة_ثانية#جزء">داخلي</a>.<sup class="reference"><a href="#cite_note-1">[1]</a></sup></p><p><a href="/wiki/index.php?title=صفحة_ثانية">next</a></p><div class="mw-references-wrap"><ol class="references"><li id="cite_note-1"><a class="mw-cite-backlink" href="#cite_ref-1">↑</a><span class="reference-text"><a href="https://example.org">مرجع</a></span></li></ol></div><!-- parser cache --></div>',
    },
    new Map([[titleKey("صفحة ثانية"), 11]]),
  );
  assert.equal(converted.nextTitle, "صفحة_ثانية");
  assert.match(converted.page.markdown, /^## عنوان القراءة/);
  assert.match(converted.page.markdown, /\*\*مهم\*\* 42/);
  assert.match(converted.page.markdown, /\[داخلي\]\(\?page=11#/);
  assert.match(
    converted.page.markdown,
    /\[\^1\]: \[مرجع\]\(https:\/\/example.org\//,
  );
  assert.doesNotMatch(converted.page.markdown, /next|mw-parser|<!--|<span|↑/);
  assert.equal(
    markdownDetails(converted.page.markdown).text,
    "عنوان القراءة نص مهم 42 داخلي. مرجع",
  );
});
