// ==APP-START==
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    text: $('text'), plaintext: $('plaintext'), tcount: $('tcount'),
    ssid: $('ssid'), wpass: $('wpass'), enc: $('enc'), whidden: $('whidden'),
    vname: $('vname'), vorg: $('vorg'), vphone: $('vphone'), vemail: $('vemail'), vweb: $('vweb'), vtitle: $('vtitle'),
    eto: $('eto'), esub: $('esub'), ebody: $('ebody'),
    imgurl: $('imgurl'), pdfurl: $('pdfurl'), mapq: $('mapq'),
    waphone: $('waphone'), wamsg: $('wamsg'), iguser: $('iguser'),
    yturl: $('yturl'), formurl: $('formurl'),
    bulktext: $('bulktext'), bulkcount: $('bulkcount'), count: $('count'),
    size: $('size'), ecc: $('ecc'), dark: $('dark'), light: $('light'),
    preview: $('preview'), placeholder: $('placeholder'), box: $('box'),
    source: $('source'), status: $('status'), grid: $('grid'),
    payloadval: $('payloadval'), themebtn: $('themebtn'),
    singleview: $('singleview'), bulkview: $('bulkview'),
    bulkstatus: $('bulkstatus'), recent: $('recent'),
    logo: $('logo'), logothumb: $('logothumb'), logorem: $('logorem'), logobtn: $('logobtn')
  };

  var TABS = ['link', 'text', 'image', 'pdf', 'map',
    'whatsapp', 'instagram', 'youtube',
    'wifi', 'vcard', 'email', 'form', 'bulk'];

  var FIELDS = ['text', 'plaintext', 'ssid', 'wpass', 'enc', 'whidden',
    'vname', 'vorg', 'vphone', 'vemail', 'vweb', 'vtitle',
    'eto', 'esub', 'ebody',
    'imgurl', 'pdfurl', 'mapq', 'waphone', 'wamsg', 'iguser', 'yturl', 'formurl',
    'bulktext', 'size', 'ecc', 'dark', 'light'];

  var MAX_BULK = 60;
  var HISTORY_KEY = 'qr-gen-history-v1';
  var SHARE_KEY = 'qr-gen-v1';
  var THEME_KEY = 'qraft-theme-v1';

  var currentTab = 'link';
  var lastQr = null;
  var logoData = null;   // base64 data URL
  var logoImg = null;    // decoded Image
  var bulkItems = [];
  var renderTimer = null;
  var historyTimer = null;
  var busy = false;

  /* ---------- tiny helpers ---------- */
  function setStatus(el, msg, isErr) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (isErr ? ' err' : '');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  // QR max capacity in bytes (8-bit mode, version 40) per error-correction level
  var MAX_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };

  function byteLength(str) {
    try { return new TextEncoder().encode(str).length; }
    catch (e) { return String(str).length; }
  }

  function friendlyErr(e) {
    var m = String((e && e.message) || e);
    // The library throws an opaque TypeError when data exceeds capacity,
    // so match that too and translate it into something a human can act on.
    if (/too long|overflow|reading '\d+'|of undefined/i.test(m)) {
      return 'Text too long — lower Error correction or shorten it';
    }
    if (/circular|clone/i.test(m)) return 'That image could not be read — try a PNG or JPG';
    return m;
  }

  // Guard before calling the library so users never see a raw TypeError
  function assertFits(text) {
    var lvl = MAX_BYTES[els.ecc.value] ? els.ecc.value : 'M';
    if (byteLength(text) > MAX_BYTES[lvl]) {
      throw new Error('Too long data');
    }
  }
  function safeGet(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }
  function b64enc(str) {
    var bytes = new TextEncoder().encode(str), out = '', i;
    for (i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64dec(str) {
    var s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length), i;
    for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------- escaping / normalising ---------- */
  function escVCard(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;'); }
  function escWifi(s) { return String(s || '').replace(/([\\;,:"])/g, '\\$1'); }

  // "example.com" → "https://example.com", full URLs pass through untouched
  function ensureUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    if (/^\/\//.test(v)) return 'https:' + v;
    return 'https://' + v.replace(/^\/+/, '');
  }

  // Link tab: only prefix a scheme when the input clearly is a bare domain
  function autoUrl(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+([/?#][^\s]*)?$/.test(v)) return 'https://' + v;
    return v;
  }

  // Image / PDF / Form fields must be links, and links cannot contain spaces
  function linkField(el) {
    var v = String((el && el.value) || '').trim();
    if (!v) return '';
    if (/\s/.test(v)) throw new Error('That link contains spaces — check what you pasted');
    return ensureUrl(v);
  }

  /* ---------- payload builders ---------- */
  function buildPayload(tab) {
    if (tab === 'link') return autoUrl(els.text.value);
    if (tab === 'text') return els.plaintext.value;
    if (tab === 'bulk') return els.bulktext.value;

    if (tab === 'image') return linkField(els.imgurl);
    if (tab === 'pdf') return linkField(els.pdfurl);

    if (tab === 'map') {
      var q = els.mapq.value.trim();
      if (!q) return '';
      if (/^https?:\/\//i.test(q)) return q;
      return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
    }

    if (tab === 'form') {
      var f = linkField(els.formurl);
      // Editor link → live form, so scanners land on the fillable version
      return f.replace(/\/edit(?:[?#].*)?$/, '/viewform');
    }

    if (tab === 'whatsapp') {
      var ph = els.waphone.value.trim();
      if (!ph) return '';
      var digits = ph.replace(/\D/g, '');
      if (digits.length < 8) throw new Error('Enter the whole number with country code, e.g. +1 555 0100');
      var msg = els.wamsg.value.trim();
      return 'https://wa.me/' + digits + (msg ? '?text=' + encodeURIComponent(msg) : '');
    }

    if (tab === 'instagram') {
      var ig = els.iguser.value.trim();
      if (!ig) return '';
      if (/^https?:\/\//i.test(ig)) {
        var p;
        try { p = new URL(ig); }
        catch (e) { throw new Error('That does not look like an Instagram link'); }
        var path = p.pathname.replace(/\/+$/, '');
        return 'https://www.instagram.com' + (path ? path + '/' : '/');
      }
      var handle = ig.replace(/^@/, '').split(/[/?#]/)[0].trim();
      if (!handle) return '';
      return 'https://www.instagram.com/' + handle + '/';
    }

    if (tab === 'youtube') {
      var y = els.yturl.value.trim();
      if (!y) return '';
      var id = null, m;
      if ((m = y.match(/[?&]v=([\w-]{6,})/))) id = m[1];
      else if ((m = y.match(/youtu\.be\/([\w-]{6,})/))) id = m[1];
      else if ((m = y.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/))) id = m[1];
      else if (/^[\w-]{11}$/.test(y)) id = y;
      if (id) return 'https://www.youtube.com/watch?v=' + id;
      if (/^https?:\/\//i.test(y)) return y;   // channel or playlist: keep as pasted
      if (/^[\w.-]+\.[a-z]{2,}/i.test(y)) return ensureUrl(y);
      throw new Error('Paste a YouTube link or an 11-character video ID');
    }

    if (tab === 'wifi') {
      var ssid = els.ssid.value.trim();
      if (!ssid) return '';
      var hidden = els.whidden.checked ? 'H:true;' : '';
      if (els.enc.value === 'nopass') return 'WIFI:T:nopass;S:' + escWifi(ssid) + ';' + hidden + ';';
      return 'WIFI:T:' + els.enc.value + ';S:' + escWifi(ssid) + ';P:' + escWifi(els.wpass.value) + ';' + hidden + ';';
    }

    if (tab === 'vcard') {
      var name = els.vname.value.trim();
      if (!name) return '';
      var lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + escVCard(name), 'FN:' + escVCard(name)];
      if (els.vorg.value.trim()) lines.push('ORG:' + escVCard(els.vorg.value.trim()));
      if (els.vtitle.value.trim()) lines.push('TITLE:' + escVCard(els.vtitle.value.trim()));
      if (els.vphone.value.trim()) lines.push('TEL;TYPE=CELL:' + els.vphone.value.trim());
      if (els.vemail.value.trim()) lines.push('EMAIL;TYPE=INTERNET:' + els.vemail.value.trim());
      if (els.vweb.value.trim()) lines.push('URL:' + els.vweb.value.trim());
      lines.push('END:VCARD');
      return lines.join('\n');
    }

    if (tab === 'email') {
      var to = els.eto.value.trim();
      if (!to) return '';
      var q2 = [];
      if (els.esub.value.trim()) q2.push('subject=' + encodeURIComponent(els.esub.value));
      if (els.ebody.value.trim()) q2.push('body=' + encodeURIComponent(els.ebody.value));
      return 'mailto:' + to + (q2.length ? '?' + q2.join('&') : '');
    }

    return '';
  }

  /* ---------- QR core ---------- */
  // Build a QR model (no DOM). typeNumber 0 = auto-pick by real capacity.
  function buildQR(text) {
    assertFits(text);
    var level = (['L', 'M', 'Q', 'H'].indexOf(els.ecc.value) >= 0) ? els.ecc.value : 'M';
    var qr = qrcode(0, level);
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    if (!n) throw new Error('Could not build that QR code');
    lastQr = qr;
    return qr;
  }

  // Draw modules onto a canvas at an exact pixel size (4-module quiet zone).
  function paintQR(qr, cv, size) {
    var ctx = cv.getContext('2d');
    if (!ctx) throw new Error('Canvas is not supported in this browser');
    var n = qr.getModuleCount();
    var margin = 4;
    var total = n + margin * 2;

    cv.width = size;
    cv.height = size;
    ctx.fillStyle = els.light.value;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = els.dark.value;

    // Round each module's edges so there are no seams between cells
    for (var r = 0; r < n; r++) {
      var y0 = Math.round((r + margin) * size / total);
      var y1 = Math.round((r + margin + 1) * size / total);
      for (var c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        var x0 = Math.round((c + margin) * size / total);
        var x1 = Math.round((c + margin + 1) * size / total);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
    return ctx;
  }

  function drawLogo(ctx, size) {
    if (!logoImg) return;
    var box = Math.round(size * 0.22);
    var pad = Math.max(4, Math.round(size * 0.018));
    var x = (size - box) / 2, y = (size - box) / 2;
    var plate = box + pad * 2;

    ctx.save();
    ctx.fillStyle = els.light.value;
    try {
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x - pad, y - pad, plate, plate, Math.max(4, Math.round(size * 0.035)));
        ctx.fill();
      } else {
        ctx.fillRect(x - pad, y - pad, plate, plate);
      }
    } catch (e) { ctx.fillRect(x - pad, y - pad, plate, plate); }

    var iw = logoImg.naturalWidth || logoImg.width || 1;
    var ih = logoImg.naturalHeight || logoImg.height || 1;
    var scale = Math.min(box / iw, box / ih);
    var w = iw * scale, h = ih * scale;
    try { ctx.drawImage(logoImg, x + (box - w) / 2, y + (box - h) / 2, w, h); }
    catch (e) { /* tainted/undecodable image — QR still shows */ }
    ctx.restore();
  }

  function paintPreview(qr, size) {
    var cv = els.preview;
    var ctx = paintQR(qr, cv, size);
    drawLogo(ctx, size);
    els.box.style.background = els.light.value;
    els.placeholder.style.display = 'none';
    cv.style.display = 'block';
  }

  function clearPreview() {
    lastQr = null;
    els.preview.style.display = 'none';
    els.preview.width = 0;
    els.preview.height = 0;
    els.placeholder.style.display = 'block';
    els.box.style.background = '#fff';
  }

  function setPayloadLine(payload) {
    if (!els.payloadval) return;
    if (!payload) { els.payloadval.textContent = '—'; return; }
    var s = payload.replace(/\s+/g, ' ');
    els.payloadval.textContent = s.length > 170 ? s.slice(0, 169) + '…' : s;
  }

  function render() {
    if (currentTab === 'bulk') { renderBulk(); return; }

    var payload;
    try {
      payload = buildPayload(currentTab);
    } catch (e) {
      clearPreview();
      setPayloadLine('');
      setStatus(els.status, friendlyErr(e), true);
      return;
    }

    updateCount();
    setPayloadLine(payload);

    if (!payload.trim()) {
      clearPreview();
      var soft = (currentTab === 'link' || currentTab === 'text');
      setStatus(els.status, soft ? '' : emptyHint(currentTab));
      if (!soft) els.status.className = 'status';
      return;
    }

    try {
      var size = parseInt(els.size.value, 10) || 256;
      var qr = buildQR(payload);
      paintPreview(qr, size);
      setStatus(els.status, 'Ready — scan with your camera to test');
      scheduleHistory();
    } catch (e) {
      clearPreview();
      setStatus(els.status, friendlyErr(e), true);
    }
  }

  function emptyHint(tab) {
    if (tab === 'wifi') return 'Enter a network name above';
    if (tab === 'vcard') return 'Enter a name above';
    if (tab === 'email') return 'Enter an email address above';
    if (tab === 'image') return 'Paste a link to your image';
    if (tab === 'pdf') return 'Paste a link to your PDF';
    if (tab === 'map') return 'Enter a place, address or coordinates';
    if (tab === 'whatsapp') return 'Enter a phone number above';
    if (tab === 'instagram') return 'Enter a username above';
    if (tab === 'youtube') return 'Paste a YouTube link';
    if (tab === 'form') return 'Paste your form link';
    return '';
  }

  function updateCount() {
    if (els.count) els.count.textContent = els.text.value.length + ' characters';
    if (els.tcount) els.tcount.textContent = els.plaintext.value.length + ' characters';
    if (els.bulkcount) {
      var n = els.bulktext.value.split('\n').filter(function (l) { return l.trim(); }).length;
      els.bulkcount.textContent = n + (n === 1 ? ' line' : ' lines');
    }
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 180);
  }

  /* ---------- bulk ---------- */
  async function renderBulk() {
    if (busy) return;
    var lines = els.bulktext.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    updateCount();
    els.grid.innerHTML = '';
    bulkItems = [];

    if (!lines.length) {
      setStatus(els.bulkstatus, 'Paste some lines on the left to generate codes');
      return;
    }

    var uniq = [];
    var seen = {};
    lines.forEach(function (l) { if (!seen[l]) { seen[l] = 1; uniq.push(l); } });
    if (uniq.length > MAX_BULK) {
      setStatus(els.bulkstatus, 'Showing first ' + MAX_BULK + ' of ' + uniq.length + ' lines', true);
      uniq = uniq.slice(0, MAX_BULK);
    }

    busy = true;
    try {
      var size = parseInt(els.size.value, 10) || 256;
      for (var i = 0; i < uniq.length; i++) {
        setStatus(els.bulkstatus, 'Generating ' + (i + 1) + ' / ' + uniq.length + '…');
        await tick();
        var item = { text: uniq[i], png: null };
        try {
          var qr = buildQR(uniq[i]);
          var cv = document.createElement('canvas');
          var ctx = paintQR(qr, cv, size);
          drawLogo(ctx, size);
          item.png = cv.toDataURL('image/png');
          els.grid.appendChild(makeCard(cv, uniq[i], bulkItems.length));
        } catch (err) {
          item.error = friendlyErr(err);
          els.grid.appendChild(makeCard(null, uniq[i] + ' — ' + item.error, -1));
        }
        bulkItems.push(item);
      }
      var ok = bulkItems.filter(function (b) { return b.png; }).length;
      setStatus(els.bulkstatus, ok + ' of ' + bulkItems.length + ' codes ready');
    } finally {
      busy = false;
    }
  }

  function makeCard(canvas, label, index) {
    var card = document.createElement('div');
    card.className = 'bulk-card';
    if (canvas) {
      canvas.removeAttribute('style');
      card.appendChild(canvas);
    } else {
      var ph = document.createElement('div');
      ph.style.cssText = 'aspect-ratio:1;background:var(--surface-2);border-radius:6px';
      card.appendChild(ph);
    }
    var lab = document.createElement('div');
    lab.className = 'bulk-label';
    lab.title = label;
    lab.textContent = label;
    card.appendChild(lab);

    if (index >= 0) {
      var btn = document.createElement('button');
      btn.className = 'mini';
      btn.type = 'button';
      btn.textContent = 'PNG';
      btn.addEventListener('click', function () {
        var it = bulkItems[index];
        if (it && it.png) { triggerDownload(it.png, 'qr-' + (index + 1) + '.png'); setStatus(els.bulkstatus, 'Downloaded qr-' + (index + 1) + '.png'); }
      });
      card.appendChild(btn);
    }
    return card;
  }

  async function downloadAll() {
    var ready = bulkItems.filter(function (b) { return b.png; });
    if (!ready.length) { setStatus(els.bulkstatus, 'Generate the codes first', true); return; }
    setStatus(els.bulkstatus, 'Downloading ' + ready.length + ' files…');
    for (var i = 0; i < bulkItems.length; i++) {
      if (!bulkItems[i].png) continue;
      triggerDownload(bulkItems[i].png, 'qr-' + (i + 1) + '.png');
      await sleep(320);
    }
    setStatus(els.bulkstatus, 'Downloaded ' + ready.length + ' files');
  }

  /* ---------- exports ---------- */
  function getPNG() {
    if (els.preview.style.display === 'none' || !els.preview.width) return null;
    try { return els.preview.toDataURL('image/png'); }
    catch (e) { return null; }
  }

  function triggerDownload(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function buildSVG() {
    var qr = lastQr;
    if (!qr || typeof qr.getModuleCount !== 'function') throw new Error('SVG export unavailable');
    var n = qr.getModuleCount();
    var m = 4; // quiet zone (modules)
    var total = n + m * 2;
    var light = els.light.value;
    var dark = els.dark.value;
    var r, c, run, out = '';

    for (r = 0; r < n; r++) {
      run = 0;
      for (c = 0; c <= n; c++) {
        var isDark = c < n && qr.isDark(r, c);
        if (isDark) run++;
        else if (run) {
          out += '<rect x="' + (c - run + m) + '" y="' + (r + m) + '" width="' + run + '" height="1"/>';
          run = 0;
        }
      }
    }

    var overlay = '';
    if (logoData) {
      var box = total * 0.22;
      var pad = total * 0.02;
      var x = (total - box) / 2, y = (total - box) / 2;
      overlay = '<rect x="' + (x - pad) + '" y="' + (y - pad) + '" width="' + (box + pad * 2) +
        '" height="' + (box + pad * 2) + '" rx="' + (total * 0.035) + '" fill="' + light + '"/>' +
        '<image href="' + logoData + '" xlink:href="' + logoData + '" x="' + x + '" y="' + y +
        '" width="' + box + '" height="' + box + '" preserveAspectRatio="xMidYMid meet"/>';
    }

    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/>' +
      '<g fill="' + dark + '">' + out + '</g>' + overlay + '</svg>';
  }

  function downloadSVG() {
    try {
      var svg = buildSVG();
      var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      triggerDownload(url, 'qr-code.svg');
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      setStatus(els.status, 'Downloaded qr-code.svg');
    } catch (e) {
      setStatus(els.status, friendlyErr(e), true);
    }
  }

  async function copyImage() {
    var png = getPNG();
    if (!png) { setStatus(els.status, 'Generate a QR code first', true); return; }
    try {
      var blob = await (await fetch(png)).blob();
      if (!window.ClipboardItem) throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setStatus(els.status, 'Image copied to clipboard');
    } catch (e) {
      try {
        var text = buildPayload(currentTab);
        await navigator.clipboard.writeText(text);
        setStatus(els.status, 'Copied as text instead');
      } catch (e2) {
        setStatus(els.status, 'Clipboard blocked — use Download instead', true);
      }
    }
  }

  /* ---------- history ---------- */
  function snapshot() {
    var f = {};
    FIELDS.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      f[id] = (el.type === 'checkbox') ? !!el.checked : el.value;
    });
    return { v: 1, tab: currentTab, f: f };
  }

  function applySnapshot(snap) {
    if (!snap || !snap.f) return false;
    Object.keys(snap.f).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      try {
        if (el.type === 'checkbox') el.checked = !!snap.f[id];
        else el.value = snap.f[id];
      } catch (e) { /* ignore bad stored value */ }
    });
    if (snap.tab && TABS.indexOf(snap.tab) >= 0) setTab(snap.tab, false);
    return true;
  }

  function scheduleHistory() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(saveHistory, 1200);
  }

  function saveHistory() {
    if (currentTab === 'bulk') return;
    var payload;
    try { payload = buildPayload(currentTab); }
    catch (e) { return; }   // invalid input isn't worth remembering
    if (!payload.trim()) return;

    var list = safeGet(HISTORY_KEY, []);
    if (!Array.isArray(list)) list = [];
    var entry = { tab: currentTab, snap: snapshot(), label: truncate(payload.replace(/\s+/g, ' '), 34), ts: Date.now() };

    // dedupe by label+tab, newest first, max 6
    list = list.filter(function (x) { return !(x && x.label === entry.label && x.tab === entry.tab); });
    list.unshift(entry);
    list = list.slice(0, 6);
    safeSet(HISTORY_KEY, list);
    renderHistory();
  }

  function renderHistory() {
    var list = safeGet(HISTORY_KEY, []);
    els.recent.innerHTML = '';
    if (!Array.isArray(list)) return;
    list.forEach(function (item) {
      if (!item || !item.snap) return;
      var b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.title = 'Restore: ' + item.label;
      b.textContent = item.label;
      b.addEventListener('click', function () {
        applySnapshot(item.snap);
        render();
        setStatus(els.status, 'Restored');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      els.recent.appendChild(b);
    });
  }

  /* ---------- share ---------- */
  async function shareLink() {
    try {
      var snap = snapshot();
      // keep the URL short: only embed the logo if it is tiny
      if (logoData && logoData.length < 1200) snap.logo = logoData;
      var hash = '#' + SHARE_KEY + '=' + b64enc(JSON.stringify(snap));
      var url = location.origin + location.pathname + hash;
      if (url.length > 8000) throw new Error('Too much content to share as a link');
      history.replaceState(null, '', hash);
      try {
        await navigator.clipboard.writeText(url);
        setStatus(els.status, 'Share link copied — paste it anywhere');
      } catch (e) {
        setStatus(els.status, 'Link updated in the address bar');
      }
    } catch (e) {
      setStatus(els.status, friendlyErr(e), true);
    }
  }

  function readHash() {
    try {
      var h = location.hash || '';
      var marker = SHARE_KEY + '=';
      var i = h.indexOf(marker);
      if (i < 0) return false;
      var snap = JSON.parse(b64dec(h.slice(i + marker.length)));
      if (!applySnapshot(snap)) return false;
      if (snap.logo && typeof snap.logo === 'string') {
        logoData = snap.logo;
        loadLogoInto(logoData);
      }
      return true;
    } catch (e) { return false; }
  }

  /* ---------- logo ---------- */
  function loadLogoInto(dataUrl) {
    var img = new Image();
    img.onload = function () {
      logoImg = img;
      els.logothumb.src = dataUrl;
      els.logothumb.style.display = 'block';
      els.logorem.style.display = 'inline-block';
      if (els.ecc.value !== 'H') {
        els.ecc.value = 'H';
        setStatus(els.status, 'Error correction set to High so the logo still scans');
      }
      render();
    };
    img.onerror = function () {
      logoData = null; logoImg = null;
      setStatus(els.status, 'That image could not be read', true);
    };
    img.src = dataUrl;
  }

  function onLogoFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { setStatus(els.status, 'Please choose an image file', true); return; }
    if (file.size > 2 * 1024 * 1024) { setStatus(els.status, 'Image must be under 2 MB', true); return; }
    var fr = new FileReader();
    fr.onload = function () { logoData = String(fr.result); loadLogoInto(logoData); };
    fr.onerror = function () { setStatus(els.status, 'Could not read that file', true); };
    fr.readAsDataURL(file);
  }

  function removeLogo() {
    logoData = null; logoImg = null;
    els.logothumb.removeAttribute('src');
    els.logothumb.style.display = 'none';
    els.logorem.style.display = 'none';
    els.logo.value = '';
    render();
  }

  /* ---------- tabs ---------- */
  function setTab(tab, doRender) {
    if (TABS.indexOf(tab) < 0) tab = 'link';
    currentTab = tab;

    document.querySelectorAll('.tab').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.dataset.panel === tab);
    });

    var isBulk = tab === 'bulk';
    document.body.classList.toggle('bulk-mode', isBulk);
    els.singleview.style.display = isBulk ? 'none' : 'flex';
    els.bulkview.style.display = isBulk ? 'block' : 'none';

    if (doRender !== false) {
      if (isBulk) renderBulk(); else render();
    }
  }

  function clearAll() {
    if (currentTab === 'bulk') {
      els.bulktext.value = '';
      els.grid.innerHTML = '';
      bulkItems = [];
      updateCount();
      setStatus(els.bulkstatus, '');
      return;
    }
    var panel = document.querySelector('.panel[data-panel="' + currentTab + '"]');
    if (panel) {
      panel.querySelectorAll('textarea, input[type=text], input[type=password], input[type=email], input[type=tel], input[type=url]').forEach(function (el) { el.value = ''; });
    }
    clearPreview();
    setPayloadLine('');
    setStatus(els.status, '');
    updateCount();
  }

  /* ---------- theme ---------- */
  function applyTheme(mode, save) {
    if (mode === 'dark') document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    if (save) { try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* private mode */ } }
    if (els.themebtn) {
      els.themebtn.setAttribute('aria-label', mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#141413' : '#f6f5f2');
  }

  /* ---------- wiring ---------- */
  function wire() {
    // tabs
    document.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });

    // live inputs
    FIELDS.filter(function (id) {
      return ['bulktext', 'size', 'ecc', 'dark', 'light'].indexOf(id) < 0;
    }).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', scheduleRender);
      el.addEventListener('change', scheduleRender);
    });

    // counters + render for the free-text areas
    [els.plaintext, els.bulktext].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', function () { updateCount(); scheduleRender(); });
    });

    [els.size, els.ecc, els.dark, els.light].forEach(function (el) {
      el.addEventListener('input', scheduleRender);
      el.addEventListener('change', scheduleRender);
    });

    // colour presets
    document.querySelectorAll('[data-pair]').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.pair.split('|');
        els.dark.value = p[0];
        els.light.value = p[1];
        render();
      });
    });

    // link samples
    document.querySelectorAll('[data-sample]').forEach(function (b) {
      b.addEventListener('click', function () {
        els.text.value = b.dataset.sample;
        render();
      });
    });

    // logo
    els.logobtn.addEventListener('click', function () { els.logo.click(); });
    els.logo.addEventListener('change', function () { onLogoFile(els.logo.files && els.logo.files[0]); });
    els.logorem.addEventListener('click', removeLogo);

    // actions
    $('download').addEventListener('click', function () {
      var png = getPNG();
      if (!png) { setStatus(els.status, 'Generate a QR code first', true); return; }
      triggerDownload(png, 'qr-code.png');
      setStatus(els.status, 'Downloaded qr-code.png');
    });
    $('svgbtn').addEventListener('click', downloadSVG);
    $('copy').addEventListener('click', copyImage);
    $('share').addEventListener('click', shareLink);
    $('clear').addEventListener('click', clearAll);
    $('dlall').addEventListener('click', downloadAll);
    $('bulkclear').addEventListener('click', clearAll);
    if ($('printbtn')) $('printbtn').addEventListener('click', function () { window.print(); });

    // theme toggle
    if (els.themebtn) {
      els.themebtn.addEventListener('click', function () {
        applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
      });
    }

    // drag & drop an image onto the preview adds it as the logo
    ['dragover', 'drop'].forEach(function (evt) {
      els.box.addEventListener(evt, function (e) {
        e.preventDefault();
        if (evt === 'drop' && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          onLogoFile(e.dataTransfer.files[0]);
        }
      });
    });

    window.addEventListener('hashchange', function () {
      if (!readHash()) return;
      render();
      // render() sets a generic status — restore the more useful note
      setStatus(els.status, 'Shared settings loaded');
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    if (typeof qrcode === 'undefined') {
      setStatus(els.status, 'QR library failed to load (assets/js/qrcode.js missing)', true);
      return;
    }
    // Proper UTF-8 encoding so accents, CJK and emoji never overflow
    if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
      qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    }

    // theme: explicit choice wins, otherwise follow the system
    var savedTheme = null;
    try { savedTheme = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    if (savedTheme !== 'dark' && savedTheme !== 'light') {
      savedTheme = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    applyTheme(savedTheme, false);

    wire();
    updateCount();
    var restored = readHash();
    renderHistory();
    setTab(restored ? currentTab : 'link', false);
    render();
    if (restored) setStatus(els.status, 'Shared settings loaded');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
// ==APP-END==
