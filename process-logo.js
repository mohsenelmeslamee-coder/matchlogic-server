const fs = require("fs");
const path = require("path");
const sharp = require('sharp');

const iconsDir = path.join(__dirname, "public", "icons");

async function resizeIconWithPadding(inputPath, outputPath, size) {
  try {
    // Add 10% padding by resizing to 80% of target size, then padding
    const actualSize = Math.floor(size * 0.8);
    const padding = Math.floor((size - actualSize) / 2);
    
    await sharp(inputPath)
      .resize(actualSize, actualSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .extend({
        top: padding,
        left: padding,
        bottom: padding,
        right: padding,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outputPath);
    
    console.log(`✅ Created ${outputPath} with 10% padding`);
  } catch (error) {
    console.error(`❌ Error creating ${outputPath}:`, error);
  }
}

async function processNewLogo(logoPath) {
  console.log('🚀 Processing premium logo...');
  
  // Create high-quality icons with 10% padding
  await resizeIconWithPadding(logoPath, path.join(iconsDir, "icon-192x192.png"), 192);
  await resizeIconWithPadding(logoPath, path.join(iconsDir, "icon-512x512.png"), 512);
  
  // Create small header icon (30px)
  await resizeIconWithPadding(logoPath, path.join(iconsDir, "header-logo.png"), 30);
  
  // Create favicon (32px)
  await resizeIconWithPadding(logoPath, path.join(iconsDir, "favicon-32.png"), 32);
  
  console.log('✅ All premium icons generated successfully!');
}

// Usage: node process-logo.js path/to/new-logo.png
const logoPath = process.argv[2];
if (logoPath && fs.existsSync(logoPath)) {
  processNewLogo(logoPath).catch(console.error);
} else {
  console.log('❌ Please provide path to logo file: node process-logo.js path/to/logo.png');
}
