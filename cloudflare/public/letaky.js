// Letáky Lidl v Gazde: prehliadanie strán, krúžkovanie tovaru prstom a pridanie
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
  products: {}, // rozpoznané produkty: "slug#strana" -> [{ name, price, box, added }] | 'loading' | { error }
};

const THUMB_MAX = 360; // najdlhšia strana miniatúry v px
const MAX_THUMB_BYTES = 150000;

/** Otvorí letáky; opts.taskId = nákup, do ktorého sa majú pridávať položky. */
async function openLeaflets(opts) {
  lf.target = (opts && opts.taskId) || lf.target;
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
  lfFrame('Letáky Lidl', '', '<div class="center muted">Načítavam letáky…</div>', '');
  try {
    lf.list = await api('getLeaflets');
  } catch (err) {
    closeLeaflets();
    showError(err);
    return;
  }
  if (lf.list.length === 1) openFlyer(lf.list[0].slug);
  else lfRenderList();
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
  if (lf.mode === 'page') lfRenderStrip();
  else if (lf.mode === 'strip' && lf.list.length > 1) lfRenderList();
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

function lfRenderList() {
  lf.mode = 'list';
  const cards = lf.list
    .map(
      (f) =>
        '<button class="lf-card" data-slug="' + esc(f.slug) + '"><img src="' + esc(f.thumb) + '" alt="" loading="lazy">' +
        '<div><b>' + esc(f.title || f.name) + '</b><small>' + esc(lfValidity(f)) + ' · ' + f.pageCount + ' strán</small></div></button>'
    )
    .join('');
  lfFrame('Letáky Lidl', 'Vyber leták', '<div class="lf-list">' + cards + '</div>', '');
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
  lfRenderStrip();
}

// ---- Listovanie (strany vedľa seba, prstom do strán) ---------------------------

function lfRenderStrip() {
  lf.mode = 'strip';
  const f = lf.flyer;
  const pages = f.pages
    .map((p, i) => '<div class="lf-page" data-i="' + i + '"><img alt="Strana ' + p.n + '" draggable="false"></div>')
    .join('');
  lfFrame(
    f.title || 'Leták Lidl',
    lfValidity(f),
    '<div class="lf-strip" id="lfStrip">' + pages + '</div>',
    '<button class="icon-btn" id="lfPrev" title="Predchádzajúca"><span class="ms">chevron_left</span></button>' +
      '<span class="lf-count" id="lfCount"></span>' +
      '<button class="icon-btn" id="lfNext" title="Ďalšia"><span class="ms">chevron_right</span></button>' +
      '<button class="btn" id="lfCircle"><span class="ms">add_shopping_cart</span>Vybrať tovar</button>'
  );
  const strip = $('lfStrip');
  const go = (i) => strip.scrollTo({ left: i * strip.clientWidth, behavior: 'smooth' });
  $('lfPrev').onclick = () => go(Math.max(0, lf.page - 1));
  $('lfNext').onclick = () => go(Math.min(f.pages.length - 1, lf.page + 1));
  $('lfCircle').onclick = () => lfOpenPage(true);
  strip.querySelectorAll('.lf-page').forEach((el) => {
    el.onclick = () => lfOpenPage(false);
  });
  let ticking = false;
  strip.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
      if (i !== lf.page) {
        lf.page = Math.max(0, Math.min(f.pages.length - 1, i));
        lfStripUpdate();
      }
    });
  });
  strip.scrollLeft = lf.page * strip.clientWidth;
  lfStripUpdate();
}

let lfDwell = null;

/** Načíta obrázky len okolo aktuálnej strany (leták má aj 100 strán). */
function lfStripUpdate() {
  const f = lf.flyer;
  // Keď človek na strane chvíľu ostane, produkty sa začnú hľadať už teraz (pri listovaní nie).
  clearTimeout(lfDwell);
  const index = lf.page;
  lfDwell = setTimeout(() => lf.mode === 'strip' && lf.page === index && lfFetchProducts(index), 1200);
  $('lfCount').textContent = lf.page + 1 + ' / ' + f.pages.length;
  $('lfPrev').disabled = lf.page === 0;
  $('lfNext').disabled = lf.page === f.pages.length - 1;
  for (let i = lf.page - 1; i <= lf.page + 2; i++) {
    const img = lf.root.querySelector('.lf-page[data-i="' + i + '"] img');
    if (img && !img.src) img.src = f.pages[i].image;
  }
}

// ---- Jedna strana: priblíženie a krúžkovanie --------------------------------------

function lfOpenPage(draw) {
  lf.mode = 'page';
  lf.draw = draw;
  lf.zoom = draw ? 1 : 2;
  const f = lf.flyer;
  const p = f.pages[lf.page];
  lfFrame(
    f.title || 'Leták Lidl',
    'Strana ' + p.n + ' / ' + f.pages.length,
    '<div class="lf-scroll" id="lfScroll"><div class="lf-wrap" id="lfWrap">' +
      '<img id="lfImg" alt="" draggable="false"><canvas id="lfCanvas"></canvas><div class="lf-hot" id="lfHot"></div></div></div>' +
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
  const step = (d) => {
    lf.page = Math.max(0, Math.min(f.pages.length - 1, lf.page + d));
    lfOpenPage(lf.draw);
  };
  $('lfPrev').disabled = lf.page === 0;
  $('lfNext').disabled = lf.page === f.pages.length - 1;
  $('lfPrev').onclick = () => step(-1);
  $('lfNext').onclick = () => step(1);
  $('lfZoomIn').onclick = () => lfSetZoom(lf.zoom + 1);
  $('lfZoomOut').onclick = () => lfSetZoom(lf.zoom - 1);
  $('lfMode').onclick = () => {
    lf.draw = !lf.draw;
    lfModeUpdate();
  };
  lfModeUpdate();
  lfBindDrawing();
  lfLayoutPage();
  lfLoadProducts();
}

function lfModeUpdate() {
  const btn = $('lfMode');
  btn.innerHTML = lf.draw ? '<span class="ms">pan_tool</span>Posúvať' : '<span class="ms">gesture</span>Krúžkovať';
  $('lfWrap').classList.toggle('drawing', lf.draw);
  lfHelpUpdate();
}

/** Nápoveda dole podľa režimu a stavu rozpoznávania produktov. */
function lfHelpUpdate() {
  const help = $('lfHelp');
  if (!help) return;
  const found = lf.products[lfMarkKey()];
  let text;
  if (found === 'loading') text = 'Hľadám produkty na strane… (prvýkrát to trvá pár sekúnd)';
  else if (found && found.error) text = found.error;
  else if (Array.isArray(found) && found.length) text = lf.draw ? 'Ťukni na + pri produkte, alebo tovar zakrúžkuj prstom.' : 'Ťukni na + pri produkte. Posúvaj prstom.';
  else if (Array.isArray(found)) text = 'Produkty sa nenašli – zakrúžkuj tovar prstom.';
  else text = lf.draw ? 'Zakrúžkuj prstom tovar – pridá sa do nákupu aj s obrázkom.' : 'Posúvaj prstom, priblíž tlačidlom +.';
  help.textContent = text;
  help.classList.toggle('loading', found === 'loading');
}

// ---- Rozpoznané produkty: tlačidlo + pri každom ---------------------------------------

const lfPending = {}; // rozbehnuté rozpoznávanie: kľúč strany -> Promise

/** Rozpozná produkty na strane (index) – raz; súbežné volania čakajú na to isté. */
function lfFetchProducts(index) {
  const flyer = lf.flyer;
  if (!flyer || index < 0 || index >= flyer.pages.length) return Promise.resolve();
  const key = flyer.slug + '#' + index;
  if (Array.isArray(lf.products[key])) return Promise.resolve();
  if (!lfPending[key]) {
    lf.products[key] = 'loading';
    lfPending[key] = apiQuiet('analyzeLeafletPage', flyer.slug, index)
      .then((list) => {
        lf.products[key] = list;
      })
      .catch((err) => {
        lf.products[key] = { error: isLoginRequired(err) ? '' : errorMessage(err) };
      })
      .finally(() => {
        delete lfPending[key];
        if (lf.mode === 'page' && lfMarkKey() === key) lfRenderProducts();
      });
  }
  return lfPending[key];
}

/** Strana otvorená na výber tovaru: jej produkty a vopred aj ďalšej strany. */
async function lfLoadProducts() {
  const index = lf.page;
  const loading = lfFetchProducts(index);
  lfRenderProducts();
  await loading;
  lfFetchProducts(index + 1); // kým si človek vyberá, ďalšia strana sa pripraví
}

function lfRenderProducts() {
  const hot = $('lfHot');
  if (!hot) return;
  const list = lf.products[lfMarkKey()];
  hot.innerHTML = Array.isArray(list)
    ? list
        .map((p, i) => {
          const [x1, y1, x2, y2] = p.box;
          return (
            '<button class="lf-plus' + (p.added ? ' added' : '') + '" data-product="' + i + '" style="left:' +
            ((x1 + x2) / 2) * 100 + '%;top:' + ((y1 + y2) / 2) * 100 + '%" title="' + esc(p.name) + '">' +
            '<span class="ms">' + (p.added ? 'check' : 'add') + '</span></button>'
          );
        })
        .join('')
    : '';
  hot.querySelectorAll('[data-product]').forEach((b) => {
    b.onpointerdown = (e) => e.stopPropagation(); // nezačne krúžok
    b.onclick = (e) => {
      e.stopPropagation();
      lfPickProduct(list[Number(b.dataset.product)]);
    };
  });
  lfHelpUpdate();
}

/** Ťuknutie na + : označí celý produkt a ponúkne ho pridať s názvom a cenou. */
async function lfPickProduct(product) {
  const [x1, y1, x2, y2] = product.box;
  const pad = 0.006;
  const b = { x: Math.max(0, x1 - pad), y: Math.max(0, y1 - pad), x2: Math.min(1, x2 + pad), y2: Math.min(1, y2 + pad) };
  const mark = { pts: [[b.x, b.y], [b.x2, b.y], [b.x2, b.y2], [b.x, b.y2], [b.x, b.y]], ok: false };
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
  lfConfirm(thumb, mark, key, product);
}

function lfSetZoom(z) {
  const scroll = $('lfScroll');
  const z2 = Math.max(1, Math.min(4, z));
  if (z2 === lf.zoom) return;
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
  canvas.addEventListener('pointercancel', () => {
    pts = null;
    lfDrawMarks();
  });
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
  // Ťuknutie alebo čiarka – nie krúžok.
  if ((b.x2 - b.x) * wrap.clientWidth < 24 || (b.y2 - b.y) * wrap.clientHeight < 24) {
    lfDrawMarks();
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
async function lfCrop(img, b) {
  await lfWhenLoaded(img);
  const sx = b.x * img.naturalWidth;
  const sy = b.y * img.naturalHeight;
  const sw = (b.x2 - b.x) * img.naturalWidth;
  const sh = (b.y2 - b.y) * img.naturalHeight;
  for (const [max, quality] of [[THUMB_MAX, 0.82], [THUMB_MAX, 0.65], [240, 0.6], [160, 0.55]]) {
    const scale = Math.min(1, max / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.length <= MAX_THUMB_BYTES) return data;
  }
  throw new Error('Miniatúra je príliš veľká.');
}

// ---- Pridanie do nákupu ---------------------------------------------------------

const NEW_SHOPPING = '__new__';

/** Nákupy domácnosti – najprv tie do Lidla. */
function lfShoppingTasks() {
  const isLidl = (c) => normalizeText(c.store || '').includes('lidl');
  return state.detail.cinnosti
    .filter((c) => c.kind === 'nakup' && !c.pending)
    .sort((a, b) => Number(isLidl(b)) - Number(isLidl(a)) || a.dueDate.localeCompare(b.dueDate));
}

/** Cena „2.49“ → „2,49“ (do poľa) */
const priceInput = (p) => (p ? String(p).replace('.', ',') : '');

function lfConfirm(thumb, mark, key, product) {
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
    '<option value="' + NEW_SHOPPING + '"' + (target === NEW_SHOPPING ? ' selected' : '') + '>+ Nový nákup v Lidli</option>';
  const pageNo = lf.flyer.pages[lf.page].n;
  let added = false;

  openModal(
    '<h2>Pridať do nákupu</h2>' +
      '<div class="lf-preview"><img src="' + thumb + '" alt=""></div>' +
      '<div class="field"><label>Názov</label><input id="lfName" maxlength="100" autocomplete="off" placeholder="Napr. mascarpone (nepovinné)" value="' +
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
      const submit = async () => {
        addBtn.disabled = true;
        const text = name.value.trim() || 'Z letáka Lidl (str. ' + pageNo + ')';
        const qty = root.querySelector('#lfQty').value;
        let taskId = root.querySelector('#lfTarget').value;
        try {
          if (taskId === NEW_SHOPPING) {
            const c = await api('addCinnost', state.detail.household.id, {
              priestorId: '',
              name: 'Nákup Lidl',
              description: '',
              assignedTo: state.email,
              dueDate: todayYmd(),
              periodicity: 'none',
              repeatInterval: 1,
              icon: 'shopping',
              color: COLORS['Zelená'],
              kind: 'nakup',
              store: 'Lidl',
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
        lfRenderProducts();
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
