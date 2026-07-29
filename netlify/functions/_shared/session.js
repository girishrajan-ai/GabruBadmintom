// Shared session helpers. Files under a leading-underscore directory are
// ignored by Netlify's function discovery, so this is safe to import from.

const TZ = "Australia/Sydney";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// sessionKey is a plain calendar date (YYYY-MM-DD) with no timezone attached.
// Parsing it as UTC keeps the day-of-week stable regardless of where the
// function happens to run - `new Date(y, m-1, d)` used the server's zone,
// which on Netlify is UTC and could shift the label by a day.
export function parseSessionKey(sessionKey) {
  const [y, m, d] = String(sessionKey).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatSessionLabel(sessionKey) {
  const date = parseSessionKey(sessionKey);
  const dayName = DAY_NAMES[date.getUTCDay()];
  const dateLabel = date.toLocaleDateString("en-AU", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${dayName}, ${dateLabel}`;
}

// Deep link so tapping a notification opens the right session, not just the app.
export function sessionUrl(sessionKey) {
  return sessionKey ? `/?session=${encodeURIComponent(sessionKey)}` : "/";
}

export { TZ };
