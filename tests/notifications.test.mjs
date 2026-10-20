import assert from "node:assert/strict";
import test from "node:test";
import {
  bookDigest, githubStateStore, notifyNewPages, planNotification,
  validateState, verifyPublishedBook,
} from "../scripts/lib/new-page-notifications.mjs";

const page = (id, title = `مصدر ${id}`) => ({
  pageid: id, title, revisionId: 1, markdown: `# عنوان ${id}\n\nنص الصفحة.`,
});
const book = (...ids) => ({
  schemaVersion: 2, sourceUrl: "https://example.org/wiki/",
  fetchedAt: "2026-10-18T00:00:00Z", pages: ids.map((id) => page(id)),
});
const history = (...ids) => ({ schemaVersion: 1, knownPageIds: ids, pending: null, lastDelivery: null });

function runner(initial = null) {
  let state = structuredClone(initial);
  const saved = [];
  const sent = [];
  const options = {
    book: book(2, 42, 77),
    readState: async () => structuredClone(state),
    saveState: async (next) => {
      state = structuredClone(next);
      saved.push(state);
    },
    verifyPublished: async () => {},
    send: async (message) => {
      assert.ok(state.pending, "persist the intent before a broadcast");
      sent.push(message);
      return "projects/adabbook-rajol/messages/test";
    },
  };
  return { options, saved, sent, state: () => structuredClone(state) };
}

test("first enabled run seeds the existing book and sends no historical pages", async () => {
  const run = runner();
  assert.deepEqual(await notifyNewPages(run.options), { status: "baseline", pageCount: 3 });
  assert.deepEqual(run.state().knownPageIds, [2, 42, 77]);
  assert.equal(run.sent.length, 0);
  assert.equal(planNotification(book(2), null).baseline, true);
});

test("edits, reordered pages, deletions and restored known IDs do not notify", () => {
  const data = book(42, 2);
  data.pages[0].revisionId = 99;
  data.pages[0].markdown = "# عنوان معدل\n\nنص معدل";
  data.pages[0].tags = ["أدب الكلام"];
  assert.equal(planNotification(data, history(2, 42, 77)), null);
  assert.equal(planNotification(book(2, 42, 77), history(2, 42, 77)), null);
});

test("multiple new pages make one public topic message with stable IDs and displayed heading", () => {
  const plan = planNotification(book(2, 42, 77), history(2));
  assert.deepEqual(plan.pageIds, [42, 77]);
  assert.equal(plan.message.topic, "adabbook_new_pages");
  assert.deepEqual(plan.message.data, {
    type: "new_pages", event_id: plan.eventId, page_ids: "42,77", page_count: "2",
  });
  assert.equal(plan.message.android.notification.tag, plan.eventId);
  assert.equal(plan.message.apns.headers["apns-collapse-id"], plan.eventId);
  assert.equal(plan.eventId, planNotification(book(77, 2, 42), history(2)).eventId);
  assert.equal(planNotification(book(2, 42), history(2)).message.notification.body, "عنوان 42");
});

test("accepted deliveries are persisted and reruns do not send them again", async () => {
  const run = runner(history(2));
  const result = await notifyNewPages(run.options);
  assert.equal(result.status, "sent");
  assert.equal(run.sent.length, 1);
  assert.equal(run.saved[0].pending.eventId, result.eventId);
  assert.equal(run.state().pending, null);
  assert.deepEqual(run.state().knownPageIds, [2, 42, 77]);
  assert.equal((await notifyNewPages(run.options)).status, "unchanged");
  assert.equal(run.sent.length, 1);
});

test("publication failure leaves history and messaging untouched", async () => {
  const run = runner(history(2));
  run.options.verifyPublished = async () => { throw new Error("stale CDN"); };
  await assert.rejects(notifyNewPages(run.options), /stale CDN/);
  assert.equal(run.saved.length, 0);
  assert.equal(run.sent.length, 0);
});

test("history write failure prevents the broadcast", async () => {
  const run = runner(history(2));
  run.options.saveState = async () => { throw new Error("conflict"); };
  await assert.rejects(notifyNewPages(run.options), /conflict/);
  assert.equal(run.sent.length, 0);
});

test("an uncertain send is recorded and is not automatically repeated", async () => {
  const run = runner(history(2));
  let attempts = 0;
  run.options.send = async () => { attempts++; throw new Error("lost response"); };
  await assert.rejects(notifyNewPages(run.options), /lost response/);
  assert.ok(run.state().pending);
  await assert.rejects(notifyNewPages(run.options), /needs review/);
  assert.equal(attempts, 1);
  assert.deepEqual(run.state().knownPageIds, [2]);
});

test("failure to save an accepted delivery also blocks automatic resend", async () => {
  const run = runner(history(2));
  const save = run.options.saveState;
  let writes = 0;
  run.options.saveState = async (state) => {
    if (++writes === 2) throw new Error("write failed after send");
    await save(state);
  };
  await assert.rejects(notifyNewPages(run.options), /write failed after send/);
  await assert.rejects(notifyNewPages(run.options), /needs review/);
  assert.equal(run.sent.length, 1);
});

test("manual confirmation records the uncertain delivery without resending", async () => {
  const plan = planNotification(book(2, 42, 77), history(2));
  const run = runner({ ...history(2), pending: { eventId: plan.eventId, pageIds: plan.pageIds } });
  assert.equal((await notifyNewPages({ ...run.options, resolvePending: "sent" })).status, "unchanged");
  assert.equal(run.sent.length, 0);
  assert.deepEqual(run.state().knownPageIds, [2, 42, 77]);
});

test("an explicit retry is required to attempt an uncertain delivery again", async () => {
  const plan = planNotification(book(2, 42, 77), history(2));
  const run = runner({ ...history(2), pending: { eventId: plan.eventId, pageIds: plan.pageIds } });
  assert.equal((await notifyNewPages({ ...run.options, resolvePending: "retry" })).status, "sent");
  assert.equal(run.sent.length, 1);
  assert.equal(run.state().lastDelivery.eventId, plan.eventId);
});

test("invalid history and oversized topic payloads fail before sending", () => {
  for (const invalid of [{}, { ...history(2), knownPageIds: [2, 2] }, { ...history(2), pending: {} }]) {
    assert.throws(() => validateState(invalid), /Invalid notification state/);
  }
  assert.throws(() => planNotification(book(...Array.from({ length: 1000 }, (_, i) => i + 1)), history()), /payload limit/);
});

test("the exact published book is checked, retrying stale CDN responses", async () => {
  const data = book(2, 42);
  let calls = 0;
  const urls = [];
  await verifyPublishedBook(data, {
    attempts: 2, wait: async () => {},
    fetchImpl: async (url) => {
      urls.push(url.href);
      return new Response(JSON.stringify(++calls === 1 ? book(2) : data));
    },
  });
  assert.equal(calls, 2);
  assert.ok(urls[0].includes(bookDigest(data)));
  await assert.rejects(verifyPublishedBook(data, {
    attempts: 1, fetchImpl: async () => new Response(JSON.stringify(book(2))),
  }), /no notification was sent/);
});

test("missing branch permits baseline, but inaccessible/corrupt history never resets", async () => {
  const options = { repository: "owner/repo", token: "fake-test-token" };
  const missing = githubStateStore({ ...options, fetchImpl: async () => new Response("{}", { status: 404 }) });
  assert.equal(await missing.readState(), null);
  const denied = githubStateStore({ ...options, fetchImpl: async () => new Response("{}", { status: 403 }) });
  await assert.rejects(denied.readState(), /403/);
  let requests = 0;
  const lostFile = githubStateStore({ ...options, fetchImpl: async () => new Response("{}", { status: ++requests === 1 ? 200 : 404 }) });
  await assert.rejects(lostFile.readState(), /404/);
});

test("GitHub history starts on its own branch and updates with the last file SHA", async () => {
  const requests = [];
  const responses = [
    [404, {}], [200, { sha: "tree" }], [201, { sha: "root-commit" }],
    [201, {}], [200, { sha: "file-v1" }], [200, { content: { sha: "file-v2" } }],
    [200, { content: { sha: "file-v3" } }],
  ];
  const store = githubStateStore({
    repository: "owner/repo", token: "fake-test-token",
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options, body: options.body && JSON.parse(options.body) });
      const [status, body] = responses.shift();
      return new Response(JSON.stringify(body), { status });
    },
  });
  assert.equal(await store.readState(), null);
  await store.saveState(history(2));
  await store.saveState(history(2, 42));
  await store.saveState(history(2, 42, 77));
  assert.deepEqual(requests[2].body.parents, []);
  assert.equal(requests[3].body.ref, "refs/heads/notification-state");
  assert.equal(requests[5].body.sha, "file-v1");
  assert.equal(requests[6].body.sha, "file-v2");
  const saved = JSON.parse(Buffer.from(requests[6].body.content, "base64").toString("utf8"));
  assert.deepEqual(saved.knownPageIds, [2, 42, 77]);
});
