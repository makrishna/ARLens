/* WallCraft Mural Fit Finder
 * ---------------------------------------------------------
 * 1. Draws a to-scale elevation of the wall as the user types.
 * 2. Scores the local catalogue instantly (no network needed).
 * 3. Optionally asks the backend (Claude) for a reasoned pick.
 * 4. Optionally asks the backend to generate a custom mural
 *    sized to the wall's exact aspect ratio.
 *
 * Backend base URL — point this at wherever /server is deployed.
 * Leave as '' if this page is served from the same origin/domain
 * as the API (e.g. both behind the same Node server).
 */
const API_BASE = '';

const els = {
  width: document.getElementById('wallWidth'),
  height: document.getElementById('wallHeight'),
  room: document.getElementById('roomType'),
  style: document.getElementById('styleType'),
  svg: document.getElementById('elevationSvg'),
  ratioReadout: document.getElementById('ratioReadout'),
  grid: document.getElementById('resultsGrid'),
  askAiBtn: document.getElementById('askAiBtn'),
  aiNote: document.getElementById('aiNote'),
  aiNoteText: document.getElementById('aiNoteText'),
  customPrompt: document.getElementById('customPrompt'),
  generateBtn: document.getElementById('generateBtn'),
  customResult: document.getElementById('customResult'),
};

let catalog = [];
let currentMatches = [];

init();

async function init() {
  catalog = await loadCatalog();
  render();
  ['input'].forEach(evt => {
    els.width.addEventListener(evt, render);
    els.height.addEventListener(evt, render);
  });
  els.room.addEventListener('change', render);
  els.style.addEventListener('change', render);
  els.askAiBtn.addEventListener('click', askAi);
  els.generateBtn.addEventListener('click', generateCustom);
}

async function loadCatalog() {
  try {
    const res = await fetch('mural-catalog.json');
    if (!res.ok) throw new Error('catalog fetch failed');
    return await res.json();
  } catch (err) {
    console.error('Could not load mural catalogue:', err);
    return [];
  }
}

function getDims() {
  const width = Math.max(0.3, parseFloat(els.width.value) || 0);
  const height = Math.max(0.3, parseFloat(els.height.value) || 0);
  return { width, height, aspect: width / height };
}

function render() {
  const dims = getDims();
  drawElevation(dims);
  currentMatches = scoreCatalog(dims, els.room.value, els.style.value);
  renderResults(currentMatches);
  els.aiNote.hidden = true;
}

/* ---------------- Elevation drawing (SVG) ---------------- */
function drawElevation({ width, height, aspect }) {
  els.ratioReadout.textContent = `${aspect.toFixed(2)} : 1`;

  const svg = els.svg;
  svg.innerHTML = '';
  const VB_W = 640, VB_H = 420;
  const margin = 70; // room for ruler labels

  const usableW = VB_W - margin * 1.4;
  const usableH = VB_H - margin * 1.4;
  const scale = Math.min(usableW / width, usableH / height);

  const wallW = width * scale;
  const wallH = height * scale;
  const x0 = margin + (usableW - wallW) / 2;
  const y0 = margin * 0.6 + (usableH - wallH) / 2;

  const ns = 'http://www.w3.org/2000/svg';
  const g = document.createElementNS(ns, 'g');

  // Wall rectangle
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', x0);
  rect.setAttribute('y', y0);
  rect.setAttribute('width', wallW);
  rect.setAttribute('height', wallH);
  rect.setAttribute('fill', '#ffffff');
  rect.setAttribute('stroke', '#23211D');
  rect.setAttribute('stroke-width', '2');
  g.appendChild(rect);

  // Best-match mural label inside wall, if any
  if (currentMatches && currentMatches[0]) {
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', x0 + wallW / 2);
    label.setAttribute('y', y0 + wallH / 2);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-family', 'IBM Plex Mono, monospace');
    label.setAttribute('font-size', '12');
    label.setAttribute('fill', '#C17A3D');
    label.textContent = currentMatches[0].title;
    g.appendChild(label);
  }

  // Width dimension line (below wall)
  addDimLine(g, ns, x0, y0 + wallH + 22, x0 + wallW, y0 + wallH + 22, `${width.toFixed(2)} m`);
  // Height dimension line (left of wall)
  addDimLine(g, ns, x0 - 22, y0, x0 - 22, y0 + wallH, `${height.toFixed(2)} m`, true);

  svg.appendChild(g);
}

function addDimLine(g, ns, x1, y1, x2, y2, text, vertical = false) {
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', x1); line.setAttribute('y1', y1);
  line.setAttribute('x2', x2); line.setAttribute('y2', y2);
  line.setAttribute('stroke', '#3D4A5C');
  line.setAttribute('stroke-width', '1.5');
  g.appendChild(line);

  [[x1, y1], [x2, y2]].forEach(([x, y]) => {
    const tick = document.createElementNS(ns, 'line');
    const d = 5;
    tick.setAttribute('x1', vertical ? x - d : x);
    tick.setAttribute('y1', vertical ? y : y - d);
    tick.setAttribute('x2', vertical ? x + d : x);
    tick.setAttribute('y2', vertical ? y : y + d);
    tick.setAttribute('stroke', '#3D4A5C');
    tick.setAttribute('stroke-width', '1.5');
    g.appendChild(tick);
  });

  const label = document.createElementNS(ns, 'text');
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
  label.setAttribute('font-family', 'IBM Plex Mono, monospace');
  label.setAttribute('font-size', '12');
  label.setAttribute('fill', '#3D4A5C');
  if (vertical) {
    label.setAttribute('x', midX - 8);
    label.setAttribute('y', midY);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('dominant-baseline', 'middle');
  } else {
    label.setAttribute('x', midX);
    label.setAttribute('y', midY + 18);
    label.setAttribute('text-anchor', 'middle');
  }
  label.textContent = text;
  g.appendChild(label);
}

/* ---------------- Client-side scoring ---------------- */
function scoreCatalog(dims, room, style) {
  return catalog
    .map(m => {
      let score = 0;

      // Aspect ratio closeness (up to 60 pts)
      const aspectDiff = Math.abs(m.idealAspect - dims.aspect) / m.idealAspect;
      score += Math.max(0, 60 - aspectDiff * 100);

      // Fits within printable size range (up to 25 pts)
      const widthOk = dims.width >= m.minWidthM && dims.width <= m.maxWidthM;
      const heightOk = dims.height >= m.minHeightM && dims.height <= m.maxHeightM;
      if (widthOk) score += 13;
      if (heightOk) score += 12;

      // Preference matches (up to 15 pts)
      if (room && m.category === room) score += 10;
      if (style && m.style === style) score += 5;

      return { ...m, score: Math.max(0, Math.min(100, Math.round(score))) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

function renderResults(matches) {
  els.grid.innerHTML = '';
  if (!matches.length) {
    els.grid.innerHTML = `<p class="msf-empty">No catalogue data loaded — check that data/mural-catalog.json is reachable.</p>`;
    return;
  }
  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = 'msf-card';
    card.innerHTML = `
      <div class="msf-card__img">
        <img src="${m.image}" alt="${m.title}" loading="lazy"
             onerror="this.parentElement.textContent='${m.title}'">
      </div>
      <div class="msf-card__body">
        <p class="msf-card__title">${m.title}</p>
        <div class="msf-card__meta">
          <span>${m.style} · ${m.category}</span>
          <span class="msf-score ${m.score >= 80 ? 'msf-score--high' : ''}">${m.score}% fit</span>
        </div>
      </div>`;
    els.grid.appendChild(card);
  });
}

/* ---------------- Backend: reasoned AI pick ---------------- */
async function askAi() {
  const dims = getDims();
  els.askAiBtn.disabled = true;
  els.askAiBtn.textContent = 'Thinking…';
  try {
    const res = await fetch(`${API_BASE}/api/suggest-mural`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: dims.width,
        height: dims.height,
        roomType: els.room.value,
        style: els.style.value,
        catalog, // sending the small catalogue inline keeps the backend stateless
      }),
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    els.aiNoteText.textContent = data.advice || 'No advice returned.';
    els.aiNote.hidden = false;

    if (Array.isArray(data.pickIds) && data.pickIds.length) {
      const reordered = [
        ...data.pickIds.map(id => currentMatches.find(m => m.id === id)).filter(Boolean),
        ...currentMatches.filter(m => !data.pickIds.includes(m.id)),
      ];
      currentMatches = reordered;
      renderResults(currentMatches);
    }
  } catch (err) {
    console.error(err);
    els.aiNoteText.textContent = 'Could not reach the AI suggestion service. Is the backend running? (see /server/README)';
    els.aiNote.hidden = false;
  } finally {
    els.askAiBtn.disabled = false;
    els.askAiBtn.textContent = 'Ask the AI to pick';
  }
}

/* ---------------- Backend: custom mural generation ---------------- */
async function generateCustom() {
  const dims = getDims();
  const description = els.customPrompt.value.trim();
  if (!description) {
    els.customPrompt.focus();
    return;
  }
  els.generateBtn.disabled = true;
  els.generateBtn.textContent = 'Generating…';
  els.customResult.hidden = true;
  try {
    const res = await fetch(`${API_BASE}/api/generate-custom-mural`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: dims.width,
        height: dims.height,
        description,
        style: els.style.value,
      }),
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const data = await res.json();
    els.customResult.innerHTML = `
      <img src="${data.imageUrl}" alt="AI-generated mural concept">
      <p>${data.promptUsed || ''}</p>`;
    els.customResult.hidden = false;
  } catch (err) {
    console.error(err);
    els.customResult.innerHTML = `<p>Could not generate an image right now. Is the backend running? (see /server/README)</p>`;
    els.customResult.hidden = false;
  } finally {
    els.generateBtn.disabled = false;
    els.generateBtn.textContent = 'Generate custom mural';
  }
}
