'use strict';
// Build a self-contained comparison artifact from full-resolution benchmark outputs.
const fs = require('node:fs');
const path = require('node:path');
const { readRgbPng } = require('./png-rgb');
const { encodePng } = require('../src/png');
const { area } = require('../media/resample');
const { rgba } = require('./demosaic-quality');
const root = path.join(__dirname, '../test-results/demosaic-quality');
const before = JSON.parse(fs.readFileSync(path.join(root, 'baseline/metrics.json')));
const after = JSON.parse(fs.readFileSync(path.join(root, 'after/metrics.json')));
function picture(file) {
  const image = readRgbPng(fs.readFileSync(file)), w = Math.min(768, image.width), h = Math.round(image.height * w / image.width);
  const pixels = rgba(image), reduced = w === image.width ? pixels : area(pixels, image.width, image.height, w, h);
  return 'data:image/png;base64,' + encodePng(w, h, reduced).toString('base64');
}
const results = after.results.map(row => {
  const old = before.results.find(r => r.name === row.name);
  if (!old || row.sourceSha256 !== old.sourceSha256 || row.pixels !== old.pixels) throw new Error('Mismatched benchmark inputs: ' + row.name);
  return { ...row, before: old, reference: picture(path.join(root, row.name + '-reference.png')),
    oldImage: picture(path.join(root, 'baseline', row.name + '.png')), newImage: picture(path.join(root, 'after', row.name + '.png')) };
});
const changes = (old, current) => old ? (100 * (old - current) / old).toFixed(1) + '%' : '—';
const keys = ['mae', 'edgeMae', 'chromaMae', 'zipper'];
const summary = results.map(({ name, pattern, bitDepth, sourceSha256, before: old, ...row }) => ({ name, pattern, bitDepth, sourceSha256,
  before: Object.fromEntries([...keys, 'psnr', 'max', 'milliseconds'].map(k => [k, old[k]])),
  after: Object.fromEntries([...keys, 'psnr', 'max', 'milliseconds'].map(k => [k, row[k]])),
  improvementPercent: Object.fromEntries(keys.map(k => [k, old[k] ? 100 * (old[k] - row[k]) / old[k] : null])), pixels: row.pixels }));
fs.writeFileSync(path.join(root, 'comparison.json'), JSON.stringify({ generated: after.timestamp, node: after.node, platform: after.platform,
  coverage: 'Every output pixel and RGB channel, including borders. References are synthetic, not native sensor captures.', results: summary }, null, 2) + '\n');
const table = results.map(r => `<tr><td>${r.name}</td><td>${r.pixels.toLocaleString()}</td><td>${r.before.mae.toFixed(3)} → ${r.mae.toFixed(3)}</td><td>${changes(r.before.mae, r.mae)}</td><td>${r.before.max} → ${r.max}</td><td>${r.before.edgeMae.toFixed(3)} → ${r.edgeMae.toFixed(3)}</td><td>${changes(r.before.chromaMae, r.chromaMae)}</td><td>${changes(r.before.zipper, r.zipper)}</td><td>${Math.round(r.before.milliseconds)} → ${Math.round(r.milliseconds)}</td></tr>`).join('');
const data = JSON.stringify(results.map(r => ({ name: r.name, reference: r.reference, oldImage: r.oldImage, newImage: r.newImage, mae: r.mae, oldMae: r.before.mae }))).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>RAW 抗锯齿评估</title>
<style>body{margin:32px auto;padding:0 24px;max-width:1600px;background:#15181e;color:#e9edf4;font:15px/1.65 system-ui}h1{font-size:28px}p{max-width:1100px;color:#b9c4d4}select,button{font:inherit;padding:8px 12px;margin:8px;background:#293343;color:white;border:1px solid #52627c;border-radius:8px}figure{margin:0;min-width:0}figcaption{padding:10px;font-weight:600}.pictures{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.pictures img{width:100%;display:block;background:#222;image-rendering:pixelated}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;text-align:left;border-bottom:1px solid #343b48}th{color:#aacaff;position:sticky;top:0;background:#15181e}small{color:#9cafc8}a{color:#a8ccff}@media(max-width:900px){.pictures{grid-template-columns:1fr}body{padding:0 12px}.results{overflow-x:auto}}</style>
<h1>RAW 解马赛克与缩放评估</h1><p>相同输入、相同黑白电平与 Gamma，对比旧重建和保守的方向修正。所有指标检查整张图，包含边界；面积降采样仅影响显示，不参与解马赛克质量评分。改善百分比为正代表误差降低。</p>
<p>参考图包括合成斜边、圆弧、织物、细线、渐变，以及现有交通、动物、足球、色卡图。复杂场景来自 RGB8 合成参考，并非原生 12/16-bit 传感器实拍，RGB-IR 使用独立的合成 IR 值。</p>
<label>测试图<select id="scene">${results.map(r => `<option>${r.name}</option>`).join('')}</select></label><button id="switch">切换前后对比顺序</button><small id="caption"></small>
<div class="pictures"><figure><figcaption>参考图</figcaption><img id="reference" alt="参考图"></figure><figure><figcaption id="leftLabel">修改前</figcaption><img id="old" alt="修改前"></figure><figure><figcaption id="rightLabel">修改后</figcaption><img id="new" alt="修改后"></figure></div>
<p>大图在本报告中使用相同面积滤波缩小到最多 768 px；完整分辨率 PNG 保存在 baseline/ 和 after/ 目录。MAE 是 RGB8 平均绝对误差；色差误差衡量 R−G / B−G；拉链代理值衡量相邻色差误差变化，不能替代人工判断。耗时为串行单次解码，含首次运行、分配和 GC 波动。</p>
<div class="results"><table><thead><tr><th>测试图</th><th>像素数</th><th>整图 MAE 前 → 后</th><th>MAE 改善</th><th>最大通道误差</th><th>边缘 MAE 前 → 后</th><th>色差改善</th><th>拉链代理改善</th><th>耗时 ms 前 → 后</th></tr></thead><tbody>${table}</tbody></table></div>
<p>ARI 参考实现尚未通过当前环境的大尺寸恒定颜色自检；本报告不将其异常输出作为算法优劣的依据。当前默认修正参考 GBTF 的局部色差一致性思路，并非完整 ARI。</p>
<script>const data=${data};let swapped=false;const select=document.getElementById('scene');function show(){const row=data[select.selectedIndex];document.getElementById('reference').src=row.reference;document.getElementById('old').src=swapped?row.newImage:row.oldImage;document.getElementById('new').src=swapped?row.oldImage:row.newImage;document.getElementById('leftLabel').textContent=swapped?'修改后':'修改前';document.getElementById('rightLabel').textContent=swapped?'修改前':'修改后';document.getElementById('caption').textContent='整图 MAE '+row.oldMae.toFixed(3)+' → '+row.mae.toFixed(3)}select.onchange=show;document.getElementById('switch').onclick=()=>{swapped=!swapped;show()};select.value='traffic-RGGB';show();</script></html>`;
fs.writeFileSync(path.join(root, 'report.html'), html);
console.log(path.join(root, 'report.html'));
