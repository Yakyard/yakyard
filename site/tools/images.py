"""Make web copies of the real app screenshots for the site.

Run from the repo root: python3 site/tools/images.py
Writes WebP files to site/static/img/. Needs Pillow.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "site/static/img"
OUT.mkdir(parents=True, exist_ok=True)

def save(src, name, widths, quality=82):
    im = Image.open(src).convert("RGB")
    for w in widths:
        if w > im.width:
            w = im.width
        h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(OUT / f"{name}-{w}.webp", "WEBP", quality=quality, method=6)

for f in sorted((ROOT / "docs/screens").glob("*.png")):
    if f.stem.startswith("phone-"):
        save(f, f.stem, [780, 520])
    elif f.stem == "voice-note-transcript":
        save(f, f.stem, [960, 640])
    else:
        save(f, f.stem, [2160, 1440, 960])

for f in sorted((ROOT / "docs/guide").glob("*.png")):
    im = Image.open(f)
    save(f, "guide-" + f.stem, [min(im.width, 1440)])
print("done", len(list(OUT.glob("*.webp"))), "files")
