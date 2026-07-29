// Small helpers for the JSON read endpoints.

const JSON_HEADERS = { "Content-Type": "application/json" };

// FNV-1a over the serialised body. Good enough to tell "unchanged" from
// "changed" for a payload this size, and far cheaper than a crypto hash.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// Clients poll these endpoints every 15s. Almost every poll returns a body
// identical to the last one, so answer with a 304 and skip the transfer.
export function jsonWithEtag(req, value) {
  const body = JSON.stringify(value);
  const etag = `W/"${hash(body)}"`;

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "no-cache" },
    });
  }

  return new Response(body, {
    status: 200,
    headers: { ...JSON_HEADERS, ETag: etag, "Cache-Control": "no-cache" },
  });
}

export function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
