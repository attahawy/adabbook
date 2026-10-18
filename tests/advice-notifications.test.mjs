import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { main } from "../scripts/notify-advice.mjs";
import { githubStateStore } from "../scripts/lib/new-page-notifications.mjs";
import { notifyAdvice, planAdvice, validateAdviceState } from "../scripts/lib/advice-notifications.mjs";

const book = {
  schemaVersion: 2, sourceUrl: "https://example.org/wiki/", fetchedAt: "2026-10-18T00:00:00Z",
  pages: [
    { pageid: 2, title: "مقدمة لا بد منها", revisionId: 1, markdown: "# مقدمة\n\nمادة تمهيدية" },
    ...[42, 77, 413].map((pageid) => ({
      pageid, title: `وصية ${pageid}`, revisionId: 1,
      markdown: `# عنوان ${pageid}\n\nهذه وصية من الكتاب.`,
    })),
  ],
};
const friday = new Date("2026-10-16T06:00:00Z"); // Cairo summer time, 09:00.

function runner() {
  let state = null;
  const sent = [];
  const options = {
    book, now: friday,
    readState: async () => structuredClone(state),
    saveState: async (next) => { state = structuredClone(next); },
    verifyPublished: async () => {},
    send: async (message) => {
      const kind = message.data.type === "daily_advice" ? "daily" : "friday";
      assert.equal(state[kind].status, "pending", "persist before broadcasting");
      sent.push(message);
      return "projects/adabbook-rajol/messages/test";
    },
  };
  return { options, sent, state: () => structuredClone(state) };
}

test("9am Cairo is enforced in summer and winter, with Friday-only weekly advice", () => {
  for (const [before, due] of [
    ["2026-10-16T05:59:59Z", "2026-10-16T06:00:00Z"],
    ["2026-11-06T06:59:59Z", "2026-11-06T07:00:00Z"],
  ]) {
    assert.equal(planAdvice(book, { kind: "daily", now: new Date(before) }), null);
    assert.equal(planAdvice(book, { kind: "friday", now: new Date(before) }), null);
    assert.ok(planAdvice(book, { kind: "daily", now: new Date(due) }));
    assert.ok(planAdvice(book, { kind: "friday", now: new Date(due) }));
  }
  assert.equal(planAdvice(book, { kind: "friday", now: new Date("2026-10-18T06:00:00Z") }), null);
});

test("advice contains a real source page, readable excerpt, and a stable event ID", () => {
  const plan = planAdvice(book, { kind: "daily", now: friday });
  assert.notEqual(plan.pageId, 2, "do not send the introduction as advice");
  assert.equal(plan.message.topic, "adabbook_daily_advice");
  assert.deepEqual(plan.message.data, {
    type: "daily_advice", event_id: plan.eventId, page_ids: String(plan.pageId), page_count: "1",
  });
  assert.match(plan.message.notification.title, /^وصية اليوم:/u);
  assert.equal(plan.message.notification.body, "هذه وصية من الكتاب.");
  assert.equal(plan.eventId, planAdvice(book, { kind: "daily", now: new Date("2026-10-16T07:00:00Z") }).eventId);
  assert.notEqual(plan.eventId, planAdvice(book, { kind: "friday", now: friday }).eventId);
  assert.equal(plan.message.android.notification.tag, plan.eventId);
});

test("daily and weekly rotation advance independently without adjacent repeats", () => {
  const daily = planAdvice(book, { kind: "daily", now: friday });
  const nextDaily = planAdvice(book, { kind: "daily", now: new Date("2026-10-17T06:00:00Z") });
  const weekly = planAdvice(book, { kind: "friday", now: friday });
  const nextWeekly = planAdvice(book, { kind: "friday", now: new Date("2026-10-23T06:00:00Z") });
  assert.notEqual(daily.pageId, nextDaily.pageId);
  assert.notEqual(weekly.pageId, nextWeekly.pageId);
});

test("Friday sends to both distinct audiences once; retries never repeat a send", async () => {
  const run = runner();
  assert.deepEqual((await notifyAdvice(run.options)).map((result) => result.kind), ["daily", "friday"]);
  assert.deepEqual(run.sent.map((message) => message.topic), ["adabbook_daily_advice", "adabbook_friday_advice"]);
  assert.equal(run.state().daily.status, "sent");
  assert.equal(run.state().friday.status, "sent");
  assert.ok((await notifyAdvice(run.options)).every((result) => result.status === "already_sent"));
  assert.equal(run.sent.length, 2);
});

test("ordinary days send only daily advice and do not touch the Friday audience", async () => {
  const run = runner();
  run.options.now = new Date("2026-10-18T06:00:00Z");
  await notifyAdvice(run.options);
  assert.equal(run.sent.length, 1);
  assert.equal(run.state().friday, null);
});

test("before the sending window no history or network is accessed", async () => {
  const fail = async () => { throw new Error("should not run"); };
  assert.deepEqual(await notifyAdvice({
    book, now: new Date("2026-10-18T05:59:59Z"),
    readState: fail, saveState: fail, verifyPublished: fail, send: fail,
  }), []);
});

test("publication or intent-write failure prevents all sends", async () => {
  for (const stage of ["verifyPublished", "saveState"]) {
    const run = runner();
    run.options[stage] = async () => { throw new Error(stage); };
    await assert.rejects(notifyAdvice(run.options), new RegExp(stage));
    assert.equal(run.sent.length, 0);
  }
});

test("uncertain sends are not repeated, but the next day's advice still runs", async () => {
  const run = runner();
  const send = run.options.send;
  run.options.send = async () => { throw new Error("lost FCM response"); };
  await assert.rejects(notifyAdvice(run.options), /lost FCM response/);
  run.options.send = send;
  await assert.rejects(notifyAdvice(run.options), /needs review/);
  assert.equal(run.sent.length, 0);
  run.options.now = new Date("2026-10-17T06:00:00Z");
  await notifyAdvice(run.options);
  assert.equal(run.sent.length, 1);
});

test("a failed post-send history write cannot cause a duplicate", async () => {
  const run = runner();
  const save = run.options.saveState;
  let writes = 0;
  run.options.saveState = async (next) => {
    if (++writes === 2) throw new Error("post-send write failure");
    await save(next);
  };
  await assert.rejects(notifyAdvice(run.options), /post-send write failure/);
  run.options.saveState = save;
  await assert.rejects(notifyAdvice(run.options), /needs review/);
  assert.equal(run.sent.length, 1);
});

test("invalid history or cadence is rejected", () => {
  assert.throws(() => planAdvice(book, { kind: "other", now: friday }), /Invalid advice cadence/);
  for (const state of [{}, { schemaVersion: 1, daily: {}, friday: null }]) {
    assert.throws(() => validateAdviceState(state), /Invalid advice delivery history/);
  }
});

test("advice history uses a separate branch and validation contract", async () => {
  const state = { schemaVersion: 1, daily: null, friday: null };
  const urls = [];
  const store = githubStateStore({
    repository: "owner/repo", token: "test-token", branch: "advice-notification-state",
    validate: validateAdviceState,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(url.includes("/git/ref/") ? {} : {
        sha: "test-sha", content: Buffer.from(JSON.stringify(state)).toString("base64"),
      }));
    },
  });
  assert.deepEqual(await store.readState(), state);
  assert.ok(urls.every((url) => url.includes("advice-notification-state")));
});

test("the whole current book produces bounded notification payloads", async () => {
  const current = JSON.parse(await readFile(new URL("../data/book.json", import.meta.url), "utf8"));
  for (let day = 0; day < current.pages.length; day++) {
    // Check payloads at noon UTC across the seasonal clock change. The
    // separate timing test checks summer and winter at exactly Cairo 09:00.
    const now = new Date(friday.getTime() + day * 86400000 + 6 * 3600000);
    const plan = planAdvice(current, { kind: "daily", now });
    assert.ok(Buffer.byteLength(JSON.stringify(plan.message), "utf8") <= 2000);
  }
});

test("CLI rejects unexpected arguments before attempting a broadcast", async () => {
  await assert.rejects(main({ env: {}, args: ["--send-all"] }), /Only --dry-run/);
});
