# New-page push notifications

The native Adab Book app uses Firebase project `adabbook-rajol` and public topic
`adabbook_new_pages`. The website remains a static GitHub Pages reader. Notification
sending runs in the `notify` job after a successful Pages deployment.

## Enable the publishing workflow

1. Verify Actions secret `FIREBASE_SERVICE_ACCOUNT_JSON` in `attahawy/adabbook`.
   It has been provisioned for dedicated sender
   `adabbook-page-notifier@adabbook-rajol.iam.gserviceaccount.com`, with only the
   Firebase Cloud Messaging API Admin role (`roles/firebasecloudmessaging.admin`).
   A validate-only request passed without delivering a notification. Never
   put this key in either repository, `data/`, `dist/`, or the Flutter app.
2. Publish the reviewed workflow and sender scripts to `main`.
3. Repository variable `NEW_PAGE_NOTIFICATIONS_ENABLED` is already `true`, and
   `notification-state` has been initialized from the currently published book
   without sending historical pages. Verify these settings before publication.
   On a new installation without history, the first enabled run records the
   existing page IDs without sending historical pages.
4. Publish the native app update and test with a consenting physical device.
   Subsequent deployments containing new page IDs send one grouped message.

The server checks that the live `book.json` exactly matches the current release
before it changes history or sends anything. CDN lag is retried. Changes to
existing text, titles, revisions, or reading order do not send notifications.
Deleted IDs remain in history, so restoring an old page does not announce it again.
Adding a page to the upstream wiki is announced only after it has been imported
into `data/book.json` and successfully published.

## Delivery history and recovery

The workflow creates an orphan branch named `notification-state`, containing only
`state.json`. It is not part of the website artifact. `knownPageIds` is the durable
baseline; `lastDelivery` records the last FCM acceptance. Do not delete/reset this
branch. The workflow serializes publication and notification work and uses GitHub
file SHA checks to reject conflicting history writes.

Before calling FCM, the sender saves a `pending` intent. On success, it adds those
IDs to `knownPageIds` and clears the intent. If the request or final history write
fails, the job fails visibly and later runs refuse to repeat the uncertain
broadcast automatically. FCM acceptance is not proof of delivery to every phone.
No system can atomically commit both the external FCM send and GitHub history.

Review the failed job's `FCM accepted <event ID>: <message name>` log and the
pending history. Then manually run **Publish GitHub Pages** with:

- `resolve_pending: sent` if the send was accepted: mark those IDs as handled
  without sending them again.
- `resolve_pending: retry` only if a repeat attempt is intended: clear the intent
  and send currently available unannounced IDs. An uncertain earlier send may have
  reached phones, so this choice can produce a repeat notification.
- `none` for normal runs; it never clears an uncertain delivery.

Each broadcast has a deterministic event ID based on the new source page IDs.
Android notification tags and APNs collapse IDs reuse it, and the app deduplicates
foreground banners and open events within its session. These measures reduce
repeats but do not claim exactly-once network delivery. Oversized topic payloads
fail before sending; split unusually large additions into smaller releases.

## Local verification

```sh
npm test
npm run build
npm run notifications:preview
```

Preview never sends or writes history. Without GitHub credentials it reports a
first-run baseline; with repository credentials it reads current delivery history.
The test suite injects messaging/history clients, so tests never send real pushes.

The mobile setup, APNs requirements, and physical-device checks are documented in
`/Users/samy/Apps/adabBookApp/docs/new-page-notifications.md` in the paired checkout.

References: [FCM Flutter setup](https://firebase.google.com/docs/cloud-messaging/flutter/get-started),
[message handling](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages),
and [server authentication](https://firebase.google.com/docs/cloud-messaging/send/v1-api).
