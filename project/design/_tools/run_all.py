"""Run watermark cleaning across every generated sheet under design/."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean_watermark import clean  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

for dirpath, dirnames, filenames in os.walk(ROOT):
    if "_raw" in dirpath or "_tools" in dirpath:
        continue
    for f in sorted(filenames):
        if f.lower().endswith(".png"):
            clean(os.path.join(dirpath, f))
