import { markdownDetails } from "./markdown.js";

const hasFields = (value, fields, optional = []) =>
  value &&
  typeof value === "object" &&
  Object.keys(value).every(
    (key) => fields.includes(key) || optional.includes(key),
  ) &&
  fields.every((field) => Object.hasOwn(value, field));

export function validateBook(book) {
  if (
    !hasFields(book, ["schemaVersion", "sourceUrl", "fetchedAt", "pages"]) ||
    book.schemaVersion !== 2 ||
    typeof book.sourceUrl !== "string" ||
    !book.sourceUrl.startsWith("https://") ||
    typeof book.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(book.fetchedAt)) ||
    !Array.isArray(book.pages) ||
    !book.pages.length
  )
    throw new Error("Invalid book");
  new URL(book.sourceUrl);
  const ids = new Set();
  for (const page of book.pages) {
    if (
      !hasFields(
        page,
        ["pageid", "title", "revisionId", "markdown"],
        ["tags"],
      ) ||
      !Number.isSafeInteger(page.pageid) ||
      page.pageid <= 0 ||
      ids.has(page.pageid) ||
      typeof page.title !== "string" ||
      !page.title.trim() ||
      !Number.isSafeInteger(page.revisionId) ||
      page.revisionId <= 0 ||
      typeof page.markdown !== "string" ||
      !page.markdown.trim() ||
      (Object.hasOwn(page, "tags") &&
        (!Array.isArray(page.tags) ||
          page.tags.some(
            (tag) =>
              typeof tag !== "string" || !tag.trim() || tag !== tag.trim(),
          ) ||
          new Set(page.tags).size !== page.tags.length))
    )
      throw new Error(`Invalid book page: ${page?.pageid}`);
    ids.add(page.pageid);
  }
  return book;
}

export function prepareBook(data) {
  const book = validateBook(data);
  return {
    ...book,
    pages: book.pages.map((page) => {
      const source = new URL(book.sourceUrl);
      source.search = "";
      source.searchParams.set("title", page.title.replace(/ /g, "_"));
      return {
        ...page,
        tags: page.tags ?? [],
        ...markdownDetails(page.markdown, page.title),
        sourceUrl: source.href,
      };
    }),
  };
}
