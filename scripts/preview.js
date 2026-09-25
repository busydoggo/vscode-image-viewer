'use strict';
// Optional local UI harness; uses the actual webview scripts and decoder.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../media/core');
const I18n = require('../media/i18n');
const { Decoder } = require('../src/decoder');
const previewDecoder = new Decoder();
const root = path.join(__dirname, '..');
const fixtures = ['color-bars.png', 'color-bars.jpg', 'bayer-rggb-320x240.raw', 'rgbir-rgbi-320x240.raw', 'nv12-320x240.yuv', 'offset16-320x240.bin', 'sequence-rggb-320x240.raw', 'sequence-i420-320x240.yuv', 'luma-320x240.y', 'chroma-320x240.uv'];
fixtures.push(...require('../fixtures/scenes.json').entries.map(entry => entry.file));
// Keep the reference and all storage variants available for direct visual comparison.
fixtures.push(...require('../fixtures/colorchecker24.json').entries.map(entry => entry.file));
// Exercise production filename inference; fixture-specific decoding overrides would hide regressions.
const entries = fixtures.map(name => {
  const config = Core.defaults(name);
  if (name.startsWith('rgbir')) Object.assign(config, { display: 'side' });
  return { id: name, name, path: 'fixtures/' + name, kind: Core.kind(name), size: fs.statSync(path.join(root, 'fixtures', name)).size, config, frame: 1, fps: 24, epoch: 0 };
});
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const locale = I18n.resolveLocale(url.searchParams.get('lang') || 'zh-cn');
  const { th } = I18n.create(locale);
  I18n.setLocale(locale);
  if (['/decode', '/pixel'].includes(url.pathname) && req.method === 'POST') {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 20000) throw new Error('Request too large'); }
      const input = JSON.parse(body);
      I18n.setLocale(locale);
      if (url.pathname === '/pixel') { res.end(JSON.stringify(await previewDecoder.inspect(input.frameId, input.x, input.y))); return; }
      const { id, config, frame, fps, epoch } = input, entry = entries.find(e => e.id === id); if (!entry) throw new Error('Unknown fixture');
      const info = Core.analyze(config, entry.size); if (!info.valid) { res.end(JSON.stringify({ type: 'invalid', message: Object.values(info.errors)[0] })); return; }
      const seq = { ...Core.sequence(config, entry.size, frame), fps, epoch };
      const decoded = await previewDecoder.decode({ path: path.join(root, entry.path), config, readOffset: seq.readOffset, length: info.requiredBytes, locale });
      res.end(JSON.stringify({ type: 'image', source: decoded.image, frameId: decoded.frameId, name: entry.name, kind: config.format, display: config.format === 'CFA' && Core.isRgbir(config) ? config.display : 'rgb', sequence: seq }));
    } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); } return;
  }
  if (url.pathname === '/viewer' || url.pathname === '/inspector') {
    // Match the extension viewer's JPEG correction module in the standalone preview.
    const role = url.pathname.slice(1); res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><link rel="stylesheet" href="/media/styles.css"><body class="${role}"><div id="app"></div><script>function acquireVsCodeApi(){return {postMessage:message=>parent.postMessage({role:'${role}',message},location.origin)}};</script><script>globalThis.SensorLocale = ${I18n.serialize(locale)}; globalThis.SensorDemosaicDefaults = ${JSON.stringify(require('../media/demosaic-defaults.json'))};</script><script src="/media/i18n.js"></script><script src="/media/demosaic.js"></script><script src="/media/core.js"></script>${role === 'viewer' ? '<script src="/media/resample.js"></script><script src="/media/jpeg-preview.js"></script><script src="/media/playback.js"></script><script src="/media/playback-controls.js"></script><script src="/media/cfa-editor.js"></script><script src="/media/toolbar.js"></script>' : ''}<script src="/media/${role}.js"></script></body></html>`); return;
  }
  if (url.pathname === '/') {
    const sidebarWidth = Math.max(160, Math.min(800, Number(url.searchParams.get('sidebarWidth')) || 310));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${th('preview.title')}</title><style>html,body{margin:0;height:100%;background:#181b20;color:#ddd;font:13px system-ui}body{display:grid;grid-template-columns:210px 1fr ${sidebarWidth}px}nav{overflow-y:auto;min-height:0;padding:22px 12px;background:#202329;border-right:1px solid #ffffff16}h2{font-size:13px;margin:0 8px 22px}button{display:block;box-sizing:border-box;text-decoration:none;background:none;border:0;color:#adb6c4;padding:10px 8px;text-align:left;width:100%;cursor:pointer;font-size:11px;overflow-wrap:anywhere}button:hover,button.active{background:#ffffff0d;color:white}iframe{border:0;width:100%;height:100%}small{display:block;color:#818b99;font-size:10px;margin:22px 8px}</style><nav><h2>${th('app.name')}</h2>${fixtures.map(name => `<button data-id="${name}">${name}</button>`).join('')}<small>${th('preview.hint')}</small></nav><iframe id="viewer" title="${th('preview.viewer')}" src="/viewer?lang=${locale}"></iframe><iframe id="inspector" title="${th('app.properties')}" src="/inspector?lang=${locale}"></iframe><script>
const entries=${JSON.stringify(entries)};let active=entries[6],rev=0,pixelRevision,pixelFrameId;const ready={};
function send(role,data){document.getElementById(role).contentWindow.postMessage(data,location.origin)}
function state(){for(const role of ['inspector','viewer'])if(ready[role])send(role,{type:'state',entry:active})}
async function render(reset=true,requestId){if(reset){active.epoch++;send('viewer',{type:'resetPlayback'});state()}document.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.id===active.id));if(!ready.viewer)return;const n=++rev;if(active.kind!=='BINARY'){send('viewer',{type:'image',source:'/fixtures/'+active.name,name:active.name,kind:active.kind,revision:n});return;}send('viewer',{type:'loading',preserveImage:!reset});const response=await fetch('/decode?lang=${locale}',{method:'POST',body:JSON.stringify({id:active.id,config:active.config,frame:active.frame,fps:active.fps,epoch:active.epoch})});const data=await response.json();if(n===rev){pixelRevision=n;pixelFrameId=data.frameId;send('viewer',{...data,sequence:data.sequence?{...data.sequence,fps:active.fps}:undefined,revision:n,requestId})}}
async function inspectPixel(m){let pixel=null;try{if(m.revision===pixelRevision){const response=await fetch('/pixel?lang=${locale}',{method:'POST',body:JSON.stringify({frameId:pixelFrameId,x:m.x,y:m.y})});pixel=(await response.json()).pixel}}catch{}send('viewer',{type:'pixel',revision:m.revision,requestId:m.requestId,pixel})}
window.addEventListener('message',e=>{if(e.origin!==location.origin)return;const {role,message:m}=e.data;if(!m)return;if(m.type==='activity'){if(role==='inspector')send('viewer',{type:'activity'})}else if(m.type==='ready'){ready[role]=true;render()}else if(m.type==='inspectPixel'){inspectPixel(m)}else if(m.type==='patch'){const target=entries.find(x=>x.id===m.id);Object.assign(target.config,m.patch);target.frame=1;if(target===active)render()}else if(m.type==='metadata'&&m.revision===rev){const changed=active.metadata?.width!==m.width||active.metadata?.height!==m.height;active.metadata={width:m.width,height:m.height};if(changed)state()}else if(m.type==='seek'&&m.epoch===active.epoch){active.frame=m.frame;render(false,m.requestId)}else if(m.type==='fps'){active.fps=m.fps}else if(m.type==='refresh')render()});document.querySelectorAll('button').forEach(b=>b.onclick=()=>{active=entries.find(e=>e.id===b.dataset.id);render()});
</script></html>`); return;
  }
  const filename = path.resolve(root, '.' + url.pathname);
  if (!filename.startsWith(root + path.sep) || !/^\/(media|fixtures)\/[a-zA-Z0-9_.-]+$/.test(url.pathname) || !fs.existsSync(filename)) { res.statusCode = 404; res.end(); return; }
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };
  res.setHeader('Content-Type', types[path.extname(filename)] || 'application/octet-stream'); fs.createReadStream(filename).pipe(res);
});
server.listen(4317, '127.0.0.1', () => console.log('UI preview: http://127.0.0.1:4317'));
