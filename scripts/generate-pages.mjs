import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { load } from "cheerio";
import { createHash } from "node:crypto";
import { prepareBook } from "../src/lib/book.js";
import {
  pageMetadata,
  serializeStructuredData,
  siteName,
  siteUrl,
} from "../src/lib/site.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const xmlEscape = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export async function generatePages({
  root = projectRoot,
  output = join(root, "dist"),
  basePath = process.env.GITHUB_PAGES === "true" ? "/adabbook/" : "/",
} = {}) {
  const started = performance.now();
  const raw = await readFile(join(root, "data/book.json"), "utf8");
  const book = prepareBook(JSON.parse(raw));
  const digest = createHash("sha256").update(raw).digest("hex");
  const shell = load(await readFile(join(output, "index.html"), "utf8"));
  shell("#root")
    .empty()
    .removeAttr("data-page-id")
    .removeAttr("data-book-digest");
  shell(
    'link[rel="canonical"], link[rel="sitemap"], #page-structured-data, meta[name="robots"], meta[property^="og:"], meta[name^="twitter:"]',
  ).remove();
  const template = shell.html();
  const vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    logLevel: "error",
  });
  try {
    const { renderReader } = await vite.ssrLoadModule("/src/entry-server.jsx");
    await rm(join(output, "pages"), { recursive: true, force: true });
    const renderDocument = (page) => {
      const document = load(template);
      const metadata = pageMetadata(page);
      document("title").text(metadata.title);
      const meta = (attribute, name, content) => {
        let element = document(`meta[${attribute}="${name}"]`);
        if (!element.length) {
          element = document("<meta>").attr(attribute, name);
          document("head").append(element);
        }
        element.attr("content", content);
      };
      for (const [attribute, name, content] of [
        ["name", "description", metadata.description],
        ["property", "og:title", metadata.title],
        ["property", "og:description", metadata.description],
        ["property", "og:type", "article"],
        ["property", "og:url", metadata.url],
        ["property", "og:site_name", siteName],
        ["name", "twitter:card", "summary"],
        ["name", "twitter:title", metadata.title],
        ["name", "twitter:description", metadata.description],
      ])
        meta(attribute, name, content);
      document(
        'link[rel="canonical"], link[rel="sitemap"], #page-structured-data',
      ).remove();
      document("head").append(
        document("<link>").attr({ rel: "canonical", href: metadata.url }),
      );
      document("head").append(
        document("<link>").attr({
          rel: "sitemap",
          type: "application/xml",
          href: `${basePath}sitemap.xml`,
        }),
      );
      document("head").append(
        document(
          '<script type="application/ld+json" id="page-structured-data"></script>',
        ).text(serializeStructuredData(metadata.structuredData)),
      );
      document("#root")
        .attr({
          "data-page-id": String(page.pageid),
          "data-book-digest": digest,
        })
        .html(renderReader(book, page.pageid, basePath));
      return document.html();
    };
    for (const page of book.pages) {
      const directory = join(output, "pages", String(page.pageid));
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "index.html"), renderDocument(page));
    }
    await writeFile(join(output, "index.html"), renderDocument(book.pages[0]));
    const missing = load(template);
    missing("title").text(`الصفحة غير موجودة | ${siteName}`);
    missing('meta[name="description"]').attr(
      "content",
      "الصفحة المطلوبة غير موجودة في كتاب أدب الرجل.",
    );
    missing("head").append('<meta name="robots" content="noindex,follow">');
    missing("#root").html(
      '<div class="empty-state"><h1>الصفحة غير موجودة</h1><p>يمكنك العودة إلى الكتاب واختيار وصية من الفهرس.</p></div>',
    );
    missing("#root .empty-state").append(
      missing('<a class="primary-button">العودة إلى الكتاب</a>').attr(
        "href",
        basePath,
      ),
    );
    await writeFile(join(output, "404.html"), missing.html());
    const urls = book.pages.map(
      (page) => `  <url><loc>${xmlEscape(pageMetadata(page).url)}</loc></url>`,
    );
    await writeFile(
      join(output, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
    );
    console.log(
      `Generated ${book.pages.length} React HTML pages, homepage, 404 and sitemap in ${((performance.now() - started) / 1000).toFixed(2)}s (${basePath}; ${siteUrl}).`,
    );
  } finally {
    await vite.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  generatePages().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
