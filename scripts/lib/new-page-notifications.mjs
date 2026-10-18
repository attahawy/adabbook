import { createHash } from "node:crypto";
import { validateBook } from "../../src/lib/book.js";
import { markdownDetails } from "../../src/lib/markdown.js";

export const notificationTopic = "adabbook_new_pages";
export const bookDigest = (book) =>
  createHash("sha256").update(JSON.stringify(validateBook(book))).digest("hex");

export function validateState(state) {
  if (
    state?.schemaVersion !== 1 ||
    !Array.isArray(state.knownPageIds) ||
    state.knownPageIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(state.knownPageIds).size !== state.knownPageIds.length ||
    !(state.pending === null ||
      (typeof state.pending?.eventId === "string" &&
        /^[a-f0-9]{64}$/.test(state.pending.eventId) &&
        Array.isArray(state.pending.pageIds) &&
        state.pending.pageIds.length > 0 &&
        state.pending.pageIds.every((id) => Number.isSafeInteger(id) && id > 0)))
  ) {
    throw new Error("Invalid notification state; refusing to reset delivery history.");
  }
  return state;
}

export function planNotification(book, state) {
  validateBook(book);
  if (state === null) return { baseline: true, pageCount: book.pages.length };
  validateState(state);
  const known = new Set(state.knownPageIds);
  const added = book.pages.filter((page) => !known.has(page.pageid));
  if (!added.length) return null;
  const pageIds = added.map((page) => page.pageid);
  const eventId = createHash("sha256")
    .update(`adabbook:new_pages:v1:${[...pageIds].sort((a, b) => a - b).join(",")}`)
    .digest("hex");
  const title = added.length === 1
    ? markdownDetails(added[0].markdown, added[0].title).readingTitle
    : added.length === 2
      ? "أضيفت صفحتان جديدتان إلى الكتاب"
      : `أضيفت ${added.length} ${added.length <= 10 ? "صفحات" : "صفحة"} جديدة إلى الكتاب`;
  const message = {
    topic: notificationTopic,
    notification: { title: "جديد أدب الرجل", body: title.slice(0, 160) },
    data: {
      type: "new_pages",
      event_id: eventId,
      page_ids: pageIds.join(","),
      page_count: String(pageIds.length),
    },
    android: {
      priority: "high",
      ttl: 7 * 24 * 60 * 60 * 1000,
      collapseKey: eventId,
      notification: { icon: "ic_notification", tag: eventId },
    },
    apns: {
      headers: {
        "apns-collapse-id": eventId,
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 7 * 86400),
      },
      payload: { aps: { sound: "default" } },
    },
  };
  if (Buffer.byteLength(JSON.stringify(message), "utf8") > 2000) {
    throw new Error("Notification exceeds the payload limit; split this content release.");
  }
  return { eventId, pageIds, message };
}

/** A durable intent is written BEFORE sending. An uncertain send needs review,
 * rather than automatically sending the same public broadcast again. */
export async function notifyNewPages({
  book, readState, saveState, verifyPublished, send,
  resolvePending = "none", log = () => {},
}) {
  validateBook(book);
  if (!["none", "sent", "retry"].includes(resolvePending)) {
    throw new Error("Invalid pending-delivery resolution.");
  }
  await verifyPublished(book);
  let state = await readState();
  if (state === null) {
    state = {
      schemaVersion: 1,
      knownPageIds: book.pages.map((page) => page.pageid),
      pending: null,
      lastDelivery: null,
    };
    await saveState(state);
    return { status: "baseline", pageCount: state.knownPageIds.length };
  }
  validateState(state);
  if (state.pending) {
    if (resolvePending === "none") {
      throw new Error(`Delivery ${state.pending.eventId} needs review. See docs/new-page-notifications.md before resolving it.`);
    }
    state = {
      ...state,
      knownPageIds: resolvePending === "sent"
        ? [...new Set([...state.knownPageIds, ...state.pending.pageIds])]
        : state.knownPageIds,
      lastDelivery: resolvePending === "sent"
        ? { ...state.pending, resolvedManually: true }
        : state.lastDelivery,
      pending: null,
    };
    await saveState(state);
  }
  const plan = planNotification(book, state);
  if (!plan) return { status: "unchanged" };
  const pending = {
    eventId: plan.eventId,
    pageIds: plan.pageIds,
    attemptedAt: new Date().toISOString(),
  };
  await saveState({ ...state, pending });
  const messageName = await send(plan.message);
  log(`FCM accepted ${plan.eventId}: ${messageName}`);
  await saveState({
    ...state,
    knownPageIds: [...new Set([...state.knownPageIds, ...plan.pageIds])],
    pending: null,
    lastDelivery: { ...pending, messageName, acceptedAt: new Date().toISOString() },
  });
  return { status: "sent", eventId: plan.eventId, pageCount: plan.pageIds.length };
}

export async function verifyPublishedBook(book, {
  url = "https://attahawy.github.io/adabbook/data/book.json",
  fetchImpl = fetch,
  attempts = 6,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const expected = bookDigest(book);
  const target = new URL(url);
  target.searchParams.set("release", expected);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchImpl(target, {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(30000),
      });
      if (response.ok && bookDigest(await response.json()) === expected) return;
    } catch { /* The new deployment may not have reached the CDN yet. */ }
    if (attempt + 1 < attempts) await wait(5000);
  }
  throw new Error("The published book does not match this release; no notification was sent.");
}

export function githubStateStore({
  repository, token, fetchImpl = fetch,
  branch = "notification-state", validate = validateState,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") || !token) {
    throw new Error("GITHUB_REPOSITORY and a repository-scoped GITHUB_TOKEN are required.");
  }
  if (!/^[a-z0-9-]+$/.test(branch)) throw new Error("Invalid history branch.");
  const path = "state.json";
  const base = `https://api.github.com/repos/${repository}`;
  let sha;
  let exists = false;

  async function api(path, { method = "GET", body, allow404 = false } = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`Notification history request failed (${response.status}); no history was reset.`);
    return response.json();
  }
  return {
    async readState() {
      const ref = await api(`/git/ref/heads/${branch}`, { allow404: true });
      if (!ref) return null;
      exists = true;
      const file = await api(`/contents/${path}?ref=${branch}`);
      sha = file.sha;
      return validate(JSON.parse(Buffer.from(file.content, "base64").toString("utf8")));
    },
    async saveState(state) {
      validate(state);
      const content = `${JSON.stringify(state, null, 2)}\n`;
      if (!exists) {
        // An orphan branch keeps delivery history out of site builds/data.
        const tree = await api("/git/trees", {
          method: "POST",
          body: { tree: [{ path, mode: "100644", type: "blob", content }] },
        });
        const commit = await api("/git/commits", {
          method: "POST",
          body: { message: "Initialize new-page notification history", tree: tree.sha, parents: [] },
        });
        await api("/git/refs", {
          method: "POST",
          body: { ref: `refs/heads/${branch}`, sha: commit.sha },
        });
        exists = true;
        const file = await api(`/contents/${path}?ref=${branch}`);
        sha = file.sha;
      } else {
        const result = await api(`/contents/${path}`, {
          method: "PUT",
          body: {
            message: "Record new-page notification delivery",
            branch, sha, content: Buffer.from(content).toString("base64"),
          },
        });
        sha = result.content.sha;
      }
    },
  };
}
