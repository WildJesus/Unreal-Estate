import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgBuffer = readFileSync(resolve(__dirname, "icon.svg"));

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const outPath = resolve(__dirname, `icon${size}.png`);
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`Generated icon${size}.png`);
}
