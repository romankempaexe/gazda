// Letáky obchodov v Gazde (Lidl, Tesco, Kaufland, Billa, …): prehliadanie strán, krúžkovanie tovaru prstom a pridanie
// vystrihnutej miniatúry do nákupného zoznamu. Používa funkcie z app.js (api,
// state, openModal, toast…). Obrázky idú cez náš server (/api/leaflets/image),
// preto sa z nich na plátne (canvas) dá vystrihnúť kúsok.

const lf = {
  root: null,
  list: [],
  flyer: null,
  page: 0, // index strany
  mode: 'list', // list | strip | page
  zoom: 1,
  draw: true,
  target: null, // id nákupu, do ktorého sa pridáva
  marks: {}, // zakrúžkované miesta: "slug#strana" -> [{ pts, ok }]
};

// Obchody s letákmi (rovnaké id ako na serveri, src/leaflets.js STORES).
const LF_STORES = [
  { id: 'lidl', name: 'Lidl' },
  { id: 'tesco', name: 'Tesco' },
  { id: 'kaufland', name: 'Kaufland' },
  { id: 'billa', name: 'Billa' },
  { id: 'coop', name: 'Coop Jednota', match: /coop|jednota/ },
  { id: 'terno', name: 'Terno' },
  { id: 'fresh', name: 'Fresh' },
  { id: 'kraj', name: 'Kraj' },
  { id: 'metro', name: 'Metro' },
];
const LF_STORE_KEY = 'gazda.lfStore';

/** Obchod podľa názvu z nákupu („Lidl Ružinov“ → lidl). */
function lfStoreFor(name) {
  const n = normalizeText(name || '');
  if (!n) return null;
  const s = LF_STORES.find((x) => (x.match ? x.match.test(n) : n.includes(normalizeText(x.name))));
  return s ? s.id : null;
}

const lfStoreName = (id) => (LF_STORES.find((s) => s.id === id) || LF_STORES[0]).name;

const THUMB_MAX = 360; // najdlhšia strana miniatúry v px
const MAX_THUMB_BYTES = 150000;

/** Otvorí letáky; opts.taskId = nákup, do ktorého sa majú pridávať položky. */
async function openLeaflets(opts) {
  lf.target = (opts && opts.taskId) || lf.target;
  // obchod: z nákupu, inak naposledy zvolený, inak Lidl
  let remembered = null;
  try {
    remembered = localStorage.getItem(LF_STORE_KEY);
  } catch (e) {
    // bez pamäte prehliadača
  }
  lf.store = lfStoreFor(opts && opts.store) || lf.store || (LF_STORES.some((s) => s.id === remembered) ? remembered : 'lidl');
  if (!lf.root) {
    lf.root = document.createElement('div');
    lf.root.id = 'leaflet';
    lf.root.className = 'lf';
    document.body.appendChild(lf.root);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lf.root.classList.contains('hidden') && $('modal').classList.contains('hidden')) lfBack();
    });
    window.addEventListener('resize', () => lf.mode === 'page' && lfLayoutPage());
  }
  lf.root.classList.remove('hidden');
  document.body.classList.add('lf-open');
  lfLoadStore(lf.store);
}

/** Načíta letáky obchodu a ukáže ich zoznam (s výberom obchodu hore). */
async function lfLoadStore(storeId) {
  lf.store = storeId;
  try {
    localStorage.setItem(LF_STORE_KEY, storeId);
  } catch (e) {
    // bez pamäte prehliadača
  }
  lf.list = null;
  lfRenderList();
  let list;
  try {
    list = await api('getLeaflets', storeId);
  } catch (err) {
    if (lf.store !== storeId) return;
    lf.list = [];
    lfRenderList(errorMessage(err));
    return;
  }
  if (lf.store !== storeId) return; // medzičasom iný obchod
  lf.list = list;
  lfRenderList();
}

function closeLeaflets() {
  if (!lf.root) return;
  lf.root.classList.add('hidden');
  lf.root.innerHTML = '';
  lf.mode = 'list';
  document.body.classList.remove('lf-open');
  if (state.detail) renderDetail({ quiet: true });
}

/** Krok späť: strana → strany → zoznam letákov → zatvoriť. */
function lfBack() {
  if (lf.mode === 'page') lfRenderList();
  else closeLeaflets();
}

function lfFrame(title, sub, body, tools) {
  lf.root.innerHTML =
    '<div class="lf-bar"><button class="icon-btn" id="lfBack" title="Späť"><span class="ms">arrow_back</span></button>' +
    '<div class="lf-title"><div>' + esc(title) + '</div>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' +
    '<button class="icon-btn" id="lfClose" title="Zavrieť"><span class="ms">close</span></button></div>' +
    '<div class="lf-body" id="lfBody">' + body + '</div>' +
    (tools ? '<div class="lf-tools">' + tools + '</div>' : '');
  $('lfBack').onclick = lfBack;
  $('lfClose').onclick = closeLeaflets;
}

function lfValidity(f) {
  if (f.start && f.end) return formatDateShort(f.start) + ' – ' + formatDateShort(f.end);
  return f.end ? 'do ' + formatDateShort(f.end) : '';
}

function lfRenderList(error) {
  lf.mode = 'list';
  const chips =
    '<div class="lf-stores chips">' +
    LF_STORES.map(
      (s) => '<button class="chip' + (s.id === lf.store ? ' active' : '') + '" data-store="' + s.id + '">' + esc(s.name) + '</button>'
    ).join('') +
    '</div>';
  let body;
  if (error) body = '<div class="empty"><span class="ms">newspaper</span><div>' + esc(error) + '</div></div>';
  else if (!lf.list) body = '<div class="center muted">Načítavam letáky…</div>';
  else if (!lf.list.length) body = '<div class="empty"><span class="ms">newspaper</span><div>' + esc(lfStoreName(lf.store)) + ' teraz nemá žiadny leták.</div></div>';
  else {
    body =
      '<div class="lf-list">' +
      lf.list
        .map((f) => {
          const info = [lfValidity(f), f.pageCount ? f.pageCount + ' strán' : ''].filter(Boolean).join(' · ');
          return (
            '<button class="lf-card" data-slug="' + esc(f.slug) + '">' +
            (f.thumb ? '<img src="' + esc(f.thumb) + '" alt="" loading="lazy">' : '<span class="lf-noimg ms">newspaper</span>') +
            '<div><b>' + esc(f.title || f.name) + '</b>' + (info ? '<small>' + esc(info) + '</small>' : '') + '</div></button>'
          );
        })
        .join('') +
      '</div>';
  }
  lfFrame('Letáky', 'Vyber obchod a leták', chips + body, '');
  lf.root.querySelectorAll('[data-store]').forEach((b) => {
    b.onclick = () => b.dataset.store !== lf.store && lfLoadStore(b.dataset.store);
  });
  const active = lf.root.querySelector('.lf-stores .active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  lf.root.querySelectorAll('[data-slug]').forEach((b) => {
    b.onclick = () => openFlyer(b.dataset.slug);
  });
}

async function openFlyer(slug) {
  if (!lf.flyer || lf.flyer.slug !== slug) {
    try {
      lf.flyer = await api('getLeaflet', slug);
    } catch (err) {
      showError(err);
      return;
    }
    lf.page = 0;
  }
  lfOpenPage();
}

// ---- Listovanie (strany vedľa seba, prstom do strán) ---------------------------



// ---- Jedna strana: priblíženie a krúžkovanie --------------------------------------

/**
 * Strana na výber tovaru: + pri rozpoznaných produktoch, krúžkovanie prstom a ťahanie
 * do strany na ďalšiu/predchádzajúcu stranu. dir = odkiaľ strana prichádza (animácia).
 */
function lfOpenPage(dir) {
  lf.mode = 'page';
  lf.draw = true;
  lf.zoom = 1;
  const f = lf.flyer;
  const p = f.pages[lf.page];
  lfFrame(
    f.title || f.name || 'Leták ' + lfStoreName(lf.store),
    'Strana ' + p.n + ' / ' + f.pages.length,
    '<div class="lf-scroll" id="lfScroll"><div class="lf-wrap" id="lfWrap">' +
      '<img id="lfImg" alt="" draggable="false"><canvas id="lfCanvas"></canvas></div></div>' +
      '<div class="lf-help" id="lfHelp"></div>',
    '<button class="icon-btn" id="lfPrev" title="Predchádzajúca"><span class="ms">chevron_left</span></button>' +
      '<button class="icon-btn" id="lfZoomOut" title="Oddialiť"><span class="ms">remove</span></button>' +
      '<button class="icon-btn" id="lfZoomIn" title="Priblížiť"><span class="ms">add</span></button>' +
      '<button class="btn tonal" id="lfMode"></button>' +
      '<button class="icon-btn" id="lfNext" title="Ďalšia"><span class="ms">chevron_right</span></button>'
  );
  const img = $('lfImg');
  img.src = p.image;
  img.onload = lfLayoutPage;
  // Ostrejší obrázok (2400 px) dotiahni na pozadí – z neho sa aj strihá miniatúra.
  if (p.zoom && p.zoom !== p.image) {
    const big = new Image();
    big.onload = () => {
      if (lf.mode === 'page' && $('lfImg') === img && lf.flyer.pages[lf.page] === p) img.src = p.zoom;
    };
    big.src = p.zoom;
  }
  if (dir) $('lfWrap').classList.add(dir > 0 ? 'from-right' : 'from-left');
  $('lfPrev').disabled = lf.page === 0;
  $('lfNext').disabled = lf.page === f.pages.length - 1;
  $('lfPrev').onclick = () => lfStep(-1);
  $('lfNext').onclick = () => lfStep(1);
  $('lfZoomIn').onclick = () => lfSetZoom(lf.zoom + 1);
  $('lfZoomOut').onclick = () => lfSetZoom(lf.zoom - 1);
  $('lfMode').onclick = () => {
    lf.draw = !lf.draw;
    lfModeUpdate();
  };
  lfModeUpdate();
  lfBindDrawing();
  lfLayoutPage();
  lfPreloadImages(lf.page);
}

/** Ďalšia (d = 1) alebo predchádzajúca (d = -1) strana v režime výberu tovaru. */
function lfStep(d) {
  const next = lf.page + d;
  if (next < 0 || next >= lf.flyer.pages.length) return;
  lf.page = next;
  lfOpenPage(d);
}

function lfModeUpdate() {
  const btn = $('lfMode');
  // Celá strana na obrazovke: prst krúžkuje alebo listuje. Pri priblížení sa dá prepnúť na posúvanie.
  btn.classList.toggle('hidden', lf.zoom <= 1);
  btn.innerHTML = lf.draw ? '<span class="ms">pan_tool</span>Posúvať' : '<span class="ms">gesture</span>Krúžkovať';
  $('lfWrap').classList.toggle('drawing', lf.draw);
  lfHelpUpdate();
}

/** Nápoveda dole podľa režimu a stavu rozpoznávania produktov. */
function lfHelpUpdate() {
  const help = $('lfHelp');
  if (help) help.classList.add('hidden'); // bez návodu cez stranu
}

// ---- Rozpoznané produkty: tlačidlo + pri každom ---------------------------------------



/** Obrázky nasledujúcich strán sa stiahnu vopred, aby sa listovalo bez čakania. */
function lfPreloadImages(index) {
  for (let i = index - 1; i <= index + 2; i++) {
    const p = lf.flyer.pages[i];
    if (!p || i === index) continue;
    new Image().src = p.image;
    if (i === index + 1 && p.zoom) new Image().src = p.zoom;
  }
}


let lfIdentifying = false;

/**
 * Ťuknutie na produkt (alebo na „+“): výrez okolo prsta pošle AI, ktorá povie, aký produkt je
 * v jeho strede – názov, cenu a presné ohraničenie. Ohraničenia z rozpoznania celej strany sú
 * len odhad (bývajú posunuté), toto sedí na to, kam človek ťukol.
 */
async function lfIdentifyAt(at) {
  if (lfIdentifying) return;
  const img = $('lfImg');
  const key = lfMarkKey();
  try {
    await lfWhenLoaded(img);
  } catch (e) {
    return;
  }
  // Výrez: asi 45 % šírky a štvorec v pixeloch (produkt v letáku býva skoro štvorcový)
  const rw = 0.45;
  const rh = Math.min(0.6, (rw * img.naturalWidth) / img.naturalHeight);
  const x = Math.min(1 - rw, Math.max(0, at[0] - rw / 2));
  const y = Math.min(1 - rh, Math.max(0, at[1] - rh / 2));
  const region = { x, y, x2: x + rw, y2: y + rh };
  let crop;
  try {
    // menší obrázok = rýchlejšia odpoveď AI; zároveň náhľad v okne
    crop = await lfCrop(img, region, 512, 0.8, MAX_THUMB_BYTES);
  } catch (e) {
    toast('Obrázok sa nepodarilo vystrihnúť. Skús to znova.', true);
    return;
  }
  lfIdentifying = true;
  lf.pulse = { at };
  lfDrawMarks();
  const pending = api('identifyLeafletProduct', crop).finally(() => {
    lfIdentifying = false;
    lf.pulse = null;
    lfDrawMarks();
  });
  // Okno sa otvorí hneď s výrezom okolo prsta; názov, cena a ohraničenie sa doplnia, keď AI odpovie.
  const mark = { pts: [], ok: false };
  (lf.marks[key] = lf.marks[key] || []).push(mark);
  lfConfirm(crop, mark, key, { name: '', price: '' }, { pending, region, at, img });
}



function lfSetZoom(z) {
  const scroll = $('lfScroll');
  const z2 = Math.max(1, Math.min(4, z));
  if (z2 === lf.zoom) return;
  // Priblížené sa najprv posúva, pri celej strane sa krúžkuje a listuje.
  if (lf.zoom === 1 || z2 === 1) {
    lf.draw = z2 === 1;
    lfModeUpdate();
  }
  // Priblíž okolo stredu toho, čo je práve vidieť.
  const cx = (scroll.scrollLeft + scroll.clientWidth / 2) / scroll.scrollWidth;
  const cy = (scroll.scrollTop + scroll.clientHeight / 2) / scroll.scrollHeight;
  lf.zoom = z2;
  lfLayoutPage();
  scroll.scrollLeft = cx * scroll.scrollWidth - scroll.clientWidth / 2;
  scroll.scrollTop = cy * scroll.scrollHeight - scroll.clientHeight / 2;
}

/** Veľkosť strany: pri 1× celá na obrazovku, inak násobok. Plátno rovnako veľké. */
function lfLayoutPage() {
  const scroll = $('lfScroll');
  const img = $('lfImg');
  if (!scroll || !img) return;
  const p = lf.flyer.pages[lf.page];
  const ratio = (img.naturalWidth && img.naturalHeight ? img.naturalHeight / img.naturalWidth : 0) || (p.w && p.h ? p.h / p.w : 1.4);
  const fitW = Math.min(scroll.clientWidth, scroll.clientHeight / ratio);
  const w = Math.round(fitW * lf.zoom);
  const h = Math.round(w * ratio);
  const wrap = $('lfWrap');
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
  const canvas = $('lfCanvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  $('lfZoomOut').disabled = lf.zoom <= 1;
  $('lfZoomIn').disabled = lf.zoom >= 4;
  lfDrawMarks();
}

const lfMarkKey = () => lf.flyer.slug + '#' + lf.page;

function lfDrawMarks(current) {
  const canvas = $('lfCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, 4 * (window.devicePixelRatio || 1));
  const path = (pts, color, fill) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
    pts.forEach((pt) => ctx.lineTo(pt[0] * W, pt[1] * H));
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  (lf.marks[lfMarkKey()] || []).forEach((m) =>
    m.ok ? path(m.pts, 'rgba(22,163,74,0.9)', 'rgba(22,163,74,0.12)') : path(m.pts, 'rgba(249,115,22,0.9)')
  );
  if (current) path(current, 'rgba(249,115,22,0.95)');
  // ťuknutie, ktoré práve rozpoznáva AI: krúžok na mieste prsta (pulzuje, kým čaká)
  if (lf.pulse) {
    const r = (18 + 6 * Math.sin(Date.now() / 150)) * (window.devicePixelRatio || 1);
    ctx.beginPath();
    ctx.arc(lf.pulse.at[0] * W, lf.pulse.at[1] * H, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(22,163,74,0.25)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(22,163,74,0.9)';
    ctx.stroke();
    requestAnimationFrame(() => lf.pulse && lfDrawMarks());
  }
}

function lfBindDrawing() {
  const canvas = $('lfCanvas');
  let pts = null;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!lf.draw || !e.isPrimary) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pts = [point(e)];
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    events.forEach((ev) => pts.push(point(ev)));
    lfDrawMarks(pts);
  });
  const finish = () => {
    if (!pts) return;
    const done = pts;
    pts = null;
    lfFinishMark(done);
  };
  canvas.addEventListener('pointerup', finish);
  // Po dotyku by prehliadač poslal ešte „klik“ – ten by trafil okno, ktoré sa práve otvorilo.
  canvas.addEventListener('touchend', (e) => lf.draw && e.cancelable && e.preventDefault(), { passive: false });
  canvas.addEventListener('pointercancel', () => {
    pts = null;
    lfDrawMarks();
  });
  // Pri priblížení (posúvanie) plátno ťuknutia nedostáva – ťuknutie na produkt chytí obrázok.
  $('lfWrap').addEventListener('click', (e) => {
    if (lf.draw) return;
    const r = $('lfWrap').getBoundingClientRect();
    lfIdentifyAt([(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]);
  });
}

/**
 * Ťah do strany (listovanie) vs. krúžok: vodorovný, dosť dlhý a neuzavretý ťah.
 * Krúžok končí blízko začiatku, ťah ďaleko od neho. Len pri celej strane (bez priblíženia).
 */
function lfIsSwipe(pts, wrap) {
  if (lf.zoom > 1 || pts.length < 2) return false;
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  const dx = (x1 - x0) * W;
  const dy = (y1 - y0) * H;
  let minY = 1, maxY = 0;
  pts.forEach(([, y]) => {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });
  const height = (maxY - minY) * H;
  return Math.abs(dx) > Math.max(50, W * 0.15) && Math.abs(dy) < Math.abs(dx) * 0.5 && height < Math.abs(dx) * 0.6;
}

/** Ohraničenie zakrúžkovaného miesta (0–1) s malým okrajom. */
function lfBounds(pts) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  pts.forEach(([x, y]) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  });
  const pad = 0.01;
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), x2: Math.min(1, x1 + pad), y2: Math.min(1, y1 + pad) };
}

async function lfFinishMark(pts) {
  const b = lfBounds(pts);
  const wrap = $('lfWrap');
  if (lfIsSwipe(pts, wrap)) {
    lfDrawMarks();
    lfStep(pts[pts.length - 1][0] < pts[0][0] ? 1 : -1);
    return;
  }
  // Ťuknutie alebo čiarka – nie krúžok. Ťuknutie na produkt ho vyberie (ako „+“).
  if ((b.x2 - b.x) * wrap.clientWidth < 24 || (b.y2 - b.y) * wrap.clientHeight < 24) {
    lfDrawMarks();
    if ((b.x2 - b.x) * wrap.clientWidth < 16 && (b.y2 - b.y) * wrap.clientHeight < 16) lfIdentifyAt(pts[0]);
    return;
  }
  const mark = { pts, ok: false };
  const key = lfMarkKey();
  (lf.marks[key] = lf.marks[key] || []).push(mark);
  lfDrawMarks();
  let thumb;
  try {
    thumb = await lfCrop($('lfImg'), b);
  } catch (err) {
    lf.marks[key].splice(lf.marks[key].indexOf(mark), 1);
    lfDrawMarks();
    toast('Obrázok sa nepodarilo vystrihnúť. Skús to znova.', true);
    return;
  }
  lfConfirm(thumb, mark, key);
}

function lfWhenLoaded(img) {
  if (img.complete && img.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', reject, { once: true });
  });
}

/** Vystrihne miesto b (0–1) z obrázka strany ako malý JPEG (data URL). */
async function lfCrop(img, b, maxSide, firstQuality, maxBytes) {
  await lfWhenLoaded(img);
  const sx = b.x * img.naturalWidth;
  const sy = b.y * img.naturalHeight;
  const sw = (b.x2 - b.x) * img.naturalWidth;
  const sh = (b.y2 - b.y) * img.naturalHeight;
  const steps = maxSide
    ? [[maxSide, firstQuality], [maxSide, 0.7], [Math.round(maxSide * 0.75), 0.65]]
    : [[THUMB_MAX, 0.82], [THUMB_MAX, 0.65], [240, 0.6], [160, 0.55]];
  for (const [max, quality] of steps) {
    const scale = Math.min(1, max / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.length <= (maxBytes || MAX_THUMB_BYTES)) return data;
  }
  throw new Error('Miniatúra je príliš veľká.');
}

// ---- Pridanie do nákupu ---------------------------------------------------------

const NEW_SHOPPING = '__new__';

/** Nákupy domácnosti – najprv tie do obchodu, ktorého leták je otvorený. */
function lfShoppingTasks() {
  const same = (c) => lfStoreFor(c.store) === lf.store;
  return state.detail.cinnosti
    .filter((c) => c.kind === 'nakup' && !c.pending)
    .sort((a, b) => Number(same(b)) - Number(same(a)) || a.dueDate.localeCompare(b.dueDate));
}

/** Cena „2.49“ → „2,49“ (do poľa) */
const priceInput = (p) => (p ? String(p).replace('.', ',') : '');

function lfConfirm(thumb, mark, key, product, live) {
  const tasks = lfShoppingTasks();
  const target = tasks.some((c) => c.id === lf.target) ? lf.target : tasks.length ? tasks[0].id : NEW_SHOPPING;
  const options =
    tasks
      .map(
        (c) =>
          '<option value="' + esc(c.id) + '"' + (c.id === target ? ' selected' : '') + '>' + esc(c.name) +
          (c.store ? ' · ' + esc(c.store) : '') + ' (' + esc(formatDateShort(c.dueDate)) + ')</option>'
      )
      .join('') +
    '<option value="' + NEW_SHOPPING + '"' + (target === NEW_SHOPPING ? ' selected' : '') + '>+ Nový nákup (' + esc(lfStoreName(lf.store)) + ')</option>';
  const pageNo = lf.flyer.pages[lf.page].n;
  let added = false;

  openModal(
    '<h2>Pridať do nákupu</h2>' +
      (live
        ? '<div class="lf-preview"><div class="lf-pv"><img src="' + thumb + '" alt=""><div class="lf-box hidden" id="lfBox"></div>' +
          '<div class="lf-spin" id="lfSpin"><span></span>Rozpoznávam…</div></div></div>'
        : '<div class="lf-preview"><img src="' + thumb + '" alt=""></div>') +
      '<div class="field"><label>Názov</label><input id="lfName" maxlength="100" autocomplete="off" placeholder="' +
      (live ? 'Rozpoznávam…' : 'Napr. mascarpone (nepovinné)') + '" value="' +
      esc(product ? product.name : '') + '">' +
      '<div class="suggest hidden" id="lfSuggest"></div></div>' +
      '<div class="row"><div class="field"><label>Počet</label>' + stepperHtml('id="lfQty"', product ? '1' : '') + '</div>' +
      '<div class="field"><label>Cena (€)</label><input id="lfPrice" inputmode="decimal" maxlength="9" autocomplete="off" placeholder="nepovinné" value="' +
      esc(priceInput(product && product.price)) + '"></div></div>' +
      '<div class="field"><label>Nákup</label><select id="lfTarget">' + options + '</select></div>' +
      '<div class="actions"><button type="button" class="btn text" id="lfCancel">Zrušiť</button>' +
      '<button type="button" class="btn" id="lfAdd"><span class="ms">add_shopping_cart</span>Pridať</button></div>',
    (root) => {
      const name = root.querySelector('#lfName');
      const suggest = attachSuggest(name, root.querySelector('#lfSuggest'), productSources, () => [], (text) => {
        name.value = text;
        suggest.clear();
      });
      root.querySelector('#lfCancel').onclick = closeModal;
      const addBtn = root.querySelector('#lfAdd');
      if (live) {
        // výsledok AI: doplň názov a cenu (ak ich človek medzičasom nenapísal), ukáž ohraničenie
        const priceEl = root.querySelector('#lfPrice');
        const finish = async (found) => {
          if (added || !document.body.contains(name)) return;
          root.querySelector('#lfSpin').classList.add('hidden');
          name.placeholder = found ? 'Napr. mascarpone (nepovinné)' : 'Produkt sa nenašiel – dopíš názov';
          if (!found) return;
          if (!name.value.trim()) name.value = found.name;
          if (!priceEl.value.trim() && found.price) priceEl.value = priceInput(found.price);
          const { region, img } = live;
          const W = region.x2 - region.x;
          const H = region.y2 - region.y;
          let b;
          if (found.box) {
            const [bx1, by1, bx2, by2] = found.box;
            const box = root.querySelector('#lfBox');
            box.style.left = bx1 * 100 + '%';
            box.style.top = by1 * 100 + '%';
            box.style.width = (bx2 - bx1) * 100 + '%';
            box.style.height = (by2 - by1) * 100 + '%';
            box.classList.remove('hidden');
            const pad = 0.006;
            b = {
              x: Math.max(0, region.x + bx1 * W - pad),
              y: Math.max(0, region.y + by1 * H - pad),
              x2: Math.min(1, region.x + bx2 * W + pad),
              y2: Math.min(1, region.y + by2 * H + pad),
            };
          } else {
            const [ax, ay] = live.at;
            b = { x: Math.max(0, ax - 0.15), y: Math.max(0, ay - 0.1), x2: Math.min(1, ax + 0.15), y2: Math.min(1, ay + 0.1) };
          }
          // ohraničenie aj na strane letáka
          mark.pts = [[b.x, b.y], [b.x2, b.y], [b.x2, b.y2], [b.x, b.y2], [b.x, b.y]];
          lfDrawMarks();
          try {
            thumb = await lfCrop(img, b); // miniatúra len samotného produktu
          } catch (e) {
            return; // ostane výrez okolia
          }
          if (added || !document.body.contains(name)) return;
          // Náhľad = presne to, čo sa uloží: produkt na celú plochu, orámovaný
          const pv = root.querySelector('.lf-pv');
          pv.querySelector('img').src = thumb;
          root.querySelector('#lfBox').classList.add('hidden');
          pv.classList.add('found');
        };
        live.pending.then(finish, (err) => {
          if (!isLoginRequired(err)) toast(errorMessage(err), true);
          finish(null);
        });
      }
      const submit = async () => {
        addBtn.disabled = true;
        const storeName = lfStoreName(lf.store);
        const text = name.value.trim() || 'Z letáka ' + storeName + ' (str. ' + pageNo + ')';
        const qty = root.querySelector('#lfQty').value;
        let taskId = root.querySelector('#lfTarget').value;
        try {
          if (taskId === NEW_SHOPPING) {
            const c = await api('addCinnost', state.detail.household.id, {
              priestorId: '',
              name: 'Nákup ' + storeName,
              description: '',
              assignedTo: state.email,
              dueDate: todayYmd(),
              periodicity: 'none',
              repeatInterval: 1,
              icon: 'shopping',
              color: COLORS['Zelená'],
              kind: 'nakup',
              store: storeName,
              items: [],
            });
            state.detail.cinnosti.push(c);
            rememberLocally(c);
            taskId = c.id;
          }
          const item = await api('addItem', taskId, text, qty, thumb, root.querySelector('#lfPrice').value);
          const c = state.detail.cinnosti.find((x) => x.id === taskId);
          if (c) {
            c.items = (c.items || []).concat([item]);
            rememberLocally({ items: name.value.trim() ? [item] : [] });
            toast('Pridané do „' + c.name + '“');
          }
          lf.target = taskId;
          added = true;
          mark.ok = true;
          if (product) product.added = true;
          saveSnapshot();
          closeModal(true);
        } catch (err) {
          addBtn.disabled = false;
          showError(err);
        }
      };
      addBtn.onclick = submit;
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      });
    },
    {
      focus: false,
      onClose: () => {
        if (!added) {
          const list = lf.marks[key] || [];
          if (list.includes(mark)) list.splice(list.indexOf(mark), 1);
        }
        lfDrawMarks();
      },
    }
  );
}

// ---- Miniatúra položky na celú obrazovku -------------------------------------------

function showImagePreview(src) {
  const el = document.createElement('div');
  el.className = 'img-preview';
  el.innerHTML = '<img src="' + esc(src) + '" alt="">';
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}
