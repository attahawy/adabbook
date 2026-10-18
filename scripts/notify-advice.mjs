import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { cert, initializeApp, deleteApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { githubStateStore, verifyPublishedBook } from "./lib/new-page-notifications.mjs";
import { notifyAdvice, planAdvice, validateAdviceState } from "./lib/advice-notifications.mjs";

export async function main({ env = process.env, args = process.argv.slice(2) } = {}) {
  if (args.some((arg) => arg !== "--dry-run")) throw new Error("Only --dry-run is accepted.");
  const book = JSON.parse(await readFile(new URL("../data/book.json", import.meta.url), "utf8"));
  if (args.includes("--dry-run")) {
    const now = new Date();
    console.log(JSON.stringify(["daily", "friday"].map((kind) => {
      const plan = planAdvice(book, { kind, now });
      return { kind, status: plan ? "would_send" : "not_due", ...plan };
    }), null, 2));
    return;
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("Firebase sender credentials are required.");
  let credentials;
  try { credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); }
  catch { throw new Error("Invalid Firebase sender credentials."); }
  if (credentials.project_id !== "adabbook-rajol") throw new Error("The sender must use adabbook-rajol.");
  const store = githubStateStore({
    repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN,
    branch: "advice-notification-state", validate: validateAdviceState,
  });
  const app = initializeApp({ credential: cert(credentials) }, "adabbook-advice");
  try {
    console.log(JSON.stringify(await notifyAdvice({
      book, ...store, verifyPublished: verifyPublishedBook,
      send: (message) => getMessaging(app).send(message),
    })));
  } finally { await deleteApp(app); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Advice notifications failed: ${error.code || error.message}`);
    process.exitCode = 1;
  });
}
