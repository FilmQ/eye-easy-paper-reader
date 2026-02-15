# Eye-Easy Paper Reader

This project was vibe-coded quick and dirty and is for **personal use** (I just want to read research papers without them assualting my retina). 

Expect things to break because everything is in the load bearer file app.js lmao. 

This is a PDF reader that inverts colors so research papers display as light text on a dark background, reducing eye strain during extended reading sessions.

## Features

- **Color inversion** — pixel-level invert with hue-rotate to preserve figure colors
- **Brightness & warmth controls** — adjustable via dropdowns in the toolbar
- **PDF proxy** — fetch PDFs by URL through an Express server (bypasses CORS)
- **Drag & drop** — upload local PDF files or paste a URL
- **Continuous scroll** — all pages rendered in a scrollable column
- **Clickable links** — external URLs open in new tabs, internal links navigate within the document
- **Search (Cmd+F)** — custom in-document search with yellow highlights and match navigation
- **Recent papers** — stores history in localStorage with in-memory caching for instant switching
- **Collapsible toolbar** — hide controls for a distraction-free reading experience
- **Keyboard shortcuts** — `+`/`-` zoom, `i` toggle inversion, `0` reset zoom, `Esc` close search

## Getting Started

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

```
eye-easy-paper-reader/
├── server.js          # Express server (static files + PDF URL proxy)
└── public/
    ├── index.html     # Main page
    ├── style.css      # Dark theme + layout
    └── app.js         # PDF.js rendering + controls
```

## How It Works

PDF.js renders each page to a `<canvas>`. Color inversion is applied directly to the canvas pixels using `CanvasRenderingContext2D.filter`, avoiding the blurriness caused by chained CSS filters. Brightness and warmth remain as lightweight CSS filters for instant adjustment.

A thin Express server serves the static frontend and provides a `POST /api/fetch-pdf` endpoint that proxies PDF downloads from arbitrary URLs, sidestepping browser CORS restrictions.
