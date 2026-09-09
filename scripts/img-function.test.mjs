import test from "node:test";
import assert from "node:assert";
import { onRequest } from "../functions/img/[[path]].js";

// Stub R2 bucket for testing
const createFakeR2 = (objects) => ({
  get: async (key) => {
    if (!objects[key]) return null;
    const obj = objects[key];
    return {
      body: obj.body || `fake-body-for-${key}`,
      httpEtag: obj.httpEtag || `"etag-${key}"`,
      writeHttpMetadata: (headers) => {
        if (obj.contentType) {
          headers.set("content-type", obj.contentType);
        }
      },
    };
  },
});

test("GET web/gig/a.jpg (exists) returns 200 with cache-control and etag", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 200, "status should be 200");
  assert(response.headers.get("cache-control")?.includes("max-age=31536000"), "should have immutable cache header");
  assert(response.headers.get("cache-control")?.includes("immutable"), "should have immutable directive");
  assert(response.headers.get("etag"), "should have etag header");
  assert(response.body, "should have body");
});

test("GET full/gig/a.jpg (exists) returns 200", async () => {
  const env = { PHOTOS: createFakeR2({ "full/gig/a.jpg": { body: "full-image-data" } }) };
  const request = new Request("http://localhost/img/full/gig/a.jpg", { method: "GET" });
  const params = { path: ["full", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 200, "status should be 200");
  assert(response.body, "should have body");
});

test("object missing returns 404", async () => {
  const env = { PHOTOS: createFakeR2({}) };
  const request = new Request("http://localhost/img/web/gig/missing.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "missing.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 404, "status should be 404");
});

test("GET thumbs/gig/a.jpg returns 404 (prefix not allowed) even if object exists", async () => {
  const env = { PHOTOS: createFakeR2({ "thumbs/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/thumbs/gig/a.jpg", { method: "GET" });
  const params = { path: ["thumbs", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 404, "status should be 404 for disallowed prefix");
});

test("key with .. segment returns 404", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/../../../etc/passwd", { method: "GET" });
  const params = { path: ["web", "..", "..", "..", "etc", "passwd"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 404, "status should be 404 for path with ..");
});

test("malformed percent-encoding returns 404 instead of throwing", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a%zz.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a%zz.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 404, "status should be 404, not a thrown URIError");
});

test("missing params.path returns 404", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/", { method: "GET" });
  const params = {};

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 404, "status should be 404 when params.path is undefined");
});

test("POST returns 405 with allow header", async () => {
  const env = { PHOTOS: createFakeR2({}) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "POST" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 405, "status should be 405");
  assert.equal(response.headers.get("allow"), "GET, HEAD", "should have allow header");
});

test("HEAD existing object returns 200 with empty body and same headers", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "HEAD" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 200, "status should be 200");
  assert.equal(response.body, null, "body should be null for HEAD");
  assert(response.headers.get("etag"), "should have etag header");
  assert(response.headers.get("cache-control"), "should have cache-control header");
});

test("if-none-match matching etag returns 304 with no body", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data", httpEtag: '"match-etag"' } }) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", {
    method: "GET",
    headers: { "if-none-match": '"match-etag"' },
  });
  const params = { path: ["web", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 304, "status should be 304");
  assert.equal(response.body, null, "body should be null for 304");
});

test("URL-encoded key decoded before R2 lookup", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a b.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a%20b.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a%20b.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 200, "status should be 200 after URL decoding");
});

test("object with stored content-type passed through", async () => {
  const env = {
    PHOTOS: createFakeR2({
      "web/gig/a.jpg": { body: "image-data", contentType: "image/png" },
    }),
  };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 200, "status should be 200");
  assert.equal(response.headers.get("content-type"), "image/png", "should pass through stored content-type");
});

test("object without content-type uses image/jpeg fallback", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const response = await onRequest({ request, params, env });

  assert.equal(response.status, 200, "status should be 200");
  assert.equal(response.headers.get("content-type"), "image/jpeg", "should use image/jpeg fallback");
});

// --- edge cache (Cache API) -------------------------------------------------
// Pages Functions are not CDN-cached automatically; the Function uses caches.default
// explicitly. `caches` does not exist under node --test, so these tests install a
// stub and remove it again, leaving the other tests on the no-cache path.

const withStubCache = async (impl, fn) => {
  const calls = { match: [], put: [] };
  globalThis.caches = {
    default: {
      match: async (req) => { calls.match.push(req); return impl.match ? impl.match(req) : undefined; },
      put: async (req, res) => { calls.put.push({ req, res }); },
    },
  };
  try { return { result: await fn(), calls }; }
  finally { delete globalThis.caches; }
};

test("cache miss: response is stored in the edge cache", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const { result, calls } = await withStubCache({}, () => onRequest({ request, params, env }));

  assert.equal(result.status, 200, "status should be 200");
  assert.equal(calls.match.length, 1, "should have consulted the cache");
  assert.equal(calls.put.length, 1, "should have stored the response");
  assert.equal(await calls.put[0].res.text(), "image-data", "should store the full body");
});

test("cache hit: served from edge without touching R2", async () => {
  let r2Reads = 0;
  const env = { PHOTOS: { get: async () => { r2Reads++; return null; } } };
  const cached = new Response("cached-bytes", {
    headers: { etag: '"etag-web/gig/a.jpg"', "cache-control": "public, max-age=31536000, immutable" },
  });
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const { result } = await withStubCache({ match: () => cached }, () => onRequest({ request, params, env }));

  assert.equal(result.status, 200, "status should be 200");
  assert.equal(await result.text(), "cached-bytes", "should return the cached body");
  assert.equal(r2Reads, 0, "must not read R2 on a cache hit");
});

test("cache hit + if-none-match: returns 304 without reading R2", async () => {
  let r2Reads = 0;
  const env = { PHOTOS: { get: async () => { r2Reads++; return null; } } };
  const cached = new Response("cached-bytes", { headers: { etag: '"v1"' } });
  const request = new Request("http://localhost/img/web/gig/a.jpg", {
    method: "GET", headers: { "if-none-match": '"v1"' },
  });
  const params = { path: ["web", "gig", "a.jpg"] };

  const { result } = await withStubCache({ match: () => cached }, () => onRequest({ request, params, env }));

  assert.equal(result.status, 304, "status should be 304");
  assert.equal(r2Reads, 0, "must not read R2 on a conditional cache hit");
});

test("HEAD is never written to the edge cache", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "HEAD" });
  const params = { path: ["web", "gig", "a.jpg"] };

  const { result, calls } = await withStubCache({}, () => onRequest({ request, params, env }));

  assert.equal(result.status, 200, "status should be 200");
  assert.equal(calls.put.length, 0, "the Cache API cannot store a HEAD response");
});

test("waitUntil is used for the cache write when the platform provides it", async () => {
  const env = { PHOTOS: createFakeR2({ "web/gig/a.jpg": { body: "image-data" } }) };
  const request = new Request("http://localhost/img/web/gig/a.jpg", { method: "GET" });
  const params = { path: ["web", "gig", "a.jpg"] };
  const deferred = [];

  const { result } = await withStubCache({}, () =>
    onRequest({ request, params, env, waitUntil: (p) => deferred.push(p) }));

  assert.equal(result.status, 200, "status should be 200");
  assert.equal(deferred.length, 1, "cache write should be deferred via waitUntil");
  await Promise.all(deferred);
});
