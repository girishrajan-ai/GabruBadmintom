import { getStore } from "@netlify/blobs";
import { sendPushToAll } from "./push.js";
import { formatSessionLabel, sessionUrl, parseSessionKey, TZ } from "./_shared/session.js";

const STORE_NAME = "gabru-attendance";
const KEY = "attendance";

// Netlify scheduled functions run in UTC. "Tomorrow" has to be computed from
// Sydney's local date, not the server's, or the reminder can fire for the
// wrong day around the UTC date-line crossing.
function sydneyDateKeyTomorrow() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(tomorrow);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

// Fires Sunday and Tuesday ~9am Sydney time (22:00 UTC), i.e. the morning
// before each Tuesday/Thursday session.
export default async () => {
  const sessionKey = sydneyDateKeyTomorrow();
  const day = parseSessionKey(sessionKey).getUTCDay();
  if (day !== 2 && day !== 4) {
    return new Response("Not a session day, skipping", { status: 200 });
  }

  const store = getStore({ name: STORE_NAME });
  const raw = (await store.get(KEY, { type: "json" })) || {};
  const session = raw[sessionKey];
  if (session && session.cancelled) {
    return new Response("Session cancelled, skipping reminder", { status: 200 });
  }

  const label = formatSessionLabel(sessionKey);
  await sendPushToAll(
    "Reminder 🏸",
    `${label} is tomorrow - don't forget to join!`,
    sessionUrl(sessionKey),
    { tag: `reminder-${sessionKey}` }
  );

  return new Response("Reminder sent", { status: 200 });
};

export const config = {
  schedule: "0 22 * * 0,2",
};
