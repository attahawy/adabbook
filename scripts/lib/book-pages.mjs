import { load } from "cheerio";
import { renderMarkdown } from "../../src/lib/markdown.js";
import { titleKey } from "./wiki-markdown.mjs";

const excludedTitles = new Set(["شتاوات", "مواضيع الكتاب", "موضوعات الكتاب"]);
const textKey = (text) => titleKey(text.replace(/\s+/g, " ").trim());

export function filterBookPages(pages) {
  const blankTitles = [];
  const excluded = [];
  const kept = pages.filter((page) => {
    if (excludedTitles.has(titleKey(page.title))) {
      excluded.push(page.title);
      return false;
    }
    const document = load(renderMarkdown(page.markdown));
    if (document("img[src]").length) return true;
    document("h1, h2, h3, h4, h5, h6").remove();
    const body = textKey(document("body").text());
    if (body && body !== textKey(page.title)) return true;
    blankTitles.push(page.title);
    return false;
  });
  return { pages: kept, blankTitles, excludedTitles: excluded };
}
