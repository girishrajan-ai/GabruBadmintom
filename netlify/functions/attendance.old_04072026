import { getStore } from "@netlify/blobs";

const STORE_NAME = "gabru-attendance";
const KEY = "attendance";

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

    const { sessionKey, name, action } = body;

    if (!sessionKey || !name || !action) {
      return new Response(
        JSON.stringify({ error: "Missing sessionKey, name, or action" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = (await store.get(KEY, { type: "json" })) || {};

    if (!data[sessionKey]) {
      data[sessionKey] = [];
    }

    const idx = data[sessionKey].indexOf(name);

    if (action === "join") {
      if (idx === -1) {
        data[sessionKey].push(name);
        data[sessionKey].sort();
      }
    } else if (action === "leave") {
      if (idx > -1) {
        data[sessionKey].splice(idx, 1);
      }
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
