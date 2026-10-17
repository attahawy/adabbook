import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { load } from "cheerio";
import { validateBook } from "../src/lib/book.js";
import { toLatinDigits } from "../src/lib/numbers.js";
import { convertWikiPage, titleKey } from "./lib/wiki-markdown.mjs";

export async function importPages({
  directory = fileURLToPath(new URL("../", import.meta.url)),
  sourceUrl = "https://attahawy.com/books/wiki/lifebook/index.php?title=خاص:كل_الصفحات",
  refresh = false,
} = {}) {
  const root = `${directory.replace(/\/$/, "")}/`;
  const dataDirectory = `${root}data`;
  const cacheDirectory = `${root}.cache/import-pages`;
  const target = `${dataDirectory}/book.json`;
  const endpoint = new URL("api.php", sourceUrl).href;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchJson(parameters) {
    const url = `${endpoint}?${new URLSearchParams({ format: "json", formatversion: "2", maxlag: "5", ...parameters })}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(45000),
          headers: { "User-Agent": "AdabBookReader/2.0" },
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
    await writeFile(
      `${path}.tmp`,
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
    await rename(`${path}.tmp`, path);
  }

  await mkdir(dataDirectory, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  let savedPages = new Map();
  try {
    const saved = validateBook(JSON.parse(await readFile(target, "utf8")));
    savedPages = new Map(saved.pages.map((page) => [page.pageid, page]));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

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

  const listResponse = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(45000),
  });
  if (!listResponse.ok)
    throw new Error(`All-pages screen returned ${listResponse.status}`);
  const listing = load(await listResponse.text());
  const visibleTitles = listing(".mw-allpages-body a")
    .map((_, link) => listing(link).text().trim())
    .get();
  const apiTitles = new Set(allPages.map((page) => titleKey(page.title)));
  const unmatched = visibleTitles.filter(
    (title) => !apiTitles.has(titleKey(title)),
  );
  if (!visibleTitles.length || unmatched.length)
    throw new Error(`Page-list mismatch: ${unmatched.join(", ")}`);
  const idsByTitle = new Map(
    allPages.map((page) => [titleKey(page.title), page.pageid]),
  );

  const metadata = new Map();
  for (let offset = 0; offset < allPages.length; offset += 50) {
    const result = await fetchJson({
      action: "query",
      pageids: allPages
        .slice(offset, offset + 50)
        .map((page) => page.pageid)
        .join("|"),
      prop: "info",
      inprop: "url",
    });
    for (const page of result.query.pages) metadata.set(page.pageid, page);
  }

  console.log(
    `Found ${allPages.length} pages; ${visibleTitles.length} verified on the all-pages screen.`,
  );
  const pages = new Array(allPages.length);
  const nextIds = new Map();
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
        const path = `${cacheDirectory}/${entry.pageid}.json`;
        let converted;
        if (!refresh) {
          try {
            const cached = JSON.parse(await readFile(path, "utf8"));
            if (
              cached.page?.pageid === entry.pageid &&
              cached.page.revisionId === info.lastrevid &&
              cached.page.title === toLatinDigits(entry.title) &&
              typeof cached.page.markdown === "string" &&
              (cached.nextTitle === null ||
                typeof cached.nextTitle === "string")
            )
              converted = cached;
          } catch {
            /* Fetch missing or outdated import checkpoints. */
          }
        }
        if (!converted) {
          const { parse: parsed } = await fetchJson({
            action: "parse",
            oldid: String(info.lastrevid),
            prop: "text|revid",
            disableeditsection: "1",
            disabletoc: "1",
          });
          if (
            parsed.pageid !== entry.pageid ||
            parsed.revid !== info.lastrevid ||
            !parsed.text
          )
            throw new Error("Unexpected parser result.");
          converted = convertWikiPage(
            {
              pageid: entry.pageid,
              title: entry.title,
              revisionId: parsed.revid,
              sourceUrl: info.fullurl,
              html: parsed.text,
            },
            idsByTitle,
          );
          await writeJson(path, converted);
          await delay(200);
        }
        const saved = savedPages.get(entry.pageid);
        // Preserve local Markdown edits when the upstream revision is unchanged.
        pages[index] =
          !refresh &&
          saved?.revisionId === info.lastrevid &&
          saved.title === toLatinDigits(entry.title)
            ? saved
            : converted.page;
        nextIds.set(
          entry.pageid,
          idsByTitle.get(titleKey(converted.nextTitle ?? "")),
        );
        completed++;
        if (completed % 25 === 0 || completed === allPages.length)
          console.log(`Converted ${completed}/${allPages.length}`);
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
    await writeJson(`${cacheDirectory}/errors.json`, failures);
    throw new Error(
      `${failures.length} pages failed; book.json was preserved. Rerun to resume.`,
    );
  }

  const byId = new Map(pages.map((page) => [page.pageid, page]));
  const orderedPages = [];
  const seen = new Set();
  let current = pages.find((page) => page.title === "مقدمة لا بد منها");
  while (current && !seen.has(current.pageid)) {
    seen.add(current.pageid);
    orderedPages.push(current);
    current = byId.get(nextIds.get(current.pageid));
  }
  for (const page of pages) if (!seen.has(page.pageid)) orderedPages.push(page);
  const book = validateBook({
    schemaVersion: 2,
    sourceUrl: toLatinDigits(sourceUrl),
    fetchedAt: new Date().toISOString(),
    pages: orderedPages,
  });
  await writeJson(target, book);
  await rm(`${cacheDirectory}/errors.json`, { force: true });
  console.log(`Saved ${pages.length} Markdown pages in data/book.json.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await importPages({ refresh: process.argv.includes("--refresh") });
