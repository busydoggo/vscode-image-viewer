"""Run the unmodified IPOL ARI implementation as an offline Bayer quality reference.

Usage: python scripts/demosaic-ari-reference.py /path/to/residual_demosaicking
Requires NumPy and OpenCV; neither is a runtime dependency of the extension.
The source must first pass an independent large constant-field sanity check.
"""
import sys
import json
import time
from pathlib import Path
import numpy as np
import cv2
sys.path.insert(0, sys.argv[1])
from demosaic_ARI import demosaic_ARI
root = Path(__file__).resolve().parents[1] / 'test-results/demosaic-quality'
output = root / 'ari-reference'
output.mkdir(exist_ok=True)
# Reject numerically unstable reference runs before ranking algorithms by their output.
constant = np.tile(np.array([115., 82., 68.]), (432, 640, 1))
quantized = np.floor(constant * 4095 / 255 + .5) * 255 / 4095
check = demosaic_ARI(quantized, 'rggb')
error = np.abs(np.floor(np.clip(check, 0, 255) + .5) - constant)
sanity = {'valid': bool(np.isfinite(check).all() and error[20:-20, 20:-20].max() <= 1),
          'numpy': np.__version__, 'opencv': cv2.__version__, 'inputScale': '0..255, 12-bit quantized',
          'constantFullFrameMAE': float(error.mean()), 'constantInteriorMaxError': float(error[20:-20, 20:-20].max()),
          'reference': 'https://www.ipol.im/pub/art/2021/358/'}
(output / 'sanity.json').write_text(json.dumps(sanity, indent=2))
if not sanity['valid']:
    print('Reference failed the constant-field sanity check; no comparative quality claim is valid.', sanity, flush=True)
    raise SystemExit(2)
results = []
for case in json.loads((root / 'baseline/metrics.json').read_text())['results']:
    if case['pattern'] != 'RGGB':
        continue  # RGB-IR is not a Bayer CFA; the published implementation does not support it.
    rgb = cv2.imread(str(root / (case['name'] + '-reference.png')))[:, :, ::-1].astype(np.float64)
    peak = 2 ** case['bitDepth'] - 1
    sampled = np.floor(rgb * peak / 255 + .5) * 255 / peak
    start = time.perf_counter()
    actual = demosaic_ARI(sampled, 'rggb')
    elapsed = (time.perf_counter() - start) * 1000
    actual = np.floor(np.clip(actual, 0, 255) + .5).astype(np.uint8)
    cv2.imwrite(str(output / (case['name'] + '.png')), actual[:, :, ::-1])
    record = {'name': case['name'], 'milliseconds': elapsed, 'sourceSha256': case['sourceSha256']}
    results.append(record)
    print(case['name'], round(elapsed), 'ms', flush=True)
    (output / 'timing.json').write_text(json.dumps(results, indent=2))
