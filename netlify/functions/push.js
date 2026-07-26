import { getStore } from "@netlify/blobs";
import webpush from "web-push";

const STORE_NAME = "gabru-push";
const KEY = "subscriptions";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = "mailto:admin@gogabru.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Exported so attendance.js and admins.js can trigger notifications directly
// (no HTTP round-trip needed - same runtime, same Blobs account).
export async function sendPushToAll(title, message, url) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { ok: false, reason: "not-configured" };

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const stored = (await store.get(KEY, { type: "json" })) || { subs: [] };
  if (stored.subs.length === 0) return { ok: true, sent: 0, total: 0 };

  const payload = JSON.stringify({ title, body: message, url: url || "/" });

  const results = await Promise.allSettled(
    stored.subs.map((sub) =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload)
    )
  );

  const stillValid = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      stillValid.push(stored.subs[i]);
    } else if (r.reason && (r.reason.statusCode === 410 || r.reason.statusCode === 404)) {
      // expired subscription, drop it
    } else {
      stillValid.push(stored.subs[i]);
    }
  });
  stored.subs = stillValid;
  await store.setJSON(KEY, stored);

  return { ok: true, sent: results.filter(r => r.status === 'fulfilled').length, total: results.length };
}

export default async (req) => {
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

    const { action } = body;

    if (action === "subscribe") {
      const { subscription, name } = body;
      if (!subscription || !subscription.endpoint) {
        return new Response(JSON.stringify({ error: "Missing subscription" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const stored = (await store.get(KEY, { type: "json" })) || { subs: [] };
      // De-dupe by endpoint - re-subscribing (e.g. after clearing site data) just updates the record
      stored.subs = stored.subs.filter((s) => s.endpoint !== subscription.endpoint);
      stored.subs.push({ endpoint: subscription.endpoint, keys: subscription.keys, name: name || null });
      await store.setJSON(KEY, stored);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    if (action === "unsubscribe") {
      const { endpoint } = body;
      if (!endpoint) {
        return new Response(JSON.stringify({ error: "Missing endpoint" }), {
          status: 400, headers: { "Content-Type": "application/json" },
        });
      }
      const stored = (await store.get(KEY, { type: "json" })) || { subs: [] };
      stored.subs = stored.subs.filter((s) => s.endpoint !== endpoint);
      await store.setJSON(KEY, stored);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    if (action === "send") {
      // Internal action - called manually/for testing. Real triggers call sendPushToAll() directly.
      const { title, message, url } = body;
      const result = await sendPushToAll(title || "Gabru Badminton 🏸", message || "", url || "/");
      if (!result.ok && result.reason === "not-configured") {
        return new Response(JSON.stringify({ error: "Push not configured (missing VAPID keys)" }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(result), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET") {
    // Expose the public key so the frontend can subscribe
    return new Response(JSON.stringify({ publicKey: VAPID_PUBLIC_KEY || null }), {
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
  path: "/api/push",
};
