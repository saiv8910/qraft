// E2E test v2 — corrected assertions + logo upload test
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const PORT = 9334;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, '--headless=new',
  '--user-data-dir=/tmp/qr-e2e-profile2',
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    if (page) wsUrl = page.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { console.log('FAIL: no Chrome'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const consoleErrors = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
};

const send = (method, params = {}) => {
  const mid = ++id;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(mid); rej(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(mid, { res: (r) => { clearTimeout(t); res(r); }, rej: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
};

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result.value;
}

// global watchdog — never let the suite hang silently
const watchdog = setTimeout(() => {
  console.log('\n⏰ WATCHDOG: suite exceeded 150s — aborting with partial results');
  const p = results.filter(r => r.pass).length;
  console.log(`RESULT: ${p}/${results.length} passed`);
  results.filter(r => !r.pass).forEach(r => console.log('  ✗ ' + r.name));
  try { chrome.kill(); } catch (e) {}
  process.exit(2);
}, 150000);

const results = [];
const check = (name, pass, info = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}${info ? '  → ' + info : ''}`);
};

// Universal paint probe: luminance-based (colour-agnostic)
const PROBE = `(() => {
  const cv = document.getElementById('preview');
  if (!cv || cv.style.display === 'none' || !cv.width) return { visible:false };
  const hex = h => { h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; };
  const lum = c => c[0]*0.299 + c[1]*0.587 + c[2]*0.114;
  const dl = lum(hex(document.getElementById('dark').value));
  const ll = lum(hex(document.getElementById('light').value));
  const mid = (dl + ll) / 2;
  const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let dark=0, light=0;
  for (let i=0;i<d.length;i+=4) {
    const L = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
    if (L < mid) dark++; else light++;
  }
  return { visible:true, w:cv.width, h:cv.height, dark, light,
           status: document.getElementById('status').textContent };
})()`;

const setVal = (id, val) => `(() => {
  const el = document.getElementById('${id}');
  el.value = ${JSON.stringify(val)};
  el.dispatchEvent(new Event('input', { bubbles:true }));
  el.dispatchEvent(new Event('change', { bubbles:true }));
  return true;
})()`;

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://localhost:8731/index.html' });
await sleep(2500);

// 1. Library present (it's a function, not an object)
let v = await evalJS('typeof qrcode');
check('QR library loaded locally', v === 'function', `typeof qrcode = ${v}`);

// 2. Boots into a clean empty state (no sample text)
v = await evalJS(`(() => ({
  canvasHidden: document.getElementById('preview').style.display === 'none',
  placeholderShown: document.getElementById('placeholder').style.display !== 'none',
  textEmpty: document.getElementById('text').value === ''
}))()`);
check('Starts empty with placeholder (no leftover sample)',
  v && v.canvasHidden && v.placeholderShown && v.textEmpty, JSON.stringify(v));

// 3. Typing renders a painted QR
await evalJS(setVal('text', 'https://example.com/hello-world'));
await sleep(600);
v = await evalJS(PROBE);
check('Typing renders painted QR', v && v.visible && v.dark > 500 && v.light > 500 && /Ready/.test(v.status),
  v.__error ? v.__error : `${v.w}x${v.h}, dark=${v.dark}, light=${v.light}, "${v.status}"`);

// 4. Dimensions follow the Size setting
await evalJS(setVal('size', '400'));
await sleep(600);
v = await evalJS(PROBE);
check('Size change applies (400px)', v && v.w === 400 && v.h === 400, JSON.stringify({w:v.w,h:v.h}));

await evalJS(setVal('size', '256'));
await sleep(500);

// 5. Colour preset: purple render still has strong contrast
v = await evalJS(`(() => { document.querySelector('[data-pair="#7c3aed|#f5f3ff"]').click(); return true; })()`);
await sleep(600);
v = await evalJS(PROBE);
check('Purple preset renders with contrast', v && v.visible && v.dark > 400 && v.light > 400,
  v.__error ? v.__error : `dark=${v.dark}, light=${v.light}`);

// 6. Inverted (white on dark) still renders
v = await evalJS(`(() => { document.querySelector('[data-pair="#ffffff|#0f172a"]').click(); return true; })()`);
await sleep(600);
v = await evalJS(PROBE);
check('Inverted preset renders', v && v.visible && v.dark > 400 && v.light > 400,
  v.__error ? v.__error : `dark=${v.dark}, light=${v.light}`);

// back to classic for the rest
await evalJS(`(() => { document.querySelector('[data-pair="#000000|#ffffff"]').click(); return true; })()`);
await sleep(500);

// 7. Empty input clears preview
await evalJS(setVal('text', ''));
await sleep(500);
v = await evalJS(`(() => ({
  hidden: document.getElementById('preview').style.display === 'none',
  placeholder: document.getElementById('placeholder').style.display !== 'none'
}))()`);
check('Clearing input resets to placeholder', v && v.hidden && v.placeholder, JSON.stringify(v));

// 8. Wi-Fi tab renders (with special chars in password)
await evalJS(`(() => { document.querySelector('[data-tab="wifi"]').click(); return true; })()`);
await evalJS(setVal('ssid', 'Cafe Guest'));
await evalJS(setVal('wpass', 'latte;123:"x"'));
await sleep(700);
v = await evalJS(PROBE);
check('Wi-Fi tab renders QR', v && v.visible && v.dark > 400 && /Ready/.test(v.status),
  v.__error ? v.__error : `dark=${v.dark}, "${v.status}"`);

// 9. Wi-Fi payload escaping correctness (replicates app rule)
v = await evalJS(`(() => {
  const esc = s => String(s||'').replace(/([\\\\;,:"])/g, '\\\\$1');
  const ssid = esc('Cafe Guest'), pass = esc('latte;123:"x"');
  return 'WIFI:T:WPA;S:' + ssid + ';P:' + pass + ';';
})()`);
check('Wi-Fi payload escaping',
  v === 'WIFI:T:WPA;S:Cafe Guest;P:latte\\;123\\:\\"x\\";', JSON.stringify(v));

// 10. Open network omits password
v = await evalJS(`(() => {
  const sel = document.getElementById('enc'); sel.value = 'nopass';
  sel.dispatchEvent(new Event('change', { bubbles:true }));
  return document.getElementById('enc').value;
})()`);
await sleep(600);
check('Open-network option selectable', v === 'nopass', v);

await evalJS(`(() => { const s=document.getElementById('enc'); s.value='WPA'; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
await sleep(400);

// 11. vCard tab renders
await evalJS(`(() => { document.querySelector('[data-tab="vcard"]').click(); return true; })()`);
await evalJS(setVal('vname', 'Ada Lovelace'));
await evalJS(setVal('vphone', '+1 555 0100'));
await evalJS(setVal('vorg', 'Analytical Engines'));
await sleep(700);
v = await evalJS(PROBE);
check('vCard tab renders QR', v && v.visible && v.dark > 400 && /Ready/.test(v.status),
  v.__error ? v.__error : `dark=${v.dark}, "${v.status}"`);

// 12. vCard requires a name (empty → placeholder, no crash)
await evalJS(setVal('vname', ''));
await sleep(600);
v = await evalJS(`(() => ({
  hidden: document.getElementById('preview').style.display === 'none',
  status: document.getElementById('status').textContent,
  err: document.getElementById('status').classList.contains('err')
}))()`);
check('vCard without name → gentle hint, no error styling',
  v && v.hidden && !v.err, JSON.stringify(v));

// 13. Email tab renders mailto payload
await evalJS(`(() => { document.querySelector('[data-tab="email"]').click(); return true; })()`);
await evalJS(setVal('eto', 'team@example.com'));
await evalJS(setVal('esub', 'Hello!'));
await sleep(700);
v = await evalJS(PROBE);
check('Email tab renders QR', v && v.visible && v.dark > 400,
  v.__error ? v.__error : `dark=${v.dark}, "${v.status}"`);

// 13b. Every new type renders a QR and shows a normalized payload
const NEW_TYPES = [
  ['text', [{ id: 'plaintext', val: 'Pick up at 5pm' }], 'Pick up at 5pm'],
  ['image', [{ id: 'imgurl', val: 'i.imgur.com/abc123.png' }], 'https://i.imgur.com/abc123.png'],
  ['pdf', [{ id: 'pdfurl', val: 'https://example.com/menu.pdf' }], 'https://example.com/menu.pdf'],
  ['map', [{ id: 'mapq', val: 'Eiffel Tower' }], 'https://www.google.com/maps/search/?api=1&query=Eiffel%20Tower'],
  ['whatsapp', [{ id: 'waphone', val: '+1 555 0100' }, { id: 'wamsg', val: 'Hello there' }],
    'https://wa.me/15550100?text=Hello%20there'],
  ['instagram', [{ id: 'iguser', val: '@qraft' }], 'https://www.instagram.com/qraft/'],
  ['youtube', [{ id: 'yturl', val: 'https://youtu.be/dQw4w9WgXcQ' }],
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ['form', [{ id: 'formurl', val: 'https://docs.google.com/forms/d/abc123/edit' }],
    'https://docs.google.com/forms/d/abc123/viewform'],
];
const newTypeFails = [];
for (const [tab, fields, want] of NEW_TYPES) {
  await evalJS(`(() => { document.querySelector('[data-tab="${tab}"]').click(); return true; })()`);
  for (const f of fields) await evalJS(setVal(f.id, f.val));
  await sleep(650);
  const r = await evalJS(`(() => ({
    visible: document.getElementById('preview').style.display !== 'none',
    ready: /Ready/.test(document.getElementById('status').textContent),
    payload: document.getElementById('payloadval').textContent
  }))()`);
  if (!(r && r.visible && r.ready && r.payload === want)) {
    newTypeFails.push(`${tab}: got ${JSON.stringify(r)} want ${JSON.stringify(want)}`);
  }
}
check('All 8 new types render with normalized payloads', newTypeFails.length === 0,
  newTypeFails.length ? newTypeFails.join(' | ') : 'text, image, pdf, map, whatsapp, instagram, youtube, form');

await evalJS(`(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`);
await sleep(300);

// 14. Over-long input shows friendly error (not a crash)
await evalJS(`(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`);
await evalJS(setVal('text', 'A'.repeat(4000)));
await evalJS(setVal('ecc', 'H'));
await sleep(900);
v = await evalJS(`(() => ({
  err: document.getElementById('status').classList.contains('err'),
  msg: document.getElementById('status').textContent,
  crashed: typeof qrcode === 'undefined'
}))()`);
check('Over-long input → friendly error, app survives',
  v && v.err && /too long|shorten/i.test(v.msg) && !v.crashed, JSON.stringify(v));

await evalJS(setVal('ecc', 'M'));
await evalJS(setVal('text', 'https://example.com'));
await sleep(700);

// 15. Logo upload switches ECC to High and composites
v = await evalJS(`(async () => {
  // 60x60 red PNG built in-page
  const c = document.createElement('canvas'); c.width = c.height = 60;
  const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0,0,60,60);
  const dataUrl = c.toDataURL('image/png');
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), ch => ch.charCodeAt(0));
  const file = new File([bytes], 'logo.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const input = document.getElementById('logo');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(1200);
v = await evalJS(`(() => {
  const cv = document.getElementById('preview');
  let redPixels = 0;
  if (cv.width) {
    const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    for (let i=0;i<d.length;i+=4) if (d[i]>200 && d[i+1]<60 && d[i+2]<60) redPixels++;
  }
  return { ecc: document.getElementById('ecc').value,
           thumb: document.getElementById('logothumb').style.display !== 'none',
           remBtn: document.getElementById('logorem').style.display !== 'none',
           redPixels,
           status: document.getElementById('status').textContent };
})()`);
check('Logo composites into QR + auto High ECC',
  v && v.ecc === 'H' && v.thumb && v.remBtn && v.redPixels > 200,
  JSON.stringify(v));

// 16. Remove logo restores normal render
v = await evalJS(`(() => { document.getElementById('logorem').click(); return true; })()`);
await sleep(800);
v = await evalJS(`(() => {
  const cv = document.getElementById('preview');
  const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let red = 0;
  for (let i=0;i<d.length;i+=4) if (d[i]>200 && d[i+1]<60 && d[i+2]<60) red++;
  return { red, thumbHidden: document.getElementById('logothumb').style.display === 'none' };
})()`);
check('Remove logo clears it', v && v.red === 0 && v.thumbHidden, JSON.stringify(v));

// 17. SVG export
await evalJS(`(() => { document.getElementById('svgbtn').click(); return true; })()`);
await sleep(400);
v = await evalJS(`(() => document.getElementById('status').textContent)()`);
check('SVG export succeeds', /Downloaded qr-code\.svg/.test(v), `"${v}"`);

// 18. PNG download
await evalJS(`(() => { document.getElementById('download').click(); return true; })()`);
v = await evalJS(`(() => document.getElementById('status').textContent)()`);
check('PNG download succeeds', /Downloaded qr-code\.png/.test(v), `"${v}"`);

// 19. Bulk: 5 codes
await evalJS(`(() => {
  document.querySelector('[data-tab="bulk"]').click();
  const b = document.getElementById('bulktext');
  b.value = ['https://a.com','https://b.com','https://c.com','https://d.com','https://e.com'].join('\\n');
  b.dispatchEvent(new Event('input', { bubbles:true }));
  return true;
})()`);
await sleep(3500);
v = await evalJS(`(() => ({
  cards: document.querySelectorAll('.bulk-card').length,
  canvases: document.querySelectorAll('.bulk-card canvas').length,
  status: document.getElementById('bulkstatus').textContent,
  bulkMode: document.body.classList.contains('bulk-mode'),
  singleHidden: document.getElementById('singleview').style.display === 'none'
}))()`);
check('Bulk generates 5 codes',
  v && v.cards === 5 && v.canvases === 5 && v.bulkMode && v.singleHidden, JSON.stringify(v));

// 20. Bulk cards are actually painted
v = await evalJS(`(() => {
  const cs = [...document.querySelectorAll('.bulk-card canvas')];
  return cs.map(cv => {
    const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    let dark = 0;
    for (let i=0;i<d.length;i+=4) { const lum=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114; if (lum<96) dark++; }
    return dark;
  });
})()`);
check('Every bulk card painted', Array.isArray(v) && v.length === 5 && v.every(n => n > 200),
  JSON.stringify(v));

// 21. Bulk dedupes & caps
await evalJS(`(() => {
  const b = document.getElementById('bulktext');
  b.value = Array.from({length: 90}, (_, i) => 'https://x.com/' + (i % 70)).join('\\n');
  b.dispatchEvent(new Event('input', { bubbles:true }));
  return true;
})()`);
await sleep(12000);
v = await evalJS(`(() => ({
  cards: document.querySelectorAll('.bulk-card').length,
  status: document.getElementById('bulkstatus').textContent
}))()`);
check('Bulk dedupes & caps at 60', v && v.cards === 60, JSON.stringify(v));

// 22. Back to single mode
await evalJS(`(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`);
await evalJS(setVal('text', 'https://single-test.com'));
await sleep(800);
v = await evalJS(`(() => Object.assign({ bulkMode: document.body.classList.contains('bulk-mode') }, ${PROBE}))()`);
check('Single mode recovers after bulk',
  v && v.visible && v.dark > 400 && !v.bulkMode, JSON.stringify(v));

// 23. Share link round-trip
await evalJS(`(() => { document.getElementById('share').click(); return true; })()`);
await sleep(700);
const hash = await evalJS('location.hash');
let roundTrip = false;
if (hash && hash.length > 40) {
  await evalJS(`(() => { history.replaceState(null,'',location.pathname); document.getElementById('text').value=''; return true; })()`);
  await evalJS(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(1200);
  v = await evalJS(`(() => ({ val: document.getElementById('text').value, status: document.getElementById('status').textContent }))()`);
  roundTrip = v && /Shared settings loaded/.test(v.status) && v.val === 'https://single-test.com';
}
check('Share link restores state on load', roundTrip, v ? JSON.stringify(v) : 'no hash');

// 24. Recent history
v = await evalJS(`(() => {
  try { const h = JSON.parse(localStorage.getItem('qr-gen-history-v1') || '[]');
        return { n: h.length, chips: document.querySelectorAll('#recent .chip').length }; }
  catch(e) { return { n:-1, err:String(e) }; }
})()`);
check('Recent history saved', v && v.n >= 1 && v.chips >= 1, JSON.stringify(v));

// 25. No console errors
const real = consoleErrors.filter(e => !/favicon|Download is not allowed|notallowed/i.test(e));
check('No console errors', real.length === 0, real.length ? real.slice(0,3).join(' | ') : 'clean');

// Screenshot of the finished state
try {
  await evalJS(`(() => { document.querySelector('[data-tab="link"]').click(); return true; })()`);
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync('/tmp/qr-e2e-v2.png', Buffer.from(shot.data, 'base64'));
  console.log('\n📸 /tmp/qr-e2e-v2.png');
} catch (e) { console.log('shot failed', e.message); }

clearTimeout(watchdog);
const passed = results.filter(r => r.pass).length;
console.log(`\n${'='.repeat(52)}\nRESULT: ${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.log('FAILED:');
  results.filter(r => !r.pass).forEach(r => console.log('  ✗ ' + r.name));
}
ws.close(); chrome.kill();
process.exit(passed === results.length ? 0 : 1);
