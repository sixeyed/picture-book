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
