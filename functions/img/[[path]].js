const ALLOWED_PREFIXES = ["web/", "full/"];

export async function onRequest({ request, params, env }) {
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

  const object = await env.PHOTOS.get(key);   // R2 get with no options also returns body
  if (!object) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);           // content-type etc. from upload metadata
  if (!headers.get("content-type")) headers.set("content-type", "image/jpeg");
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  // Conditional requests: lightbox revisits should be 304s even past edge cache
  if (request.headers.get("if-none-match") === object.httpEtag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
