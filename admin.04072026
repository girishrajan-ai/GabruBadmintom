import { getStore } from "@netlify/blobs";

const STORE_NAME = "gabru-admins";
const KEY = "admins";
const DEFAULT_CAPACITY = 6;

// Aamer and Deep are hardcoded as permanent admins.
const PERMANENT_ADMINS = ["Aamer", "Deep"];

export default async (req) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });

  if (req.method === "GET") {
    const stored = (await store.get(KEY, { type: "json" })) || { admins: [], capacity: DEFAULT_CAPACITY, roster: [] };
    const allAdmins = Array.from(new Set([...PERMANENT_ADMINS, ...(stored.admins || [])]));
    const capacity = stored.capacity || DEFAULT_CAPACITY;
    const roster = stored.roster || [];
    return new Response(JSON.stringify({ admins: allAdmins, capacity, roster }), {
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

    const { action, name, requestedBy, capacity } = body;

    if (!action || !requestedBy) {
      return new Response(
        JSON.stringify({ error: "Missing action or requestedBy" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const stored = (await store.get(KEY, { type: "json" })) || { admins: [], capacity: DEFAULT_CAPACITY, roster: [] };
    if (!stored.admins) stored.admins = [];
    if (!stored.capacity) stored.capacity = DEFAULT_CAPACITY;
    if (!stored.roster) stored.roster = [];

    const currentAdmins = Array.from(new Set([...PERMANENT_ADMINS, ...stored.admins]));

    // Only existing admins can promote/demote/change capacity/manage roster
    if (!currentAdmins.includes(requestedBy)) {
      return new Response(
        JSON.stringify({ error: "Only admins can manage this" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    if (action === "promote") {
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing name" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      if (!stored.admins.includes(name) && !PERMANENT_ADMINS.includes(name)) {
        stored.admins.push(name);
      }
    } else if (action === "demote") {
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing name" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      if (PERMANENT_ADMINS.includes(name)) {
        return new Response(
          JSON.stringify({ error: "Cannot demote a permanent admin" }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
      stored.admins = stored.admins.filter((n) => n !== name);
    } else if (action === "set-capacity") {
      const val = parseInt(capacity, 10);
      if (!val || val < 1 || val > 50) {
        return new Response(JSON.stringify({ error: "Invalid capacity value" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      stored.capacity = val;
    } else if (action === "add-regular") {
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing name" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      if (!stored.roster.includes(name)) {
        stored.roster.push(name);
      }
    } else if (action === "remove-regular") {
      if (!name) {
        return new Response(JSON.stringify({ error: "Missing name" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      stored.roster = stored.roster.filter((n) => n !== name);
    } else {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await store.setJSON(KEY, stored);
    const allAdmins = Array.from(new Set([...PERMANENT_ADMINS, ...stored.admins]));

    return new Response(JSON.stringify({ admins: allAdmins, capacity: stored.capacity, roster: stored.roster }), {
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
  path: "/api/admins",
};
