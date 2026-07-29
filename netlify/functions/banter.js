import { getStore } from "@netlify/blobs";
import { sendPushToAll } from "./push.js";
import { formatSessionLabel, sessionUrl } from "./_shared/session.js";
import { jsonWithEtag } from "./_shared/http.js";

const STORE_NAME = "gabru-banter";
const KEY = "banter";
const PUSH_META_KEY = "push-meta";
const MAX_MESSAGE_LENGTH = 200;
const MAX_MESSAGES_PER_SESSION = 100;
// A back-and-forth in the banter thread shouldn't buzz everyone's phone on
// every line. One notification per session per window; the tag makes any that
// do get through replace the previous one rather than stack.
const PUSH_THROTTLE_MS = 5 * 60 * 1000;

async function shouldNotifyBanter(store, sessionKey) {
  const now = Date.now();
  let meta;
  try {
    meta = (await store.get(PUSH_META_KEY, { type: "json" })) || {};
  } catch {
    return true; // metadata is only an optimisation - never block a push on it
  }
  if (meta[sessionKey] && now - meta[sessionKey] < PUSH_THROTTLE_MS) return false;
  meta[sessionKey] = now;
  try {
    await store.setJSON(PUSH_META_KEY, meta);
  } catch {
    // ignore
  }
  return true;
}

export default async (req) => {
  if (req.method === "GET") {
    // Eventual consistency + ETag on the read path; see attendance.js.
    const store = getStore({ name: STORE_NAME });
    const data = (await store.get(KEY, { type: "json" })) || {};
    return jsonWithEtag(req, data);
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

    const { action, sessionKey, name, message, messageId } = body;

    if (!action || !sessionKey) {
      return new Response(
        JSON.stringify({ error: "Missing action or sessionKey" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = (await store.get(KEY, { type: "json" })) || {};
    if (!data[sessionKey]) data[sessionKey] = [];

    if (action === "post") {
      if (!name || !message) {
        return new Response(JSON.stringify({ error: "Missing name or message" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const trimmed = message.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!trimmed) {
        return new Response(JSON.stringify({ error: "Empty message" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      data[sessionKey].push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        message: trimmed,
        ts: new Date().toISOString(),
      });
      // Keep it bounded so one session can't grow unbounded
      if (data[sessionKey].length > MAX_MESSAGES_PER_SESSION) {
        data[sessionKey] = data[sessionKey].slice(-MAX_MESSAGES_PER_SESSION);
      }
    } else if (action === "delete") {
      if (!messageId) {
        return new Response(JSON.stringify({ error: "Missing messageId" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      data[sessionKey] = data[sessionKey].filter((m) => m.id !== messageId);
    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await store.setJSON(KEY, data);

    if (action === "post") {
      // Awaited deliberately: a floating promise can be killed when the
      // serverless invocation is frozen on return, so pushes get dropped.
      try {
        if (await shouldNotifyBanter(store, sessionKey)) {
          const preview = message.trim().slice(0, MAX_MESSAGE_LENGTH);
          await sendPushToAll(
            `💬 New banter — ${formatSessionLabel(sessionKey)}`,
            `${name}: ${preview}`,
            sessionUrl(sessionKey),
            { excludeName: name, tag: `banter-${sessionKey}` }
          );
        }
      } catch (e) {
        // never let notification errors affect the response
      }
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
  path: "/api/banter",
};
