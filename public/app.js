const PDF_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
const PDF_JS_WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

// please do not ask me how this work, i just want a quick webapp
// that makes reading research paper easier on the eyes

let pdfjsLib;
let pdfDoc = null;
let currentScale = 1.5;
let isInverted = true;
const SCALE_STEP = 0.2;
const MIN_SCALE = 0.4;
const MAX_SCALE = 4.0;
const pdfCache = new Map();
const MAX_CACHE = 10;

// --- DOM refs ---
const headerEl = document.querySelector('header');
const inputSection = document.getElementById('input-section');
const viewerSection = document.getElementById('viewer-section');
const pagesContainer = document.getElementById('pages-container');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const urlInput = document.getElementById('url-input');
const urlBtn = document.getElementById('url-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const fitWidthBtn = document.getElementById('fit-width-btn');
const zoomLevel = document.getElementById('zoom-level');
const pageIndicator = document.getElementById('page-indicator');
const invertBtn = document.getElementById('invert-btn');
const warmthSelect = document.getElementById('warmth-select');
const brightnessSelect = document.getElementById('brightness-select');
const closeBtn = document.getElementById('close-btn');
const toggleToolbarBtn = document.getElementById('toggle-toolbar-btn');
const toolbar = document.getElementById('toolbar');
const pageCard = document.getElementById('page-card');
const recentBtn = document.getElementById('recent-btn');
const recentDropdown = document.getElementById('recent-dropdown');
const recentList = document.getElementById('recent-list');
const recentEmpty = document.getElementById('recent-empty');
const recentClear = document.getElementById('recent-clear');
const searchBar = document.getElementById('search-bar');
const searchInput = document.getElementById('search-input');
const searchCount = document.getElementById('search-count');
const searchPrev = document.getElementById('search-prev');
const searchNext = document.getElementById('search-next');
const searchClose = document.getElementById('search-close');

let pageTextData = []; // per-page: { items, text }
let searchMatches = []; // { pageIndex, rects[] }
let currentMatchIndex = -1;

// --- Init filter defaults ---
pagesContainer.style.setProperty('--text-brightness', brightnessSelect.value);
pagesContainer.style.setProperty('--warmth', warmthSelect.value);

// --- Init PDF.js ---
async function initPdfJs() {
  pdfjsLib = await import(PDF_JS_CDN);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_JS_WORKER_CDN;
}

const pdfReady = initPdfJs();

// --- File input ---
browseBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadFromFile(e.target.files[0]);
});

// --- Drag & drop ---
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') loadFromFile(file);
});

// --- URL input ---
urlBtn.addEventListener('click', loadFromUrl);
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadFromUrl();
});

// --- Toolbar toggle ---
toggleToolbarBtn.addEventListener('click', () => {
  toolbar.classList.toggle('hidden');
});

// --- Toolbar ---
zoomInBtn.addEventListener('click', () => setScale(currentScale + SCALE_STEP));
zoomOutBtn.addEventListener('click', () => setScale(currentScale - SCALE_STEP));
fitWidthBtn.addEventListener('click', fitToWidth);
invertBtn.addEventListener('click', toggleInvert);
warmthSelect.addEventListener('change', () => {
  pagesContainer.style.setProperty('--warmth', warmthSelect.value);
});
brightnessSelect.addEventListener('change', () => {
  pagesContainer.style.setProperty('--text-brightness', brightnessSelect.value);
});
closeBtn.addEventListener('click', closePdf);

// --- Page card (current page on scroll) ---
pagesContainer.addEventListener('scroll', () => {
  if (!pdfDoc) return;
  const wrappers = pagesContainer.querySelectorAll('.page-wrapper');
  const containerTop = pagesContainer.scrollTop;
  const containerMid = containerTop + pagesContainer.clientHeight / 3;
  let current = 1;
  for (let i = 0; i < wrappers.length; i++) {
    if (wrappers[i].offsetTop <= containerMid) current = i + 1;
    else break;
  }
  pageCard.textContent = `Page ${current} / ${pdfDoc.numPages}`;
});

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl+F to open search
  if ((e.metaKey || e.ctrlKey) && e.key === 'f' && pdfDoc) {
    e.preventDefault();
    openSearch();
    return;
  }
  // Escape to close search
  if (e.key === 'Escape' && !searchBar.classList.contains('hidden')) {
    closeSearch();
    return;
  }
  // Enter in search input to go to next match
  if (e.key === 'Enter' && e.target === searchInput) {
    e.preventDefault();
    e.shiftKey ? prevMatch() : nextMatch();
    return;
  }
  if (!pdfDoc) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); setScale(currentScale + SCALE_STEP); }
  if (e.key === '-') { e.preventDefault(); setScale(currentScale - SCALE_STEP); }
  if (e.key === '0') { e.preventDefault(); setScale(1.5); }
  if (e.key === 'i') { e.preventDefault(); toggleInvert(); }
});

// --- Search ---
searchInput.addEventListener('input', () => runSearch(searchInput.value));
searchPrev.addEventListener('click', prevMatch);
searchNext.addEventListener('click', nextMatch);
searchClose.addEventListener('click', closeSearch);

function openSearch() {
  searchBar.classList.remove('hidden');
  searchInput.focus();
  searchInput.select();
}

function closeSearch() {
  searchBar.classList.add('hidden');
  searchInput.value = '';
  clearSearchHighlights();
  searchCount.textContent = '';
}

function clearSearchHighlights() {
  document.querySelectorAll('.search-highlight').forEach(el => el.remove());
  searchMatches = [];
  currentMatchIndex = -1;
}

function runSearch(query) {
  clearSearchHighlights();
  if (!query || !pdfDoc) { searchCount.textContent = ''; return; }

  const q = query.toLowerCase();
  const wrappers = pagesContainer.querySelectorAll('.page-wrapper');

  for (let p = 0; p < pageTextData.length; p++) {
    const { items, viewport } = pageTextData[p];
    const wrapper = wrappers[p];
    if (!wrapper) continue;

    for (const item of items) {
      if (!item.str) continue;
      const text = item.str.toLowerCase();
      let startIdx = 0;
      while ((startIdx = text.indexOf(q, startIdx)) !== -1) {
        const rects = getMatchRects(item, startIdx, q.length, viewport);
        for (const rect of rects) {
          const div = document.createElement('div');
          div.className = 'search-highlight';
          div.style.left = rect.left + 'px';
          div.style.top = rect.top + 'px';
          div.style.width = rect.width + 'px';
          div.style.height = rect.height + 'px';
          wrapper.appendChild(div);
          searchMatches.push({ element: div, pageIndex: p });
        }
        startIdx += q.length;
      }
    }
  }

  if (searchMatches.length > 0) {
    currentMatchIndex = 0;
    highlightCurrentMatch();
    searchCount.textContent = `1 / ${searchMatches.length}`;
  } else {
    searchCount.textContent = '0 results';
  }
}

function getMatchRects(item, charStart, charLen, viewport) {
  const x = item.transform[4];
  const y = item.transform[5];
  const charWidth = item.str.length > 0 ? item.width / item.str.length : 0;
  const h = item.height || 10;

  const matchX = x + charStart * charWidth;
  const matchW = charLen * charWidth;

  const pdfRect = [matchX, y, matchX + matchW, y + h];
  const vpRect = viewport.convertToViewportRectangle(pdfRect);

  const left = Math.min(vpRect[0], vpRect[2]);
  const top = Math.min(vpRect[1], vpRect[3]);
  const width = Math.abs(vpRect[2] - vpRect[0]);
  const height = Math.abs(vpRect[3] - vpRect[1]);

  return [{ left, top, width, height }];
}

function highlightCurrentMatch() {
  document.querySelectorAll('.search-highlight.active').forEach(el => el.classList.remove('active'));
  if (currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;
  const match = searchMatches[currentMatchIndex];
  match.element.classList.add('active');
  match.element.scrollIntoView({ block: 'center' });
  searchCount.textContent = `${currentMatchIndex + 1} / ${searchMatches.length}`;
}

function nextMatch() {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  highlightCurrentMatch();
}

function prevMatch() {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
  highlightCurrentMatch();
}

// --- PDF cache ---
function cacheput(key, data) {
  if (pdfCache.size >= MAX_CACHE) {
    const oldest = pdfCache.keys().next().value;
    pdfCache.delete(oldest);
  }
  pdfCache.set(key, data);
}

// --- Load from local file ---
async function loadFromFile(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const cacheKey = 'file:' + file.name;
  cacheput(cacheKey, data);
  await openPdf({ data: new Uint8Array(data) });
  addRecentPaper(file.name, 'file', null, cacheKey);
}

// --- Load from URL via proxy ---
async function loadFromUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  const cacheKey = 'url:' + url;

  // Serve from cache if available
  if (pdfCache.has(cacheKey)) {
    const data = pdfCache.get(cacheKey);
    await openPdf({ data: new Uint8Array(data) });
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || url;
    addRecentPaper(name, 'url', url, cacheKey);
    return;
  }

  showLoading();
  try {
    const res = await fetch('/api/fetch-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Server returned ${res.status}`);
    }
    const data = new Uint8Array(await res.arrayBuffer());
    cacheput(cacheKey, data);
    await openPdf({ data: new Uint8Array(data) });
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || url;
    addRecentPaper(name, 'url', url, cacheKey);
  } catch (err) {
    alert('Failed to load PDF: ' + err.message);
    hideLoading();
  }
}

// --- Load from cache (used by recent papers) ---
function loadFromCacheKey(cacheKey) {
  const data = pdfCache.get(cacheKey);
  if (!data) return false;
  openPdf({ data: new Uint8Array(data) });
  return true;
}

// --- Open a PDF document ---
async function openPdf(source) {
  await pdfReady;
  showLoading();
  try {
    pdfDoc = await pdfjsLib.getDocument(source).promise;
    headerEl.classList.add('hidden');
    inputSection.classList.add('hidden');
    viewerSection.classList.remove('hidden');
    toggleToolbarBtn.classList.remove('hidden');
    pageCard.classList.remove('hidden');
    await renderAllPages();
    pageCard.textContent = `Page 1 / ${pdfDoc.numPages}`;
  } catch (err) {
    alert('Failed to open PDF: ' + err.message);
    hideLoading();
  }
}

// --- Render all pages ---
async function renderAllPages() {
  const scrollRatio = pagesContainer.scrollHeight > 0
    ? pagesContainer.scrollTop / pagesContainer.scrollHeight
    : 0;

  pagesContainer.innerHTML = '';
  pagesContainer.appendChild(pageCard);
  pageIndicator.textContent = `${pdfDoc.numPages} page${pdfDoc.numPages !== 1 ? 's' : ''}`;
  updateZoomLabel();
  pageTextData = [];
  clearSearchHighlights();

  const dpr = window.devicePixelRatio || 1;

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: currentScale });

    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Apply inversion at the pixel level for crisp text
    if (isInverted) {
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const tmpCtx = tmp.getContext('2d');
      tmpCtx.filter = 'invert(1) hue-rotate(180deg)';
      tmpCtx.drawImage(canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(tmp, 0, 0);
    }

    wrapper.appendChild(canvas);

    // Invisible text layer for text selection
    const textContent = await page.getTextContent();
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'text-layer';
    wrapper.appendChild(textLayerDiv);
    try {
      const textLayer = new pdfjsLib.TextLayer({
        textContentSource: textContent,
        container: textLayerDiv,
        viewport: viewport,
      });
      await textLayer.render();
    } catch {}

    // Store text data for search
    pageTextData.push({ items: textContent.items, viewport });

    // Overlay clickable links
    const annotations = await page.getAnnotations();
    for (const anno of annotations) {
      if (anno.subtype !== 'Link') continue;
      const url = anno.url;
      const dest = anno.dest;
      if (!url && !dest) continue;

      const rect = viewport.convertToViewportRectangle(anno.rect);
      const left = Math.min(rect[0], rect[2]);
      const top = Math.min(rect[1], rect[3]);
      const width = Math.abs(rect[2] - rect[0]);
      const height = Math.abs(rect[3] - rect[1]);

      const a = document.createElement('a');
      a.className = 'pdf-link-overlay';
      a.style.left = left + 'px';
      a.style.top = top + 'px';
      a.style.width = width + 'px';
      a.style.height = height + 'px';

      if (url) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      } else if (dest) {
        a.href = '#';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          navigateToDest(dest);
        });
      }

      wrapper.appendChild(a);
    }

    pagesContainer.appendChild(wrapper);
  }

  requestAnimationFrame(() => {
    pagesContainer.scrollTop = scrollRatio * pagesContainer.scrollHeight;
  });
}

// --- Internal link navigation ---
async function navigateToDest(dest) {
  let pageIndex;
  if (typeof dest === 'string') {
    const resolved = await pdfDoc.getDestination(dest);
    if (!resolved) return;
    pageIndex = await pdfDoc.getPageIndex(resolved[0]);
  } else if (Array.isArray(dest)) {
    pageIndex = await pdfDoc.getPageIndex(dest[0]);
  }
  const wrappers = pagesContainer.querySelectorAll('.page-wrapper');
  if (wrappers[pageIndex]) {
    wrappers[pageIndex].scrollIntoView({ behavior: 'smooth' });
  }
}

// --- Scale / zoom ---
function setScale(newScale) {
  newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
  if (newScale === currentScale) return;
  currentScale = Math.round(newScale * 100) / 100;
  if (pdfDoc) renderAllPages();
}

function fitToWidth() {
  if (!pdfDoc) return;
  pdfDoc.getPage(1).then((page) => {
    const desiredWidth = pagesContainer.clientWidth - 32;
    const unscaledViewport = page.getViewport({ scale: 1 });
    setScale(desiredWidth / unscaledViewport.width);
  });
}

function updateZoomLabel() {
  zoomLevel.textContent = Math.round(currentScale * 100 / 1.5) + '%';
}

// --- Inversion toggle ---
function toggleInvert() {
  isInverted = !isInverted;
  invertBtn.textContent = `Invert: ${isInverted ? 'ON' : 'OFF'}`;
  invertBtn.classList.toggle('active', isInverted);
  if (pdfDoc) renderAllPages();
}

// --- Close PDF ---
function closePdf() {
  if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
  closeSearch();
  pageTextData = [];
  pagesContainer.innerHTML = '';
  viewerSection.classList.add('hidden');
  toolbar.classList.remove('hidden');
  toggleToolbarBtn.classList.add('hidden');
  pageCard.classList.add('hidden');
  headerEl.classList.remove('hidden');
  inputSection.classList.remove('hidden');
  fileInput.value = '';
  urlInput.value = '';
  currentScale = 1.5;
  isInverted = true;
}

// --- Recent papers (localStorage) ---
const RECENT_KEY = 'eyeEasyRecentPapers';
const MAX_RECENT = 20;

function getRecentPapers() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch { return []; }
}

function saveRecentPapers(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function addRecentPaper(name, type, url, cacheKey) {
  let list = getRecentPapers();
  list = list.filter(e => !(e.name === name && e.url === url));
  list.unshift({ name, type, url: url || null, cacheKey: cacheKey || null, time: Date.now() });
  if (list.length > MAX_RECENT) list.length = MAX_RECENT;
  saveRecentPapers(list);
}

function removeRecentPaper(index) {
  const list = getRecentPapers();
  list.splice(index, 1);
  saveRecentPapers(list);
  renderRecentDropdown();
}

function renderRecentDropdown() {
  const list = getRecentPapers();
  recentList.innerHTML = '';

  if (list.length === 0) {
    recentEmpty.classList.remove('hidden');
    recentClear.classList.add('hidden');
    return;
  }

  recentEmpty.classList.add('hidden');
  recentClear.classList.remove('hidden');

  list.forEach((entry, i) => {
    const li = document.createElement('li');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'recent-name';
    nameSpan.textContent = entry.name;
    li.appendChild(nameSpan);

    const cached = entry.cacheKey && pdfCache.has(entry.cacheKey);

    const tag = document.createElement('span');
    tag.className = 'recent-tag';
    tag.textContent = cached ? 'cached' : (entry.type === 'url' ? 'URL' : 'File');
    if (cached) tag.classList.add('recent-tag-cached');
    li.appendChild(tag);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'recent-remove';
    removeBtn.textContent = '\u00d7';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeRecentPaper(i); });
    li.appendChild(removeBtn);

    // Clickable if cached (instant) or if URL (will fetch or hit cache)
    if (cached) {
      li.addEventListener('click', () => {
        recentDropdown.classList.add('hidden');
        loadFromCacheKey(entry.cacheKey);
      });
    } else if (entry.type === 'url' && entry.url) {
      li.addEventListener('click', () => {
        urlInput.value = entry.url;
        recentDropdown.classList.add('hidden');
        loadFromUrl();
      });
    } else {
      li.style.opacity = '0.5';
      li.style.cursor = 'default';
    }

    recentList.appendChild(li);
  });
}

// Toggle dropdown
recentBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = recentDropdown.classList.toggle('hidden');
  if (!open) renderRecentDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!recentDropdown.classList.contains('hidden') && !recentDropdown.contains(e.target)) {
    recentDropdown.classList.add('hidden');
  }
});

recentClear.addEventListener('click', () => {
  saveRecentPapers([]);
  renderRecentDropdown();
});

// --- Loading helpers ---
function showLoading() {
  headerEl.classList.add('hidden');
  inputSection.classList.add('hidden');
  viewerSection.classList.remove('hidden');
  pagesContainer.innerHTML = '<p class="loading-msg">Loading PDF…</p>';
}

function hideLoading() {
  viewerSection.classList.add('hidden');
  headerEl.classList.remove('hidden');
  inputSection.classList.remove('hidden');
  pagesContainer.innerHTML = '';
}
