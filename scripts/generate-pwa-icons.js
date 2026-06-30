const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const iconsDir = path.join(__dirname, "..", "public", "icons");
const themeGreen = { r: 15, g: 197, b: 94 }; // #0f172a -> use #22c55e green
const themeDark = { r: 15, g: 23, b: 42 };

function createIcon(size) {
  const png = new PNG({ width: size, height: size });
  const center = size / 2;
  const radius = size * 0.35;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const d = Math.sqrt(dx * dx + dy * dy);
      const idx = (size * y + x) << 2;
      if (d <= radius) {
        png.data[idx] = themeGreen.r;
        png.data[idx + 1] = themeGreen.g;
        png.data[idx + 2] = themeGreen.b;
        png.data[idx + 3] = 255;
      } else {
        png.data[idx] = themeDark.r;
        png.data[idx + 1] = themeDark.g;
        png.data[idx + 2] = themeDark.b;
        png.data[idx + 3] = 255;
      }
    }
  }
  return png;
}

if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

async function run() {
  for (const size of [192, 512]) {
    const png = createIcon(size);
    const out = path.join(iconsDir, `icon-${size}.png`);
    await new Promise((resolve, reject) => {
      png.pack().pipe(fs.createWriteStream(out)).on("finish", resolve).on("error", reject);
    });
    console.log("Created", out);
  }
}
run().catch((err) => { console.error(err); process.exit(1); });
