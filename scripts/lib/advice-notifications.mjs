import { createHash } from "node:crypto";
import { validateBook } from "../../src/lib/book.js";
import { markdownDetails } from "../../src/lib/markdown.js";

const topics = {
  daily: "adabbook_daily_advice",
  friday: "adabbook_friday_advice",
};
const cairoClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", hourCycle: "h23",
});

export function validateAdviceState(state) {
  if (state?.schemaVersion !== 1) throw new Error("Invalid advice delivery history.");
  for (const kind of Object.keys(topics)) {
    const delivery = state[kind];
    if (delivery === null) continue;
    if (!delivery || !/^\d{4}-\d{2}-\d{2}$/.test(delivery.date) ||
        !/^[a-f0-9]{64}$/.test(delivery.eventId) ||
        !["pending", "sent"].includes(delivery.status) ||
        !Number.isSafeInteger(delivery.pageId) || delivery.pageId <= 0) {
      throw new Error("Invalid advice delivery history.");
    }
  }
  return state;
}

export function planAdvice(book, { kind, now = new Date() }) {
  validateBook(book);
  if (!Object.hasOwn(topics, kind)) throw new Error("Invalid advice cadence.");
  const clock = Object.fromEntries(cairoClock.formatToParts(now).map(({ type, value }) => [type, value]));
  if (Number(clock.hour) < 9 || (kind === "friday" && clock.weekday !== "Fri")) return null;
  const date = `${clock.year}-${clock.month}-${clock.day}`;
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const slot = kind === "daily" ? days : Math.floor(days / 7);
  // Introductory material is not a standalone piece of advice. Rotate through
  // the original page IDs so reruns choose the same page without randomness.
  const pages = book.pages
    .filter((page) => !/^(مقدمة|خاتمة|فهرس)/u.test(page.title.trim()))
    .sort((a, b) => a.pageid - b.pageid);
  if (!pages.length) throw new Error("No advice pages are available.");
  const page = pages[slot % pages.length];
  const details = markdownDetails(page.markdown, page.title);
  const text = details.text.startsWith(details.readingTitle)
    ? details.text.slice(details.readingTitle.length).trim() : details.text;
  const label = kind === "daily" ? "وصية اليوم" : "وصية الجمعة";
  const eventId = createHash("sha256").update(`adabbook:${kind}_advice:v1:${date}`).digest("hex");
  const message = {
    topic: topics[kind],
    notification: {
      title: `${label}: ${details.readingTitle}`.slice(0, 90),
      body: text.length > 180 ? `${text.slice(0, 177).trimEnd()}…` : text,
    },
    data: {
      type: `${kind}_advice`, event_id: eventId,
      page_ids: String(page.pageid), page_count: "1",
    },
    android: {
      priority: "high", ttl: 12 * 60 * 60 * 1000, collapseKey: eventId,
      notification: { icon: "ic_notification", tag: eventId },
    },
    apns: {
      headers: {
        "apns-collapse-id": eventId,
        "apns-expiration": String(Math.floor(now.getTime() / 1000) + 12 * 3600),
      },
      payload: { aps: { sound: "default" } },
    },
  };
  if (Buffer.byteLength(JSON.stringify(message), "utf8") > 2000) {
    throw new Error("Advice notification exceeds the payload limit.");
  }
  return { date, eventId, pageId: page.pageid, message };
}

export async function notifyAdvice({
  book, now = new Date(), readState, saveState, verifyPublished, send,
}) {
  const plans = Object.keys(topics).map((kind) => ({ kind, plan: planAdvice(book, { kind, now }) }))
    .filter(({ plan }) => plan);
  if (!plans.length) return [];
  await verifyPublished(book);
  let state = await readState() ?? { schemaVersion: 1, daily: null, friday: null };
  validateAdviceState(state);
  const results = [];
  for (const { kind, plan } of plans) {
    const previous = state[kind];
    if (previous && previous.date >= plan.date) {
      if (previous.status === "pending") {
        throw new Error(`Advice ${previous.eventId} needs review; refusing an automatic resend.`);
      }
      results.push({ kind, status: "already_sent" });
      continue;
    }
    // Save the intent first. A lost FCM response or post-send write failure
    // must not broadcast the same advice again on a workflow retry.
    const delivery = {
      date: plan.date, eventId: plan.eventId, pageId: plan.pageId, status: "pending",
    };
    state = { ...state, [kind]: delivery };
    await saveState(state);
    const messageName = await send(plan.message);
    state = { ...state, [kind]: { ...delivery, status: "sent", messageName } };
    await saveState(state);
    results.push({ kind, status: "sent", eventId: plan.eventId, pageId: plan.pageId });
  }
  return results;
}
