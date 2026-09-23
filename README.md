# Qraft — Free QR Code Generator

A fast, private, zero-dependency QR code generator that runs **100% in the browser**.
No signup, no watermark, no server, no tracking — nothing you type ever leaves the visitor's device.

**Live demo:** deploy this folder (see below) → share the link with everyone.

---

## QR types

| Type | What the code encodes |
|---|---|
| **Link** | Any URL — a missing `https://` is added for you |
| **Text** | Any plain text, encoded as UTF-8 (accents, emoji, CJK all safe) |
| **Image** | A direct link to your image (see note below) |
| **PDF** | A direct link to your PDF — Drive, Dropbox or your own host |
| **Map** | Google Maps search link from a place, address or coordinates |
| **WhatsApp** | `wa.me/<number>` with an optional pre-filled message |
| **Instagram** | Profile URL from a username or pasted profile link |
| **YouTube** | Normalized `watch?v=` URL from watch / youtu.be / Shorts / embed links or a bare ID |
| **Wi-Fi** | `WIFI:` syntax — scanning joins the network automatically |
| **Contact** | vCard 3.0 — name, company, phone, email, website, job title |
| **Email** | `mailto:` with subject and body pre-filled |
| **Google Form** | Editor link normalized from `/edit` to `/viewform` |
| **Bulk** | Up to 60 codes at once, deduplicated, with batch download |

### Why Image and PDF encode a link

A QR code holds at most ~2,953 bytes — not nearly enough to store an actual photo or
document. So those tabs encode a **link to your file** instead, and the copy in the app
says exactly that. Nothing you paste is ever uploaded anywhere; the code simply points
at wherever your file already lives.

---

## Features

- **13 QR types**, grouped into Basic / Social / Details / Tools
- **Custom colors** — dark/light pickers plus 6 presets, including inverted
- **Center logo** — upload or drag-and-drop; error correction auto-switches to High so it still scans
- **PNG + SVG export**, clipboard copy, and a print stylesheet that prints just the code
- **Share links** — the full setup is encoded in the URL, so you can send it to anyone
- **Recent list** — last 6 codes restored with one click (localStorage only)
- **Light & dark theme** — follows your system, with a manual toggle
- **Encoded-payload preview** — see the exact content being generated
- **Responsive** — phone, tablet and desktop

### Privacy

Everything runs client-side. There is no backend, no API call and no analytics.
The only browser APIs used are `localStorage` (recent list + theme) and the clipboard
(only when you press Copy).

---

## Tech notes

Four files, no build step, no bundler, no CDN:

```
qr-generator/
├── index.html            # markup, inline icon sprite, theme boot
├── assets/
│   ├── css/styles.css    # design tokens, light/dark themes, print sheet
│   └── js/
│       ├── qrcode.js     # QR encoder, bundled locally
│       └── app.js        # all application logic
├── tests/                # headless-Chrome suites (see below)
├── README.md
└── .gitignore
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

## Tests

The suites drive headless Chrome over CDP (no dependencies beyond Node 22+, which has a
built-in WebSocket). With the local server running on port 8731:

```bash
node tests/e2e.mjs      # 26 behavioral checks (tabs, exports, bulk, share, errors)
node tests/decode.mjs   # 17 BarcodeDetector round-trips — every QR type decodes
node tests/smoke.mjs    # branding + render sanity
node tests/share.mjs    # cross-browser share link (against the deployed URL)
node tests/live.mjs     # full suite against the deployed URL
```

Chrome is expected at the macOS path set at the top of each script.

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
Clipboard *image* copy requires a secure context (HTTPS or `localhost`) — all hosts above
provide that.
