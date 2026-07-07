import { loadGigs, DEFAULT_COLUMNS } from "../../scripts/lib/gigs.mjs";

const THUMB_EDGE = 1600; // must match the thumb rendition edge in build-images.mjs

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
      const scale = Math.min(1, THUMB_EDGE / Math.max(img.width, img.height));
      img.thumbWidth = Math.round(img.width * scale);
      img.thumbHeight = Math.round(img.height * scale);

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
  return gigs;
}
