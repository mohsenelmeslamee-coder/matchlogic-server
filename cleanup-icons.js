const fs = require("fs");
const path = require("path");

const iconsDir = path.join(__dirname, "public", "icons");

console.log('🧹 Cleaning up old icons...');

// Files to keep (essential)
const keepFiles = [
  'fallback-logo.svg',
  'README.txt'
];

// Files that will be replaced by new logo
const replaceFiles = [
  'icon-192x192.png',
  'icon-512x512.png',
  'header-logo.png',
  'favicon-32.png'
];

// Clean up old/redundant files
const files = fs.readdirSync(iconsDir);
files.forEach(file => {
  const filePath = path.join(iconsDir, file);
  const stat = fs.statSync(filePath);
  
  if (stat.isFile()) {
    // Skip essential files
    if (keepFiles.includes(file)) {
      console.log(`✅ Keeping: ${file}`);
      return;
    }
    
    // Remove old files that will be replaced
    if (replaceFiles.includes(file)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Removed old: ${file} (will be replaced with premium logo)`);
      return;
    }
    
    // Remove any other redundant files
    if (file.includes('icon-') || file.includes('favicon') || file.includes('logo')) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Removed redundant: ${file}`);
    }
  }
});

console.log('✅ Icon cleanup completed!');
console.log('📝 Next steps:');
console.log('   1. Add your premium logo file to the project');
console.log('   2. Run: npm install');
console.log('   3. Run: node process-logo.js path/to/your-logo.png');
console.log('   4. Update favicon.ico if needed');
