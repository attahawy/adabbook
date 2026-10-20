import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import Reader, { ErrorMessage } from "./Reader.jsx";
import { prepareBook } from "./lib/book.js";
import { pageIdFromUrl, pagePath, siteName } from "./lib/site.js";
import "./fonts.css";
import "./styles.css";

const basePath = import.meta.env.BASE_URL;
const container = document.getElementById("root");

function showNotFound() {
  document.title = `الصفحة غير موجودة | ${siteName}`;
  let robots = document.head.querySelector('meta[name="robots"]');
  if (!robots) {
    robots = document.createElement("meta");
    robots.name = "robots";
    document.head.append(robots);
  }
  robots.content = "noindex,follow";
  document.querySelector('link[rel="canonical"]')?.remove();
  document.getElementById("page-structured-data")?.remove();
  createRoot(container).render(
    <div className="empty-state">
      <h1>الصفحة غير موجودة</h1>
      <p>يمكنك العودة إلى الكتاب واختيار وصية من الفهرس.</p>
      <a className="primary-button" href={basePath}>
        العودة إلى الكتاب
      </a>
    </div>,
  );
}

function showLoadError() {
  if (container.dataset.pageId) {
    // Keep the complete, readable HTML when interactive tools cannot load.
    const notice = document.createElement("div");
    notice.className = "reader-notice";
    notice.setAttribute("role", "status");
    notice.append("تعذّر تحميل أدوات القراءة. ");
    const retry = document.createElement("button");
    retry.textContent = "إعادة المحاولة";
    retry.addEventListener("click", () => location.reload());
    notice.append(retry);
    document.body.append(notice);
  } else {
    createRoot(container).render(
      <ErrorMessage retry={() => location.reload()}>
        تعذّر تحميل الكتاب. تحقق من اتصالك وحاول مجددًا.
      </ErrorMessage>,
    );
  }
}

async function startReader() {
  const url = new URL(location.href);
  const requested = pageIdFromUrl(url, basePath);
  const home = [basePath, `${basePath}index.html`].includes(url.pathname);
  // Old app/share URLs reach their complete HTML before requesting reader data.
  if (home && requested) {
    url.searchParams.delete("page");
    location.replace(
      `${pagePath(requested, basePath)}${url.search}${url.hash}`,
    );
    return;
  }
  const version = container.dataset.bookDigest;
  const response = await fetch(
    `${basePath}data/book.json${version ? `?release=${version}` : ""}`,
    { cache: "no-cache" },
  );
  if (!response.ok) throw new Error("Book unavailable");
  const raw = await response.text();
  const book = prepareBook(JSON.parse(raw));
  const digest = globalThis.crypto?.subtle
    ? [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
        ),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    : "";
  let pageId = requested;
  if (home && !url.searchParams.has("page")) {
    try {
      pageId = JSON.parse(localStorage.getItem("adabbook:last-page"));
    } catch {
      /* Start with the introduction when saved progress is invalid. */
    }
    if (!book.pages.some((page) => page.pageid === pageId))
      pageId = book.pages[0].pageid;
  }
  if (!book.pages.some((page) => page.pageid === pageId)) {
    showNotFound();
    return;
  }
  const path = pagePath(pageId, basePath);
  if (url.pathname !== path || url.searchParams.has("page")) {
    url.searchParams.delete("page");
    location.replace(`${path}${url.search}${url.hash}`);
    return;
  }
  const app = <Reader book={book} initialPageId={pageId} basePath={basePath} />;
  if (
    Number(container.dataset.pageId) === pageId &&
    version === digest &&
    container.hasChildNodes()
  )
    hydrateRoot(container, app);
  else createRoot(container).render(app);
}

startReader().catch(showLoadError);
