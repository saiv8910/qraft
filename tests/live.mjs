// LIVE production verification against the deployed Netlify URL
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const SITE = 'https://remarkable-haupia-c7ea70.netlify.app';
const PORT = 9411;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new',
  '--user-data-dir=/tmp/qr-live', '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const wd = setTimeout(() => { console.log('⏰ TIMEOUT'); try { chrome.kill(); } catch {} process.exit(2); }, 150000);

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const p = l.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pend = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.j(new Error(m.error.message)) : p.r(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails?.exception?.description || 'exception');
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push(m.params.entry.text);
};
const send = (method, params = {}) => { const i2 = ++id;
  return new Promise((r, j) => { const t = setTimeout(() => { pend.delete(i2); j(new Error('cdp timeout ' + method)); }, 20000);
    pend.set(i2, { r: v => { clearTimeout(t); r(v); }, j: e => { clearTimeout(t); j(e); } });
    ws.send(JSON.stringify({ id: i2, method, params })); }); };
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}

const res = [];
const check = (n, p, i = '') => { res.push(p); console.log(`${p ? '✅' : '❌'} ${n}${i ? '  → ' + i : ''}`); };

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url: SITE });
await sleep(4000);

// --- page health ---
const meta = await ev(`(() => ({
  title: document.title,
  lib: typeof qrcode,
  h1: (document.querySelector('h1')||{}).textContent || '',
  favicon: ((document.querySelector('link[rel=icon]')||{}).href||'').slice(0,26),
  tabs: document.querySelectorAll('.tab').length
}))()`);

check('Live page loads', typeof meta === 'object' && !meta.__error, JSON.stringify(meta));
check('Branded title live', /Qraft/.test(meta.title || ''), JSON.stringify(meta.title));
check('QR library loaded over the network', meta.lib === 'function', `typeof qrcode = ${meta.lib}`);
check('Favicon served', /^data:image\/svg/.test(meta.favicon || ''), meta.favicon);
check('All 13 tabs present', meta.tabs === 13, `tabs=${meta.tabs}`);

const setVal = (id, val) => `(() => { const e=document.getElementById('${id}'); e.value=${JSON.stringify(val)};
  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

const DECODE = `(async () => {
  const cv = document.getElementById('preview');
  if (!cv || cv.style.display === 'none' || !cv.width) return 'NO_CANVAS';
  try { const c = await new BarcodeDetector({formats:['qr_code']}).detect(cv);
        return c.length ? c[0].rawValue : 'NOTHING'; }
  catch(e) { return 'ERR:' + e.message; }
})()`;

async function renderDecode() { await sleep(800); return await ev(DECODE); }

// --- 1. plain URL ---
await ev(setVal('text', 'https://example.com/pricing'));
let got = await renderDecode();
check('LIVE decode: plain URL', got === 'https://example.com/pricing', JSON.stringify(got));

// --- 2. unicode (the bug we fixed) ---
await ev(setVal('text', 'Héllo Wörld 🎉 — 你好'));
got = await renderDecode();
check('LIVE decode: unicode (accent/CJK/emoji)', got === 'Héllo Wörld 🎉 — 你好', JSON.stringify(got));

// --- 3. Wi-Fi tab ---
await ev(`(() => { document.querySelector('[data-tab="wifi"]').click(); return true; })()`);
await ev(setVal('ssid', 'Cafe Guest'));
await ev(setVal('wpass', 'latte;123:"x"'));
got = await renderDecode();
check('LIVE decode: Wi-Fi payload',
  typeof got === 'string' && got.startsWith('WIFI:T:WPA;S:Cafe Guest;P:latte\\;123\\:\\"x\\";'),
  JSON.stringify(got));

// --- 4. vCard tab ---
await ev(`(() => { document.querySelector('[data-tab="vcard"]').click(); return true; })()`);
await ev(setVal('vname', 'Ada Lovelace'));
await ev(setVal('vphone', '+1 555 0100'));
got = await renderDecode();
check('LIVE decode: vCard',
  typeof got === 'string' && ['BEGIN:VCARD','FN:Ada Lovelace','TEL;TYPE=CELL:+1 555 0100','END:VCARD'].every(s => got.includes(s)),
  typeof got === 'string' ? `contains ${['BEGIN:VCARD','FN:Ada Lovelace','END:VCARD'].filter(s=>got.includes(s)).length}/3 fields` : JSON.stringify(got));

// --- 5. email tab ---
await ev(`(() => { document.querySelector('[data-tab="email"]').click(); return true; })()`);
await ev(setVal('eto', 'team@example.com'));
await ev(setVal('esub', 'Hello!'));
got = await renderDecode();
check('LIVE decode: mailto',
  typeof got === 'string' && got.startsWith('mailto:team@example.com') && got.includes('subject=Hello!'),
  JSON.stringify(got));

// --- 6. color preset still decodes ---
await ev(`(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`);
await ev(setVal('text', 'https://example.com/purple'));
await ev(`(() => { document.querySelector('[data-pair="#7c3aed|#f5f3ff"]').click(); return true; })()`);
got = await renderDecode();
check('LIVE decode: purple preset', got === 'https://example.com/purple', JSON.stringify(got));

// --- 7. extreme sizes ---
await ev(`(() => { document.querySelector('[data-pair="#000000|#ffffff"]').click(); return true; })()`);
await ev(setVal('size', '180'));
got = await renderDecode();
check('LIVE decode: 180px (smallest)', got === 'https://example.com/purple', JSON.stringify(got));

await ev(setVal('size', '1000'));
got = await renderDecode();
check('LIVE decode: 1000px (largest)', got === 'https://example.com/purple', JSON.stringify(got));
await ev(setVal('size', '256'));

// --- 8. exports ---
await ev(`(() => { document.getElementById('download').click(); return true; })()`);
let st = await ev(`(() => document.getElementById('status').textContent)()`);
check('LIVE PNG export', /Downloaded qr-code\.png/.test(st), JSON.stringify(st));

await ev(`(() => { document.getElementById('svgbtn').click(); return true; })()`);
st = await ev(`(() => document.getElementById('status').textContent)()`);
check('LIVE SVG export', /Downloaded qr-code\.svg/.test(st), JSON.stringify(st));

// --- 9. bulk ---
await ev(`(() => { document.querySelector('[data-tab="bulk"]').click();
  const b = document.getElementById('bulktext');
  b.value = Array.from({length:10},(_,i)=>'https://example.com/b/'+i).join('\\n');
  b.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await sleep(4000);
const bulk = await ev(`(() => ({ cards: document.querySelectorAll('.bulk-card').length,
  canvases: document.querySelectorAll('.bulk-card canvas').length,
  status: document.getElementById('bulkstatus').textContent }))()`);
check('LIVE bulk: 10 codes generated',
  bulk && bulk.cards === 10 && bulk.canvases === 10 && /10 of 10/.test(bulk.status), JSON.stringify(bulk));

// --- 10. share link round-trip on live origin ---
await ev(`(() => { document.querySelector('[data-tab="link"]').click();
  const t=document.getElementById('text'); t.value='https://example.com/shared';
  t.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await sleep(700);
await ev(`(() => { document.getElementById('share').click(); return true; })()`);
await sleep(900);
const hash = await ev('location.hash');
let shareOk = false;
if (hash && hash.length > 40) {
  shareOk = hash.startsWith('#qr-gen-v1=');
  // full round-trip: cold-load with the hash. A's URL already IS the hash URL
  // after the share click, so add a unique query param to force a real reload.
  await send('Page.navigate', { url: SITE + '/?restore=' + Date.now() + hash });
  await sleep(3500);
  const rt = await ev(`(() => ({ v: document.getElementById('text').value,
    s: document.getElementById('status').textContent }))()`);
  shareOk = shareOk && rt && rt.v === 'https://example.com/shared' && /Shared settings loaded/.test(rt.s);
  check('LIVE share link restores after reload', shareOk, JSON.stringify(rt));
} else {
  check('LIVE share link restores after reload', false, 'no hash produced: ' + JSON.stringify(hash));
}

// --- 11. no errors across the whole session ---
const realErrs = errs.filter(e => !/favicon|net::ERR_ABORTED|Download is not allowed|notallowed/i.test(e));
check('No console/page errors on live site', realErrs.length === 0,
  realErrs.length ? realErrs.slice(0, 3).join(' | ') : 'clean');

// --- screenshot of live site ---
try {
  await ev(`(() => { document.querySelector('[data-tab="link"]').click();
    const t=document.getElementById('text'); t.value='https://remarkable-haupia-c7ea70.netlify.app';
    t.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(900);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('node:fs');
  fs.writeFileSync('/tmp/qraft-live.png', Buffer.from(shot.data, 'base64'));
  console.log('\n📸 /tmp/qraft-live.png');
} catch (e) { console.log('screenshot failed:', e.message); }

clearTimeout(wd);
const passed = res.filter(Boolean).length;
console.log(`\n${'='.repeat(54)}\nLIVE PRODUCTION: ${passed}/${res.length} passed`);
if (passed !== res.length) res.forEach((p, i) => { if (!p) console.log('  ✗ check #' + (i + 1)); });
ws.close(); chrome.kill();
process.exit(passed === res.length ? 0 : 1);
