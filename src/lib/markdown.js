import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";

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
