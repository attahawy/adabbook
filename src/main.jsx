import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import DOMPurify from "dompurify";
import { prepareBook } from "./lib/book.js";
import { renderMarkdown } from "./lib/markdown.js";
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
const contentsTabs = [
  ["all", "جميع الصفحات"],
  ["topics", "الموضوعات"],
  ["saved", "المحفوظة"],
];
function HighlightedText({ text, terms }) {
  const ranges = findMatchRanges(text, terms);
  if (!ranges.length) return text;
  const parts = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    parts.push(text.slice(cursor, start));
    parts.push(<mark key={`${start}-${end}`}>{text.slice(start, end)}</mark>);
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
      aria-describedby="preferences-help"
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
        <p id="preferences-help" className="preferences-help">
          أثناء القراءة، استخدم السهم الأيمن في لوحة المفاتيح للانتقال إلى الصفحة
          السابقة، والسهم الأيسر للانتقال إلى الصفحة التالية.
        </p>
      </div>
    </dialog>
  );
}

function Reader({ book }) {
  const orderedPages = book.pages;
  const totalPages = orderedPages.length;
  const firstPageId = orderedPages[0].pageid;
  const pagesById = useMemo(
    () => new Map(orderedPages.map((page) => [page.pageid, page])),
    [orderedPages],
  );
  const pagesByTitle = useMemo(
    () =>
      new Map(orderedPages.map((page) => [normalize(page.title), page.pageid])),
    [orderedPages],
  );
  const [lastPage, setLastPage] = useStored("last-page", firstPageId);
  const pageFromUrl = () =>
    Number(new URLSearchParams(location.search).get("page"));
  const [pageId, setPageId] = useState(() =>
    pagesById.has(pageFromUrl())
      ? pageFromUrl()
      : pagesById.has(lastPage)
        ? lastPage
        : firstPageId,
  );
  const [bookmarks, setBookmarks] = useStored("bookmarks", []);
  const [finished, setFinished] = useStored("finished", []);
  const savedCount = bookmarks.filter((id) => pagesById.has(id)).length;
  const finishedCount = finished.filter((id) => pagesById.has(id)).length;
  const [fontSize, setFontSize] = useStored("font-size", 25);
  const [theme, setTheme] = useStored("theme", "paper");
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const topicTags = useMemo(() => {
    const counts = new Map();
    for (const page of orderedPages)
      for (const tag of page.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b, "ar"));
  }, [orderedPages]);
  const searchIndex = useMemo(
    () =>
      new Map(
        orderedPages.map((page) => [
          page.pageid,
          {
            text: page.text,
            normalized: normalize(
              [page.title, page.readingTitle, page.text, ...page.tags].join(" "),
            ),
          },
        ]),
      ),
    [orderedPages],
  );
  const hasQuery = query.trim().length > 0;
  const [filter, setFilter] = useState("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const articleRef = useRef(null);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  const topicsBackRef = useRef(null);
  const startAtTopRef = useRef(false);
  const page = pagesById.get(pageId);
  const readingTitle = page.readingTitle;
  const index = orderedPages.findIndex((item) => item.pageid === pageId);
  const isBookmarked = bookmarks.includes(pageId);
  const isFinished = finished.includes(pageId);

  const selectContentsTab = (next) => {
    if (next !== filter && (next === "topics" || filter === "topics"))
      setQuery("");
    setFilter(next);
  };
  const openTopic = (tag) => {
    setSelectedTag(tag);
    setQuery("");
    setFilter("topics");
    setSidebarOpen(true);
    requestAnimationFrame(() =>
      topicsBackRef.current?.focus({ preventScroll: true }),
    );
  };
  const showAllTopics = () => {
    setSelectedTag("");
    setQuery("");
    requestAnimationFrame(() =>
      sidebarRef.current?.querySelector(".topic-link")?.focus(),
    );
  };

  useEffect(() => {
    document.documentElement.dataset.theme =
      theme === "night" ? "night" : "paper";
  }, [theme]);
  useEffect(() => {
    setLastPage(pageId);
  }, [pageId, setLastPage]);
  useEffect(() => {
    const onPopState = () => {
      startAtTopRef.current = false;
      const requested = pageFromUrl();
      if (pagesById.has(requested)) setPageId(requested);
      else setPageId(firstPageId);
    };
    window.addEventListener("popstate", onPopState);
    if (!pageFromUrl())
      history.replaceState(null, "", `?page=${pageId}${location.hash}`);
    return () => window.removeEventListener("popstate", onPopState);
  }, [pagesById, firstPageId, pageId]);

  useLayoutEffect(() => {
    const startAtTop = startAtTopRef.current;
    startAtTopRef.current = false;
    const position = startAtTop
      ? 0
      : Number(readStored(`position:${pageId}`, 0)) || 0;
    const restoreScroll = () => {
      let anchor;
      try {
        anchor = decodeURIComponent(location.hash.slice(1));
      } catch {
        anchor = "";
      }
      if (anchor && document.getElementById(anchor))
        document.getElementById(anchor).scrollIntoView();
      else window.scrollTo(0, position);
    };
    // Direct navigation starts fresh; reloads and history resume reading.
    if (startAtTop) restoreScroll();
    const frame = requestAnimationFrame(restoreScroll);
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
          ...sidebarRef.current.querySelectorAll("button, input, a, [tabindex]"),
        ].filter((node) => !node.disabled && node.tabIndex >= 0);
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
        startAtTopRef.current = true;
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
  const showTopicIndex = filter === "topics" && !selectedTag;
  const visibleTopics = useMemo(
    () =>
      topicTags.filter(([tag]) =>
        terms.every((term) => normalize(tag).includes(term)),
      ),
    [topicTags, terms],
  );
  const filteredPages = useMemo(
    () =>
      orderedPages.filter((item) => {
        if (filter === "topics" && selectedTag && !item.tags.includes(selectedTag))
          return false;
        if (filter === "saved" && !bookmarks.includes(item.pageid))
          return false;
        if (!terms.length) return true;
        const haystack = searchIndex.get(item.pageid).normalized;
        return terms.every((term) => haystack.includes(term));
      }),
    [searchIndex, orderedPages, selectedTag, filter, bookmarks, terms],
  );
  useEffect(() => {
    sidebarRef.current?.querySelector(".contents-list")?.scrollTo(0, 0);
  }, [query, selectedTag, filter]);
  const excerpts = useMemo(() => {
    if (!hasQuery) return new Map();
    return new Map(
      filteredPages.map((item) => {
        const title = normalize(item.readingTitle);
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
    const doc = new DOMParser().parseFromString(
      DOMPurify.sanitize(renderMarkdown(page.markdown), {
        FORBID_TAGS: ["style", "form", "button", "iframe"],
        FORBID_ATTR: ["style"],
      }),
      "text/html",
    );
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
      const id = href.startsWith("?page=")
        ? Number(url.searchParams.get("page"))
        : url.origin === source.origin &&
            url.pathname === source.pathname &&
            title
          ? pagesByTitle.get(normalize(title))
          : undefined;
      if (pagesById.has(id)) {
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
  }, [page, pagesById, pagesByTitle]);

  return (
    <>
      <a href="#reading" className="skip-link">
        انتقل إلى القراءة
      </a>
      <header className="site-header">
        <a
          className="brand"
          href={`?page=${firstPageId}`}
          onClick={(event) => {
            event.preventDefault();
            navigate(firstPageId);
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
            <span>{number(totalPages)} صفحة</span>
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
              placeholder={
                showTopicIndex ? "ابحث عن موضوع…" : "ابحث في النصوص والوسوم…"
              }
              aria-label="ابحث في الكتاب"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div
            className="contents-tabs"
            role="tablist"
            aria-label="عرض الصفحات"
            onKeyDown={(event) => {
              if (
                event.defaultPrevented ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              const buttons = [
                ...event.currentTarget.querySelectorAll('[role="tab"]'),
              ];
              const current = buttons.indexOf(
                event.target.closest('[role="tab"]'),
              );
              if (current < 0) return;
              event.preventDefault();
              const step = event.key === "ArrowLeft" ? 1 : -1;
              let next =
                (current + step + contentsTabs.length) % contentsTabs.length;
              if (event.key === "Home") next = 0;
              else if (event.key === "End") next = contentsTabs.length - 1;
              selectContentsTab(contentsTabs[next][0]);
              buttons[next]?.focus();
            }}
          >
            {contentsTabs.map(([key, label]) => (
              <button
                key={key}
                id={`contents-tab-${key}`}
                role="tab"
                className={filter === key ? "selected" : ""}
                aria-selected={filter === key}
                aria-controls="book-contents-panel"
                tabIndex={filter === key ? 0 : -1}
                onClick={() => selectContentsTab(key)}
              >
                {label} {key === "saved" && <span>{number(savedCount)}</span>}
              </button>
            ))}
          </div>
          {filter === "topics" && selectedTag && (
            <div className="topic-pages-heading">
              <button
                ref={topicsBackRef}
                className="topics-back"
                onClick={showAllTopics}
              >
                العودة إلى جميع الموضوعات
              </button>
              <div className="topic-pages-title">
                <h3>{selectedTag}</h3>
                <span role="status">{number(filteredPages.length)} صفحة</span>
              </div>
            </div>
          )}
        </div>
        <div
          className="contents-list"
          id="book-contents-panel"
          role="tabpanel"
          aria-labelledby={`contents-tab-${filter}`}
          tabIndex={0}
        >
          {showTopicIndex ? (
            <>
              <p className="search-summary" role="status">
                {number(visibleTopics.length)} موضوعًا
              </p>
              {visibleTopics.map(([tag, count]) => (
                <button
                  key={tag}
                  className="topic-link"
                  onClick={() => openTopic(tag)}
                >
                  <span className="topic-name">
                    <HighlightedText text={tag} terms={terms} />
                  </span>
                  <span className="topic-count">{number(count)} صفحة</span>
                </button>
              ))}
              {!visibleTopics.length && (
                <div className="list-empty">
                  <p>لا توجد موضوعات تطابق بحثك</p>
                  <button onClick={() => setQuery("")}>مسح البحث</button>
                </div>
              )}
            </>
          ) : (
            <>
              {hasQuery && (
                <p className="search-summary" role="status">
                  {`${number(filteredPages.length)} نتيجة في العناوين والنصوص والوسوم`}
                </p>
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
                      <HighlightedText text={item.readingTitle} terms={terms} />
                    </span>
                    {item.tags.length > 0 && (
                      <span className="chapter-topics">
                        <HighlightedText text={item.tags.join(" · ")} terms={terms} />
                      </span>
                    )}
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
              {!filteredPages.length && (
                <div className="list-empty">
                  <Icon
                    name={filter === "saved" ? "bookmark" : "search"}
                    size={26}
                  />
                  <p>
                    {hasQuery
                      ? "لا توجد وصايا تطابق التصفية"
                      : "احفظ صفحة لتعود إليها هنا"}
                  </p>
                  {hasQuery && (
                    <button onClick={() => setQuery("")}>مسح البحث</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="reading-status">
          <div>
            <span>رحلتك في الكتاب</span>
            <strong>
              {number(finishedCount)} / {number(totalPages)}
            </strong>
          </div>
          <div className="status-track">
            <span
              style={{
                width: `${(finishedCount / totalPages) * 100}%`,
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
              الصفحة {number(index + 1)} <span>من {number(totalPages)}</span>
            </p>
            <h1>{readingTitle}</h1>
            <div className="chapter-meta">
              <span>{number(page.readingMinutes)} دقائق قراءة</span>
              <span className="meta-dot">·</span>
              <span>{number(page.wordCount)} كلمة</span>
            </div>
          </div>
          <div className="title-ornament">
            <span />
            <i>❧</i>
            <span />
          </div>
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
                navigate(Number(link.dataset.pageId), new URL(link.href).hash);
              }
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {page.tags.length > 0 && (
            <div
              className="chapter-tags"
              role="group"
              aria-label="موضوعات الوصية"
            >
              {page.tags.map((tag) => (
                <button
                  key={tag}
                  aria-label={`عرض وصايا عن ${tag}`}
                  aria-pressed={filter === "topics" && selectedTag === tag}
                  onClick={() => openTopic(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <footer className="chapter-footer">
            <span className="end-mark">◆</span>
            <button
              className={`finished-button ${isFinished ? "is-finished" : ""}`}
              aria-pressed={isFinished}
              onClick={toggleFinished}
            >
              <Icon name="check" size={17} />
              {isFinished ? "تمّت قراءة هذه الصفحة" : "أتممتُ قراءة هذه الصفحة"}
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
                      ? orderedPages[index - 1].readingTitle
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
                    {orderedPages[index + 1]?.readingTitle ?? "نهاية الكتاب"}
                  </strong>
                </span>
                <Icon name="left" size={20} />
              </button>
            </nav>
          </footer>
        </div>
        <footer className="site-footer">
          <span>حمّل تطبيق أدب الرجل</span>
          <nav className="app-downloads" aria-label="تحميل التطبيق">
            <a
              href="https://apps.apple.com/app/id6768483584"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="حمّل التطبيق من App Store"
              dir="ltr"
            >
              App Store
            </a>
            <a
              href="https://play.google.com/store/apps/details?id=com.rajol.adabbookapp"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="حمّل التطبيق من Google Play"
              dir="ltr"
            >
              Google Play
            </a>
          </nav>
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
  const [book, setBook] = useState(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    fetch(dataUrl("book.json"), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Book unavailable");
        return response.json();
      })
      .then((data) => {
        setBook(prepareBook(data));
      })
      .catch((error) => {
        if (error.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  if (error)
    return (
      <ErrorMessage retry={() => setAttempt((value) => value + 1)}>
        تعذّر تحميل الكتاب. تحقق من اتصالك وحاول مجددًا.
      </ErrorMessage>
    );
  if (!book)
    return (
      <div className="initial-loading" role="status">
        <Icon name="book" size={42} />
        <p>أدب الرجل</p>
        <small>جارٍ فتح الكتاب…</small>
      </div>
    );
  return <Reader book={book} />;
}

createRoot(document.getElementById("root")).render(<App />);
