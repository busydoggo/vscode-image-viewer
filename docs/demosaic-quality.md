# RAW anti-alias evaluation

Measured on 2026-09-25, macOS arm64, Node.js v24.15.0. This is a conservative improvement, not complete alias removal or a full ARI implementation.

## Changes evaluated

- Stabilize Hamilton–Adams green candidates using 5×5 local color-difference consistency, with continuous directional-confidence blending.
- Retain the existing eight-ray coefficient policies. Protect supported corner neighborhoods, smooth/low-disagreement areas and strong opposing red/blue boundaries.
- Carry measured-versus-synthetic confidence through RGB-IR virtual Bayer reconstruction. Synthetic centers do not receive the new green correction; their neighborhood evidence is downweighted. IR never supplies visible green.
- Bound temporary filter planes using 256×256 tiles with an eight-pixel halo. Translation tests check that tile boundaries do not create seams.
- Integrate source-pixel areas when reducing the display. Keep original-resolution pixels for inspection and integer zoom; use a separate raster for reduction, with device pixel density and premultiplied alpha.

## Method

The benchmark checks **every pixel and every RGB channel, including outer borders**, at original resolution. It never downsamples images before calculating reconstruction metrics. It contains 58 cases: ten analytical scenes across four Bayer patterns and RGBI (50 cases), plus traffic, wildlife, football and ColorChecker in Bayer and RGBI (8 cases). Synthetic cases cover 12- and 16-bit samples; the complex-scene comparison uses 12-bit samples in 16-bit containers. Separate regression tests exercise packed 12-bit, 16-bit, measured sample retention and all six stored ColorChecker variants.

Analytical references integrate a continuous scene over each pixel with 4×4 supersampling. They include 7°, 22°, 45°, 67° and 83° slants, arcs, fabric, thin lines, a chromatic slant and a smooth ramp. The existing complex references are **AI-generated RGB8 images synthetically mosaiced, not native high-bit-depth sensor captures**. RGB-IR uses independent synthetic IR values and is not a sensor-specific spectral/crosstalk simulation. These are development fixtures, not a held-out camera benchmark; improvements cannot be assumed to generalize to every sensor.

The baseline disables `antiAlias.enabled` while retaining the same decoder, filename/storage interpretation, black/white levels, gamma and output rounding. Source hashes and complete per-case results are recorded in [demosaic-quality.json](demosaic-quality.json). Full-resolution PNGs and an interactive HTML report can be regenerated with the commands below.

- **MAE:** mean absolute RGB8 reconstruction error.
- **Edge MAE:** RGB error on a reference-defined edge mask (adjacent reference luminance difference > 12 RGB8 units). This supplements, never replaces, the whole-frame metric.
- **Chroma error:** mean error in R−G and B−G differences, rather than colorfulness of the output itself.
- **Zipper proxy:** mean adjacent variation of chroma *error*. Lower values are useful evidence but do not prove perceptual sharpness.
- **Max error:** largest absolute channel error anywhere in the image.
- **Timing:** one serial wall-clock decode per case, including allocations, JIT and GC effects. These numbers are indicative, not statistically stable latency guarantees.

## Bayer results

| Scene | RGB8 MAE before → after | MAE reduction | Edge MAE reduction | Chroma-error reduction | Max channel error before → after | Decode ms before → after |
| --- | --- | --- | --- | --- | --- | --- |
| traffic-RGGB | 2.407 → 2.279 | 5.3% | 7.2% | 5.2% | 124 → 117 | 1530 → 1839 |
| wildlife-RGGB | 3.255 → 3.026 | 7.0% | 8.1% | 6.8% | 188 → 188 | 1602 → 1842 |
| football-RGGB | 2.056 → 2.018 | 1.8% | 2.7% | 1.7% | 91 → 97 | 1536 → 1724 |

Across the three equally sized 1536×1024 scenes, mean full-frame MAE falls **5.1%**, edge MAE **6.3%**, chroma error **4.9%**, and the zipper proxy **4.6%**. Average decode time rises from **1.56 s to 1.80 s (about 16%)** in this run.

## RGB-IR results

| Scene | RGB8 MAE before → after | MAE reduction | Edge MAE reduction | Chroma-error reduction | Max channel error before → after | Decode ms before → after |
| --- | --- | --- | --- | --- | --- | --- |
| traffic-RGBI | 4.869 → 4.846 | 0.5% | 0.6% | 0.9% | 172 → 172 | 9497 → 9924 |
| wildlife-RGBI | 5.720 → 5.694 | 0.4% | 0.5% | 0.9% | 197 → 197 | 9479 → 9746 |
| football-RGBI | 2.954 → 2.951 | 0.1% | 0.2% | 0.3% | 132 → 127 | 9368 → 9535 |

Mean full-frame MAE falls only **0.38%** and edge MAE **0.45%**. Average decode time rises from **9.45 s to 9.74 s (about 3%)**. This is a small improvement; the sparse visible sampling and virtual Bayer stage remain the main limitation. It should not be presented as solving RGB-IR zippering.

## Preserved behavior and limitations

- All six stored ColorChecker variants still satisfy the unchanged **whole-frame max error ≤ 1 and MAE ≤ 0.1** limits. The benchmark's Bayer/RGBI charts both measure zero error before and after.
- Every measured visible-channel sample is retained at 12/16-bit in dedicated tests; changing IR intensity does not change reconstructed RGB.
- Bayer 22° and 67° slants improve, but 45° slant improvement is very small. Near-Nyquist detail remains ambiguous.
- Some individual pixels worsen even when the whole image improves: the football Bayer maximum error rises from 91 to 97. Some synthetic RGB-IR cases also regress slightly (all case results are retained, not cherry-picked).
- The analytical 1-pixel stripe test reduced to 25% gives uniform RGB8 128 with area integration. A center-sampled nearest-neighbor simulation has MAE 128 against that expected raster; area reduction has zero error. This is a display-resampling test, separate from demosaicing.
- Area integration operates on already tone-mapped display RGB. It does not claim radiometrically linear reconstruction or recovery of information lost in sensor sampling.

## ARI reference experiment

The Python reference from [IPOL 2021/358](https://www.ipol.im/pub/art/2021/358/) was downloaded and run separately; it is not bundled with the extension. Before ranking it, an independent 640×432 constant field `[115, 82, 68]`, quantized to 12-bit, was tested. With NumPy 2.5.1 and OpenCV 4.14.0, its full-frame MAE was **2.826** and interior maximum error **187**, where a constant interior should reconstruct within rounding tolerance. OpenCV 5 and normalized input were also investigated without establishing a reliable full-frame reference.

This indicates that this reference run needs compatibility/numerical investigation. **It is not evidence that ARI as an algorithm is inferior.** Its anomalous comparison outputs were excluded from the accepted benchmark. The offline driver now fails its sanity check before generating comparative results. A full ARI production mode is therefore deferred; the shipped change is a bounded GBTF-inspired confidence refinement of the existing decoder.

## Reproduction

```sh
npm test
npm run check
node scripts/demosaic-quality.js baseline
node scripts/demosaic-quality.js after
node scripts/demosaic-report.js
```

Open `test-results/demosaic-quality/report.html` for reference/before/after image selection and all case metrics. Complete PNGs are in `baseline/` and `after/`; the HTML embeds display-sized previews so it can be shared as one file. `--quick` restricts an exploratory benchmark to the 50 analytical cases; do not use that option for the complete report.

To investigate ARI, obtain the source ZIP linked by the IPOL paper, install NumPy/OpenCV in a separate Python environment, and run:

```sh
python scripts/demosaic-ari-reference.py /path/to/residual_demosaicking
```

A failed constant-field check exits with status 2 and writes `ari-reference/sanity.json`; it must not be ignored when reporting quality.

## Validation

354 tests passed, including the new full-frame comparisons, 12/16-bit sample retention, IR independence, coefficient compatibility, tile translation and display-area integration tests. Syntax/manifest/localization checks and `git diff --check` passed. Browser checks confirmed separate native/reduced raster dimensions, Fit → 1:1 restoration and the actual traffic preview. New inline comments are in English; coefficient descriptions are localized in English and Simplified Chinese.
