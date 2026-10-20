import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import { normalize } from "./search.js";
import { pagePath } from "./site.js";

const markdown = new MarkdownIt({ html: false, linkify: true })
  .use(footnote)
  .use(taskLists);

const inlineText = (tokens = []) =>
  tokens
    .map((token) => {
      if (["softbreak", "hardbreak"].includes(token.type)) return " ";
      if (token.children) return inlineText(token.children);
      return ["text", "code_inline"].includes(token.type) ? token.content : "";
    })
    .join("");
const compactText = (text) => text.replace(/\s+/g, " ").trim();

// Keep both generations of MediaWiki fragment URLs working without saving
// their duplicate anchor markup in every page.
markdown.core.ruler.push("book-heading-anchors", (state) => {
  const used = new Set();
  for (let index = 0; index < state.tokens.length; index++) {
    const token = state.tokens[index];
    if (token.type !== "heading_open") continue;
    const heading = compactText(inlineText(state.tokens[index + 1].children));
    const base = heading.replace(/ /g, "_") || "section";
    let anchor = base;
    for (let suffix = 2; used.has(anchor); suffix++)
      anchor = `${base}_${suffix}`;
    used.add(anchor);
    token.attrSet("id", anchor);
    token.meta = {
      legacyAnchor: encodeURIComponent(anchor).replace(/%/g, "."),
    };
  }
});
markdown.renderer.rules.heading_open = (
  tokens,
  index,
  options,
  env,
  renderer,
) => {
  const token = tokens[index];
  const legacy = token.meta.legacyAnchor;
  return (
    renderer.renderToken(tokens, index, options) +
    (legacy === token.attrGet("id")
      ? ""
      : `<span id="${markdown.utils.escapeHtml(legacy)}"></span>`)
  );
};

for (const [rule, prefix] of [
  ["footnote_ref", "cite_ref-"],
  ["footnote_open", "cite_note-"],
]) {
  const render = markdown.renderer.rules[rule];
  markdown.renderer.rules[rule] = (tokens, index, ...args) => {
    const token = tokens[index];
    const alias = `${prefix}${token.meta.id + 1}`;
    const html = render(tokens, index, ...args);
    if (rule === "footnote_ref")
      return token.meta.subId > 0 ? html : `<span id="${alias}"></span>${html}`;
    return `${html}<span id="${alias}"></span>`;
  };
}

export const renderMarkdown = (content) => markdown.render(content);

// Render the same portable, escaped Markdown on Node and in the browser.
// Raw HTML is disabled above; markdown-it also rejects executable link schemes.
export function renderPageMarkdown(page, pages, basePath = "/") {
  const tokens = markdown.parse(page.markdown, {});
  const ids = new Set(pages.map((item) => item.pageid));
  const titles = new Map(
    pages.map((item) => [normalize(item.title), item.pageid]),
  );
  const source = new URL(page.sourceUrl);
  const visit = (items) => {
    for (const token of items) {
      if (token.type === "link_open") {
        const href = token.attrGet("href");
        if (!href.startsWith("#")) {
          const url = new URL(href, source);
          const title = url.searchParams.get("title");
          const id = href.startsWith("?page=")
            ? Number(url.searchParams.get("page"))
            : url.origin === source.origin &&
                url.pathname === source.pathname &&
                title
              ? titles.get(normalize(title))
              : undefined;
          if (ids.has(id)) {
            token.attrSet("href", `${pagePath(id, basePath)}${url.hash}`);
            token.attrSet("data-page-id", String(id));
          } else {
            token.attrSet("href", url.href);
            token.attrSet("target", "_blank");
            token.attrSet("rel", "noopener noreferrer");
          }
        }
      } else if (token.type === "image") {
        token.attrSet("src", new URL(token.attrGet("src"), source).href);
        token.attrSet("loading", "lazy");
      }
      if (token.children) visit(token.children);
    }
  };
  visit(tokens);
  const first = tokens.findIndex((token) => token.type === "heading_open");
  if (first !== -1) {
    const heading = tokens[first];
    const anchor = new heading.constructor("html_block", "", 0);
    const ids = new Set([heading.attrGet("id"), heading.meta.legacyAnchor]);
    anchor.content = [...ids]
      .map((id) => `<span id="${markdown.utils.escapeHtml(id)}"></span>`)
      .join("");
    tokens.splice(first, 3, anchor);
  }
  return markdown.renderer.render(tokens, markdown.options, {});
}

export function markdownDetails(content, fallbackTitle = "") {
  const tokens = markdown.parse(content, {});
  const heading = tokens.findIndex((token) => token.type === "heading_open");
  const text = compactText(
    tokens
      .map((token) => {
        if (token.type === "inline") return inlineText(token.children);
        return ["fence", "code_block"].includes(token.type)
          ? token.content
          : "";
      })
      .join(" "),
  );
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return {
    readingTitle:
      (heading === -1
        ? ""
        : compactText(inlineText(tokens[heading + 1].children))) ||
      fallbackTitle,
    text,
    wordCount,
    readingMinutes: Math.max(1, Math.ceil(wordCount / 180)),
  };
}
