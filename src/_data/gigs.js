import { loadGigs, DEFAULT_COLUMNS } from "../../scripts/lib/gigs.mjs";

// Must match THUMB_SIZES in scripts/build-images.mjs (long edges, ascending).
const THUMB_SIZES = [800, 1600];

export default async function () {
  const gigs = await loadGigs("gigs");
  for (const gig of gigs) {
    const columns = gig.layout?.columns ?? DEFAULT_COLUMNS;
    const widths = gig.layout?.widths ?? Array(columns).fill(1);
    gig.layout = { columns, widths };

    // Fallback placement for images without an explicit column: portraits
    // alternate into the outer columns, landscapes go to the centre. This is
    // the same heuristic new-gig.ps1 seeds, so hand-authoring is optional.
    const centre = Math.floor((columns - 1) / 2);
    let nextOuter = 0; // toggles 0 (left) / columns-1 (right)
    const groups = Array.from({ length: columns }, () => []);

    gig.images.forEach((img, i) => {
      img.order = i;
      img.stem = img.file.replace(/\.[^.]+$/, "");

      // Responsive thumbnails: one entry per THUMB_SIZES, `w` = the variant's
      // actual pixel width so the browser can pick against the `sizes` hint.
      const maxEdge = Math.max(img.width, img.height);
      const variants = THUMB_SIZES.map((edge) => {
        const scale = Math.min(1, edge / maxEdge);
        return { url: `/thumbs/${gig.slug}/${img.stem}-${edge}.jpg`, w: Math.round(img.width * scale) };
      });
      img.thumbSrc = variants[0].url; // smallest = safe fallback for no-srcset
      img.thumbSrcset = variants.map((v) => `${v.url} ${v.w}w`).join(", ");
      // width/height attrs (for aspect-ratio / no CLS) from the largest variant
      const largeScale = Math.min(1, THUMB_SIZES[THUMB_SIZES.length - 1] / maxEdge);
      img.thumbWidth = Math.round(img.width * largeScale);
      img.thumbHeight = Math.round(img.height * largeScale);

      let col = img.column;
      if (!Number.isInteger(col) || col < 0 || col >= columns) {
        if (img.height > img.width) {
          col = nextOuter === 0 ? 0 : columns - 1;
          nextOuter = nextOuter === 0 ? 1 : 0;
        } else {
          col = centre;
        }
      }
      img.column = col;
      groups[col].push(img);
    });

    gig.columnGroups = groups;
    gig.coverImage = gig.images.find((i) => i.file === gig.cover);
  }

  // Gig-to-gig nav. loadGigs sorts newest first, so the neighbour before a gig
  // is the next-newer one ("Next") and the one after is the next-older
  // ("Previous"). No wrap-around: the ends are null and the template omits them.
  const navLink = (g) => (g ? { slug: g.slug, title: g.title } : null);
  gigs.forEach((gig, i) => {
    gig.newer = navLink(gigs[i - 1]);
    gig.older = navLink(gigs[i + 1]);
  });
  return gigs;
}
