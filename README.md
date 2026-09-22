# ⚡ Qraft — Free QR Code Generator

A fast, private, zero-dependency QR code generator that runs **100% in the browser**.
No signup, no watermark, no server, no tracking — nothing you type ever leaves the visitor's device.

**Live demo:** deploy this folder (see below) → share the link with everyone.

---

## Features

| | |
|---|---|
| 🔗 **Link / Text** | Any URL or plain text, generated live as you type |
| 📶 **Wi-Fi** | Encodes `WIFI:` syntax — scanning joins the network automatically |
| 📇 **Contact (vCard)** | Name, company, phone, email, website, job title → saves straight to contacts |
| ✉️ **Email** | Pre-filled `mailto:` with subject and body |
| 📦 **Bulk** | Up to 60 codes at once, deduplicated, with batch download |
| 🎨 **Colors** | Custom dark/light colors + 6 presets, including inverted |
| 🖼️ **Center logo** | Upload or drag-and-drop; auto-switches to High error correction so it still scans |
| ⬇️ **PNG + SVG** | Raster for screens, vector for print at any size |
| 🔗 **Share links** | Full setup encoded in the URL — send it to anyone |
| 🕓 **Recent** | Last 6 codes restored with one click |
| 📱 **Responsive** | Works on phone, tablet and desktop |

### Privacy

Everything runs client-side. There is no backend, no API call and no analytics.
The only browser API used is `localStorage`, for the "Recent" list.

---

## Tech notes

Two files, 100 KB total, no build step, no bundler, no CDN.

```
qr-generator/
├── index.html   # entire app (markup + styles + logic)
└── qrcode.js    # QR encoder, bundled locally
```

The encoder is [Kazuhiko Arase's `qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator) (MIT).

> **Why this library?** It selects the QR version by *actually building the bit buffer and
> measuring it*, rather than estimating capacity from `encodeURI().length`. Libraries that
> estimate can under-size the version for multi-byte text, causing
> `code length overflow` on ordinary input like `Héllo Wörld 🎉 — 你好`.
> It also ships a proper UTF-8 encoder with surrogate-pair handling.

Text is encoded as **UTF-8**, so accents, CJK and emoji are safe.

---

## Run locally

```bash
python3 -m http.server 8731
# → http://localhost:8731
```

Or just open `index.html` directly — it works from `file://` too.

---

## Deploy (make it public)

The folder is fully static, so any static host works and the free tiers are more than enough.

**Netlify Drop (fastest — ~30 seconds)**
1. Go to <https://app.netlify.com/drop>
2. Drag this `qr-generator` folder onto the page
3. You get a public URL — share it with everyone

**GitHub Pages**
1. Push this folder to a repo
2. Settings → Pages → Source: `main` / root
3. Your site appears at `https://<user>.github.io/<repo>/`

**Vercel / Cloudflare Pages** — import the folder, no config needed.

Because generation is client-side, hosting costs stay at **$0** whether you have
10 visitors or 1,000,000.

---

## Browser support

Uses modern, widely-available APIs: `<canvas>`, `FileReader`, `ClipboardItem`,
`localStorage`, `TextEncoder`. Tested in Chrome; works in current Safari, Firefox and Edge.
Clipboard *image* copy requires a secure context (HTTPS or `localhost`) — all hosts above provide that.
