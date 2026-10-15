import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";
import { toLatinDigits } from "../src/lib/numbers.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const endpoint = "https://attahawy.com/books/wiki/lifebook/api.php";
const source =
  "https://attahawy.com/books/wiki/lifebook/index.php?title=خاص:كل_الصفحات";
const dataDirectory = `${root}data`;
const pageDirectory = `${dataDirectory}/pages`;
const refresh = process.argv.includes("--refresh");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(parameters) {
  const url = `${endpoint}?${new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...parameters })}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(45000),
        headers: { "User-Agent": "AdabBookLocalReader/1.0" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (result.error)
        throw new Error(`${result.error.code}: ${result.error.info}`);
      return result;
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(1000 * 2 ** attempt);
    }
  }
}

async function writeJson(path, data) {
  const json = toLatinDigits(`${JSON.stringify(data, null, 2)}\n`);
  await writeFile(`${path}.tmp`, json, "utf8");
  await rename(`${path}.tmp`, path);
  return JSON.parse(json);
}

await mkdir(pageDirectory, { recursive: true });
const allPages = [];
let continuation = {};
do {
  const result = await fetchJson({
    action: "query",
    list: "allpages",
    apnamespace: "0",
    aplimit: "max",
    apfilterredir: "all",
    ...continuation,
  });
  allPages.push(...result.query.allpages);
  continuation = result.continue;
} while (continuation);
if (!allPages.length) throw new Error("The API returned no pages.");
if (new Set(allPages.map((page) => page.pageid)).size !== allPages.length)
  throw new Error("Duplicate page IDs.");

// Check the same main-namespace list displayed in the requested browser tab.
const listResponse = await fetch(source);
if (!listResponse.ok)
  throw new Error(`All-pages screen returned ${listResponse.status}`);
const listing = load(await listResponse.text());
const visibleTitles = listing(".mw-allpages-body a")
  .map((_, link) => listing(link).text().trim())
  .get();
const apiTitles = new Set(allPages.map((page) => page.title));
const unmatchedTitles = visibleTitles.filter((title) => !apiTitles.has(title));
if (unmatchedTitles.length)
  throw new Error(`Page-list mismatch: ${unmatchedTitles.join(", ")}`);
const titleKey = (title) =>
  toLatinDigits(title).replace(/_/g, " ").normalize("NFC");
const idsByTitle = new Map(
  allPages.map((page) => [titleKey(page.title), page.pageid]),
);

const site = await fetchJson({
  action: "query",
  meta: "siteinfo",
  siprop: "general|rightsinfo",
});
const metadata = new Map();
for (let offset = 0; offset < allPages.length; offset += 50) {
  const result = await fetchJson({
    action: "query",
    pageids: allPages
      .slice(offset, offset + 50)
      .map((page) => page.pageid)
      .join("|"),
    prop: "info|revisions",
    inprop: "url",
    rvprop: "ids|timestamp",
  });
  for (const page of result.query.pages) metadata.set(page.pageid, page);
}

console.log(
  `Found ${allPages.length} pages; ${visibleTitles.length} verified on the all-pages screen.`,
);
const pages = new Array(allPages.length);
const searchPages = new Array(allPages.length);
let cursor = 0;
let completed = 0;
const failures = [];
async function worker() {
  while (cursor < allPages.length) {
    const index = cursor++;
    const entry = allPages[index];
    try {
      const info = metadata.get(entry.pageid);
      if (!info || info.missing) throw new Error("Page metadata is missing.");
      let page;
      const path = `${pageDirectory}/${entry.pageid}.json`;
      if (!refresh) {
        try {
          const saved = await readFile(path, "utf8");
          const normalized = toLatinDigits(saved);
          const cached = JSON.parse(normalized);
          if (
            cached.schemaVersion === 1 &&
            cached.revisionId === info.lastrevid &&
            cached.title === toLatinDigits(entry.title) &&
            cached.html &&
            cached.wikitext !== undefined
          ) {
            page = cached;
            if (normalized !== saved) await writeJson(path, cached);
          }
        } catch {
          /* Fetch missing or outdated snapshots. */
        }
      }
      if (!page) {
        const result = await fetchJson({
          action: "parse",
          oldid: String(info.lastrevid),
          prop: "text|wikitext|sections|links|images|categories|revid|displaytitle",
          disableeditsection: "1",
          disabletoc: "1",
        });
        const parsed = result.parse;
        if (
          parsed.pageid !== entry.pageid ||
          parsed.revid !== info.lastrevid ||
          !parsed.text
        )
          throw new Error("Unexpected parser result.");
        const document = load(parsed.text);
        document("script, style, .mw-editsection, .toc").remove();
        const text = document.root().text().replace(/\s+/g, " ").trim();
        page = {
          schemaVersion: 1,
          pageid: entry.pageid,
          namespace: entry.ns,
          title: entry.title,
          displayTitle: parsed.displaytitle,
          revisionId: parsed.revid,
          revisedAt: info.revisions?.[0]?.timestamp ?? null,
          fetchedAt: new Date().toISOString(),
          sourceUrl: info.fullurl,
          isRedirect: Boolean(info.redirect),
          html: parsed.text,
          text,
          wikitext: parsed.wikitext,
          sections: parsed.sections,
          categories: parsed.categories,
          links: parsed.links,
          images: parsed.images,
        };
        page = await writeJson(path, page);
        await delay(200);
      }
      const wordCount = page.text.split(/\s+/).filter(Boolean).length;
      const parsedDocument = load(page.html);
      const readingTitle =
        parsedDocument("h1,h2,h3,h4,h5,h6")
          .first()
          .text()
          .replace(/\s+/g, " ")
          .trim() || page.title;
      const nextLink = parsedDocument("a")
        .toArray()
        .find(
          (link) => parsedDocument(link).text().trim().toLowerCase() === "next",
        );
      const nextTitle = nextLink
        ? new URL(
            parsedDocument(nextLink).attr("href"),
            page.sourceUrl,
          ).searchParams.get("title")
        : null;
      pages[index] = {
        pageid: page.pageid,
        title: page.title,
        readingTitle,
        file: `pages/${page.pageid}.json`,
        revisionId: page.revisionId,
        wordCount,
        readingMinutes: Math.max(1, Math.ceil(wordCount / 180)),
        sourceNextPageId: nextTitle
          ? (idsByTitle.get(titleKey(nextTitle)) ?? null)
          : null,
      };
      searchPages[index] = { pageid: page.pageid, text: page.text };
      completed++;
      if (completed % 25 === 0 || completed === allPages.length)
        console.log(`Parsed ${completed}/${allPages.length}`);
    } catch (error) {
      failures.push({
        pageid: entry.pageid,
        title: entry.title,
        error: error.message,
      });
      console.error(`Failed page ${entry.pageid}: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
if (failures.length) {
  await writeJson(`${dataDirectory}/import-errors.json`, failures);
  throw new Error(
    `${failures.length} pages failed; the previous manifest was preserved. Rerun to resume.`,
  );
}

// Follow the source's partial "next" chain, then append every remaining page
// in the all-pages index's order. Guard against cycles and missing targets.
const introduction = pages.find((page) => page.title === "مقدمة لا بد منها");
const byId = new Map(pages.map((page) => [page.pageid, page]));
const readingOrder = [];
const seen = new Set();
let current = introduction;
while (current && !seen.has(current.pageid)) {
  seen.add(current.pageid);
  readingOrder.push(current.pageid);
  current = byId.get(current.sourceNextPageId);
}
const sourceSequencePages = readingOrder.length;
for (const page of pages)
  if (!seen.has(page.pageid)) readingOrder.push(page.pageid);
await writeJson(`${dataDirectory}/search-index.json`, {
  schemaVersion: 1,
  pages: searchPages,
});
await writeJson(`${dataDirectory}/manifest.json`, {
  schemaVersion: 1,
  title: site.query.general.sitename,
  language: "ar",
  direction: "rtl",
  sourceUrl: source,
  apiUrl: endpoint,
  fetchedAt: new Date().toISOString(),
  rights: site.query.rightsinfo,
  totalPages: pages.length,
  visibleIndexPages: visibleTitles.length,
  namespace: 0,
  order:
    "Follow the source next-page sequence from the introduction, then append remaining pages alphabetically.",
  sourceSequencePages,
  readingOrder,
  searchIndex: "search-index.json",
  pages: pages.map(({ sourceNextPageId, ...page }) => page),
});
await rm(`${dataDirectory}/import-errors.json`, { force: true });
console.log(
  `Saved ${pages.length} parser snapshots, data/manifest.json, and data/search-index.json.`,
);
