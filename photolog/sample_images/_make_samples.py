"""Generate two synthetic field-photo JPEGs so the dry-run renders out of the
box without real survey imagery. Run: python sample_images/_make_samples.py"""
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def forest(path, w=1200, h=1000):
    img = Image.new("RGB", (w, h), (150, 175, 120))
    d = ImageDraw.Draw(img)
    # sky-to-floor wash
    for y in range(h):
        t = y / h
        c = (int(170 - 70 * t), int(190 - 60 * t), int(150 - 80 * t))
        d.line([(0, y), (w, y)], fill=c)
    # tree trunks
    for i in range(18):
        x = int((i + 0.5) * w / 18) + ((i * 37) % 40 - 20)
        tw = 10 + (i * 13) % 18
        shade = 60 + (i * 29) % 60
        d.rectangle([x, 60, x + tw, h], fill=(shade, shade - 10, shade - 25))
    img.save(path, quality=88)


def stockpile(path, w=1200, h=900):
    img = Image.new("RGB", (w, h), (120, 150, 90))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = (int(150 - 40 * t), int(165 - 20 * t), int(170 - 90 * t))
        d.line([(0, y), (w, y)], fill=c)
    # grass foreground
    d.rectangle([0, int(h * 0.55), w, h], fill=(95, 130, 70))
    # dark stockpile mound
    cx, base, top = int(w * 0.55), int(h * 0.7), int(h * 0.42)
    d.polygon([(cx - 320, base), (cx, top), (cx + 330, base)], fill=(38, 36, 34))
    img.save(path, quality=88)


if __name__ == "__main__":
    forest(os.path.join(HERE, "photo_01.jpg"))
    stockpile(os.path.join(HERE, "photo_02.jpg"))
    print("wrote photo_01.jpg, photo_02.jpg")
