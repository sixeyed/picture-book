import { readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const dir = process.argv[2];
if (!dir) { console.error("usage: node read-dimensions.mjs <dir>"); process.exit(1); }

const files = (await readdir(dir)).filter((f) => /\.jpe?g$/i.test(f)).sort();
const out = [];
for (const file of files) {
  const m = await sharp(join(dir, file)).metadata();
  const rotated = m.orientation >= 5;              // EXIF orientations 5-8 are 90°/270°
  out.push({
    file,
    width: rotated ? m.height : m.width,
    height: rotated ? m.width : m.height,
  });
}
process.stdout.write(JSON.stringify(out));
