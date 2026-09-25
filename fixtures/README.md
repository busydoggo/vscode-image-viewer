# Image fixtures / 图像测试素材


## ColorChecker 24 IQ chart / 24 色块 IQ 测试图

[PNG reference / PNG 参考图](colorchecker24-reference.png): **640 × 432**, six columns × four rows, 88 × 88 square patches with 16-pixel dark gutters. Colors follow the **ColorChecker 2005, sRGB (GMB)** column of Table 2 in [Danny Pascale / BabelColor's reference](https://babelcolor.com/index_htm_files/RGB%20Coordinates%20of%20the%20Macbeth%20ColorChecker.pdf). The last row provides six gray levels. The geometry is synthetic; this is a preview test asset, not a certified physical calibration target.
**640 × 432**、6 列 × 4 行，色块大小 88 × 88，深色间隔 16 像素。颜色采用上述文献表 2 的 **ColorChecker 2005 sRGB (GMB)** 数据，最下方为六级灰阶。布局通过程序生成，用于预览测试，并非经过认证的实体校准卡。

| Pattern / 阵列 | 12 bit in 16 / 12 位放入 16 位 | Packed 12 bit / 紧凑 12 位 | 16 bit / 16 位 |
| --- | --- | --- | --- |
| Bayer RGGB | [RAW](colorchecker24-bayer-rggb-12bit-in16-lsb-le-640x432.raw) | [RAW](colorchecker24-bayer-rggb-12bit-packed-le-640x432.raw) | [RAW](colorchecker24-bayer-rggb-16bit-in16-lsb-le-640x432.raw) |
| RGB-IR RGBI | [RAW](colorchecker24-rgbir-rgbi-12bit-in16-lsb-le-640x432.raw) | [RAW](colorchecker24-rgbir-rgbi-12bit-packed-le-640x432.raw) | [RAW](colorchecker24-rgbir-rgbi-16bit-in16-lsb-le-640x432.raw) |

Open any RAW directly; filenames infer the configuration. Use gamma 1, automatic white level and RGB display to compare with the PNG. RGB-IR uses constant synthetic I = 128/255, scaled to the chosen pixel depth; this is not measured infrared reflectance. Samples are scaled from RGB8, with no inverse transfer function, added sensor noise or additional source precision. Packed 12-bit is a row-local LSB-first bitstream, not MIPI RAW12.
直接打开 RAW 即可从文件名推导配置。使用 Gamma 1、自动白电平和彩色显示，与 PNG 对照。RGB-IR 的 I 为固定合成值 128/255，并按像素深度缩放，不代表实测红外反射率。样本由 RGB8 缩放，不加入逆传递函数、传感器噪声或额外的原始精度。Packed 12-bit 为每行重新开始的 LSB 优先位流，不是 MIPI RAW12。

Run `npm run fixtures:colorchecker` to reproduce all seven files offline. `npm run fixtures` also includes this chart. [colorchecker24.json](colorchecker24.json) records colors, geometry, storage metadata and hashes. The standalone preview lists all seven files.
运行 `npm run fixtures:colorchecker` 可离线重新生成全部七个文件，`npm run fixtures` 也包含此步骤。清单记录色值、布局、存储参数和校验值；独立预览已加入全部七个文件。

## Complex scenes / 复杂场景

Three AI-generated reference images, each **1536 × 1024**, with three CFA storage variants per scene (nine RAW files total).
三张 AI 生成的彩色参考图，每张 **1536 × 1024**，每个场景三种 CFA 存储版本，共九个 RAW 文件。

| Scene / 场景 | Reference / 彩色参考图 | Edge and texture coverage / 观察内容 |
| --- | --- | --- |
| Traffic / 交通路口 | [traffic-reference.png](traffic-reference.png) | Prominent red/green traffic lights, diagonal markings, windows, foliage / 醒目的红绿交通灯、斜向标线、窗框、树叶 |
| Wildlife / 动物世界 | [wildlife-reference.png](wildlife-reference.png) | Zebra stripes, fur, grass, branches, water / 斑马纹、毛发、草丛、树枝、水面 |
| Football / 足球赛 | [football-reference.png](football-reference.png) | Goal net, grass, jersey color boundaries, field lines / 球网、草地、球衣颜色边界、场地线 |

| RAW file / 文件 | Bayer | Pixel bits / 像素位深 | Container bits / 容器位数 | Size / 大小 |
| --- | --- | --- | --- | --- |
| [traffic-bayer-rggb-12bit-in16-lsb-le-1536x1024.raw](traffic-bayer-rggb-12bit-in16-lsb-le-1536x1024.raw) | RGGB | 12 | 16 | 3.00 MiB |
| [traffic-bayer-rggb-12bit-packed-le-1536x1024.raw](traffic-bayer-rggb-12bit-packed-le-1536x1024.raw) | RGGB | 12 | 12 | 2.25 MiB |
| [traffic-bayer-rggb-16bit-in16-lsb-le-1536x1024.raw](traffic-bayer-rggb-16bit-in16-lsb-le-1536x1024.raw) | RGGB | 16 | 16 | 3.00 MiB |
| [wildlife-bayer-bggr-12bit-in16-lsb-le-1536x1024.raw](wildlife-bayer-bggr-12bit-in16-lsb-le-1536x1024.raw) | BGGR | 12 | 16 | 3.00 MiB |
| [wildlife-bayer-bggr-12bit-packed-le-1536x1024.raw](wildlife-bayer-bggr-12bit-packed-le-1536x1024.raw) | BGGR | 12 | 12 | 2.25 MiB |
| [wildlife-bayer-bggr-16bit-in16-lsb-le-1536x1024.raw](wildlife-bayer-bggr-16bit-in16-lsb-le-1536x1024.raw) | BGGR | 16 | 16 | 3.00 MiB |
| [football-bayer-grbg-12bit-in16-lsb-le-1536x1024.raw](football-bayer-grbg-12bit-in16-lsb-le-1536x1024.raw) | GRBG | 12 | 16 | 3.00 MiB |
| [football-bayer-grbg-12bit-packed-le-1536x1024.raw](football-bayer-grbg-12bit-packed-le-1536x1024.raw) | GRBG | 12 | 12 | 2.25 MiB |
| [football-bayer-grbg-16bit-in16-lsb-le-1536x1024.raw](football-bayer-grbg-16bit-in16-lsb-le-1536x1024.raw) | GRBG | 16 | 16 | 3.00 MiB |

All files are single-frame, little-endian, LSB-aligned, offset 0, tightly packed rows. 12-bit values in 16-bit containers occupy the low 12 bits, with the high four bits zero. Packed 12-bit uses consecutive LSB-first 12-bit samples restarting at each row; it is **not MIPI RAW12**. 16-bit files use full 16-bit containers. Use gamma 1, black 0, white 0 (automatic).
所有文件均为单帧、小端、低位对齐、读取偏移 0，行内无额外填充。12-in-16 将有效值放在低 12 位，高 4 位补零。Packed 12-bit 是逐行重新开始的 LSB 优先连续位流，**不是 MIPI RAW12**。16-bit 使用完整 16 位容器。Gamma 设为 1，黑电平 0，白电平 0（自动）。

Open a RAW with Image Viewer: its explicit filename supplies dimensions, Bayer pattern, pixel depth, container size, alignment and byte order. Existing per-file saved settings still take precedence. The standalone preview lists the references and all RAW variants, so each source can be compared with its reconstruction.
使用图像观察器打开 RAW 时，文件名自动提供尺寸、Bayer 阵列、像素深度、容器大小、对齐方式和端序；已保存的该文件设置仍优先生效。独立测试预览已列出参考图和全部 RAW，可切换比较重建效果。

## Reproduce / 重新生成

Run `npm run fixtures:scenes` from the repository root to regenerate these RAW files and `scenes.json` from the committed PNG references, without network access or external packages. `npm run fixtures` also includes this step. `scenes.json` records exact file sizes, row pitches and SHA-256 hashes. The references are kept unchanged.
在项目根目录运行 `npm run fixtures:scenes`，即可从保留的 PNG 参考图重新生成 RAW 和 `scenes.json`，无需联网或额外依赖。`npm run fixtures` 也包含此步骤。清单记录精确大小、pitch 和 SHA-256。参考图保持原样。

The CFA sample at each position is `round(RGB8[channel] × (2^bitDepth − 1) / 255)`, where the channel is selected by the specified 2×2 Bayer pattern. Colors remain display-referred; no inverse-sRGB transform, synthetic noise, optical blur or sensor response is added. These files test storage/reading, CFA phase and demosaicing detail. Their underlying reference precision is RGB8: they are **not native 12/16-bit sensor captures** and cannot benchmark real sensor dynamic range or noise.
每个 CFA 采样值为 `round(RGB8[通道] × (2^位深 − 1) / 255)`，通道由对应的 2×2 Bayer 阵列决定。保留显示编码颜色，不加入逆 sRGB 变换、模拟噪声、光学模糊或传感器响应。适合测试存储解析、阵列相位和解马赛克细节；原始参考精度是 RGB8，**不是真实传感器采集的 12/16 位 RAW**，不能用于评估传感器动态范围或噪声。

References were created with the built-in image_gen tool. Exact generation prompts are preserved in [scene-prompts.json](scene-prompts.json). They depict synthetic scenes, not documented real events.
参考图由内置 image_gen 工具生成，完整提示词见 [scene-prompts.json](scene-prompts.json)。场景为合成内容，不对应真实事件记录。
