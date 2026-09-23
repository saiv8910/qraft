// Post-branding smoke test: title, wordmark, QR renders + decodes
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9401;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--user-data-dir=/tmp/qr-smoke', '--no-first-run', '--disable-gpu', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const wd = setTimeout(() => { console.log('TIMEOUT'); try { chrome.kill(); } catch {} process.exit(2); }, 90000);

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const p = l.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); } };
const send = (method, params = {}) => { const i2 = ++id;
  return new Promise((r, j) => { pend.set(i2, { r, j }); ws.send(JSON.stringify({ id: i2, method, params })); }); };
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}

const res = [];
const check = (n, p, i = '') => { res.push(p); console.log(`${p ? '✅' : '❌'} ${n}${i ? '  → ' + i : ''}`); };

await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8731/index.html' });
await sleep(2500);

const meta = await ev(`(() => ({
  title: document.title,
  h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null,
  wordmark: !!document.querySelector('.wordmark'),
  desc: (document.querySelector('meta[name=description]')||{}).content || '',
  og: (document.querySelector('meta[property="og:title"]')||{}).content || '',
  favicon: (document.querySelector('link[rel=icon]')||{}).href || '',
  tabs: document.querySelectorAll('.tab').length
}))()`);

check('Title is branded', /Qraft/.test(meta.title), JSON.stringify(meta.title));
check('H1 shows Qraft wordmark', /Qraft/.test(meta.h1 || '') && meta.wordmark, JSON.stringify(meta.h1));
check('Meta description branded', /Qraft/.test(meta.desc), meta.desc.slice(0, 60) + '…');
check('og:title branded', /Qraft/.test(meta.og), JSON.stringify(meta.og));
check('Favicon is a data URI SVG', /^data:image\/svg\+xml;base64,/.test(meta.favicon), meta.favicon.slice(0, 34) + '…');
check('All 13 tabs present', meta.tabs === 13, `tabs=${meta.tabs}`);

// Render + decode round-trip on the branded page
const out = await ev(`(async () => {
  const t = document.getElementById('text');
  t.value = 'https://qraft.app/hello';
  t.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  const cv = document.getElementById('preview');
  if (!cv || cv.style.display === 'none') return { err: 'no canvas' };
  if (typeof BarcodeDetector === 'undefined') return { err: 'no detector' };
  const codes = await new BarcodeDetector({ formats: ['qr_code'] }).detect(cv);
  return { w: cv.width, decoded: codes.length ? codes[0].rawValue : null,
           status: document.getElementById('status').textContent };
})()`);

check('QR renders after branding', out && out.w === 256, JSON.stringify(out));
check('QR decodes to exact input', out && out.decoded === 'https://qraft.app/hello', JSON.stringify(out && out.decoded));
check('Status reads ready', out && /Ready/.test(out.status || ''), JSON.stringify(out && out.status));

const errs = [];
ws.addEventListener('message', () => {});
check('No page errors', errs.length === 0);

clearTimeout(wd);
const passed = res.filter(Boolean).length;
console.log(`\n${'='.repeat(46)}\nSMOKE: ${passed}/${res.length} passed`);
ws.close(); chrome.kill();
process.exit(passed === res.length ? 0 : 1);
