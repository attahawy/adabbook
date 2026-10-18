import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cert, initializeApp, deleteApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import {
  githubStateStore, notifyNewPages, planNotification, verifyPublishedBook,
} from "./lib/new-page-notifications.mjs";

export async function main({ env = process.env, args = process.argv.slice(2) } = {}) {
  if (args.some((arg) => arg !== "--dry-run")) {
    throw new Error("Only --dry-run is accepted as a command-line option.");
  }
  const book = JSON.parse(await readFile(new URL("../data/book.json", import.meta.url), "utf8"));
  const store = env.GITHUB_TOKEN
    ? githubStateStore({ repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN })
    : null;
  if (args.includes("--dry-run")) {
    const state = store ? await store.readState() : null;
    const plan = planNotification(book, state);
    console.log(JSON.stringify({
      status: plan?.baseline ? "baseline" : plan ? "would_send" : "unchanged",
      pageCount: plan?.pageCount ?? plan?.pageIds.length ?? 0,
      eventId: plan?.eventId,
      pendingReview: Boolean(state?.pending),
    }, null, 2));
    return;
  }
  if (!store || !env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Sending requires GITHUB_TOKEN, GITHUB_REPOSITORY and FIREBASE_SERVICE_ACCOUNT_JSON.");
  }
  let credentials;
  try {
    credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON.");
  }
  if (credentials.project_id !== "adabbook-rajol") {
    throw new Error("The sender must use the adabbook-rajol Firebase project.");
  }
  const app = initializeApp({ credential: cert(credentials) }, "adabbook-notifications");
  try {
    const result = await notifyNewPages({
      book,
      ...store,
      verifyPublished: verifyPublishedBook,
      send: (message) => getMessaging(app).send(message),
      resolvePending: env.RESOLVE_PENDING || "none",
      log: console.log,
    });
    console.log(JSON.stringify(result));
  } finally {
    await deleteApp(app);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Never print credentials, HTTP bodies, or complete SDK error objects.
    console.error(`New-page notifications failed: ${error.code || error.message}`);
    process.exitCode = 1;
  });
}
