import { load } from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { toLatinDigits } from "../../src/lib/numbers.js";

export const titleKey = (title) =>
  toLatinDigits(title).replace(/_/g, " ").normalize("NFC");

export function cleanWikiDocument(html, sourceUrl, idsByTitle) {
  const document = load(html);
  document("script, style, .mw-editsection, .toc, .mw-empty-elt").remove();
  let nextTitle = null;
  document("a[href]").each((_, element) => {
    const link = document(element);
    const href = link.attr("href");
    if (href.startsWith("#")) return;
    const url = new URL(href, sourceUrl);
    const source = new URL(sourceUrl);
    const title = url.searchParams.get("title");
    const id =
      url.origin === source.origin && url.pathname === source.pathname && title
        ? idsByTitle.get(titleKey(title))
        : undefined;
    const label = link.text().trim().toLowerCase();
    if (id && ["next", "pre", "prev", "previous"].includes(label)) {
      if (label === "next") nextTitle = title;
      const parent = link.parent();
      link.remove();
      if (parent.is("p") && !parent.text().trim()) parent.remove();
    } else link.attr("href", id ? `?page=${id}${url.hash}` : url.href);
  });
  document("img[src]").each((_, element) => {
    const image = document(element);
    image.attr("src", new URL(image.attr("src"), sourceUrl).href);
  });
  // Leading wiki line breaks only add empty space between paragraphs.
  document("p > br").each((_, element) => {
    const siblings = document(element).parent().contents().toArray();
    const before = siblings.slice(0, siblings.indexOf(element));
    if (before.every((node) => node.type === "text" && !node.data.trim()))
      document(element).remove();
  });
  return { document, nextTitle };
}

export function convertWikiPage(page, idsByTitle) {
  const { document, nextTitle } = cleanWikiDocument(
    page.html,
    page.sourceUrl,
    idsByTitle,
  );
  const converter = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  converter.use(gfm);
  converter.addRule("wiki-footnote-reference", {
    filter: (node) =>
      node.nodeName === "SUP" && node.classList.contains("reference"),
    replacement: (_, node) => {
      const target = node.querySelector("a")?.getAttribute("href");
      if (!target?.startsWith("#cite_note-"))
        throw new Error(`Unsupported footnote in page ${page.pageid}`);
      return `[^${target.slice("#cite_note-".length)}]`;
    },
  });
  const footnotes = document("ol.references > li")
    .toArray()
    .map((element) => {
      const note = document(element);
      const id = note.attr("id").slice("cite_note-".length);
      const content = converter.turndown(
        note.find(".reference-text").html() ?? "",
      );
      return `[^${id}]: ${content.replace(/\n/g, "\n    ")}`;
    });
  document(".mw-references-wrap, ol.references").remove();
  const content = converter.turndown(document("body").html());
  return {
    page: {
      pageid: page.pageid,
      title: toLatinDigits(page.title),
      revisionId: page.revisionId,
      markdown: toLatinDigits([content, ...footnotes].join("\n\n")),
    },
    nextTitle,
  };
}
