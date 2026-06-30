#!/usr/bin/env python3
"""
Resize logo.png to PWA icon sizes using Pillow
"""

from PIL import Image
import os

def resize_logo():
    try:
        # Open the original logo
        logo_path = "public/icons/logo.png.png"
        if not os.path.exists(logo_path):
            print(f"Error: {logo_path} not found")
            return
        
        with Image.open(logo_path) as img:
            print(f"Original logo size: {img.size}")
            
            # Create icons directory if it doesn't exist
            os.makedirs("public/icons", exist_ok=True)
            
            # Resize to 192x192
            img_192 = img.resize((192, 192), Image.Resampling.LANCZOS)
            img_192.save("public/icons/icon-192x192.png", "PNG", optimize=True)
            print("✅ Created icon-192x192.png (192x192)")
            
            # Resize to 512x512
            img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
            img_512.save("public/icons/icon-512x512.png", "PNG", optimize=True)
            print("✅ Created icon-512x512.png (512x512)")
            
            # Resize to 180x180 (Apple touch icon)
            img_180 = img.resize((180, 180), Image.Resampling.LANCZOS)
            img_180.save("public/icons/apple-touch-icon.png", "PNG", optimize=True)
            print("✅ Created apple-touch-icon.png (180x180)")
            
            print("\n🎨 All PWA icons created successfully!")
            print("📱 Ready for mobile installation!")
            
    except Exception as e:
        print(f"❌ Error: {e}")
        print("Make sure Pillow is installed: pip install Pillow")

if __name__ == "__main__":
    resize_logo()
