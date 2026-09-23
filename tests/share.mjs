// True share-link test: capture URL in browser A, open it cold in a SEPARATE profile
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const SITE = 'https://remarkable-haupia-c7ea70.netlify.app';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function launch(port, profile) {
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, '--headless=new',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try { const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
          const p = l.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {}
  }
  if (!wsUrl) throw new Error('cannot attach on ' + port);
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); } };
  const send = (method, params = {}) => { const i2 = ++id;
    return new Promise((r, j) => { pend.set(i2, { r, j }); ws.send(JSON.stringify({ id: i2, method, params })); }); };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result.value;
  };
  return { chrome, ws, send, ev };
}

const res = [];
const check = (n, p, i = '') => { res.push(p); console.log(`${p ? '✅' : '❌'} ${n}${i ? '  → ' + i : ''}`); };
const wd = setTimeout(() => { console.log('⏰ TIMEOUT'); process.exit(2); }, 140000);

/* ---------------- Browser A: create a share link ---------------- */
const A = await launch(9421, '/tmp/qr-shareA');
await A.send('Runtime.enable'); await A.send('Page.enable');
await A.send('Page.navigate', { url: SITE });
await sleep(4000);

// Build a rich state: link text + custom colour + a size, then share
await A.ev(`(() => { const t=document.getElementById('text');
  t.value='https://example.com/shared-by-qraft';
  t.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await sleep(700);
await A.ev(`(() => { document.querySelector('[data-pair="#0f766e|#ecfdf5"]').click(); return true; })()`);
await sleep(500);
await A.ev(`(() => { const s=document.getElementById('size'); s.value='400';
  s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
await sleep(800);

const before = await A.ev(`(() => ({ text: document.getElementById('text').value,
  dark: document.getElementById('dark').value, size: document.getElementById('size').value }))()`);
console.log('  browser A state:', JSON.stringify(before));

await A.ev(`(() => { document.getElementById('share').click(); return true; })()`);
await sleep(1000);
const shareUrl = await A.ev('location.href');
console.log('  share URL:', String(shareUrl).slice(0, 90) + '…');

check('Share URL produced on live origin',
  typeof shareUrl === 'string' && shareUrl.startsWith(SITE + '/#qr-gen-v1='),
  String(shareUrl).length + ' chars');
check('Share URL is reasonably short',
  typeof shareUrl === 'string' && shareUrl.length < 8000, String(shareUrl).length + ' chars');

A.ws.close(); A.chrome.kill();
await sleep(800);

/* ---------------- Browser B: open it COLD (separate profile) ---------------- */
const B = await launch(9422, '/tmp/qr-shareB_' + Date.now());
await B.send('Runtime.enable'); await B.send('Page.enable');

// Prove B starts clean: no localStorage from A
await B.send('Page.navigate', { url: SITE });
await sleep(3500);
const clean = await B.ev(`(() => ({ hist: localStorage.getItem('qr-gen-history-v1'),
  text: document.getElementById('text').value }))()`);
console.log('  browser B before share link:', JSON.stringify(clean));
check('Browser B starts empty (no state carried over)',
  clean && !clean.hist && clean.text === '', JSON.stringify(clean));

// Now open the share URL cold — as if a friend clicked your link
await B.send('Page.navigate', { url: shareUrl });
await sleep(4500);

const after = await B.ev(`(() => ({
  text: document.getElementById('text').value,
  dark: document.getElementById('dark').value,
  light: document.getElementById('light').value,
  size: document.getElementById('size').value,
  status: document.getElementById('status').textContent,
  w: document.getElementById('preview').width
}))()`);
console.log('  browser B after opening link:', JSON.stringify(after));

check('Text restored in a brand-new browser', after.text === 'https://example.com/shared-by-qraft',
  JSON.stringify(after.text));
check('Colour restored', after.dark === '#0f766e' && after.light === '#ecfdf5',
  `${after.dark} / ${after.light}`);
check('Size restored', after.size === '400', `size=${after.size}`);
check('Confirmation message shown', /Shared settings loaded/.test(after.status || ''),
  JSON.stringify(after.status));
check('QR canvas rendered at restored size', after.w === 400, `w=${after.w}`);

// Decode the QR that the restored state produced
const decoded = await B.ev(`(async () => {
  const cv = document.getElementById('preview');
  if (!cv || !cv.width) return 'NO_CANVAS';
  const c = await new BarcodeDetector({formats:['qr_code']}).detect(cv);
  return c.length ? c[0].rawValue : 'NOTHING';
})()`);
check('Restored QR decodes to the shared text',
  decoded === 'https://example.com/shared-by-qraft', JSON.stringify(decoded));

B.ws.close(); B.chrome.kill();
clearTimeout(wd);

const passed = res.filter(Boolean).length;
console.log(`\n${'='.repeat(54)}\nSHARE LINK (cross-browser): ${passed}/${res.length} passed`);
process.exit(passed === res.length ? 0 : 1);
