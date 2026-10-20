import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importPages } from "../scripts/import-pages.mjs";

test("imports atomically, skips blank and excluded pages, and preserves cached local edits", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "adabbook-import-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let fail = false;
  let parseRequests = 0;
  const sourceUrl = "https://example.com/wiki/index.php?title=All_pages";
  const entries = [
    { pageid: 11, ns: 0, title: "الثانية" },
    { pageid: 10, ns: 0, title: "مقدمة لا بد منها" },
    { pageid: 12, ns: 0, title: "فارغة بعنوان" },
    { pageid: 13, ns: 0, title: "عنوان فقط" },
    { pageid: 14, ns: 0, title: "شتاوات" },
    { pageid: 15, ns: 0, title: "موضوعات الكتاب" },
  ];
  const nextTitles = new Map([
    [10, "فارغة بعنوان"],
    [12, "عنوان فقط"],
    [13, "شتاوات"],
    [14, "موضوعات الكتاب"],
    [15, "الثانية"],
  ]);
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("index.php"))
      return new Response(
        `<div class="mw-allpages-body">${entries.map((page) => `<a>${page.title}</a>`).join("")}</div>`,
      );
    if (url.searchParams.get("list") === "allpages")
      return Response.json({ query: { allpages: entries } });
    if (url.searchParams.get("action") === "query")
      return Response.json({
        query: {
          pages: entries.map((page) => ({
            ...page,
            lastrevid: page.pageid + 100,
            fullurl: `https://example.com/wiki/index.php?title=${encodeURIComponent(page.title)}`,
          })),
        },
      });
    parseRequests++;
    assert.equal(url.searchParams.get("prop"), "text|revid");
    const pageid = Number(url.searchParams.get("oldid")) - 100;
    const content =
      pageid === 12
        ? "<h2>فارغة بعنوان</h2>"
        : pageid === 13
          ? "<p>عنوان فقط</p>"
          : `<h2>عنوان ${pageid}</h2><p>المحتوى الأصلي</p>`;
    return Response.json({
      parse: {
        pageid,
        revid: pageid + 100,
        text: fail
          ? ""
          : `${content}${nextTitles.has(pageid) ? `<p><a href="?title=${nextTitles.get(pageid)}">next</a></p>` : ""}`,
      },
    });
  };
  const options = { directory, sourceUrl };
  const target = join(directory, "data/book.json");
  await importPages(options);
  assert.equal(parseRequests, entries.length);
  const saved = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(
    saved.pages.map((page) => page.pageid),
    [10, 11],
  );
  assert.equal(
    await readFile(join(directory, "tmp/blank-page-titles.txt"), "utf8"),
    "فارغة بعنوان\nعنوان فقط\n",
  );
  saved.pages[0].markdown = "## تعديل محلي\n\nنص محرر";
  saved.pages[0].tags = ["العلم والتعلم", "الأخلاق"];
  await writeFile(target, JSON.stringify(saved));

  await importPages(options);
  assert.equal(
    parseRequests,
    entries.length,
    "Unchanged revisions must reuse checkpoints",
  );
  const updated = JSON.parse(await readFile(target, "utf8"));
  assert.equal(updated.pages[0].markdown, saved.pages[0].markdown);
  assert.deepEqual(updated.pages[0].tags, saved.pages[0].tags);
  assert.deepEqual(updated.pages.map((page) => page.pageid), [10, 11]);

  fail = true;
  const beforeFailure = await readFile(target, "utf8");
  await assert.rejects(
    importPages({ ...options, refresh: true }),
    /book.json was preserved/,
  );
  assert.equal(await readFile(target, "utf8"), beforeFailure);
  const errors = JSON.parse(
    await readFile(join(directory, ".cache/import-pages/errors.json"), "utf8"),
  );
  assert.equal(errors.length, entries.length);

  fail = false;
  await importPages({ ...options, refresh: true });
  const refreshed = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(refreshed.pages.map((page) => page.pageid), [10, 11]);
  assert.match(refreshed.pages[0].markdown, /المحتوى الأصلي/);
  assert.doesNotMatch(refreshed.pages[0].markdown, /تعديل محلي/);
  assert.deepEqual(refreshed.pages[0].tags, saved.pages[0].tags);
  await assert.rejects(
    readFile(join(directory, ".cache/import-pages/errors.json")),
    { code: "ENOENT" },
  );
});
