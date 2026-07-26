import { getStore } from "@netlify/blobs";

const STORE_NAME = "gabru-banter";
const KEY = "banter";
const MAX_MESSAGE_LENGTH = 200;
const MAX_MESSAGES_PER_SESSION = 100;

export default async (req) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  if (req.method === "GET") {
    const data = (await store.get(KEY, { type: "json" })) || {};
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
