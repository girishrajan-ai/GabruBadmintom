import { getStore } from "@netlify/blobs";
import { sendPushToAll } from "./push.js";

const STORE_NAME = "gabru-attendance";
const KEY = "attendance";
const ADMIN_STORE_NAME = "gabru-admins";
const ADMIN_KEY = "admins";
const AMBER_THRESHOLD = 4;

// Backward-compatible normalizer: old data shape was { sessionKey: [names] }.
// New shape is { sessionKey: { attendees: [names], cancelled: bool } }.
// This keeps all existing data valid - it's read and upgraded in place, never wiped.
function normalizeSession(raw) {
  if (Array.isArray(raw)) {
    return { attendees: raw, cancelled: false };
  }
  if (raw && typeof raw === "object") {
    return { attendees: raw.attendees || [], cancelled: !!raw.cancelled };
  }
  return { attendees: [], cancelled: false };
}

function normalizeAll(data) {
  const out = {};
  for (const key of Object.keys(data || {})) {
    out[key] = normalizeSession(data[key]);
  }
  return out;
}

function formatSessionLabel(sessionKey) {
  const [y, m, d] = sessionKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayName = date.getDay() === 2 ? "Tuesday" : "Thursday";
  const dateLabel = date.toLocaleDateString("en-AU", { month: "short", day: "numeric" });
  return `${dayName}, ${dateLabel}`;
}

export default async (req) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  if (req.method === "GET") {
    const raw = (await store.get(KEY, { type: "json" })) || {};
    const data = normalizeAll(raw);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { sessionKey, name, action, targetName, requestedBy } = body;

    if (!sessionKey || !action) {
      return new Response(
        JSON.stringify({ error: "Missing sessionKey or action" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const rawData = (await store.get(KEY, { type: "json" })) || {};
    const data = normalizeAll(rawData);

    if (!data[sessionKey]) {
      data[sessionKey] = { attendees: [], cancelled: false };
    }

    const countBefore = data[sessionKey].attendees.length;
    let shouldNotifyThreshold = false;

    if (action === "join") {
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing name" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (data[sessionKey].attendees.indexOf(name) === -1) {
        data[sessionKey].attendees.push(name);
        data[sessionKey].attendees.sort();
      }
      const countAfter = data[sessionKey].attendees.length;
      // Notify once, exactly when crossing into "filling up" territory
      if (countBefore < AMBER_THRESHOLD && countAfter >= AMBER_THRESHOLD) {
        shouldNotifyThreshold = true;
      }
    } else if (action === "leave") {
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing name" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const idx = data[sessionKey].attendees.indexOf(name);
      if (idx > -1) data[sessionKey].attendees.splice(idx, 1);
    } else if (action === "admin-remove") {
      // Admin removing someone else from a session (e.g. a no-show)
      if (!targetName) {
        return new Response(JSON.stringify({ error: "Missing targetName" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      const idx = data[sessionKey].attendees.indexOf(targetName);
      if (idx > -1) data[sessionKey].attendees.splice(idx, 1);
    } else if (action === "cancel-session") {
      // Admin cancels a session - attendee list is preserved, just flagged
      data[sessionKey].cancelled = true;
    } else if (action === "uncancel-session") {
      // Admin reverses a cancellation
      data[sessionKey].cancelled = false;
    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await store.setJSON(KEY, data);

    // Fire notifications after the write succeeds. Failures here must never
    // block the attendance update itself - notification is best-effort.
    try {
      if (shouldNotifyThreshold) {
        sendPushToAll(
          "Session filling up! 🏸",
          `${formatSessionLabel(sessionKey)} now has ${data[sessionKey].attendees.length} confirmed.`,
          "/"
        ).catch(() => {});
      }
      if (action === "cancel-session") {
        sendPushToAll(
          "Session cancelled 🚫",
          `${formatSessionLabel(sessionKey)} has been cancelled.`,
          "/"
        ).catch(() => {});
      }
    } catch (e) {
      // never let notification errors affect the response
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = {
  path: "/api/attendance",
};
