# Component 5 — Frontend: `site.css` + `gallery.js`

The look (dark, photos-first, per high-level §8) and the lightbox behaviour. Pure
CSS + vanilla JS, no frameworks, no build step — these files ship as written.

**Files:**
- Create: `src/assets/site.css`
- Create: `src/assets/gallery.js`

**Interfaces:**
- Consumes: the markup contract (overview §3.6) and the page structure produced by
  component 4. JS binds only to: `ul.grid[data-download]`, `a.thumb` and its
  `data-stem` attribute and `href` (web rendition), plus `data-full` when present
  (component 4 omits it entirely for `display-only` gigs — it is read but only
  acted on when `data-download="true"`, i.e. when it's actually present).
- Produces: no exports; progressive enhancement over working plain-HTML pages.

---

## 1. `site.css`

### Design tokens

```css
:root {
  color-scheme: dark;
  --bg: #0e0e11;          /* near-black, slightly warm */
  --surface: #17171c;
  --text: #e8e6e3;
  --text-dim: #9b98a0;
  --accent: #b48eff;      /* stage-light purple; links, focus rings */
  --gap: 10px;            /* grid gutter */
  --content-max: 1400px;
  --radius: 4px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
```

### Layout rules

- **Base:** `body { background: var(--bg); color: var(--text); }`; content column
  `max-width: var(--content-max); margin-inline: auto; padding-inline: 16px`.
  Header/footer minimal — small type, `--text-dim`, generous whitespace. Links
  `--accent`, underline on hover only. Visible `:focus-visible` outline in accent.
- **Home cards (`ul.cards`):** responsive grid,
  `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px`.
  Card = cover image (`width: 100%; height: auto; border-radius: var(--radius)`),
  title in `1.1rem`, venue/date line in `--text-dim` `0.85rem`. Whole card is the
  anchor; subtle hover: image `opacity: .85`.
- **Gig grid (`ul.grid`):** CSS multi-column masonry preserving aspect ratio, no
  cropping:

  ```css
  .grid { columns: 4 260px; gap: var(--gap); list-style: none; padding: 0; }
  .grid li { break-inside: avoid; margin-bottom: var(--gap); }
  .thumb { display: block; position: relative; }
  .thumb img { width: 100%; height: auto; display: block; border-radius: var(--radius); }
  ```

  `columns: 4 260px` gives ~4 columns on desktop, 2 on tablet, 1 on phones, with no
  media queries. The `aspect-ratio` inline style on `a.thumb` (from the markup
  contract) reserves space before images load — no layout shift.
- **Hover (light touch):** no per-image captions exist (per-gig blurb only, spec
  §11.3) — hover is just the subtle image treatment (`opacity: .9`); no text overlay.
- **Gig blurb:** `p.blurb` under the gig heading — `--text-dim`, `0.95rem`,
  `max-width: 65ch`.
- **Lightbox (`dialog.lightbox`):** styles for the element defined in §2 —
  full-viewport (`width/height: 100vw/100dvh; max-width/height: none`), background
  `rgb(0 0 0 / .96)`, no border. Image centered,
  `max-width: 100vw; max-height: calc(100dvh - 56px); object-fit: contain`. Footer
  bar: counter `n / total` left (`--text-dim`), download link right.
  Prev/next/close buttons: transparent, large hit areas (min 44 px), accent on
  hover/focus; prev/next vertically centered at the edges, close top-right.
- **Reduced motion:** wrap any transition in `@media (prefers-reduced-motion: no-preference)`.

## 2. `gallery.js`

Progressive enhancement: no grid on the page → script does nothing. Anchor default
behaviour (open web rendition) remains the no-JS fallback.

### Structure

```javascript
(() => {
  const grid = document.querySelector("ul.grid");
  if (!grid) return;
  const items = [...grid.querySelectorAll("a.thumb")].map((a) => ({
    web: a.getAttribute("href"),
    full: a.dataset.full,
    stem: a.dataset.stem,
    alt: a.querySelector("img")?.alt ?? "",
    el: a,
  }));
  const allowDownload = grid.dataset.download === "true";
  let current = -1;
  // buildDialog(), open(index), close(), show(index), preload(index), onKey(e), swipe handlers…
})();
```

### Behaviour spec

1. **Dialog construction** — on load, append one `<dialog class="lightbox">` to
   `<body>` containing: `<img>`, prev/next/close `<button>`s (aria-labels "Previous
   image" / "Next image" / "Close"), and a footer with `<span class="counter">`
   and — only if `allowDownload` — an `<a class="download" download>Full
   resolution</a>`.
2. **Open** — click on `a.thumb` → `preventDefault()`, `open(index)`:
   `dialog.showModal()`, `document.body.style.overflow = "hidden"`, then `show(index)`.
3. **`show(index)`** — wraps modulo `items.length`; sets `img.src = items[i].web`,
   `img.alt = items[i].alt`, counter `«i+1 / total»`, download `href =
   items[i].full`; updates the URL hash via
   `history.replaceState(null, "", "#" + items[i].stem)`; then `preload(i + 1)` and
   `preload(i - 1)` (`new Image().src = …`).
4. **Navigation** — next: right button, `ArrowRight`, or click on the image itself
   (click-to-advance, per design direction §8). Prev: left button, `ArrowLeft`.
   Close: close button, `Escape` (native dialog behaviour), or click on the dialog
   backdrop (click target === dialog).
5. **Swipe** — `pointerdown`/`pointerup` on the dialog: horizontal delta > 40 px and
   |dx| > |dy| → prev/next. (Pointer events cover touch; no touch-event code.) A
   swipe releasing over any interactive element (close/prev/next/image/backdrop,
   and — when present — the download link) still fires a trailing click; every one
   of those click handlers consumes the swipe flag so it doesn't double-fire. For
   the download link specifically this means calling `preventDefault()` on that
   trailing click, otherwise the swipe would trigger a native file download.
6. **Close** — cleanup must be event-independent: some browsers do not deliver
   the dialog `close` event (observed in Chrome 2026 — Escape fired only
   `cancel`); run an idempotent `cleanup()` from both `close` and `cancel` AND
   directly after our own `dialog.close()` calls. Cleanup: restore `body`
   overflow, clear the hash (`history.replaceState(null, "", location.pathname)`),
   and best-effort focus return to the last-shown image's thumbnail (rAF-deferred;
   the browser's native focus restore to the originally-clicked thumb may win the
   race — either outcome is acceptable).
7. **Deep link** — on load, if `location.hash` matches an item's `stem`, `open` that
   index immediately (this is the shareable per-image URL from high-level §6.4).
8. **Loading state** — set a `data-loading` attribute on the dialog while the new
   `img` hasn't fired `load`; CSS dims the old image (`opacity: .4`) until it does.

Accessibility notes: `<dialog>` + `showModal()` provides focus trapping and `Escape`
natively — do not reimplement. Buttons are real `<button>` elements. The image click
target for advance also works via the Next button, so keyboard users lose nothing.

### Optional extensions (Phase 3 — implement only after everything else works)

- **S/M/L density toggle:** three buttons above the grid setting
  `grid.style.columns` to `3 340px | 4 260px | 6 180px`; persist in `localStorage`
  (`gallery-size`); apply persisted value on load.
- The `preload` in `show()` already covers "prefetch next lightbox image".

## 3. Test plan

No JS test harness for this component (would need a browser runner; not worth the
dependency at this scale). Verification is a scripted manual pass against the built
site under `npx wrangler pages dev build`:

| Check | Steps |
|---|---|
| no-JS fallback | disable JS → thumb click opens `/img/web/...` directly |
| open/close | click thumb → lightbox; Esc, ✕, and backdrop-click all close; focus returns to the thumb |
| navigation | ArrowRight/ArrowLeft cycle and wrap; image click advances; swipe works in device emulation |
| swipe over download link | in device emulation, swipe releasing over "Full resolution" navigates only — no file download triggered |
| deep link | open `/<slug>/#<stem>` → lightbox opens on that image; closing removes the hash; hash updates while navigating |
| download visibility | editorial gig shows "Full resolution" linking `/img/full/...`; display-only gig shows none |
| blurb | gig with a `description` shows it under the heading; empty description shows nothing |
| layout | no layout shift while thumbs load (aspect-ratio boxes); grid reflows 4→2→1 columns across viewport widths |
| a11y quick pass | tab through grid; open via Enter; buttons announce labels (VoiceOver spot check) |

## 4. Acceptance criteria

- [ ] All manual checks above pass in Chrome + Safari (desktop) and iOS Safari
      (device emulation minimum).
- [ ] Lighthouse on a gig page (local): accessibility ≥ 95, no CLS flagged.
