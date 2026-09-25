# JPEG decode regression snapshots

These lossless PNGs contain the output of an independent JPEG decoder, not corrected previews. Runtime code and Node tests need no JPEG package. Source SHA-256 hashes in `jpeg-decoded.json` bind the snapshots to the committed references.

Generated with Pillow 12.3.0 (libjpeg):

```python
from PIL import Image
from io import BytesIO

Image.open('fixtures/color-bars.jpg').convert('RGBA').save(
    'test/fixtures/color-bars-jpeg-decoded.png')
encoded = BytesIO()
Image.open('fixtures/colorchecker24-reference.png').convert('RGB').save(
    encoded, format='JPEG', quality=92, subsampling=2)
Image.open(BytesIO(encoded.getvalue())).convert('RGBA').save(
    'test/fixtures/colorchecker-jpeg-decoded.png')
```

The first snapshot preserves the reported columns 159/160. The second introduces actual 4:2:0 compression around all ColorChecker patch corners. Tests compare every RGB channel with the corresponding original PNG and separately verify luminance, alpha, source immutability, eight corner orientations, gradients, texture and cancellation.
