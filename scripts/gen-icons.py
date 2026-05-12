#!/usr/bin/env python3
"""Generate all PWA/favicon icon sizes from public/logo.png."""
import sys
from pathlib import Path
from PIL import Image

src = Path(__file__).parent.parent / "public" / "logo.png"
if not src.exists():
    sys.exit(f"ERROR: {src} not found — copy your logo PNG there first.")

img = Image.open(src).convert("RGBA")

sizes = {
    "favicon-16.png":        (16,  16),
    "favicon-32.png":        (32,  32),
    "apple-touch-icon.png":  (180, 180),
    "icon-192.png":          (192, 192),
    "icon-512.png":          (512, 512),
    "icon-maskable-192.png": (192, 192),
    "icon-maskable-512.png": (512, 512),
}

out_dir = src.parent
for name, (w, h) in sizes.items():
    resized = img.resize((w, h), Image.LANCZOS)
    dest = out_dir / name
    resized.save(dest, "PNG", optimize=True)
    print(f"  {name} ({w}×{h})")

print("Done.")
