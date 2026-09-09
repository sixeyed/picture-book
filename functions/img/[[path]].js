const ALLOWED_PREFIXES = ["web/", "full/"];

// 304 if the client's validator matches this response's etag, else null.
function notModified(request, response) {
  if (!request.headers.get("if-none-match")) return null;
  if (request.headers.get("if-none-match") !== response.headers.get("etag")) return null;
  return new Response(null, { status: 304, headers: response.headers });
}

export async function onRequest({ request, params, env, waitUntil }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  let key;
  try {
    key = (params.path ?? []).map(decodeURIComponent).join("/");
  } catch {
    return new Response("Not found", { status: 404 }); // malformed percent-encoding (e.g. "a%zz.jpg")
  }
  if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p)) || key.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  // Pages Functions are NOT edge-cached by the CDN automatically: without this every
  // request costs a Worker invocation plus an R2 read, however immutable the header
  // says the response is. GET only -- the Cache API will not store a HEAD. Absent
  // under `node --test` (no `caches` global), where this degrades to the R2 path.
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheable = Boolean(cache) && request.method === "GET";

  if (cacheable) {
    const hit = await cache.match(request);
    if (hit) return notModified(request, hit) ?? hit;
  }

  const object = await env.PHOTOS.get(key);   // R2 get with no options also returns body
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);           // content-type etc. from upload metadata
  if (!headers.get("content-type")) headers.set("content-type", "image/jpeg");
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  if (cacheable) {
    // Store the full body even when this particular request gets a 304, so the next
    // cold visitor is served from the edge rather than from R2.
    const full = new Response(object.body, { headers });
    const put = cache.put(request, full.clone());
    if (waitUntil) waitUntil(put); else await put;
    return notModified(request, full) ?? full;
  }

  // Conditional requests: lightbox revisits should be 304s even past edge cache
  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
