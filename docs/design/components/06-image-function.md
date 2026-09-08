# Component 6 — Image Function: `functions/img/[[path]].js` + `wrangler.jsonc`

The only server-side code: a Cloudflare Pages Function that streams private R2
objects under the site's own domain, with hard edge caching.

**Files:**
- Create: `functions/img/[[path]].js`
- Create: `wrangler.jsonc`

**Interfaces:**
- Consumes: R2 bucket `pictures-elton` via binding `PHOTOS`; key scheme
  `web/<slug>/<file>` and `full/<slug>/<file>` (overview §3.3), populated by
  component 7.
- Produces: `GET/HEAD /img/web/...` and `/img/full/...` for the templates and
  lightbox.

---

## 1. `wrangler.jsonc`

```jsonc
{
  "name": "picture-book",
  "compatibility_date": "2026-06-01",
  "pages_build_output_dir": "build",
  "r2_buckets": [
    { "binding": "PHOTOS", "bucket_name": "pictures-elton" }
  ]
}
```

## 2. `functions/img/[[path]].js` — full implementation

```javascript
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
```

Design points:

- **Prefix allowlist** — the binding has full bucket access; the URL must not.
  Anything outside `web/`/`full/` (or containing `..`) is a 404, indistinguishable
  from a missing object.
- **Decode is wrapped in try/catch** — `decodeURIComponent` throws `URIError` on
  malformed percent-encoding (e.g. a segment like `a%zz.jpg`); left unguarded that
  would surface as an unhandled 500 instead of the same 404 every other
  not-found/disallowed path already returns.
- **Immutable, 1-year cache** — filenames are content identity (overview §3.4), so
  the edge and browsers may cache forever. Consequence: replacing an image's bytes
  under the same name will serve stale copies up to a year; rename instead
  (ASSUMPTIONS.md #7).
- **No listing, no auth** — URLs are unguessable only to the extent filenames are;
  this is a public gallery, so `web/` being fetchable is by design. `full/` objects
  simply don't exist in R2 for display-only gigs (enforced upstream by component 3),
  so there is nothing to protect here.
- **Download filename** — the lightbox's `<a download>` handles naming client-side;
  no `content-disposition` needed.

## 3. Local development

`npx wrangler pages dev build` serves the static site **and** this Function with a
**local** R2 simulation (empty by default). To exercise the Function locally, seed
the simulated bucket:

```
npx wrangler r2 object put pictures-elton/web/<slug>/<file> --file .r2-stage/web/<slug>/<file> --local
```

(Component 7's docs include a `dev-seed` note for doing this in bulk.)

## 4. Test plan

Runner: `node --test scripts/img-function.test.mjs` — the module is a pure function
of `(request, params, env)`, so unit-test it directly with a stub `env.PHOTOS`:

```javascript
const fakeR2 = (objects) => ({
  get: async (key) => objects[key]
    ? { body: objects[key], httpEtag: `"etag-${key}"`, writeHttpMetadata: (h) => h.set("content-type", "image/jpeg") }
    : null,
});
```

| Case | Expect |
|---|---|
| `GET web/gig/a.jpg` (exists) | 200; body streamed; `cache-control: public, max-age=31536000, immutable`; `etag` set |
| `GET full/gig/a.jpg` (exists) | 200 |
| object missing | 404 |
| `GET thumbs/gig/a.jpg` | 404 (prefix not allowed) even if object exists |
| key with `..` segment | 404 |
| `POST` | 405 with `allow` header |
| `HEAD` existing object | 200, empty body, same headers |
| `if-none-match` matching etag | 304, no body |
| URL-encoded key (`a%20b.jpg`) | decoded before R2 lookup |
| malformed percent-encoding (`a%zz.jpg`) | 404 (caught `URIError`), not a 500 |
| missing `params.path` (empty path) | 404 |
| object with stored content-type | passed through; without → `image/jpeg` fallback |

Integration smoke (manual): seed local R2 as in §3, `npx wrangler pages dev build`,
confirm `curl -I localhost:8788/img/web/<slug>/<file>` returns 200 + immutable
cache header, and a second browser load is served from cache (network tab: disk cache).

## 5. Acceptance criteria

- [ ] `node --test scripts/img-function.test.mjs` passes.
- [ ] Local smoke test above passes.
- [ ] After first deploy: `curl -I https://pictures.elton.stoneman.io/img/web/<slug>/<file>`
      → 200 with `cf-cache-status` header present (HIT on the second request).
