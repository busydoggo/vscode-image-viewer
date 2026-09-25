# Sensor Image Viewer icon

Generated with the built-in image_gen tool. The four glass pixels represent red, green, blue and infrared samples; the corner brackets represent image inspection. No text is used so the symbol stays readable at small sizes.

`sensor-image-viewer-icon-source.png` preserves the original generated image. `../media/icon.png` is the 256 x 256 PNG export used by the extension manifest. Export with macOS `sips -z 256 256 design/sensor-image-viewer-icon-source.png --out media/icon.png`; retain its alpha channel.

## Generation prompt

```text
Use case: logo-brand.
Asset type: finished square application icon for "Sensor Image Viewer", a VS Code extension for RAW CFA, RGB-IR, PNG/JPEG and YUV image inspection.
Create ONE polished production icon, not a presentation sheet or mockup. 1024 x 1024 PNG.
The symbol is a large, perfectly aligned 2 by 2 image-sensor mosaic: top-left warm coral red, top-right vivid emerald green, bottom-left saturated electric blue, bottom-right luminous violet representing infrared. Four thick rounded-square glass pixels with clean narrow dark gutters, occupying most of the icon. A restrained set of four silver-white viewfinder corner strokes surrounds this mosaic to suggest precise image inspection. The whole composition sits on a dark graphite rounded-square app tile with smooth generous corners and a subtle bevel.
Style: premium macOS-inspired translucent glass, refined soft reflections and subtle depth, crisp geometric silhouettes. Orthographic straight-on view, no perspective tilt. Saturated but controlled color, very high legibility even when reduced to 48 pixels. Glass highlights should be broad and gentle, not lots of shiny lines. Symmetric, optically centered composition with consistent padding; silhouette fills about 86 percent of the canvas.
Outside the rounded app tile use actual transparent alpha, not a drawn checkerboard, white border, scene or backdrop.
No words, no letters (including R G B I), no numbers, no logos belonging to other products, no lens, no camera body, no tiny circuitry, no sparkles, no extra objects, no watermark.
```
