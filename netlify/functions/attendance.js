import { getStore } from "@netlify/blobs";
import { sendPushToAll } from "./push.js";
import { formatSessionLabel, sessionUrl } from "./_shared/session.js";
import { jsonWithEtag } from "./_shared/http.js";

const STORE_NAME = "gabru-attendance";
const KEY = "attendance";
const ADMIN_STORE_NAME = "gabru-admins";
const ADMIN_KEY = "admins";
const DEFAULT_CAPACITY = 6;
// How many free spots left when we nudge people that it's filling up.
const NUDGE_AT_SPOTS_LEFT = 2;

async function getCapacity() {
  try {
    const store = getStore({ name: ADMIN_STORE_NAME });
    const stored = await store.get(ADMIN_KEY, { type: "json" });
    return (stored && stored.capacity) || DEFAULT_CAPACITY;
  } catch {
    return DEFAULT_CAPACITY;
  }
}

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

// All attendance-driven notifications live here so the targeting rules are in
// one place. Every send is tagged per session, so a flurry of joins collapses
// into a single notification on the device rather than a stack of them.
async function notify(action, sessionKey, session, attendeesBefore, countBefore) {
  const label = formatSessionLabel(sessionKey);
  const url = sessionUrl(sessionKey);
  const tag = `session-${sessionKey}`;
  const attendees = session.attendees;
  const countAfter = attendees.length;

  if (action === "cancel-session") {
    // Only the people who had signed up actually need to know.
    return sendPushToAll(
      "Session cancelled 🚫",
      `${label} has been cancelled.`,
      url,
      { onlyNames: attendeesBefore, tag }
    );
  }

  if (action === "uncancel-session") {
    return sendPushToAll(
      "Session back on! 🏸",
      `${label} is no longer cancelled - see you there.`,
      url,
      { onlyNames: attendeesBefore, tag }
    );
  }

  if (session.cancelled) return; // don't nudge about a cancelled session

  const capacity = await getCapacity();
  const nudgeAt = Math.max(1, capacity - NUDGE_AT_SPOTS_LEFT);

  if (action === "join") {
    // Fires once per session, on the join that crosses the line. People who
    // already joined don't need to be told the session is filling up.
    if (countBefore < capacity && countAfter >= capacity) {
      return sendPushToAll(
        "Full squad! 🏸",
        `${label} is full with ${countAfter} confirmed.`,
        url,
        { excludeNames: attendees, tag }
      );
    }
    if (countBefore < nudgeAt && countAfter >= nudgeAt) {
      const left = Math.max(0, capacity - countAfter);
      return sendPushToAll(
        "Session filling up! 🏸",
        `${label} has ${countAfter}/${capacity} confirmed - ${left} spot${left === 1 ? "" : "s"} left.`,
        url,
        { excludeNames: attendees, tag }
      );
    }
    return;
  }

  if (action === "leave" || action === "admin-remove") {
    // A spot opening up on a full session is the one drop worth interrupting
    // people for - it's the moment someone else can actually get in.
    if (countBefore >= capacity && countAfter < capacity) {
      return sendPushToAll(
        "A spot opened up 🏸",
        `${label} now has ${countAfter}/${capacity} - grab it.`,
        url,
        { excludeNames: attendees, tag }
      );
    }
  }
}

export default async (req) => {
  if (req.method === "GET") {
    // Reads use the default (eventual) consistency: strong consistency
    // bypasses the edge cache and is measurably slower, and this endpoint is
    // polled constantly by clients that already tolerate 15s of staleness.
    // Strong consistency is reserved for the read-modify-write below.
    const store = getStore({ name: STORE_NAME });
    const raw = (await store.get(KEY, { type: "json" })) || {};
    return jsonWithEtag(req, normalizeAll(raw));
  }

  const store = getStore({ name: STORE_NAME, consistency: "strong" });

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

    const attendeesBefore = data[sessionKey].attendees.slice();
    const countBefore = attendeesBefore.length;

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

    // Fire notifications after the write succeeds. These are awaited: on a
    // serverless runtime the invocation can be frozen the moment we return, so
    // a floating promise here means pushes land only some of the time.
    // Failures must still never fail the attendance update itself.
    try {
      await notify(action, sessionKey, data[sessionKey], attendeesBefore, countBefore);
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
