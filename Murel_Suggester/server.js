/**
 * WallCraft Mural Fit Finder — backend
 * -------------------------------------------------
 * Two endpoints:
 *   POST /api/suggest-mural        -> Claude reasons over the catalogue, returns top picks + advice
 *   POST /api/generate-custom-mural -> Claude drafts an image prompt, an image API renders it
 *
 * Why a backend at all: API keys must never be shipped to the browser.
 * This is the one piece that can't be "just static HTML" like the rest
 * of the WallCraft site — it needs to run on a small Node host
 * (Render, Railway, Fly.io, a VPS, etc.), not on static file hosting.
 */
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = 'claude-sonnet-4-6'; // swap for whichever current model you're provisioned for

if (!ANTHROPIC_API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY is not set — /api/suggest-mural and prompt drafting will fail.');
}

async function callClaude(system, userText, maxTokens = 500) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  const textBlock = data.content.find(b => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

/* ---------------- 1. Reasoned catalogue pick ---------------- */
app.post('/api/suggest-mural', async (req, res) => {
  try {
    const { width, height, roomType, style, catalog } = req.body;
    if (!width || !height || !Array.isArray(catalog)) {
      return res.status(400).json({ error: 'width, height, and catalog are required' });
    }

    const system = `You are a mural-placement consultant for WallCraft, a UV-cured digital wall
printing company. You will be given a wall's dimensions and a JSON catalogue of murals.
Reply with ONLY a JSON object, no prose, no markdown fences, in this exact shape:
{"pickIds": ["id1","id2","id3"], "advice": "one or two sentences of practical, specific advice"}
pickIds must be an ordered list of up to 3 ids taken from the catalogue, best fit first,
chosen for aspect ratio fit, size range fit, and stated preferences. advice should mention
something concrete (e.g. proportions, scale, room use) — not generic praise.`;

    const userText = JSON.stringify({
      wall: { widthM: width, heightM: height, aspect: +(width / height).toFixed(2) },
      preferences: { roomType: roomType || null, style: style || null },
      catalog,
    });

    const raw = await callClaude(system, userText, 400);
    let parsed;
    try {
      parsed = JSON.parse(raw.trim().replace(/^```json|```$/g, '').trim());
    } catch {
      parsed = { pickIds: [], advice: raw.trim() };
    }
    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'suggestion failed' });
  }
});

/* ---------------- 2. Custom mural generation ---------------- */
app.post('/api/generate-custom-mural', async (req, res) => {
  try {
    const { width, height, description, style } = req.body;
    if (!width || !height || !description) {
      return res.status(400).json({ error: 'width, height, and description are required' });
    }
    const aspect = +(width / height).toFixed(2);

    // Step 1: Claude turns the user's rough idea into a well-formed image prompt
    // sized/composed for this wall's proportions.
    const system = `You write concise, vivid prompts for a text-to-image model, for large-format
wall murals. Given a wall's aspect ratio and a rough description, output ONLY the final
image-generation prompt (no preamble, no quotes) — under 60 words, describing composition,
subject, framing, and how it fills a wall of the given proportions. Avoid depicting real,
named people or copyrighted characters.`;
    const userText = `Wall aspect ratio (width:height): ${aspect}:1. Style preference: ${style || 'unspecified'}. Rough idea: ${description}`;
    const promptUsed = (await callClaude(system, userText, 150)).trim();

    // Step 2: send that prompt to an image-generation provider.
    // Anthropic does not offer an image-generation model, so plug in whichever
    // provider you have an account with. Example shown for a generic
    // OpenAI-compatible images endpoint — replace with Stability AI, Replicate,
    // Ideogram, etc. as preferred. Set IMAGE_API_KEY and IMAGE_API_URL in .env.
    if (!process.env.IMAGE_API_KEY) {
      return res.status(501).json({
        error: 'No image generation provider configured yet.',
        promptUsed,
        note: 'Set IMAGE_API_KEY / IMAGE_API_URL in server/.env — see server/README.md',
      });
    }

    const imgRes = await fetch(process.env.IMAGE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: promptUsed,
        size: aspect >= 1 ? '1536x1024' : '1024x1536', // closest widescreen/portrait bucket
      }),
    });
    if (!imgRes.ok) throw new Error(`Image provider error ${imgRes.status}`);
    const imgData = await imgRes.json();

    // Adjust this line to match your provider's actual response shape.
    const imageUrl = imgData.data?.[0]?.url || imgData.imageUrl;

    res.json({ imageUrl, promptUsed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'custom mural generation failed' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`WallCraft mural API listening on :${PORT}`));
