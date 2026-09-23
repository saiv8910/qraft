// Decode test: render QR -> read pixels -> decode with BarcodeDetector -> compare
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9341;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new',
  '--user-data-dir=/tmp/qr-decode-profile',
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

const watchdog = setTimeout(() => { console.log('⏰ decode test timed out'); try { chrome.kill(); } catch {} process.exit(2); }, 120000);

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = list.find(t => t.type === 'page');
    if (p) wsUrl = p.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { console.log('FAIL no chrome'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
};
const send = (method, params = {}) => {
  const mid = ++id;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(mid); rej(new Error('timeout ' + method)); }, 15000);
    pending.set(mid, { res: r => { clearTimeout(t); res(r); }, rej: e => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
};
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}

const results = [];
const check = (n, pass, info = '') => { results.push({ n, pass }); console.log(`${pass ? '✅' : '❌'} ${n}${info ? '  → ' + info : ''}`); };

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8731/index.html' });
await sleep(2500);

// Is BarcodeDetector available?
let avail = await ev('typeof BarcodeDetector !== "undefined"');
console.log('BarcodeDetector available:', avail);

const setVal = (id, val) => `(() => { const e=document.getElementById('${id}'); e.value=${JSON.stringify(val)};
  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;

// Decode the live preview canvas
const DECODE = `(() => {
  const cv = document.getElementById('preview');
  if (!cv || cv.style.display === 'none' || !cv.width) return { err: 'no canvas' };
  return (async () => {
    if (typeof BarcodeDetector === 'undefined') return { err: 'no BarcodeDetector' };
    try {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      const codes = await det.detect(cv);
      if (!codes.length) return { err: 'nothing decoded' };
      return { text: codes[0].rawValue };
    } catch (e) { return { err: String(e.message || e) }; }
  })();
})()`;

async function decode() {
  const r = await ev(DECODE);
  return (r && r.text) ? r.text : (r && r.err) || JSON.stringify(r);
}

const cases = [
  { name: 'Plain URL', tab: 'link', setup: `(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`,
    fill: [setVal('text', 'https://example.com/pricing')], expect: 'https://example.com/pricing' },
  { name: 'Unicode text', tab: 'link',
    setup: `(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`,
    fill: [setVal('text', 'Héllo Wörld 🎉 — 你好')], expect: 'Héllo Wörld 🎉 — 你好' },
  { name: 'Wi-Fi credentials', tab: 'wifi',
    setup: `(() => { document.querySelector('[data-tab="wifi"]').click(); return true; })()`,
    fill: [setVal('ssid', 'Cafe Guest'), setVal('wpass', 'latte;123:"x"'), setVal('enc', 'WPA')],
    expect: 'WIFI:T:WPA;S:Cafe Guest;P:latte\\;123\\:\\"x\\";;' },
  { name: 'vCard contact', tab: 'vcard',
    setup: `(() => { document.querySelector('[data-tab="vcard"]').click(); return true; })()`,
    fill: [setVal('vname', 'Ada Lovelace'), setVal('vphone', '+1 555 0100'), setVal('vemail', 'ada@example.com')],
    expectIncludes: ['BEGIN:VCARD', 'FN:Ada Lovelace', 'TEL;TYPE=CELL:+1 555 0100', 'EMAIL;TYPE=INTERNET:ada@example.com', 'END:VCARD'] },
  { name: 'mailto link', tab: 'email',
    setup: `(() => { document.querySelector('[data-tab="email"]').click(); return true; })()`,
    fill: [setVal('eto', 'team@example.com'), setVal('esub', 'Hello!')],
    expectIncludes: ['mailto:team@example.com', 'subject=Hello!'] },
  { name: 'Plain text', tab: 'text',
    setup: `(() => { document.querySelector('[data-tab="text"]').click(); return true; })()`,
    fill: [setVal('plaintext', 'Pick up at 5pm')], expect: 'Pick up at 5pm' },
  { name: 'Image link (auto https)', tab: 'image',
    setup: `(() => { document.querySelector('[data-tab="image"]').click(); return true; })()`,
    fill: [setVal('imgurl', 'i.imgur.com/abc123.png')], expect: 'https://i.imgur.com/abc123.png' },
  { name: 'PDF link', tab: 'pdf',
    setup: `(() => { document.querySelector('[data-tab="pdf"]').click(); return true; })()`,
    fill: [setVal('pdfurl', 'https://example.com/menu.pdf')], expect: 'https://example.com/menu.pdf' },
  { name: 'Map place', tab: 'map',
    setup: `(() => { document.querySelector('[data-tab="map"]').click(); return true; })()`,
    fill: [setVal('mapq', 'Eiffel Tower')], expect: 'https://www.google.com/maps/search/?api=1&query=Eiffel%20Tower' },
  { name: 'WhatsApp chat', tab: 'whatsapp',
    setup: `(() => { document.querySelector('[data-tab="whatsapp"]').click(); return true; })()`,
    fill: [setVal('waphone', '+1 555 0100'), setVal('wamsg', 'Hello there')],
    expect: 'https://wa.me/15550100?text=Hello%20there' },
  { name: 'Instagram handle', tab: 'instagram',
    setup: `(() => { document.querySelector('[data-tab="instagram"]').click(); return true; })()`,
    fill: [setVal('iguser', '@qraft')], expect: 'https://www.instagram.com/qraft/' },
  { name: 'YouTube link', tab: 'youtube',
    setup: `(() => { document.querySelector('[data-tab="youtube"]').click(); return true; })()`,
    fill: [setVal('yturl', 'https://youtu.be/dQw4w9WgXcQ')], expect: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { name: 'Google Form (edit → viewform)', tab: 'form',
    setup: `(() => { document.querySelector('[data-tab="form"]').click(); return true; })()`,
    fill: [setVal('formurl', 'https://docs.google.com/forms/d/abc123/edit')],
    expect: 'https://docs.google.com/forms/d/abc123/viewform' },
];

for (const c of cases) {
  await ev(c.setup);
  for (const f of c.fill) await ev(f);
  await sleep(900);
  const got = await decode();
  if (c.expect) {
    check(`Decode: ${c.name}`, got === c.expect, got === c.expect ? JSON.stringify(got) : `want ${JSON.stringify(c.expect)} got ${JSON.stringify(got)}`);
  } else {
    const ok = typeof got === 'string' && c.expectIncludes.every(s => got.includes(s));
    check(`Decode: ${c.name}`, ok, ok ? `contains all ${c.expectIncludes.length} fields` : `got ${JSON.stringify(got)}`);
  }
}

// Coloured QR still decodes (purple preset)
await ev(`(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`);
await ev(setVal('text', 'https://example.com/purple'));
await ev(`(() => { document.querySelector('[data-pair="#7c3aed|#f5f3ff"]').click(); return true; })()`);
await sleep(900);
let got = await decode();
check('Decode: purple preset', got === 'https://example.com/purple', JSON.stringify(got));

// Logo overlay must still decode (High ECC)
await ev(`(() => { document.querySelector('[data-pair="#000000|#ffffff"]').click(); return true; })()`);
await ev(setVal('text', 'https://example.com/with-logo'));
await ev(setVal('ecc', 'H'));
await sleep(600);
const logoOk = await ev(`(async () => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#1d4ed8'; x.fillRect(0,0,64,64);
  x.fillStyle = '#fbbf24'; x.beginPath(); x.arc(32,32,20,0,Math.PI*2); x.fill();
  const du = c.toDataURL('image/png');
  const bytes = Uint8Array.from(atob(du.split(',')[1]), ch => ch.charCodeAt(0));
  const f = new File([bytes], 'logo.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(f);
  const inp = document.getElementById('logo'); inp.files = dt.files;
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(1500);
got = await decode();
check('Decode: with centre logo (High ECC)', got === 'https://example.com/with-logo', JSON.stringify(got));

// Small size (180px) still decodes
await ev(`(() => { const r=document.getElementById('logorem'); if(r) r.click(); return true; })()`);
await ev(setVal('size', '180'));
await sleep(900);
got = await decode();
check('Decode: smallest size (180px)', got === 'https://example.com/with-logo', JSON.stringify(got));

// Large size decodes
await ev(setVal('size', '1000'));
await sleep(1200);
got = await decode();
check('Decode: largest size (1000px)', got === 'https://example.com/with-logo', JSON.stringify(got));

clearTimeout(watchdog);
const passed = results.filter(r => r.pass).length;
console.log(`\n${'='.repeat(52)}\nDECODE RESULT: ${passed}/${results.length} passed`);
if (passed !== results.length) results.filter(r => !r.pass).forEach(r => console.log('  ✗ ' + r.n));
ws.close(); chrome.kill();
process.exit(passed === results.length ? 0 : 1);
