export const siteUrl = "https://adab.rajol.com/";
export const siteName = "أدب الرجل";
export const authorName = "سامي الطحاوي";

export function pagePath(pageId, basePath = "/") {
  if (!Number.isSafeInteger(pageId) || pageId <= 0)
    throw new Error("Invalid page ID");
  return `${basePath.replace(/\/?$/, "/")}pages/${pageId}/`;
}

export function pageIdFromUrl(input, basePath = "/") {
  const url = new URL(input);
  const prefix = `${basePath.replace(/\/?$/, "/")}pages/`;
  const path = url.pathname.startsWith(prefix)
    ? url.pathname
        .slice(prefix.length)
        .match(/^([1-9]\d*)(?:\/|\/index\.html)?$/)?.[1]
    : null;
  const raw = path ?? url.searchParams.get("page");
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function canonicalPageUrl(pageId, baseUrl = siteUrl) {
  return new URL(pagePath(pageId, new URL(baseUrl).pathname), baseUrl).href;
}

export function pageBodyText(page) {
  return (
    page.text.startsWith(page.readingTitle)
      ? page.text.slice(page.readingTitle.length)
      : page.text
  ).trim();
}

export function pageMetadata(page, baseUrl = siteUrl) {
  const body = pageBodyText(page) || page.readingTitle;
  const description =
    body.length > 160 ? `${body.slice(0, 157).replace(/\s+\S*$/, "")}…` : body;
  const url = canonicalPageUrl(page.pageid, baseUrl);
  return {
    title: `${page.readingTitle} | ${siteName} — ${authorName}`,
    description,
    url,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Book",
          "@id": `${baseUrl}#book`,
          name: siteName,
          url: baseUrl,
          inLanguage: "ar",
          author: { "@type": "Person", name: authorName },
        },
        {
          "@type": "Article",
          "@id": `${url}#article`,
          url,
          headline: page.readingTitle,
          description,
          articleBody: body,
          inLanguage: "ar",
          keywords: page.tags,
          author: { "@type": "Person", name: authorName },
          isPartOf: { "@id": `${baseUrl}#book` },
          mainEntityOfPage: url,
        },
      ],
    },
  };
}

export const serializeStructuredData = (data) =>
  JSON.stringify(data).replace(/</g, "\\u003c");

export function updatePageMetadata(page) {
  const metadata = pageMetadata(page);
  document.title = metadata.title;
  for (const [attribute, name, content] of [
    ["name", "description", metadata.description],
    ["property", "og:title", metadata.title],
    ["property", "og:description", metadata.description],
    ["property", "og:url", metadata.url],
    ["property", "og:type", "article"],
    ["property", "og:site_name", siteName],
    ["name", "twitter:card", "summary"],
    ["name", "twitter:title", metadata.title],
    ["name", "twitter:description", metadata.description],
  ]) {
    let element = document.head.querySelector(`meta[${attribute}="${name}"]`);
    if (!element) {
      element = document.createElement("meta");
      element.setAttribute(attribute, name);
      document.head.append(element);
    }
    element.content = content;
  }
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = metadata.url;
  let structured = document.getElementById("page-structured-data");
  if (!structured) {
    structured = document.createElement("script");
    structured.id = "page-structured-data";
    structured.type = "application/ld+json";
    document.head.append(structured);
  }
  structured.textContent = serializeStructuredData(metadata.structuredData);
}
