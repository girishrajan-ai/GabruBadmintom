import { getStore } from "@netlify/blobs";

const STORE_NAME = "gabru-attendance";
const KEY = "attendance";

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
