"""Remove the bottom-right "AI生成" watermark from design sheets.

Instead of painting a flat colour (which would leave a visible block on the UI
mockups where the watermark sits on a parchment panel), we take a thin strip of
pixels just ABOVE the watermark and stretch it downward over the watermark area.
On these sheets that region is a vertically-uniform background or panel edge, so
the patch blends in cleanly for both flat character sheets and UI mockups.
"""
import sys
from PIL import Image


def clean(path: str) -> None:
    im = Image.open(path).convert("RGB")
    W, H = im.size
    x0, y0 = int(W * 0.70), int(H * 0.885)
    h = H - y0
    if h <= 0 or W - x0 <= 0:
        print("skip", path)
        return
    strip = im.crop((x0, max(0, y0 - 6), W, y0)).resize((W - x0, h), Image.NEAREST)
    im.paste(strip, (x0, y0))
    im.save(path)
    print("cleaned", path)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        clean(p)
