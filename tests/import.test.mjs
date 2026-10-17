import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { importPages } from "../scripts/import-pages.mjs";

test("imports atomically, reuses revision checkpoints, and keeps unchanged local edits", async (context) => {
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
  ];
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("index.php"))
      return new Response(
        '<div class="mw-allpages-body"><a>الثانية</a><a>مقدمة لا بد منها</a></div>',
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
    return Response.json({
      parse: {
        pageid,
        revid: pageid + 100,
        text: fail
          ? ""
          : `<h2>عنوان ${pageid}</h2><p>المحتوى الأصلي</p>${pageid === 10 ? '<p><a href="?title=الثانية">next</a></p>' : ""}`,
      },
    });
  };
  const options = { directory, sourceUrl };
  const target = join(directory, "data/book.json");
  await importPages(options);
  assert.equal(parseRequests, 2);
  const saved = JSON.parse(await readFile(target, "utf8"));
  assert.deepEqual(
    saved.pages.map((page) => page.pageid),
    [10, 11],
  );
  saved.pages[0].markdown = "## تعديل محلي\n\nنص محرر";
  await writeFile(target, JSON.stringify(saved));

  await importPages(options);
  assert.equal(parseRequests, 2, "Unchanged revisions must reuse checkpoints");
  const updated = JSON.parse(await readFile(target, "utf8"));
  assert.equal(updated.pages[0].markdown, saved.pages[0].markdown);

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
  assert.equal(errors.length, 2);

  fail = false;
  await importPages({ ...options, refresh: true });
  const refreshed = JSON.parse(await readFile(target, "utf8"));
  assert.match(refreshed.pages[0].markdown, /المحتوى الأصلي/);
  assert.doesNotMatch(refreshed.pages[0].markdown, /تعديل محلي/);
  await assert.rejects(
    readFile(join(directory, ".cache/import-pages/errors.json")),
    { code: "ENOENT" },
  );
});
