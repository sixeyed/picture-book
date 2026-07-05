import { loadGigs } from "../../scripts/lib/gigs.mjs";

const THUMB_EDGE = 600;

export default async function () {
  const gigs = await loadGigs("gigs");
  for (const gig of gigs) {
    for (const img of gig.images) {
      img.stem = img.file.replace(/\.[^.]+$/, "");
      const scale = Math.min(1, THUMB_EDGE / Math.max(img.width, img.height));
      img.thumbWidth = Math.round(img.width * scale);
      img.thumbHeight = Math.round(img.height * scale);
    }
    gig.coverImage = gig.images.find((i) => i.file === gig.cover);
  }
  return gigs;
}
