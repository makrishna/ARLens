# WallCraft — Mural Fit Finder

An AI-assisted tool that takes a wall's width and height, draws it to scale, matches it
against your mural catalogue, and can generate a custom mural sized to that exact wall.

## What's in here

```
mural-suggester.html   ← the page (drop into your existing multi-file site)
css/mural-suggester.css
js/mural-suggester.js
data/mural-catalog.json   ← replace with your real murals
images/murals/            ← put real photos here, named to match the catalogue's "image" field
server/                   ← small Node backend (required — see below)
```

## Why there's a backend

Your current site is static HTML/CSS/JS, which is great for hosting cost and simplicity —
but calling Claude (or any AI API) directly from the browser would mean shipping your API
key in the page source, where anyone can read it and rack up charges on your account. The
`server/` folder is a minimal Express app that holds the keys and does the AI calls; the
static page just talks to it over `fetch`.

You have two options:
1. **Keep it simple:** deploy `server/` as-is to a small Node host — Render, Railway, or
   Fly.io all have free/cheap tiers that would comfortably handle this. Point
   `API_BASE` in `js/mural-suggester.js` at that host's URL.
2. **Serverless:** if you'd rather not run a standing server, the two route handlers in
   `server/server.js` can be adapted almost line-for-line into a Vercel/Netlify serverless
   function each — say the word and I can convert them.

## Local setup

```bash
cd server
cp .env.example .env      # then fill in ANTHROPIC_API_KEY
npm install
npm run dev                # runs on http://localhost:3001
```

Then open `mural-suggester.html` via a local static server (not file://, since it fetches
JSON) — e.g. `npx serve .` from the project root — and it will talk to the backend on
port 3001.

## Wiring in your real catalogue

Edit `data/mural-catalog.json`. Each entry needs:
- `minWidthM` / `maxWidthM` / `minHeightM` / `maxHeightM` — the size range you're comfortable printing that design at
- `idealAspect` — the width÷height the artwork looks best at
- `category`, `style`, `tags` — used for filtering and for the AI's reasoning

The client-side scoring in `js/mural-suggester.js` (`scoreCatalog`) runs instantly with no
AI call, so results always appear the moment someone types dimensions. The "Ask the AI to
pick" button is an optional second pass that asks Claude to reason over the same data and
re-rank with a short written justification — nice for a "why this one" explanation, but not
required for the tool to work.

## Custom mural generation

Anthropic doesn't provide an image-generation model, so `/api/generate-custom-mural` uses
Claude only to turn the customer's rough idea into a well-formed prompt sized to the wall's
proportions, then hands that prompt to an image API you choose (OpenAI Images, Stability AI,
Replicate, Ideogram are all reasonable). Fill in `IMAGE_API_URL` / `IMAGE_API_KEY` in
`server/.env`, and adjust the response-parsing line in `server.js` to match whichever
provider's JSON shape you end up with — it's flagged clearly in the code.

## Integrating into the existing WallCraft site

- Add a nav link to `mural-suggester.html` from your existing pages (e.g. alongside
  "Products" or "Get a quote").
- If your other pages share a header/footer include, copy that markup around the
  `<main class="msf-layout">` block and drop the CSS variables at the top of
  `mural-suggester.css` into your shared stylesheet if you'd like consistent theming
  site-wide.
- The page is fully self-contained otherwise — no build step, no framework.
