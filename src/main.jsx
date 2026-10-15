import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import DOMPurify from "dompurify";
import {
  findMatchRanges,
  normalize,
  searchExcerpt,
  searchTerms,
} from "./lib/search.js";
import "./fonts.css";
import "./styles.css";

const numberFormatter = new Intl.NumberFormat("ar-EG", {
  numberingSystem: "latn",
});
const number = (value) => numberFormatter.format(value);
const dataUrl = (path) => `${import.meta.env.BASE_URL}data/${path}`;
function HighlightedText({ text, terms }) {
  const ranges = findMatchRanges(text, terms);
  if (!ranges.length) return text;
  const parts = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={`${start}-${end}`}>{text.slice(start, end)}</mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`adabbook:${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}

function useStored(key, fallback) {
  const [value, setValue] = useState(() => readStored(key, fallback));
  useEffect(() => {
    try {
      localStorage.setItem(`adabbook:${key}`, JSON.stringify(value));
    } catch {
      /* Reading remains available when storage is disabled. */
    }
  }, [key, value]);
  return [value, setValue];
}

function Icon({ name, size = 20, ...props }) {
  const paths = {
    book: (
      <>
        <path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Z" />
        <path d="M12 5v15" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    bookmark: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
    moon: <path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m9.5 3-.6 2.3-1.6.9L5 5.6 2.5 10l1.7 1.7v1L2.5 14.4 5 18.7l2.3-.6 1.6.9.6 2.3h5l.6-2.3 1.6-.9 2.3.6 2.5-4.3-1.7-1.7v-1L21.5 10 19 5.6l-2.3.6-1.6-.9-.6-2.3h-5Z" />
      </>
    ),
    right: <path d="m9 5 7 7-7 7" />,
    left: <path d="m15 5-7 7 7 7" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}

function ErrorMessage({ children, retry }) {
  return (
    <div className="empty-state" role="alert">
      <Icon name="book" size={36} />
      <h2>تعذّر فتح الكتاب</h2>
      <p>{children}</p>
      <button className="primary-button" onClick={retry}>
        حاول مرة أخرى
      </button>
    </div>
  );
}

function PreferencesDialog({
  open,
  onClose,
  theme,
  setTheme,
  fontSize,
  setFontSize,
}) {
  const dialogRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      id="reader-preferences"
      className="preferences-dialog"
      aria-labelledby="preferences-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current.close();
      }}
    >
      <div className="preferences-panel">
        <div className="preferences-heading">
          <h2 id="preferences-title">إعدادات القراءة</h2>
          <button
            className="icon-button close-preferences"
            aria-label="إغلاق الإعدادات"
            onClick={() => dialogRef.current.close()}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="preference-row">
          <span id="theme-label">المظهر</span>
          <div
            className="preference-options"
            role="group"
            aria-labelledby="theme-label"
          >
            <button
              aria-label="تفعيل الوضع النهاري"
              title="الوضع النهاري"
              aria-pressed={theme === "paper"}
              onClick={() => setTheme("paper")}
            >
              <Icon name="sun" />
            </button>
            <button
              aria-label="تفعيل الوضع الليلي"
              title="الوضع الليلي"
              aria-pressed={theme === "night"}
              onClick={() => setTheme("night")}
            >
              <Icon name="moon" />
            </button>
          </div>
        </div>
        <div className="preference-row">
          <span id="font-size-label">حجم النص</span>
          <div
            className="preference-options font-size-controls"
            role="group"
            aria-labelledby="font-size-label"
          >
            <button
              aria-label="تصغير النص"
              disabled={fontSize <= 20}
              onClick={() => setFontSize((size) => Math.max(20, size - 2))}
            >
              −
            </button>
            <output aria-label="حجم النص الحالي" aria-live="polite">
              {number(fontSize)}
            </output>
            <button
              aria-label="تكبير النص"
              disabled={fontSize >= 35}
              onClick={() => setFontSize((size) => Math.min(35, size + 2))}
            >
              +
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}

function Reader({ manifest }) {
  const orderedPages = useMemo(
    () =>
      manifest.readingOrder.map((id) =>
        manifest.pages.find((page) => page.pageid === id),
      ),
    [manifest],
  );
  const pagesById = useMemo(
    () => new Map(manifest.pages.map((page) => [page.pageid, page])),
    [manifest],
  );
  const pagesByTitle = useMemo(
    () =>
      new Map(
        manifest.pages.map((page) => [normalize(page.title), page.pageid]),
      ),
    [manifest],
  );
  const [lastPage, setLastPage] = useStored(
    "last-page",
    manifest.readingOrder[0],
  );
  const pageFromUrl = () =>
    Number(new URLSearchParams(location.search).get("page"));
  const [pageId, setPageId] = useState(() =>
    pagesById.has(pageFromUrl())
      ? pageFromUrl()
      : pagesById.has(lastPage)
        ? lastPage
        : manifest.readingOrder[0],
  );
  const [bookmarks, setBookmarks] = useStored("bookmarks", []);
  const [finished, setFinished] = useStored("finished", []);
  const [fontSize, setFontSize] = useStored("font-size", 25);
  const [theme, setTheme] = useStored("theme", "paper");
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const hasQuery = query.trim().length > 0;
  const [filter, setFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [page, setPage] = useState(null);
  const [pageError, setPageError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [progress, setProgress] = useState(0);
  const articleRef = useRef(null);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  const cache = useRef(new Map());
  const active = pagesById.get(pageId);
  const readingTitle = active.readingTitle ?? active.title;
  const index = orderedPages.findIndex((item) => item.pageid === pageId);
  const isBookmarked = bookmarks.includes(pageId);
  const isFinished = finished.includes(pageId);

  useEffect(() => {
    if (!hasQuery || searchIndex) {
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    fetch(dataUrl(manifest.searchIndex), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Search index unavailable");
        return response.json();
      })
      .then((data) => {
        if (
          !Array.isArray(data.pages) ||
          data.pages.length !== pagesById.size ||
          data.pages.some(
            (entry) =>
              !pagesById.has(entry.pageid) || typeof entry.text !== "string",
          )
        )
          throw new Error("Invalid search index");
        const index = new Map(
          data.pages.map((entry) => [
            entry.pageid,
            { text: entry.text, normalized: normalize(entry.text) },
          ]),
        );
        if (index.size !== pagesById.size)
          throw new Error("Incomplete search index");
        if (!cancelled) setSearchIndex(index);
      })
      .catch((error) => {
        if (!cancelled && error.name !== "AbortError") setSearchError(true);
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [hasQuery, searchIndex, searchAttempt, manifest.searchIndex, pagesById]);

  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === "night" ? "night" : "paper";
  }, [theme]);
  useEffect(() => {
    document.title = `${readingTitle} — أدب الرجل`;
    setLastPage(pageId);
  }, [pageId, readingTitle, setLastPage]);
  useEffect(() => {
    const onPopState = () => {
      const requested = pageFromUrl();
      if (pagesById.has(requested)) setPageId(requested);
      else setPageId(manifest.readingOrder[0]);
    };
    window.addEventListener("popstate", onPopState);
    if (!pageFromUrl())
      history.replaceState(null, "", `?page=${pageId}${location.hash}`);
    return () => window.removeEventListener("popstate", onPopState);
  }, [pagesById, manifest, pageId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPage(null);
    setPageError(false);
    const loadPage = async () => {
      try {
        let next = cache.current.get(pageId);
        if (!next) {
          const response = await fetch(dataUrl(active.file), {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Page unavailable");
          next = await response.json();
          if (next.pageid !== pageId || typeof next.html !== "string")
            throw new Error("Invalid page");
          cache.current.set(pageId, next);
        }
        if (!cancelled) setPage(next);
      } catch (error) {
        if (!cancelled && error.name !== "AbortError") setPageError(true);
      }
    };
    loadPage();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pageId, active.file, retry]);

  useEffect(() => {
    if (!page) return;
    const frame = requestAnimationFrame(() => {
      let anchor;
      try {
        anchor = decodeURIComponent(location.hash.slice(1));
      } catch {
        anchor = "";
      }
      if (anchor && document.getElementById(anchor))
        document.getElementById(anchor).scrollIntoView();
      else window.scrollTo(0, Number(readStored(`position:${pageId}`, 0)) || 0);
    });
    let timer;
    const onScroll = () => {
      const article = articleRef.current;
      if (!article) return;
      const available = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      setProgress(
        Math.min(100, Math.max(0, (window.scrollY / available) * 100)),
      );
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(
            `adabbook:position:${pageId}`,
            JSON.stringify(window.scrollY),
          );
        } catch {
          /* Optional persistence. */
        }
      }, 120);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [page, pageId]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    if (matchMedia("(max-width: 900px)").matches)
      document.body.style.overflow = "hidden";
    sidebarRef.current?.querySelector("input")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key === "Tab" && matchMedia("(max-width: 900px)").matches) {
        const controls = [
          ...sidebarRef.current.querySelectorAll("button, input, a"),
        ].filter((node) => !node.disabled);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const keydown = (event) => {
      if (
        preferencesOpen ||
        event.defaultPrevented ||
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
        event.target.isContentEditable
      )
        return;
      event.preventDefault();
      setSidebarOpen(true);
      sidebarRef.current?.querySelector("input")?.focus();
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [preferencesOpen]);

  const navigate = useCallback(
    (id, anchor = "") => {
      if (!pagesById.has(id)) return;
      if (id === pageId) {
        history.pushState(null, "", `?page=${id}${anchor}`);
        let decoded;
        try {
          decoded = decodeURIComponent(anchor.slice(1));
        } catch {
          decoded = "";
        }
        if (decoded) document.getElementById(decoded)?.scrollIntoView();
        else window.scrollTo(0, 0);
      } else {
        history.pushState(null, "", `?page=${id}${anchor}`);
        setPageId(id);
        setProgress(0);
      }
      setSidebarOpen(false);
      document.getElementById("reading")?.focus({ preventScroll: true });
    },
    [pagesById, pageId],
  );

  useEffect(() => {
    const keydown = (event) => {
      if (
        preferencesOpen ||
        !["ArrowRight", "ArrowLeft"].includes(event.key) ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
        event.target.isContentEditable
      )
        return;
      const destination =
        orderedPages[index + (event.key === "ArrowLeft" ? 1 : -1)];
      if (!destination) return;
      event.preventDefault();
      navigate(destination.pageid);
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [index, navigate, orderedPages, preferencesOpen]);

  const toggleSaved = () =>
    setBookmarks((previous) =>
      previous.includes(pageId)
        ? previous.filter((id) => id !== pageId)
        : [...previous, pageId],
    );
  const toggleFinished = () =>
    setFinished((previous) =>
      previous.includes(pageId)
        ? previous.filter((id) => id !== pageId)
        : [...previous, pageId],
    );
  const terms = useMemo(() => searchTerms(query), [query]);
  const filteredPages = useMemo(
    () =>
      hasQuery && !searchIndex
        ? []
        : orderedPages.filter((item) => {
            if (filter === "saved" && !bookmarks.includes(item.pageid))
              return false;
            if (!terms.length) return true;
            const haystack = `${normalize(`${item.readingTitle ?? item.title} ${item.title}`)} ${searchIndex.get(item.pageid).normalized}`;
            return terms.every((term) => haystack.includes(term));
          }),
    [hasQuery, searchIndex, orderedPages, filter, bookmarks, terms],
  );
  const excerpts = useMemo(() => {
    if (!hasQuery || !searchIndex) return new Map();
    return new Map(
      filteredPages.map((item) => {
        const title = normalize(item.readingTitle ?? item.title);
        const bodyTerms = terms.filter((term) => !title.includes(term));
        return [
          item.pageid,
          bodyTerms.length
            ? searchExcerpt(searchIndex.get(item.pageid).text, bodyTerms)
            : "",
        ];
      }),
    );
  }, [hasQuery, searchIndex, filteredPages, terms]);

  const html = useMemo(() => {
    if (!page) return "";
    const doc = new DOMParser().parseFromString(
      DOMPurify.sanitize(page.html, {
        FORBID_TAGS: ["style", "form", "input", "button", "iframe"],
        FORBID_ATTR: ["style"],
      }),
      "text/html",
    );
    doc
      .querySelectorAll(".mw-editsection, .toc, .mw-empty-elt")
      .forEach((element) => element.remove());
    const firstHeading = doc.querySelector("h1,h2,h3,h4,h5,h6");
    if (firstHeading?.textContent.trim()) {
      // Promote the first content heading to the page header, retaining its
      // fragment targets for links within the book.
      const targets = [firstHeading, ...firstHeading.querySelectorAll("[id]")]
        .filter((element) => element.id)
        .map((element) => {
          const anchor = doc.createElement("span");
          anchor.id = element.id;
          return anchor;
        });
      firstHeading.replaceWith(...targets);
    }
    doc.querySelectorAll("a[href]").forEach((link) => {
      const href = link.getAttribute("href");
      if (href.startsWith("#")) return;
      const url = new URL(href, page.sourceUrl);
      const source = new URL(page.sourceUrl);
      const title = url.searchParams.get("title");
      const id =
        url.origin === source.origin &&
        url.pathname === source.pathname &&
        title
          ? pagesByTitle.get(normalize(title))
          : undefined;
      if (
        id &&
        ["next", "pre", "prev", "previous"].includes(
          link.textContent.trim().toLowerCase(),
        )
      ) {
        const parent = link.parentElement;
        link.remove();
        if (parent?.tagName === "P" && !parent.textContent.trim())
          parent.remove();
        return;
      }
      if (id) {
        link.href = `?page=${id}${url.hash}`;
        link.dataset.pageId = String(id);
      } else {
        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    });
    doc.querySelectorAll("img, audio, video, source").forEach((element) => {
      if (element.getAttribute("src"))
        element.setAttribute(
          "src",
          new URL(element.getAttribute("src"), page.sourceUrl).href,
        );
      if (element.tagName === "IMG") {
        element.setAttribute("loading", "lazy");
        element.removeAttribute("srcset");
      }
    });
    return doc.body.innerHTML;
  }, [page, pagesByTitle]);

  return (
    <>
      <a href="#reading" className="skip-link">
        انتقل إلى القراءة
      </a>
      <header className="site-header">
        <a
          className="brand"
          href={`?page=${manifest.readingOrder[0]}`}
          onClick={(event) => {
            event.preventDefault();
            navigate(manifest.readingOrder[0]);
          }}
          aria-label="أدب الرجل، بداية الكتاب"
        >
          <span>
            <strong>أدب الرجل</strong>
            <small>سامي الطحاوي</small>
          </span>
        </a>
        <span className="header-note">دليل الرجل إلى الحياة</span>
        <div className="header-actions">
          <button
            className={`save-button ${isBookmarked ? "is-saved" : ""}`}
            aria-label={isBookmarked ? "إزالة من المحفوظة" : "حفظ الصفحة"}
            aria-pressed={isBookmarked}
            onClick={toggleSaved}
          >
            <Icon name="bookmark" />
          </button>
          <button
            className="settings-button"
            onClick={() => {
              setSidebarOpen(false);
              setPreferencesOpen(true);
            }}
            aria-label="إعدادات القراءة"
            aria-haspopup="dialog"
            aria-controls="reader-preferences"
          >
            <Icon name="settings" />
          </button>
          <button
            ref={menuButtonRef}
            className="contents-toggle"
            aria-label="الفهرس"
            aria-expanded={sidebarOpen}
            aria-controls="book-contents"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Icon name="menu" />
          </button>
        </div>
      </header>

      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="إغلاق الفهرس"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        ref={sidebarRef}
        id="book-contents"
        className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
        aria-label="فهرس الكتاب"
      >
        <div className="sidebar-top">
          <div className="sidebar-heading">
            <h2>فهرس الكتاب</h2>
            <span>{number(manifest.totalPages)} صفحة</span>
            <button
              className="close-contents icon-button"
              aria-label="إغلاق الفهرس"
              onClick={() => {
                setSidebarOpen(false);
                menuButtonRef.current?.focus();
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <label className="search-field">
            <Icon name="search" size={18} />
            <input
              type="search"
              placeholder="ابحث في الكتاب…"
              aria-label="ابحث في الكتاب"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="contents-tabs" role="group" aria-label="عرض الصفحات">
            <button
              className={filter === "all" ? "selected" : ""}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              جميع الصفحات
            </button>
            <button
              className={filter === "saved" ? "selected" : ""}
              aria-pressed={filter === "saved"}
              onClick={() => setFilter("saved")}
            >
              المحفوظة <span>{number(bookmarks.length)}</span>
            </button>
          </div>
        </div>
        <nav className="contents-list" aria-label="صفحات الكتاب">
          {hasQuery && !searchError && (
            <p className="search-summary" role="status">
              {searchLoading || !searchIndex
                ? "جارٍ البحث…"
                : `${number(filteredPages.length)} نتيجة في العناوين والنصوص`}
            </p>
          )}
          {hasQuery && searchError && (
            <div className="list-empty" role="alert">
              <p>تعذّر تحميل البحث. حاول مرة أخرى.</p>
              <button onClick={() => setSearchAttempt((value) => value + 1)}>
                إعادة المحاولة
              </button>
            </div>
          )}
          {filteredPages.map((item) => (
            <button
              key={item.pageid}
              className={`chapter-link ${item.pageid === pageId ? "active" : ""} ${hasQuery ? "search-result" : ""}`}
              aria-current={item.pageid === pageId ? "page" : undefined}
              onClick={() => navigate(item.pageid)}
            >
              <span className="chapter-number">
                {number(orderedPages.indexOf(item) + 1).padStart(2, "0")}
              </span>
              <span className="chapter-copy">
                <span className="chapter-name">
                  <HighlightedText
                    text={item.readingTitle ?? item.title}
                    terms={terms}
                  />
                </span>
                {excerpts.get(item.pageid) && (
                  <span className="search-excerpt">
                    <HighlightedText
                      text={excerpts.get(item.pageid)}
                      terms={terms}
                    />
                  </span>
                )}
              </span>
              {finished.includes(item.pageid) ? (
                <Icon name="check" size={14} />
              ) : bookmarks.includes(item.pageid) ? (
                <Icon name="bookmark" size={14} />
              ) : null}
            </button>
          ))}
          {!filteredPages.length && (!hasQuery || searchIndex) && (
            <div className="list-empty">
              <Icon
                name={filter === "saved" ? "bookmark" : "search"}
                size={26}
              />
              <p>
                {hasQuery
                  ? "لا توجد صفحات تطابق بحثك"
                  : "احفظ صفحة لتعود إليها هنا"}
              </p>
              {hasQuery && (
                <button onClick={() => setQuery("")}>مسح البحث</button>
              )}
            </div>
          )}
        </nav>
        <div className="reading-status">
          <div>
            <span>رحلتك في الكتاب</span>
            <strong>
              {number(finished.filter((id) => pagesById.has(id)).length)} /{" "}
              {number(manifest.totalPages)}
            </strong>
          </div>
          <div className="status-track">
            <span
              style={{
                width: `${(finished.length / manifest.totalPages) * 100}%`,
              }}
            />
          </div>
          <small>موضع قراءتك محفوظ تلقائيًا</small>
        </div>
      </aside>

      <main className="reader-main" id="reading" tabIndex={-1}>
        <div className="book-page" key={pageId}>
          <div className="chapter-heading">
            <p className="chapter-kicker">
              الصفحة {number(index + 1)}{" "}
              <span>من {number(manifest.totalPages)}</span>
            </p>
            <h1>{readingTitle}</h1>
            <div className="chapter-meta">
              <span>{number(active.readingMinutes)} دقائق قراءة</span>
              <span className="meta-dot">·</span>
              <span>{number(active.wordCount)} كلمة</span>
            </div>
          </div>
          <div className="title-ornament">
            <span />
            <i>❧</i>
            <span />
          </div>
          {pageError ? (
            <ErrorMessage retry={() => setRetry((value) => value + 1)}>
              تعذّر تحميل هذه الصفحة. حاول فتحها مرة أخرى.
            </ErrorMessage>
          ) : !page ? (
            <div className="page-loading" role="status">
              جارٍ فتح الصفحة…
            </div>
          ) : (
            <article
              ref={articleRef}
              className="book-content"
              style={{
                "--reading-size": `${Math.min(35, Math.max(20, Number(fontSize) || 25))}px`,
              }}
              onClick={(event) => {
                const link = event.target.closest("a[data-page-id]");
                if (
                  link &&
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  navigate(
                    Number(link.dataset.pageId),
                    new URL(link.href).hash,
                  );
                }
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
          {page && (
            <footer className="chapter-footer">
              <span className="end-mark">◆</span>
              <button
                className={`finished-button ${isFinished ? "is-finished" : ""}`}
                aria-pressed={isFinished}
                onClick={toggleFinished}
              >
                <Icon name="check" size={17} />
                {isFinished
                  ? "تمّت قراءة هذه الصفحة"
                  : "أتممتُ قراءة هذه الصفحة"}
              </button>
              <nav className="page-navigation" aria-label="التنقل بين الصفحات">
                <button
                  disabled={index === 0}
                  aria-keyshortcuts="ArrowRight"
                  onClick={() => navigate(orderedPages[index - 1].pageid)}
                >
                  <Icon name="right" size={20} />
                  <span>
                    <small>الصفحة السابقة</small>
                    <strong>
                      {index
                        ? (orderedPages[index - 1].readingTitle ??
                          orderedPages[index - 1].title)
                        : "بداية الكتاب"}
                    </strong>
                  </span>
                </button>
                <button
                  className="next-page"
                  aria-keyshortcuts="ArrowLeft"
                  disabled={index === orderedPages.length - 1}
                  onClick={() => navigate(orderedPages[index + 1].pageid)}
                >
                  <span>
                    <small>الصفحة التالية</small>
                    <strong>
                      {orderedPages[index + 1]?.readingTitle ??
                        orderedPages[index + 1]?.title ??
                        "نهاية الكتاب"}
                    </strong>
                  </span>
                  <Icon name="left" size={20} />
                </button>
              </nav>
            </footer>
          )}
        </div>
        <footer className="site-footer">
          <span>أدب الرجل</span>
        </footer>
      </main>
      <PreferencesDialog
        open={preferencesOpen}
        onClose={() => setPreferencesOpen(false)}
        theme={theme}
        setTheme={setTheme}
        fontSize={fontSize}
        setFontSize={setFontSize}
      />
      <div
        className="scroll-progress"
        style={{ width: `${progress}%` }}
        aria-hidden="true"
      />
    </>
  );
}

function App() {
  const [manifest, setManifest] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch(dataUrl("manifest.json"), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Manifest unavailable");
        return response.json();
      })
      .then((data) => {
        if (
          !data.totalPages ||
          !Array.isArray(data.pages) ||
          !Array.isArray(data.readingOrder)
        )
          throw new Error("Invalid manifest");
        setManifest(data);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  if (error)
    return (
      <ErrorMessage retry={() => setAttempt((value) => value + 1)}>
        تعذّر تحميل فهرس الكتاب. تحقق من اتصالك وحاول مجددًا.
      </ErrorMessage>
    );
  if (!manifest)
    return (
      <div className="initial-loading" role="status">
        <Icon name="book" size={42} />
        <p>أدب الرجل</p>
        <small>جارٍ فتح الكتاب…</small>
      </div>
    );
  return <Reader manifest={manifest} />;
}

createRoot(document.getElementById("root")).render(<App />);
