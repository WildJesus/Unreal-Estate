import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use icon-source.png if present, otherwise fall back to icon.svg
const sourcePng = resolve(__dirname, "icon-source.png");
const sourceSvg = resolve(__dirname, "icon.svg");
const source = readFileSync(sourcePng.toString() ? sourcePng : sourceSvg);

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const outPath = resolve(__dirname, `icon${size}.png`);
  await sharp(sourcePng)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated icon${size}.png`);
}
