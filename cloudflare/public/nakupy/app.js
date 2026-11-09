// Nákupy – nákupné zoznamy rodiny, podaplikácia Family Grid (predtým časť Gazdy).
//
// Nákupný zoznam je na serveri činnosť s kind = 'nakup' (tabuľky cinnosti, polozky, historia),
// preto sú funkcie servera spoločné s Gazdou (createShoppingList, addItem, toggleItem,
// setItemMissing, startShopping, completeCinnost…). Nákupy načítajú len nákupy zvolenej
// rodiny (nakupy/getData) a len históriu nákupov; Gazde ostali domáce práce.
//
// Skript nie je zabalený vo funkcii: letáky (letaky.js) používajú jeho funkcie a stav
// (state, api, openModal, showTaskDetail, renderDetail…).

// -------------------------------------------------------------------------
// Konštanty a stav
// -------------------------------------------------------------------------

const COLORS = { 'Zelená': '#4CAF50' };

const PERIODICITY = {
  none: { label: 'Bez opakovania' },
  weekly: { label: 'Týždenne', unit: 'týždňov', hint: 'Napr. 2 = každé 2 týždne' },
  monthly: { label: 'Mesačne', unit: 'mesiacov', hint: 'Napr. 3 = každé 3 mesiace' },
  annually: { label: 'Ročne', unit: 'rokov', hint: 'Napr. 2 = každé 2 roky' },
};

const WEEKDAYS_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
const WEEKDAYS = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];

/** assignedTo spoločného nákupu – patrí všetkým členom rodiny. */
const ALL = '*';

const state = {
  email: '',
  nickname: '',
  hh: null, // id zvolenej rodiny
  detail: null, // { householdId, rev, household, members, cinnosti (nákupy), stores, products }
  tab: 'zoznamy', // zoznamy | historia
  history: null,
  openTask: null, // otvorený detail nákupu (nákup naživo)
};

const { $, esc, toast, showError, errorMessage, isLoginRequired } = FG;

// -------------------------------------------------------------------------
// Server: volania cez Family Grid + počítadlá (obnova na pozadí neprepíše rozpracované zmeny)
// -------------------------------------------------------------------------

const READ_ONLY = new Set(['nakupy/getData', 'getRev', 'getHistory', 'getLeaflets', 'getLeaflet', 'getOffers', 'getComments']);
let pending = 0;
let mutations = 0;

function track(fn, promise) {
  pending++;
  if (!READ_ONLY.has(fn)) mutations++;
  return promise.finally(() => pending--);
}

function api(fn, ...args) {
  return track(fn, FG.api(fn, ...args));
}

function apiQuiet(fn, ...args) {
  return track(fn, FG.apiQuiet(fn, ...args));
}

// -------------------------------------------------------------------------
// Posledné údaje v telefóne – Nákupy sa otvoria hneď (aj bez internetu v obchode)
// -------------------------------------------------------------------------

const snapKey = () => 'nakupy.snap.' + state.hh;

function saveSnapshot() {
  if (!state.detail) return;
  try {
    // neuložené (práve ukladané) nákupy do pamäte telefónu nedávaj
    const detail = { ...state.detail, cinnosti: state.detail.cinnosti.filter((c) => !c.pending) };
    localStorage.setItem(snapKey(), JSON.stringify(detail));
  } catch (e) {
    // plné alebo nedostupné úložisko – Nákupy fungujú aj bez neho
  }
}

function readSnapshot() {
  const snap = FG.readJson(snapKey());
  return snap && snap.householdId === state.hh && Array.isArray(snap.cinnosti) ? snap : null;
}

/** Smie sa obrazovka prekresliť čerstvými údajmi? (nie keď je otvorené okno) */
function canRefreshView() {
  return !FG.modalOpen();
}

// -------------------------------------------------------------------------
// Okná (z Family Grid) – pri písaní na mobile pole nad klávesnicou
// -------------------------------------------------------------------------

function openModal(html, onMount, opts) {
  state.openTask = null;
  FG.openModal(html, onMount, opts);
}

function closeModal(force) {
  FG.closeModal(force);
  if (!FG.modalOpen()) $('modal').classList.remove('typing');
}

// -------------------------------------------------------------------------
// Pomocné funkcie
// -------------------------------------------------------------------------

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayYmd() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

function ymd(y, m, d) {
  return y + '-' + pad(m) + '-' + pad(d);
}

function weekday(s) {
  const p = parseYmd(s);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

function formatDate(s) {
  if (!s) return 'bez termínu';
  const p = parseYmd(s);
  return p.d + '. ' + p.m + '. ' + p.y;
}

function formatDateShort(s) {
  if (!s) return 'bez termínu';
  const p = parseYmd(s);
  return WEEKDAYS_SHORT[weekday(s)].toLowerCase() + ' ' + p.d + '. ' + p.m + '.';
}

function formatDateLong(s) {
  return WEEKDAYS[weekday(s)] + ', ' + formatDate(s);
}

/** Nákup, ktorý mám riešiť ja: pridelený mne alebo spoločný. */
function isMine(c) {
  return c.assignedTo === state.email || c.assignedTo === ALL;
}

function assigneeIcon(email) {
  return email === ALL ? 'group' : email ? 'person' : 'person_off';
}

/** Čas komentára: dnes len hodiny, inak deň. */
function commentTime(iso) {
  const d = new Date(iso);
  const time = pad(d.getHours()) + ':' + pad(d.getMinutes());
  const day = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return day === todayYmd() ? time : formatDateShort(day) + ' ' + time;
}

/** Ako sa človek zobrazuje: prezývka, kým ju nemá, tak časť e-mailu pred @. */
function shortName(email) {
  if (!email) return 'Nepriradené';
  if (email === ALL) return 'Všetci';
  return nicknameOf(email) || email.split('@')[0];
}

function nicknameOf(email) {
  if (email === state.email && state.nickname) return state.nickname;
  const lists = [(state.detail && state.detail.members) || []].concat(FG.state.households.map((h) => h.members || []));
  for (const list of lists) {
    const m = list.find((x) => x.email === email && x.nickname);
    if (m) return m.nickname;
  }
  return '';
}

function periodicityLabel(c) {
  const p = PERIODICITY[c.periodicity] || PERIODICITY.none;
  if (c.periodicity === 'none') return p.label;
  const n = c.repeatInterval || 1;
  return n === 1 ? p.label : p.label + ' (každých ' + n + ' ' + p.unit + ')';
}

// -------------------------------------------------------------------------
// Načítanie a obrazovka so zoznamami
// -------------------------------------------------------------------------

let lastRev = { id: '', rev: -1 };

async function load(quiet) {
  const id = state.hh;
  if (!id) return;
  const fresh = await (quiet ? apiQuiet : api)('nakupy/getData', id);
  if (fresh.householdId !== state.hh) return; // medzičasom iná rodina
  state.detail = fresh;
  lastRev = { id, rev: fresh.rev };
}

function setTabs(show) {
  $('tabs').classList.toggle('hidden', !show);
  document.body.classList.toggle('with-tabs', show);
  document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === state.tab));
}

/** Prekreslí Nákupy (opts.quiet = po uložení, bez animácie kariet). Letáky ju volajú ako renderDetail. */
function render(opts) {
  $('title').textContent = 'Nákupy';
  if (!state.hh) {
    setTabs(false);
    $('view').innerHTML = FG.emptyFamilyHtml('Nákupné zoznamy');
    FG.bindEmptyFamily(() => start());
    return;
  }
  if (!state.detail) {
    setTabs(false);
    $('view').innerHTML = '<div class="center muted">Načítavam…</div>';
    return;
  }
  saveSnapshot();
  setTabs(true);
  $('view').innerHTML = FG.householdPickerHtml() + (state.tab === 'historia' ? renderHistoria() : renderLists());
  FG.bindHouseholdPicker((id) => switchFamily(id));
  // Tiché prekreslenie (po uložení) bez animácie kariet, aby nepreblikli.
  $('view').classList.toggle('no-anim', Boolean(opts && opts.quiet));
  bindViewEvents();
  if (shop.id) renderShoppingMode();
  runLaunchAction();
}

const renderDetail = render;

function switchFamily(id) {
  if (!id || id === state.hh) return;
  closeShoppingMode();
  state.hh = id;
  state.detail = readSnapshot();
  state.history = null;
  shopResumeChecked = false;
  render();
  load(Boolean(state.detail))
    .then(() => canRefreshView() && render({ quiet: true }))
    .catch(showError);
}

/** Poradie: kto práve nakupuje, potom zoznamy na teraz (spoločné prvé), potom podľa termínu. */
function listOrder(a, b) {
  const today = todayYmd();
  const later = (c) => Boolean(c.dueDate && c.dueDate > today);
  return (
    Number(Boolean(b.shoppingBy)) - Number(Boolean(a.shoppingBy)) ||
    Number(later(a)) - Number(later(b)) ||
    (a.dueDate || '').localeCompare(b.dueDate || '') ||
    Number(b.assignedTo === ALL) - Number(a.assignedTo === ALL) ||
    Number(isMine(b)) - Number(isMine(a)) ||
    a.name.localeCompare(b.name, 'sk')
  );
}

function renderLists() {
  const today = todayYmd();
  const lists = state.detail.cinnosti.slice().sort(listOrder);
  const now = lists.filter((c) => c.shoppingBy || !c.dueDate || c.dueDate <= today);
  const later = lists.filter((c) => !now.includes(c));
  let html = '';
  if (!lists.length) {
    html +=
      '<div class="empty"><span class="ms">shopping_cart</span><h2>Žiadne nákupy</h2>' +
      '<div>Ťukni na <b>Nákupný zoznam</b> – vznikne spoločný zoznam pre celú rodinu a ostatní dostanú upozornenie. ' +
      'Tovar sa dá vybrať aj z letákov obchodov.</div></div>';
  }
  if (now.length) html += now.map((c) => taskCard(c)).join('');
  if (later.length) {
    html +=
      '<div class="section-gap"></div><div class="section-title"><span class="ms">event</span>Naplánované (' + later.length + ')</div>' +
      later.map((c) => taskCard(c)).join('');
  }
  // vpravo dole: letáky, nový nákup (s obchodom, termínom…) a hlavné tlačidlo – spoločný nákupný zoznam
  html +=
    '<div class="fab-bar">' +
    '<button class="btn fab-icon" id="leafletsBtn" title="Letáky obchodov" aria-label="Letáky obchodov"><span class="ms">newspaper</span></button>' +
    '<button class="btn fab-icon" id="addShopBtn" title="Nový nákup (obchod, termín…)" aria-label="Nový nákup"><span class="ms">add</span></button>' +
    '<button class="btn" id="newShopBtn"><span class="ms">add_shopping_cart</span>Nákupný zoznam</button></div>';
  return html;
}

function bindViewEvents() {
  const view = $('view');
  if ($('historyMore')) $('historyMore').onclick = () => loadHistory(true);
  view.querySelectorAll('[data-again]').forEach((el) => {
    el.onclick = () => shopAgain(el.dataset.again);
  });
  view.querySelectorAll('[data-restore]').forEach((el) => {
    el.onclick = () => restoreFromHistory(el.dataset.restore);
  });
  view.querySelectorAll('.hist-card [data-preview]').forEach((el) => {
    el.onclick = () => showImagePreview(el.dataset.preview);
  });
  view.querySelectorAll('[data-complete]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      confirmComplete(el.dataset.complete, el);
    };
  });
  view.querySelectorAll('[data-start-shop]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      startShopping(el.dataset.startShop);
    };
  });
  bindCardItems(view);
  view.querySelectorAll('[data-open-task]').forEach((el) => {
    el.onclick = () => showTaskDetail(el.dataset.openTask);
  });
  if ($('newShopBtn')) $('newShopBtn').onclick = newShoppingList;
  if ($('addShopBtn')) $('addShopBtn').onclick = () => showCinnostForm(null);
  if ($('leafletsBtn')) $('leafletsBtn').onclick = () => openLeaflets({});
}

// ---- Odkazy z ikony a z upozornení ------------------------------------------------

// /nakupy/?akcia=nakup – rovno pridávanie do spoločného nákupného zoznamu (skratka ikony)
let launchAction = (() => {
  try {
    const action = new URLSearchParams(location.search).get('akcia');
    if (action) history.replaceState(null, '', location.pathname);
    return action;
  } catch {
    return null;
  }
})();

// /nakupy/?nakup=<id> – ťuknutie na upozornenie o nákupe otvorí rovno ten zoznam
let launchShop = (() => {
  try {
    const id = new URLSearchParams(location.search).get('nakup');
    if (id) history.replaceState(null, '', location.pathname);
    return id;
  } catch {
    return null;
  }
})();

let shopResumeChecked = false;

function runLaunchAction() {
  if (!state.detail || !state.email) return;
  if (!shopResumeChecked) {
    shopResumeChecked = true;
    resumeShopping();
  }
  if (launchShop) {
    const id = launchShop;
    launchShop = null;
    const c = state.detail.cinnosti.find((x) => x.id === id);
    if (c && !shop.id) setTimeout(() => showTaskDetail(id), 300);
  }
  if (!launchAction) return;
  const action = launchAction;
  launchAction = null;
  if (action === 'nakup') setTimeout(newShoppingList, 300);
}

// -------------------------------------------------------------------------
// Nákupný zoznam: vytvorenie jedným ťuknutím a nákup v obchode na celú obrazovku
// -------------------------------------------------------------------------

/** Spoločný nákupný zoznam: vytvorí ho (ostatní dostanú upozornenie) a hneď otvorí na písanie položiek. */
async function newShoppingList() {
  if (!state.detail) return;
  try {
    const c = await api('createShoppingList', state.hh);
    const list = state.detail.cinnosti;
    const index = list.findIndex((x) => x.id === c.id);
    if (index === -1) {
      list.push(c);
      if (state.detail.members.length > 1) toast('Nákupný zoznam je pre všetkých – ostatní dostanú upozornenie');
    } else {
      list[index] = c;
    }
    renderDetail({ quiet: true });
    showTaskDetail(c.id, { focus: true });
  } catch (err) {
    showError(err);
  }
}

const shop = { root: null, id: null, wakeLock: null };

/** Zahájiť nákup: zoznam na celú obrazovku (veľké položky); pri ďalšom otvorení appky sa ukáže sám. */
async function startShopping(id) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  if (!c) return;
  closeModal(true);
  const before = { shoppingBy: c.shoppingBy, shoppingSince: c.shoppingSince };
  c.shoppingBy = state.email;
  openShoppingMode(id);
  try {
    const saved = await api('startShopping', id, true);
    const current = state.detail && state.detail.cinnosti.find((x) => x.id === id);
    if (current) Object.assign(current, { shoppingBy: saved.shoppingBy, shoppingSince: saved.shoppingSince });
    saveSnapshot();
  } catch (err) {
    Object.assign(c, before);
    if (!before.shoppingBy) delete c.shoppingBy;
    closeShoppingMode();
    showError(err);
  }
}

/** Prerušiť nákup: zoznam ostáva tak, ako je (aj odškrtnuté), len sa už neotvára na celú obrazovku. */
async function stopShopping(id) {
  const c = state.detail && state.detail.cinnosti.find((x) => x.id === id);
  closeShoppingMode();
  if (!c) return;
  delete c.shoppingBy;
  delete c.shoppingSince;
  renderDetail({ quiet: true });
  try {
    await api('startShopping', id, false);
    saveSnapshot();
  } catch (err) {
    showError(err);
  }
}

/** Ukončiť nákup: uloží sa do Histórie (čo nemali, ostane pri opakovanom nákupe na budúce). */
async function finishShopping(id, button) {
  button.disabled = true;
  try {
    const res = await api('completeCinnost', id);
    state.history = null;
    const list = state.detail.cinnosti;
    const index = list.findIndex((c) => c.id === id);
    if (res.deleted) {
      if (index !== -1) list.splice(index, 1);
    } else if (index !== -1) {
      list[index] = res.cinnost;
    }
    closeShoppingMode();
    renderDetail();
    toast('Nákup ukončený – uložený v Histórii');
  } catch (err) {
    button.disabled = false;
    showError(err);
  }
}

function openShoppingMode(id) {
  if (!shop.root) {
    shop.root = document.createElement('div');
    shop.root.id = 'shopMode';
    shop.root.className = 'shop-mode hidden';
    document.body.appendChild(shop.root);
  }
  shop.id = id;
  shop.root.innerHTML =
    '<div class="shop-bar"><button class="icon-btn" id="shopHide" title="Skryť – nákup beží ďalej"><span class="ms">arrow_back</span></button>' +
    '<div class="shop-title"><div id="shopName"></div><small id="shopSub"></small></div>' +
    '<button type="button" class="btn text small" id="shopStop"><span class="ms">pause</span>Prerušiť</button></div>' +
    '<div class="shop-progress"><span id="shopBar"></span></div>' +
    '<div class="shop-body" id="shopBody"></div>' +
    '<div class="shop-foot"><div class="field item-add shop-add"><input id="shopInput" maxlength="100" autocomplete="off" placeholder="Ešte niečo pridať…">' +
    '<button type="button" class="btn tonal small" id="shopAdd" title="Pridať"><span class="ms">add</span></button></div>' +
    '<button type="button" class="btn shop-finish" id="shopFinish"></button></div>';
  shop.root.classList.remove('hidden');
  document.body.classList.add('shop-open');
  $('shopHide').onclick = closeShoppingMode;
  $('shopStop').onclick = () => stopShopping(id);
  $('shopFinish').onclick = (e) => {
    const c = state.detail.cinnosti.find((x) => x.id === id);
    const p = c ? itemProgress(c) : { done: 0, total: 0 };
    if (p.total && p.done === p.total) return finishShopping(id, e.currentTarget);
    toast(p.total ? 'Najprv odškrtni zvyšné položky, alebo daj „Nemali“' : 'Zoznam je prázdny');
  };
  const input = $('shopInput');
  const add = async () => {
    const c = state.detail.cinnosti.find((x) => x.id === id);
    const text = input.value.trim();
    if (!c || !text) return;
    input.value = '';
    try {
      const item = await api('addItem', c.id, text, '');
      c.items = [item].concat(c.items || []);
      renderShoppingMode();
      saveSnapshot();
    } catch (err) {
      input.value = text;
      showError(err);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  $('shopAdd').onclick = add;
  $('shopBody').onclick = (e) => {
    const row = e.target.closest('[data-shop-item]');
    const c = state.detail && state.detail.cinnosti.find((x) => x.id === id);
    if (!row || !c) return;
    if (e.target.dataset.preview) return showImagePreview(e.target.dataset.preview);
    if (e.target.closest('[data-miss]')) return toggleMissingItem(c, row.dataset.shopItem, renderShoppingMode);
    toggleChecklistItem(c, row.dataset.shopItem, renderShoppingMode);
  };
  keepScreenOn(true);
  renderShoppingMode();
}

function closeShoppingMode() {
  if (!shop.root || !shop.id) return;
  shop.id = null;
  shop.root.classList.add('hidden');
  shop.root.innerHTML = '';
  document.body.classList.remove('shop-open');
  keepScreenOn(false);
  if (state.detail) renderDetail({ quiet: true });
}

/** Displej v obchode nezhasne (kde to prehliadač vie). */
async function keepScreenOn(on) {
  try {
    if (!on) {
      if (shop.wakeLock) await shop.wakeLock.release();
      shop.wakeLock = null;
    } else if ('wakeLock' in navigator && !shop.wakeLock) {
      shop.wakeLock = await navigator.wakeLock.request('screen');
      shop.wakeLock.addEventListener('release', () => (shop.wakeLock = null));
    }
  } catch (e) {
    shop.wakeLock = null;
  }
}

/** Prekreslí zoznam nákupu (aj po zmenách od ostatných – nákup naživo). */
function renderShoppingMode() {
  if (!shop.id) return;
  const c = state.detail && state.detail.cinnosti.find((x) => x.id === shop.id);
  if (!c) {
    closeShoppingMode();
    toast('Nákup už je ukončený');
    return;
  }
  if (!c.shoppingBy) {
    // prerušil ho niekto iný (alebo na inom zariadení)
    closeShoppingMode();
    return;
  }
  const items = c.items || [];
  const p = itemProgress(c);
  const total = itemsTotal(c);
  $('shopName').textContent = c.name + (c.store ? ' · ' + c.store : '');
  $('shopSub').textContent =
    (p.total ? p.done + ' z ' + p.total + ' vybavených' : 'Zatiaľ žiadne položky') + (total !== null ? ' · zostáva ~' + formatPrice(total) : '') +
    (c.shoppingBy !== state.email ? ' · nakupuje ' + shortName(c.shoppingBy) : '');
  $('shopBar').style.width = (p.total ? Math.round((100 * p.done) / p.total) : 0) + '%';
  const row = (i) =>
    '<button type="button" class="shop-item' + itemClass(i) + '" data-shop-item="' + esc(i.id) + '">' +
    '<span class="ms shop-check">' + itemIcon(i) + '</span>' + thumbHtml(i) +
    '<span class="shop-text">' + esc(i.text) + (i.qty || i.price ? '<small>' + qtyHtml(i) + '</small>' : '') + '</span>' +
    '<span class="shop-miss' + (i.missing ? ' on' : '') + '" data-miss="1" title="' + (i.missing ? 'Zrušiť – predsa mali' : 'Nemali') + '">' +
    '<span class="ms">remove_shopping_cart</span><span>Nemali</span></span></button>';
  const open = items.filter((i) => !i.done && !i.missing);
  const rest = items.filter((i) => i.missing).concat(items.filter((i) => i.done));
  const groups = byDeptMode() ? groupByDept(open) : [['', open]];
  $('shopBody').innerHTML = items.length
    ? groups.map(([d, list]) => (d && groups.length > 1 ? deptHead(d) : '') + list.map(row).join('')).join('') +
      (!open.length ? '<div class="shop-all"><span class="ms">task_alt</span>Všetko vybavené</div>' : '') +
      (rest.length ? deptHead('Vybavené (' + rest.length + ')') + rest.map(row).join('') : '')
    : '<div class="empty compact"><span class="ms">shopping_cart</span><div>Zoznam je prázdny – pridaj dole, čo treba kúpiť.</div></div>';
  const all = p.total > 0 && p.done === p.total;
  const finish = $('shopFinish');
  finish.classList.toggle('ready', all);
  finish.classList.toggle('pulse', all);
  finish.innerHTML = all
    ? '<span class="ms">check</span>Ukončiť nákup'
    : '<span class="ms">shopping_cart</span>' + (p.total ? 'Zostáva ' + (p.total - p.done) + ' z ' + p.total : 'Zoznam je prázdny');
}

/** Prebieha môj nákup? Pri otvorení appky (aj návrate do nej) ma hneď hodí na jeho obrazovku. */
function resumeShopping() {
  if (!state.detail || shop.id || !canRefreshView() || document.body.classList.contains('lf-open')) return;
  const c = state.detail.cinnosti.find((x) => x.kind === 'nakup' && x.shoppingBy === state.email);
  if (c) openShoppingMode(c.id);
}

/** Karta nákupu v zozname: obchod, termín, kto, priebeh a položky priamo v karte. */
function taskCard(c) {
  const tag = (icon, text, cls) =>
    '<span class="tag' + (cls ? ' ' + cls : '') + '"><span class="ms">' + icon + '</span>' + esc(text) + '</span>';
  const today = todayYmd();
  const overdue = Boolean(c.dueDate && c.dueDate < today);
  const info = [];
  if (c.pending) info.push(tag('schedule', 'Ukladá sa…'));
  if (c.shoppingBy) info.push(tag('shopping_cart_checkout', c.shoppingBy === state.email ? 'nakupuješ' : 'nakupuje ' + shortName(c.shoppingBy), 'tag-ok'));
  if (c.store) info.push(tag('storefront', c.store));
  if (c.dueDate) {
    info.push(
      overdue
        ? tag('warning', 'od ' + formatDateShort(c.dueDate), 'tag-danger')
        : tag('calendar_month', c.dueDate === today ? 'dnes' : formatDateShort(c.dueDate))
    );
  }
  const progress = itemProgress(c);
  if (progress.total) {
    info.push(
      '<span class="tag' + (progress.done === progress.total ? ' tag-ok' : '') + '" data-progress="' + esc(c.id) + '">' +
        '<span class="ms">checklist</span><span>' + progress.done + '/' + progress.total + '</span></span>'
    );
  }
  if (c.dueTime) info.push(tag('alarm', c.dueTime));
  if (c.comments) info.push(tag('chat', String(c.comments)));
  info.push(totalTag(c));
  if (c.periodicity !== 'none') info.push(tag('repeat', periodicityLabel(c)));
  // spoločný nákup je bežný – meno len pri nákupe pre niekoho
  if (c.assignedTo !== ALL) info.push(tag(assigneeIcon(c.assignedTo), shortName(c.assignedTo)));

  // všetko vybavené (aj „nemali“) – nákup sa dá dať za hotový aj bez obrazovky nákupu
  const action =
    progress.total && progress.done === progress.total && !c.shoppingBy
      ? '<button class="btn tonal small pulse" data-complete="' + esc(c.id) + '"><span class="ms">check</span>Hotové</button>'
      : '<button class="btn small" data-start-shop="' + esc(c.id) + '"><span class="ms">shopping_cart_checkout</span>' +
        (c.shoppingBy === state.email ? 'Pokračovať' : 'Nakupovať') + '</button>';

  return (
    '<div class="card clickable' + (overdue ? ' overdue' : '') + (progress.total ? ' has-list' : '') +
    (c.pending ? ' pending' : '') +
    '" data-open-task="' + esc(c.id) + '">' +
    '<span class="ms task-icon" style="background:var(--primary-gradient)">shopping_cart</span>' +
    '<div class="card-body"><div class="card-title">' + esc(c.name) + '</div>' +
    (c.description ? '<div class="card-sub">' + esc(c.description) + '</div>' : '') +
    '<div class="meta">' + info.join('') + '</div></div>' +
    action +
    cardChecklist(c) +
    '</div>'
  );
}

const CARD_ITEMS = 12;

/** Odhad sumy nákupu v karte (za ešte nekúpené položky s cenou); bez cien je prázdny. */
function totalTag(c) {
  const total = itemsTotal(c);
  return (
    '<span class="tag tag-price" data-total="' + esc(c.id) + '"' + (total === null ? ' hidden' : '') +
    '><span class="ms">payments</span><span>~' + (total === null ? '' : esc(formatPrice(total))) + '</span></span>'
  );
}

/** Checklist priamo v karte – položky sa dajú odškrtnúť bez otvárania detailu.
 * Položky z letáka (s obrázkom) sú veľké dlaždice vedľa seba (posúvajú sa do strany),
 * ostatné sú pod nimi ako zoznam. */
function cardChecklist(c) {
  const items = c.items || [];
  if (!items.length) return '';
  // vybavené (odškrtnuté, nemali) idú na koniec – nekúpené ostávajú vpredu
  const byState = (list) => list.filter((i) => !i.done && !i.missing).concat(list.filter((i) => i.missing), list.filter((i) => i.done));
  const pictures = byState(items.filter((i) => i.image));
  const plain = byState(items.filter((i) => !i.image));
  const more = plain.length - CARD_ITEMS;
  const tiles = pictures.length
    ? '<div class="card-tiles">' +
      pictures
        .map(
          (i) =>
            '<button type="button" class="tile' + itemClass(i) + '" data-card-item="' + esc(i.id) +
            '" data-task="' + esc(c.id) + '"><span class="ms tile-check">' + itemIcon(i) +
            '</span><span class="tile-zoom" data-preview="' + esc(i.image) + '"><span class="ms">zoom_in</span></span>' +
            '<img src="' + esc(i.image) + '" alt="" loading="lazy">' +
            '<span class="tile-text">' + esc(i.text) + '</span>' +
            '<span class="tile-meta">' + qtyHtml(i) + missHtml(c, i) + '</span></button>'
        )
        .join('') +
      '</div>'
    : '';
  return (
    '<div class="card-checklist">' +
    tiles +
    cardRows(c, plain.slice(0, CARD_ITEMS)) +
    (more > 0 ? '<div class="hint card-more">+ ďalšie ' + more + ' – ťukni na kartu</div>' : '') +
    '</div>'
  );
}

function cardRows(c, list) {
  const row = (i) =>
    '<button type="button" class="check-item compact' + itemClass(i) + '" data-card-item="' + esc(i.id) +
    '" data-task="' + esc(c.id) + '"><span class="ms">' + itemIcon(i) +
    '</span><span class="check-text">' + esc(i.text) + '</span>' + qtyHtml(i) + missHtml(c, i) + '</button>';
  if (c.kind !== 'nakup' || !byDeptMode() || list.length < 2) return list.map(row).join('');
  // nákup: nekúpené podľa oddelení, vybavené na konci
  const open = list.filter((i) => !i.done && !i.missing);
  const rest = list.filter((i) => i.done || i.missing);
  const groups = groupByDept(open);
  return (
    groups.map(([d, items]) => (groups.length > 1 ? deptHead(d) : '') + items.map(row).join('')).join('') +
    rest.map(row).join('')
  );
}

/** Po odškrtnutí z karty aktualizuje karty tej úlohy bez prekreslenia celého zoznamu. */
function refreshTaskCards(c) {
  const p = itemProgress(c);
  const all = p.total > 0 && p.done === p.total;
  const view = $('view');
  view.querySelectorAll('[data-open-task="' + c.id + '"] .card-checklist').forEach((old) => {
    const tiles = old.querySelector('.card-tiles');
    const scroll = tiles ? tiles.scrollLeft : 0;
    const tmp = document.createElement('div');
    tmp.innerHTML = cardChecklist(c);
    const fresh = tmp.firstElementChild;
    old.replaceWith(fresh);
    if (fresh.querySelector('.card-tiles')) fresh.querySelector('.card-tiles').scrollLeft = scroll;
    bindCardItems(fresh);
  });
  view.querySelectorAll('[data-progress="' + c.id + '"]').forEach((el) => {
    el.classList.toggle('tag-ok', all);
    el.lastChild.textContent = p.done + '/' + p.total;
  });
  // všetko vybavené → na karte namiesto „Nakupovať“ tlačidlo „Hotové“ (a naopak)
  const card = view.querySelector('[data-open-task="' + c.id + '"]');
  if (card && canRefreshView() && Boolean(card.querySelector('[data-complete]')) !== (all && !c.shoppingBy)) render({ quiet: true });
  const total = itemsTotal(c);
  view.querySelectorAll('[data-total="' + c.id + '"]').forEach((el) => {
    el.hidden = total === null;
    el.lastChild.textContent = total === null ? '' : '~' + formatPrice(total);
  });
}

/** Odškrtne položku hneď na obrazovke a uloží na pozadí (pri chybe vráti späť). */
async function toggleChecklistItem(c, itemId, refresh) {
  const item = (c.items || []).find((i) => i.id === itemId);
  if (!item) return;
  const before = { done: item.done, missing: item.missing };
  item.done = !item.done;
  delete item.missing;
  refresh();
  const p = itemProgress(c);
  if (p.total && p.done === p.total) toast(shop.id ? 'Všetko vybavené – ťukni Ukončiť nákup' : 'Všetko vybavené – ťukni Hotové');
  try {
    const saved = await api('toggleItem', itemId, item.done);
    item.done = saved.done;
    saveSnapshot();
  } catch (err) {
    Object.assign(item, before);
    refresh();
    showError(err);
  }
}

/** Položka nákupu „nemali“ (alebo zrušenie) – hneď na obrazovke, uloží sa na pozadí. */
async function toggleMissingItem(c, itemId, refresh) {
  const item = (c.items || []).find((i) => i.id === itemId);
  if (!item) return;
  const before = { done: item.done, missing: item.missing };
  const missing = !item.missing;
  item.done = false;
  if (missing) item.missing = true;
  else delete item.missing;
  refresh();
  const p = itemProgress(c);
  if (p.total && p.done === p.total) toast(shop.id ? 'Všetko vybavené – ťukni Ukončiť nákup' : 'Všetko vybavené – ťukni Hotové');
  try {
    await api('setItemMissing', itemId, missing);
    saveSnapshot();
  } catch (err) {
    Object.assign(item, before);
    if (!before.missing) delete item.missing;
    refresh();
    showError(err);
  }
}


function showEditCinnost(id) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  if (c) showCinnostForm(c);
}

/**
 * Formulár nového nákupu, alebo úpravy existujúceho (existing): názov, položky (a leták),
 * komu a kedy (aj bez termínu a opakovane), obchod a popis.
 * opts: { assignedTo, prefill: { name, items, store }, draft (po chybe pri ukladaní) }
 */
function showCinnostForm(existing, opts) {
  const edit = Boolean(existing);
  const draft = opts && opts.draft;
  let v = existing || {
    name: 'Nákup',
    description: '',
    assignedTo: opts && opts.assignedTo !== undefined ? opts.assignedTo : ALL,
    dueDate: '',
    dueTime: '',
    periodicity: 'none',
    repeatInterval: 1,
    color: COLORS['Zelená'],
    store: '',
    items: [],
  };
  if (opts && opts.prefill) {
    const pre = opts.prefill;
    v = { ...v, items: pre.items || [], ...(pre.name && { name: pre.name }), ...(pre.store && { store: pre.store }) };
  }
  if (draft) {
    // Po chybe pri ukladaní: vyplnené údaje, odškrtnutie položiek ostáva z pôvodného nákupu.
    const done = new Map((v.items || []).map((i) => [i.id, i.done]));
    const images = new Map((v.items || []).map((i) => [i.id, i.image]));
    const prices = new Map((v.items || []).map((i) => [i.id, i.price]));
    v = {
      ...v,
      ...draft,
      items: draft.items.map((i) => ({ ...i, done: Boolean(i.id && done.get(i.id)), image: i.id && images.get(i.id), price: i.id && prices.get(i.id) })),
    };
  }
  // Pracovná kópia položiek (formulár mení len texty, počty a poradie, nie odškrtnutie).
  let items = (v.items || []).map((i) => ({ id: i.id, text: i.text, qty: i.qty || '', done: i.done, image: i.image, price: i.price }));
  const members = state.detail.members.map((m) => m.email).sort();
  // Ak je nákup pridelený niekomu, kto už nie je členom, ponecháme ho vo výbere.
  if (v.assignedTo && v.assignedTo !== ALL && !members.includes(v.assignedTo)) members.push(v.assignedTo);
  const chip = (attr, value, icon, label, on) =>
    '<button type="button" class="chip' + (on ? ' active' : '') + '" ' + attr + '="' + esc(value) + '">' +
    (icon ? '<span class="ms">' + icon + '</span>' : '') + esc(label) + '</button>';
  const memberChips =
    chip('data-assign', ALL, 'group', 'Všetci', v.assignedTo === ALL) +
    [state.email].concat(members.filter((e) => e !== state.email))
      .map((e) => chip('data-assign', e, 'person', e === state.email ? shortName(e) + ' (ja)' : shortName(e), e === v.assignedTo))
      .join('') +
    chip('data-assign', '', 'person_off', 'Nikto', !v.assignedTo);
  const periodChips = Object.keys(PERIODICITY)
    .map((k) => chip('data-period', k, '', k === 'none' ? 'Raz' : PERIODICITY[k].label, k === v.periodicity))
    .join('');

  const section = (icon, title, body) =>
    '<section class="fsec"><div class="fsec-title"><span class="ms">' + icon + '</span>' + title + '</div>' + body + '</section>';
  openModal(
    '<form id="f" class="task-form">' +
      // Tlačidlá hore – dole ich na mobile prekrývala klávesnica a obsah.
      '<div class="form-actions">' +
      '<button type="button" class="btn text" id="cancel">Zrušiť</button>' +
      (edit ? '<button type="button" class="icon-btn" id="delete" title="Vymazať nákup"><span class="ms">delete</span></button>' : '') +
      '<button class="btn">' + (edit ? 'Uložiť' : 'Vytvoriť') + '</button></div>' +
      '<div class="form-head"><span class="ms task-icon" style="background:var(--primary-gradient)">shopping_cart</span>' +
      '<div class="form-head-text"><div class="form-kicker">' + (edit ? 'Upraviť nákup' : 'Nový nákup') + '</div>' +
      '<input name="name" class="title-input" maxlength="80" required placeholder="Názov (napr. Veľký nákup)" value="' + esc(v.name) + '"></div></div>' +
      section(
        'checklist',
        'Nakúpiť<span class="fsec-count" id="itemsCount"></span>',
        '<div class="item-add">' + stepperHtml('id="qtyInput"') +
          '<input id="itemInput" maxlength="100" autocomplete="off" placeholder="Pridať produkt…">' +
          '<button type="button" class="btn tonal small" id="itemAdd"><span class="ms">add</span></button></div>' +
          '<div class="suggest hidden" id="itemSuggest"></div>' +
          '<button type="button" class="btn tonal small" id="formLeaflets"><span class="ms">newspaper</span>Leták – vybrať tovar</button>' +
          '<div class="checklist" id="itemList"></div>'
      ) +
      section(
        'event',
        'Kto a kedy',
        '<div class="field"><label>Kto nakúpi</label><input type="hidden" name="assignedTo" value="' + esc(v.assignedTo || '') + '">' +
          '<div class="chips wrap">' + memberChips + '</div></div>' +
          '<label class="switch nodate"><input type="checkbox" name="noDate"' + (v.dueDate ? '' : ' checked') + '>' +
          '<span class="switch-track"></span><span class="ms">event_busy</span>Bez termínu (keď sa bude dať)</label>' +
          '<div class="row" id="dateRow"><div class="field"><label>' + (edit ? 'Ďalší termín' : 'Termín') + '</label><input type="date" name="dueDate" required value="' + esc(v.dueDate || todayYmd()) + '"></div>' +
          '<div class="field field-time"><label>Pripomenúť o</label><input type="time" name="dueTime" value="' + esc(v.dueTime || '') + '"></div></div>' +
          '<div class="field" id="periodField"><label>Opakovanie</label><input type="hidden" name="periodicity" value="' + esc(v.periodicity) + '">' +
          '<div class="chips seg">' + periodChips + '</div>' +
          '<div class="interval hidden" id="intervalField"><span>každých</span>' +
          '<input type="number" name="repeatInterval" min="1" max="99" value="' + esc(v.repeatInterval || 1) + '">' +
          '<span id="intervalLabel"></span></div><div class="hint" id="intervalHint"></div></div>'
      ) +
      section(
        'notes',
        'Podrobnosti',
        '<div class="field"><label>Obchod</label>' +
          '<input name="store" maxlength="60" placeholder="Kde? (napr. Lidl)" autocomplete="off" value="' + esc(v.store || '') + '">' +
          '<div class="suggest hidden" id="storeSuggest"></div>' +
          '<div class="hint">Podľa obchodu sa otvoria jeho letáky.</div></div>' +
          '<div class="field"><label>Popis</label><textarea name="description" rows="2" placeholder="Napr. na oslavu, len v akcii…">' + esc(v.description) + '</textarea></div>'
      ) +
      '</form>',
    (root) => {
      const form = root.querySelector('#f');
      if (edit) root.querySelector('#delete').onclick = () => deleteTask(existing.id);

      const storeInput = form.store;
      const storeSuggest = attachSuggest(storeInput, root.querySelector('#storeSuggest'), storeSources, null, (name) => {
        storeInput.value = name;
        storeSuggest.clear();
        if (/^(nákup|nakúpiť)$/i.test(form.name.value.trim())) form.name.value = 'Nákup ' + name;
      });

      // Položky
      const itemInput = root.querySelector('#itemInput');
      const qtyInput = root.querySelector('#qtyInput');
      const renderItems = () => {
        root.querySelector('#itemsCount').textContent = items.length ? String(items.length) : '';
        root.querySelector('#itemList').innerHTML = items
          .map(
            (i, idx) =>
              '<div class="check-item edit' + (i.done ? ' done' : '') + '"><span class="ms">' +
              (i.done ? 'check_box' : 'check_box_outline_blank') + '</span>' + thumbHtml(i) + '<span class="check-text">' + esc(i.text) +
              '</span>' + stepperHtml('data-qty="' + idx + '"', i.qty) +
              '<button type="button" class="icon-btn small" data-remove="' + idx + '" title="Odstrániť">' +
              '<span class="ms">close</span></button></div>'
          )
          .join('');
        root.querySelectorAll('[data-qty]').forEach((el) => {
          el.oninput = () => (items[Number(el.dataset.qty)].qty = el.value);
        });
        root.querySelectorAll('[data-remove]').forEach((b) => {
          b.onclick = () => {
            items.splice(Number(b.dataset.remove), 1);
            renderItems();
          };
        });
      };
      const addItemText = (raw) => {
        const { text, qty } = splitQty(raw, qtyInput.value);
        if (!text) return;
        const same = items.find((i) => normalizeText(i.text) === normalizeText(text));
        if (same) same.qty = qty || same.qty;
        else items.unshift({ text, qty, done: false });
        rememberProduct(text);
        itemInput.value = '';
        qtyInput.value = '';
        itemSuggest.clear();
        renderItems();
        itemInput.focus();
      };
      const itemSuggest = attachSuggest(itemInput, root.querySelector('#itemSuggest'), productSources,
        () => items.map((i) => i.text), addItemText);
      itemInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addItemText(itemInput.value);
        }
      });
      root.querySelector('#itemAdd').onclick = () => addItemText(itemInput.value);
      attachVoice(itemInput, addItemText);
      renderItems();

      // Kto a kedy
      form.periodicity.onchange = () => {
        const p = PERIODICITY[form.periodicity.value];
        root.querySelector('#intervalField').classList.toggle('hidden', form.periodicity.value === 'none');
        root.querySelector('#intervalLabel').textContent = p.unit || '';
        root.querySelector('#intervalHint').textContent = p.hint || '';
      };
      const pickChip = (attr, input, onPick) => {
        root.querySelectorAll('[' + attr + ']').forEach((b) => {
          b.onclick = () => {
            root.querySelectorAll('[' + attr + ']').forEach((x) => x.classList.toggle('active', x === b));
            input.value = b.getAttribute(attr);
            if (onPick) onPick();
          };
        });
      };
      pickChip('data-assign', form.assignedTo);
      pickChip('data-period', form.periodicity, () => form.periodicity.onchange());
      // bez termínu: dátum, čas ani opakovanie sa nezadávajú
      const applyNoDate = () => {
        const none = form.noDate.checked;
        root.querySelector('#dateRow').classList.toggle('hidden', none);
        root.querySelector('#periodField').classList.toggle('hidden', none);
        form.dueDate.required = !none;
        if (none) {
          form.periodicity.value = 'none';
          root.querySelectorAll('[data-period]').forEach((x) => x.classList.toggle('active', x.dataset.period === 'none'));
        }
        form.periodicity.onchange();
      };
      form.noDate.onchange = applyNoDate;
      applyNoDate();
      root.querySelector('#cancel').onclick = closeModal;
      if (edit) setTimeout(() => document.activeElement && document.activeElement.blur(), 0);

      // Leták: nákup sa uloží a hneď sa otvoria letáky, z ktorých sa tovar pridá do neho.
      let leafletsAfterSave = false;
      root.querySelector('#formLeaflets').onclick = () => {
        leafletsAfterSave = true;
        form.requestSubmit();
      };

      form.onsubmit = async (e) => {
        e.preventDefault();
        const submit = form.querySelector('button:not([type])');
        submit.disabled = true;
        const data = {
          priestorId: '',
          name: form.name.value,
          description: form.description.value,
          assignedTo: form.assignedTo.value,
          dueDate: form.noDate.checked ? '' : form.dueDate.value,
          dueTime: form.noDate.checked ? '' : form.dueTime.value,
          periodicity: form.periodicity.value,
          repeatInterval: form.repeatInterval.value,
          icon: 'shopping',
          color: v.color || COLORS['Zelená'],
          kind: 'nakup',
          store: form.store.value,
          // Text v poli, ktorý ešte nebol pridaný Enterom, tiež pridaj.
          items: items
            .map((i) => ({ id: i.id, text: i.text, qty: i.qty }))
            .concat(itemInput.value.trim() ? [{ text: itemInput.value.trim(), qty: qtyInput.value }] : []),
        };
        // Okno sa zavrie hneď a nákup sa ukáže ako „Ukladá sa…“; server beží na pozadí.
        const list = state.detail.cinnosti;
        const previous = edit ? list.find((x) => x.id === existing.id) : null;
        const optimistic = optimisticTask(data, previous);
        if (previous) list[list.indexOf(previous)] = optimistic;
        else list.push(optimistic);
        rememberLocally(optimistic);
        closeModal();
        render();
        try {
          const c = edit ? await api('updateCinnost', existing.id, data) : await api('addCinnost', state.hh, data);
          const index = state.detail.cinnosti.indexOf(optimistic);
          if (index !== -1) state.detail.cinnosti[index] = c;
          rememberLocally(c);
          render({ quiet: true });
          toast(edit ? 'Zmeny uložené' : 'Nákup „' + c.name + '“ bol vytvorený');
          if (leafletsAfterSave) openLeaflets({ taskId: c.id, store: c.store });
          // nový nákup bez položiek: ponúkni letáky
          else if (!edit && !c.items.length) offerLeaflets(c);
        } catch (err) {
          const index = state.detail.cinnosti.indexOf(optimistic);
          if (index !== -1) {
            if (previous) state.detail.cinnosti[index] = previous;
            else state.detail.cinnosti.splice(index, 1);
          }
          render({ quiet: true });
          showError(err);
          // Formulár znova otvor s tým, čo bolo vyplnené, nech sa nič nestratí.
          showCinnostForm(previous, { draft: data });
        }
      };
    },
    { focus: edit ? false : '#itemInput' }
  );
}

// -------------------------------------------------------------------------
// História nákupov
// -------------------------------------------------------------------------

/** Obsah karty História (z pamäte; pri prvom otvorení sa načíta zo servera). */
function renderHistoria() {
  const id = state.hh;
  const h = state.history;
  if (!h || h.householdId !== id) {
    if (!h || !h.loading) setTimeout(() => loadHistory(false), 0);
    return '<div class="center muted">Načítavam históriu…</div>';
  }
  if (!h.entries.length) {
    return (
      '<div class="empty"><span class="ms">history</span><h2>História nákupov</h2>' +
      '<div>Keď ukončíš nákup, uloží sa sem – čo sa kúpilo, za koľko a čo nemali. Odtiaľ sa dá nakúpiť znova.</div></div>'
    );
  }
  let html = '';
  let day = '';
  h.entries.forEach((e) => {
    const d = new Date(e.completedAt);
    const ymdLocal = ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (ymdLocal !== day) {
      day = ymdLocal;
      html += '<div class="section-title">' + formatDateLong(day) + '</div>';
    }
    html += historyCard(e, d);
  });
  if (h.more) html += '<div class="center"><button class="btn tonal" id="historyMore">Načítať staršie</button></div>';
  return html;
}

function historyCard(e, d) {
  const tag = (icon, text, cls) =>
    '<span class="tag' + (cls ? ' ' + cls : '') + '"><span class="ms">' + icon + '</span>' + esc(text) + '</span>';
  const info = [tag('person', shortName(e.completedBy) + ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()))];
  if (e.store) info.push(tag('storefront', e.store));
  const bought = e.items.filter((i) => i.state === 'done');
  const total = itemsTotal({ items: bought });
  if (total !== null) info.push(tag('payments', '~' + formatPrice(total), 'tag-ok'));
  const missing = e.items.filter((i) => i.state === 'missing').length;
  if (missing) info.push(tag('remove_shopping_cart', 'nemali ' + missing, 'tag-warn'));

  const stateIcon = (i) => (i.state === 'done' ? 'check' : i.state === 'missing' ? 'remove_shopping_cart' : 'check_box_outline_blank');
  const stateClass = (i) => ' st-' + i.state;
  const pictures = e.items.filter((i) => i.image);
  const plain = e.items.filter((i) => !i.image);
  const tiles = pictures.length
    ? '<div class="card-tiles">' +
      pictures
        .map(
          (i) =>
            '<div class="tile' + stateClass(i) + '" data-preview="' + esc(i.image) + '"><span class="ms tile-check">' + stateIcon(i) +
            '</span><img src="' + esc(i.image) + '" alt="" loading="lazy"><span class="tile-text">' + esc(i.text) +
            '</span><span class="tile-meta">' + qtyHtml(i) + (i.state === 'missing' ? '<span class="miss-btn on"><span>nemali</span></span>' : '') +
            '</span></div>'
        )
        .join('') +
      '</div>'
    : '';
  const rows = plain
    .map(
      (i) =>
        '<div class="hist-row' + stateClass(i) + '"><span class="ms">' + stateIcon(i) + '</span><span class="check-text">' + esc(i.text) +
        '</span>' + qtyHtml(i) + (i.state === 'missing' ? '<span class="miss-btn on"><span>nemali</span></span>' : '') + '</div>'
    )
    .join('');
  return (
    '<div class="card hist-card' + (e.items.length ? ' has-list' : '') + '">' +
    '<span class="ms task-icon" style="background:var(--primary-gradient)">shopping_cart</span>' +
    '<div class="card-body"><div class="card-title">' + esc(e.name) + '</div><div class="meta">' + info.join('') + '</div></div>' +
    '<div class="hist-actions">' +
    (e.items.length
      ? '<button class="btn tonal small" data-again="' + esc(e.id) + '" title="Nový nákup s tými istými položkami"><span class="ms">replay</span>Znova</button>'
      : '') +
    '<button class="btn text small" data-restore="' + esc(e.id) + '" title="Vrátiť medzi nákupy"><span class="ms">undo</span>Vrátiť</button></div>' +
    (e.items.length ? '<div class="card-checklist">' + tiles + rows + '</div>' : '') +
    '</div>'
  );
}

/** Načíta históriu (more = ďalšia, staršia stránka). */
async function loadHistory(more) {
  const id = state.hh;
  if (!id) return;
  const h = state.history && state.history.householdId === id ? state.history : null;
  if (!more) state.history = { householdId: '', loading: true };
  try {
    const before = more && h && h.entries.length ? h.entries[h.entries.length - 1].completedAt : '';
    const res = await (more ? api : apiQuiet)('getHistory', id, before, 'nakup');
    if (state.hh !== id) return;
    state.history = { householdId: id, entries: (more && h ? h.entries : []).concat(res.entries), more: res.more };
  } catch (err) {
    if (!more) state.history = { householdId: id, entries: [], more: false };
    if (!isLoginRequired(err)) showError(err);
  }
  if (state.tab === 'historia') renderDetail({ quiet: true });
}

/** Ťuknutie na položku v karte: odškrtnúť, „nemali“, alebo zväčšiť obrázok. */
function bindCardItems(scope) {
  scope.querySelectorAll('[data-card-item]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const zoom = e.target.closest('[data-preview]');
      if (zoom) return showImagePreview(zoom.dataset.preview);
      const c = state.detail.cinnosti.find((x) => x.id === el.dataset.task);
      if (!c) return;
      if (e.target.closest('[data-miss]')) return toggleMissingItem(c, el.dataset.cardItem, () => refreshTaskCards(c));
      toggleChecklistItem(c, el.dataset.cardItem, () => refreshTaskCards(c));
    };
  });
}

/** Potvrdenie pred „Hotové“ – omylom ťuknuté tlačidlo nič nedokončí. */
function confirmComplete(id, button) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  if (!c) return;
  const open = (c.items || []).filter((i) => !i.done && !i.missing).length;
  const notes = [];
  if (open) {
    notes.push(
      '<span class="ms">warning</span>' + open + (open === 1 ? ' položka nie je odškrtnutá' : open < 5 ? ' položky nie sú odškrtnuté' : ' položiek nie je odškrtnutých') +
        (c.periodicity !== 'none' ? ' – ostanú na budúci nákup.' : '.')
    );
  }
  notes.push(
    c.periodicity !== 'none'
      ? '<span class="ms">repeat</span>Opakuje sa – posunie sa na ďalší termín (kúpené zmizne, čo nemali, ostane).'
      : '<span class="ms">history</span>Uloží sa do Histórie (odtiaľ sa dá vrátiť alebo nakúpiť znova).'
  );
  openModal(
    '<h2>Nákup je hotový?</h2><div class="subtitle">„' + esc(c.name) + '“</div>' +
      '<div class="confirm-notes">' + notes.map((n) => '<div>' + n + '</div>').join('') + '</div>' +
      '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button>' +
      '<button type="button" class="btn" id="ok"><span class="ms">check</span>Hotové</button></div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#ok').onclick = () => {
        closeModal(true);
        completeTask(id, button);
      };
    },
    { focus: false }
  );
}

async function completeTask(id, button) {
  button.disabled = true;
  try {
    const res = await api('completeCinnost', id);
    state.history = null; // v histórii pribudol záznam
    const list = state.detail.cinnosti;
    const index = list.findIndex((c) => c.id === id);
    if (res.deleted) {
      if (index !== -1) list.splice(index, 1);
      toast('Hotovo – uložené v Histórii');
    } else {
      if (index !== -1) list[index] = res.cinnost;
      toast('Hotovo – ďalší termín ' + formatDate(res.cinnost.dueDate));
    }
    renderDetail();
  } catch (err) {
    button.disabled = false;
    showError(err);
  }
}

// ---- Akcie a porovnanie cien (Kimbino) ---------------------------------------

const offersCache = new Map(); // výraz → { data } alebo { loading: Promise }

function offerKey(text) {
  return normalizeText(text).replace(/\d+([.,]\d+)?\s*(%|ks|kg|g|l|ml|bal\.?|x)?/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Najlacnejšia akcia, ktorá naozaj zodpovedá položke (hlavné slovo v názve ponuky). */
function bestOffer(text, offers) {
  const word = normalizeText(text).split(/[^a-z0-9]+/).find((w) => w.length >= 3);
  if (!word) return null;
  const stem = word.slice(0, Math.max(3, word.length - 2));
  return (offers || []).find((o) => normalizeText(o.name).includes(stem)) || null;
}

function offerLineHtml(i) {
  const hit = offersCache.get(offerKey(i.text));
  const o = hit && hit.data && bestOffer(i.text, hit.data.offers);
  if (!o) return '';
  return (
    '<span class="offer-line" data-offer="1"><span class="ms">sell</span>' + esc(o.store) + ' ' + esc(formatPrice(o.price)) +
    (hit.data.offers.length > 1 ? ' · +' + (hit.data.offers.length - 1) + ' ďalšie' : '') + '</span>'
  );
}

/** Akcie pre položky (najviac 15 naraz; výsledky si appka pamätá) – potom prekreslí zoznam. */
function loadOffersFor(items, rerender) {
  const missing = items.map((i) => offerKey(i.text)).filter((k) => k && !offersCache.has(k)).slice(0, 15);
  if (!missing.length) return;
  const jobs = missing.map((k) => {
    const job = apiQuiet('getOffers', k)
      .then((data) => offersCache.set(k, { data }))
      .catch(() => offersCache.set(k, { data: { offers: [] } }));
    offersCache.set(k, { loading: job });
    return job;
  });
  Promise.all(jobs).then(() => {
    if ($('modalContent').querySelector('#checklist')) rerender();
  });
}

/** Porovnanie cien: všetky akcie na položku; leták sa dá otvoriť, cena použiť. */
function showOffers(c, itemId, back) {
  const item = (c.items || []).find((i) => i.id === itemId);
  const hit = item && offersCache.get(offerKey(item.text));
  if (!hit || !hit.data) return;
  const offers = hit.data.offers;
  const until = (d) => (d ? 'do ' + formatDateShort(d) : '');
  openModal(
    '<h2>' + esc(item.text) + ' v akcii</h2><div class="subtitle">Najlacnejšie prvé · z letákov obchodov (Kimbino)</div>' +
      '<div class="offers">' +
      offers
        .map(
          (o, idx) =>
            '<div class="offer">' + (o.img ? '<img src="/api/leaflets/image?p=' + encodeURIComponent(o.img) + '" alt="" loading="lazy">' : '<span class="ms">sell</span>') +
            '<div class="offer-body"><div class="offer-name">' + esc(o.name) + '</div>' +
            '<div class="hint">' + esc(o.store) + ' · ' + esc(until(o.validTo)) + '</div></div>' +
            '<div class="offer-side"><div class="offer-price">' + esc(formatPrice(o.price)) + '</div>' +
            '<div class="offer-acts">' +
            (o.flyer ? '<button type="button" class="icon-btn small" data-open="' + idx + '" title="Otvoriť leták"><span class="ms">newspaper</span></button>' : '') +
            '<button type="button" class="icon-btn small" data-use="' + idx + '" title="Použiť cenu v nákupe"><span class="ms">payments</span></button>' +
            '</div></div></div>'
        )
        .join('') +
      '</div><div class="actions"><button type="button" class="btn text" id="back"><span class="ms">arrow_back</span>Späť</button></div>',
    (root) => {
      root.querySelector('#back').onclick = () => showTaskDetail(c.id);
      root.querySelectorAll('[data-open]').forEach((b) => {
        b.onclick = () => {
          const o = offers[Number(b.dataset.open)];
          closeModal(true);
          openLeaflets({ taskId: c.id, flyer: o.flyer, page: o.page });
        };
      });
      root.querySelectorAll('[data-use]').forEach((b) => {
        b.onclick = async () => {
          const o = offers[Number(b.dataset.use)];
          try {
            const saved = await api('setItemPrice', item.id, o.price);
            item.price = saved.price;
            refreshTaskCards(c);
            toast('Cena ' + formatPrice(o.price) + ' (' + o.store + ') použitá');
            showTaskDetail(c.id);
          } catch (err) {
            showError(err);
          }
        };
      });
    },
    { focus: false }
  );
}

/** Nový nákup z položiek nákupu v histórii (všetky, aj tie, čo nemali). */
function shopAgain(entryId) {
  const e = state.history && state.history.entries.find((x) => x.id === entryId);
  if (!e) return;
  showCinnostForm(null, {
    prefill: { name: e.name, store: e.store, items: e.items.map((i) => ({ text: i.text, qty: i.qty || '' })) },
  });
}

/** Vráti ukončený nákup z histórie späť (napr. omylom daný za hotový). */
function restoreFromHistory(entryId) {
  const e = state.history && state.history.entries.find((x) => x.id === entryId);
  if (!e) return;
  openModal(
    '<h2>Vrátiť nákup?</h2><div class="subtitle">„' + esc(e.name) + '“ sa vráti medzi nákupy s termínom ' +
      esc(e.dueDate ? formatDate(e.dueDate) : '– bez termínu –') + ' a položky budú tak, ako boli pri dokončení. Z histórie zmizne.</div>' +
      '<div class="actions"><button class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn" id="ok"><span class="ms">undo</span>Vrátiť</button></div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      const ok = root.querySelector('#ok');
      ok.onclick = async () => {
        ok.disabled = true;
        try {
          const c = await api('restoreHistory', entryId);
          const list = state.detail.cinnosti;
          const index = list.findIndex((x) => x.id === c.id);
          if (index === -1) list.push(c);
          else list[index] = c;
          state.history.entries = state.history.entries.filter((x) => x.id !== entryId);
          closeModal();
          renderDetail();
          toast('„' + c.name + '“ je späť medzi nákupmi');
        } catch (err) {
          ok.disabled = false;
          showError(err);
        }
      };
    }
  );
}

function deleteTask(id) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  openModal(
    '<h2>Vymazať nákup?</h2><div class="subtitle">„' + esc(c.name) + '“' +
      (c.periodicity !== 'none' ? ' – vymažú sa aj všetky jej opakovania.' : '') + '</div>' +
      '<div class="actions"><button class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn danger" id="ok">Vymazať</button></div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#ok').onclick = async () => {
        try {
          await api('deleteCinnost', id);
          state.detail.cinnosti = state.detail.cinnosti.filter((x) => x.id !== id);
          closeModal();
          renderDetail();
          toast('Nákup „' + c.name + '“ bol vymazaný');
        } catch (err) {
          showError(err);
        }
      };
    }
  );
}

// -------------------------------------------------------------------------
// Našepkávanie (produkty, obchody)
// -------------------------------------------------------------------------

const DEFAULT_STORES = ['Lidl', 'Kaufland', 'Tesco', 'Billa', 'Coop Jednota', 'Penny', 'Terno',
  'Fresh', 'Biedronka', 'dm drogerie', 'Teta drogérie', 'Rossmann', 'Hornbach', 'OBI', 'IKEA',
  'Decathlon', 'Lekáreň', 'Pekáreň', 'Mäsiarstvo', 'Trh'];

function normalizeText(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// ---- Oddelenia v obchode -------------------------------------------------------

// Doplnkové začiatky slov, keď položka nie je presne v zozname (napr. „Syr Rajo 45 %“).
const DEPT_STEMS = [
  ['Mliečne výrobky a vajcia', ['syr', 'jogurt', 'mliek', 'smotan', 'tvaroh', 'masl', 'kefir', 'vajc', 'bryndz', 'puding']],
  ['Mäso a ryby', ['kur', 'brav', 'hovadz', 'mor', 'mas', 'sunk', 'salam', 'klobas', 'park', 'slanin', 'ryb', 'losos', 'tuniak']],
  ['Pečivo', ['chlieb', 'chleb', 'rozk', 'zeml', 'bagel', 'pecivo', 'croissant', 'toast']],
  ['Ovocie', ['jablk', 'banan', 'pomaranc', 'citron', 'hrozn', 'jahod', 'ovoc']],
  ['Zelenina', ['zemiak', 'cibul', 'cesnak', 'mrkv', 'paradaj', 'uhork', 'papri', 'salat', 'zelenin', 'hub']],
  ['Nápoje', ['pivo', 'vino', 'voda', 'mineralk', 'dzus', 'limonad', 'kava', 'caj', 'sirup', 'cola', 'nealko']],
  ['Sladkosti a snacky', ['cokol', 'susienk', 'cukrik', 'chips', 'oriesk', 'tycink', 'zmrzlin', 'keks']],
  ['Trvanlivé potraviny', ['muk', 'cukor', 'ryz', 'cestovin', 'olej', 'ocot', 'konzerv', 'kecup', 'horcic', 'majonez']],
  ['Drogéria a hygiena', ['sampon', 'mydl', 'zubn', 'deodor', 'krem', 'plienk', 'vlozk', 'holiac', 'sprchov']],
  ['Upratovanie a domácnosť', ['prasok', 'prac', 'aviv', 'saponat', 'papier', 'utierk', 'vrecia', 'tablet', 'cistic', 'spongi', 'hubk']],
  ['Zvieratá', ['granul', 'krmivo', 'psy', 'mack', 'pes']],
];
const OTHER_DEPT = 'Ostatné';
let deptIndex = null;

/** Oddelenie obchodu pre položku: presná zhoda so zoznamom, potom najdlhšia zhoda, potom začiatok slova. */
function departmentOf(text) {
  if (typeof PRODUKTY_ODDELENIA === 'undefined') return OTHER_DEPT;
  if (!deptIndex) {
    deptIndex = { exact: new Map(), names: [] };
    PRODUKTY_ODDELENIA.forEach(([dept, list]) =>
      list.forEach((name) => {
        const n = normalizeText(name);
        deptIndex.exact.set(n, dept);
        deptIndex.names.push([n, dept]);
      })
    );
    deptIndex.names.sort((a, b) => b[0].length - a[0].length);
  }
  const t = normalizeText(text);
  if (deptIndex.exact.has(t)) return deptIndex.exact.get(t);
  const padded = ' ' + t + ' ';
  for (const [n, dept] of deptIndex.names) if (n.length >= 3 && padded.includes(' ' + n + ' ')) return dept;
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  for (const [dept, stems] of DEPT_STEMS) if (words.some((w) => stems.some((st) => w.startsWith(st)))) return dept;
  return OTHER_DEPT;
}

function deptOrder() {
  return (typeof PRODUKTY_ODDELENIA === 'undefined' ? [] : PRODUKTY_ODDELENIA.map((o) => o[0])).concat(OTHER_DEPT);
}

/** Položky zoskupené podľa oddelení v poradí obchodu: [[oddelenie, položky], …] (v skupine ostáva poradie). */
function groupByDept(items) {
  const groups = new Map(deptOrder().map((d) => [d, []]));
  items.forEach((i) => groups.get(departmentOf(i.text)).push(i));
  return [...groups].filter(([, list]) => list.length);
}

/** Zoraďovanie nákupu: podľa oddelení (predvolené) alebo podľa pridania. */
function byDeptMode() {
  try {
    return localStorage.getItem('gazda.sort') !== 'added';
  } catch {
    return true;
  }
}

function setByDeptMode(on) {
  try {
    localStorage.setItem('gazda.sort', on ? 'dept' : 'added');
  } catch {
    /* bez úložiska ostane predvolené */
  }
}

const deptHead = (name) => '<div class="dept-head">' + esc(name) + '</div>';

/** Návrhy pre zadaný text: najprv to, čo začína zadaným textom, potom slová a nakoniec obsahuje. */
function suggestFor(query, sources, exclude, limit) {
  const q = normalizeText(query);
  if (!q) return [];
  const seen = new Set((exclude || []).map(normalizeText));
  const buckets = [[], [], []];
  sources.forEach((list) =>
    list.forEach((name) => {
      const n = normalizeText(name);
      if (!n || seen.has(n)) return;
      let rank = -1;
      if (n.startsWith(q)) rank = 0;
      else if (n.includes(' ' + q)) rank = 1;
      else if (q.length >= 3 && n.includes(q)) rank = 2;
      if (rank === -1) return;
      seen.add(n);
      buckets[rank].push(name);
    })
  );
  return buckets.flat().slice(0, limit || 6);
}

/** Pripojí k poľu input zoznam návrhov v boxe; onPick dostane vybraný text. */
function attachSuggest(input, box, getSources, getExclude, onPick) {
  const render = () => {
    const list = suggestFor(input.value, getSources(), getExclude ? getExclude() : []);
    box.innerHTML = list
      .map((name) => '<button type="button" class="suggest-chip">' + esc(name) + '</button>')
      .join('');
    box.classList.toggle('hidden', !list.length);
    box.querySelectorAll('.suggest-chip').forEach((b, i) => {
      // pointerdown, aby sa návrh vybral skôr, než pole stratí fokus
      b.onpointerdown = (e) => {
        e.preventDefault();
        onPick(list[i]);
      };
    });
  };
  input.addEventListener('input', render);
  return { refresh: render, clear: () => box.classList.add('hidden') };
}

/** Nový produkt (napísaný do zoznamu) si zapamätaj hneď – lokálne aj na serveri. */
function rememberProduct(text) {
  const d = state.detail;
  if (!d || !text) return;
  d.products = d.products || [];
  if (d.products.some((x) => normalizeText(x) === normalizeText(text))) return;
  d.products.unshift(text);
  apiQuiet('rememberProducts', state.hh, [text]).catch(() => {});
}

// ---- Hlasové pridávanie (rozpoznávanie reči v telefóne, bez AI) -----------------

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
// slovné počty (bez diakritiky, ako ich vráti normalizeText)
const NUMBER_WORDS = {
  jeden: 1, jedna: 1, jedno: 1, jednu: 1, jednej: 1, dva: 2, dve: 2, dvoch: 2, tri: 3, troch: 3,
  styri: 4, styroch: 4, pat: 5, sest: 6, sedem: 7, osem: 8, devat: 9, desat: 10, pol: 0.5,
  jedenast: 11, dvanast: 12, patnast: 15, dvadsat: 20,
};
// jednotky: „kilo papriky“, „pol kila syra“, „dve balenia“, „liter mlieka“
const SPOKEN_UNITS = [
  [/^(kilo|kila|kil|kilogram\w*)$/, 'kg'],
  [/^(deka|dkg|dekagram\w*)$/, 'dkg'],
  [/^(gram|gramy|gramov)$/, 'g'],
  [/^(liter|litre|litra|litrov)$/, 'l'],
  [/^(deci|decilit\w*)$/, 'dl'],
  [/^(balenie|balenia|baleni|balik|baliky|balikov)$/, 'bal.'],
  [/^(kus|kusy|kusov|kusok|kusky)$/, 'ks'],
];

// slovenské tvary: rožok/rožky, chlieb/chleby, vajce/vajec – porovnáva sa viac podôb slova
const wordForms = (w) => [w, w.replace(/ie/g, 'e'), w.replace(/[eo]([^aeiouy])$/, '$1')];
const spokenStem = (w) => (w.length <= 3 ? w : w.slice(0, w.length >= 6 ? w.length - 2 : w.length - 1));

/** Hovorený názov → známy produkt (najprv z domácnosti, potom zo zoznamu): „papriky“ → „Paprika“. */
function knownProduct(words) {
  const spoken = words.map((w) => wordForms(normalizeText(w)).map(spokenStem));
  const fits = (name) => {
    const pw = normalizeText(name).split(/\s+/);
    if (pw.length !== words.length) return false; // „jogurty“ nie je „Jogurt biely“
    const forms = pw.flatMap(wordForms);
    // začiatok slova musí pokryť väčšinu názvu – „pros(ím)“ nie je „Prosecco“, „tam“ nie „Tampóny“
    return spoken.every((stems) => stems.some((st) => forms.some((f) => f.startsWith(st) && st.length >= Math.min(f.length, Math.max(3, f.length * 0.6)))));
  };
  for (const list of productSources()) {
    const hits = list.filter(fits).sort((a, b) => a.length - b.length);
    if (hits.length) return hits[0];
  }
  // jedno slovo, ktoré je len súčasťou známeho názvu: „jogurtov“ → „Jogurt“ (z „Jogurt biely“)
  if (words.length === 1) {
    const stems = spoken[0];
    for (const list of productSources()) {
      for (const name of list) {
        for (const w of name.split(/\s+/)) {
          const f = normalizeText(w);
          if (f.length >= 4 && wordForms(f).some((ff) => stems.some((st) => ff.startsWith(st) && st.length >= Math.max(3, ff.length * 0.6)))) {
            return w.charAt(0).toUpperCase() + w.slice(1);
          }
        }
      }
    }
  }
  return '';
}

/** Jedna hovorená vec → „Názov počet“: „kilo papriky“ → „Paprika 1 kg“, „tri rožky“ → „Rožky 3 ks“. */
function parseSpokenItem(part) {
  const words = part.trim().split(/\s+/).filter(Boolean);
  let num = null;
  let unit = '';
  const first = normalizeText(words[0] || '');
  if (/^\d+([.,]\d+)?$/.test(first)) num = Number(first.replace(',', '.'));
  else if (NUMBER_WORDS[first] !== undefined) num = NUMBER_WORDS[first];
  if (num !== null) words.shift();
  const maybeUnit = normalizeText(words[0] || '');
  const u = SPOKEN_UNITS.find(([re]) => re.test(maybeUnit));
  if (u && words.length > 1) {
    unit = u[1];
    words.shift();
    if (num === null) num = 1; // „kilo papriky“ = 1 kg
  }
  if (!words.length) return '';
  const spoken = words.join(' ');
  const name = knownProduct(words) || spoken.charAt(0).toUpperCase() + spoken.slice(1);
  if (num === null) return name;
  return name + ' ' + String(num).replace('.', ',') + ' ' + (unit || 'ks');
}

// Výplňové slová reči – nie sú to produkty („treba kúpiť mlieko a ešte nejaké rožky“).
// Bez diakritiky, ako ich vráti normalizeText.
const FILLER_WORDS = new Set(
  ('kup kupit kupte kupim kupime nakup nakupit nakupte zober zobrat zoberte vezmi vziat prines priniest ' +
    'daj dat dajte pridaj pridat pridajte zapis zapisat napis napisat treba potrebujem potrebujeme potrebujes ' +
    'chcem chceme chces chcelo chcel chcela by bolo bude je su sme som mame mam nemame nemam dosli doslo ' +
    'mi nam ti vam si sa ma mu jej im tam tu tak teda no jo ok okej hej nie ano hm hmm ehm eh ee eee mmm ' +
    'prosim dakujem diky este aj a alebo potom plus tiez taktiez a potom no a ' +
    'nejake nejaky nejaku nejaka nejakeho nejakych nejakej trochu par vela malo viac menej dalsie dalsi dalsiu ' +
    'na do z zo s so k ku v vo pre od o ze aby ked ako co to ten ta tie tych toho tomu tej toto tieto ' +
    'vsetko vsetky doma domov obchod obchode obchodu dnes zajtra rano vecer potom zoznam nakupny nakupu ' +
    'hotovo koniec stop staci')
    .split(' ')
    .filter(Boolean)
);

const PREPOSITIONS = new Set(['na', 's', 'so', 'z', 'zo', 'do', 'pre', 'bez', 'od']);

const isNumberWord = (w) => /^\d+([.,]\d+)?$/.test(w) || NUMBER_WORDS[w] !== undefined;
const isUnitWord = (w) => SPOKEN_UNITS.some(([re]) => re.test(w));

/**
 * Rozdelí súvislú reč bez čiarok na položky: „mlieko kilo papriky tri rožky maslo“ →
 * mlieko | kilo papriky | tri rožky | maslo. Nová položka začína počtom alebo jednotkou;
 * známe produkty (aj viacslovné) sa berú celé, neznáme slová vedľa seba ostanú spolu.
 */
function segmentSpoken(part) {
  const tokens = part.trim().split(/\s+/).filter(Boolean);
  const norm = tokens.map((t) => normalizeText(t));
  const out = [];
  let i = 0;
  let unknown = [];
  let lastEnd = -1; // kde skončila posledná známa položka (na pripojenie „na pranie“)
  const flushUnknown = () => {
    if (unknown.length) out.push(unknown.join(' '));
    unknown = [];
  };
  const productAt = (k) => {
    for (let n = Math.min(3, tokens.length - k); n >= 1; n--) if (knownProduct(tokens.slice(k, k + n))) return n;
    return 0;
  };
  while (i < tokens.length) {
    // výplňové slovo (ak nezačína známy produkt) sa vynechá a ukončí rozpracovanú položku
    // predložka medzi dvoma slovami názvu ho nedelí: „prášok na pranie“, „jogurt s jahodami“
    if (PREPOSITIONS.has(norm[i]) && i + 1 < tokens.length && !FILLER_WORDS.has(norm[i + 1]) && !isNumberWord(norm[i + 1])) {
      if (unknown.length) {
        unknown.push(tokens[i]);
        i++;
        continue;
      }
      if (out.length && lastEnd === i) {
        out[out.length - 1] += ' ' + tokens[i] + ' ' + tokens[i + 1];
        i += 2;
        lastEnd = i;
        continue;
      }
    }
    // (viacslovný produkt ako „smotana na šľahanie“ sa vynechať nesmie)
    if ((FILLER_WORDS.has(norm[i]) || norm[i].length < 2) && !isNumberWord(norm[i]) && productAt(i) < 2) {
      flushUnknown();
      i++;
      continue;
    }
    let start = i;
    // počet a/alebo jednotka pred názvom patria k nasledujúcej položke
    if (isNumberWord(norm[i])) i++;
    if (i < tokens.length && isUnitWord(norm[i]) && i + 1 < tokens.length) i++;
    const hasQty = i > start;
    // najdlhší známy produkt (3, 2 alebo 1 slovo)
    const len = productAt(i);
    if (len) {
      flushUnknown();
      out.push(tokens.slice(start, i + len).join(' '));
      i += len;
      lastEnd = i;
    } else if (hasQty) {
      flushUnknown();
      unknown = tokens.slice(start, i + 1);
      i += 1;
    } else {
      unknown.push(tokens[i]);
      i += 1;
    }
  }
  flushUnknown();
  return out;
}

/** „mlieko, kilo papriky a tri rožky“ → ['Mlieko', 'Paprika 1 kg', 'Rožky 3 ks'] */
function splitSpoken(text) {
  return String(text)
    .split(/,|;|\.|\s+(?:a|aj|potom|plus|tiez|tiež|ešte|este)\s+/i)
    .flatMap(segmentSpoken)
    .map(parseSpokenItem)
    .filter(Boolean);
}

/** Z viacerých možností rozpoznania vyber tú, v ktorej je najviac známych produktov. */
function bestTranscript(alternatives) {
  let best = alternatives[0] || '';
  let bestScore = -1;
  alternatives.forEach((t, idx) => {
    const items = String(t).split(/\s+/).filter(Boolean);
    let score = 0;
    for (let i = 0; i < items.length; i++) if (knownProduct([items[i]])) score++;
    score -= idx * 0.5; // pri zhode vyhráva tá, ktorú rozpoznávanie považuje za najpravdepodobnejšiu
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  });
  return best;
}

const STOP_WORDS = /\s*(hotovo|koniec|to je všetko|to je vsetko)[.!]?\s*$/i;
const VOICE_IDLE_MS = 25000; // bez reči 25 s – nahrávanie sa samo ukončí

/**
 * Mikrofón vedľa poľa na pridanie – diktovanie celého zoznamu: ťuknutím sa začne nahrávať,
 * človek povie všetko naraz („mlieko kilo papriky tri rožky maslo“), ďalším ťuknutím
 * (alebo „hotovo“) sa text rozanalyzuje a ukáže sa náhľad položiek na potvrdenie.
 */
function attachVoice(input, add) {
  if (!SpeechRec || !input || input.parentNode.querySelector('.mic')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn tonal small mic';
  btn.title = 'Nadiktovať zoznam';
  btn.innerHTML = '<span class="ms">mic</span>';
  input.after(btn);
  const row = input.parentNode;
  const placeholder = input.placeholder;
  let active = false;
  let rec = null;
  let lastSpeech = 0;
  let text = ''; // doteraz nadiktované (ukončené úseky)

  const preview = document.createElement('div');
  preview.className = 'voice-preview hidden';
  row.after(preview);

  const showPreview = (items) => {
    if (!items.length) {
      preview.classList.add('hidden');
      toast('Nič som nezachytil. Skús to znova.', true);
      return;
    }
    const render = () => {
      preview.innerHTML =
        '<div class="voice-head"><span class="ms">mic</span>Rozpoznané (' + items.length + ')</div>' +
        '<div class="voice-items">' +
        items
          .map((it, i) => '<span class="voice-item">' + esc(it) + '<button type="button" data-drop="' + i + '" title="Odstrániť"><span class="ms">close</span></button></span>')
          .join('') +
        '</div><div class="voice-acts"><button type="button" class="btn text small" data-voice="cancel">Zrušiť</button>' +
        '<button type="button" class="btn tonal small" data-voice="again"><span class="ms">mic</span>Znova</button>' +
        '<button type="button" class="btn small" data-voice="add"' + (items.length ? '' : ' disabled') + '><span class="ms">add</span>Pridať všetky</button></div>';
      preview.querySelectorAll('[data-drop]').forEach((b) => {
        b.onclick = () => {
          items.splice(Number(b.dataset.drop), 1);
          if (!items.length) preview.classList.add('hidden');
          else render();
        };
      });
      preview.querySelector('[data-voice=cancel]').onclick = () => preview.classList.add('hidden');
      preview.querySelector('[data-voice=again]').onclick = () => {
        preview.classList.add('hidden');
        start();
      };
      preview.querySelector('[data-voice=add]').onclick = async () => {
        preview.classList.add('hidden');
        for (const it of items) await add(it);
        toast('Pridané: ' + items.length);
      };
    };
    preview.classList.remove('hidden');
    render();
  };

  const finish = () => {
    if (!active) return;
    active = false;
    btn.classList.remove('listening');
    input.placeholder = placeholder;
    input.value = '';
    if (rec) {
      const r = rec;
      rec = null;
      r.onend = null;
      try {
        r.stop();
      } catch {
        /* už skončilo */
      }
    }
    const all = (text + ' ' + current).replace(STOP_WORDS, '').trim();
    current = '';
    if (!all) return showPreview([]);
    // AI (Workers AI) rozdelí text na položky; bez nej (limit, výpadok) vlastné rozdelenie
    preview.classList.remove('hidden');
    preview.innerHTML = '<div class="voice-head"><span class="ms">auto_awesome</span>Analyzujem: „' + esc(all) + '“…</div>';
    const fallback = () => showPreview(splitSpoken(all));
    apiQuiet('parseShoppingText', state.hh, all)
      .then((items) => (Array.isArray(items) ? showPreview(items) : fallback()))
      .catch(fallback);
  };

  let current = ''; // rozpracovaný úsek (aktuálne počúvanie)
  const listen = () => {
    rec = new SpeechRec();
    rec.lang = 'sk-SK';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.onresult = (e) => {
      // Celý text tohto počúvania poskladaj znova z výsledkov. Android niekedy posiela
      // výsledok, ktorý už obsahuje predchádzajúce – taký nahradí, nie pridá (bez zdvojenia).
      let session = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const alts = [];
        for (let k = 0; k < r.length; k++) alts.push(r[k].transcript);
        const t = (r.isFinal ? bestTranscript(alts) : alts[0]).trim();
        if (!t) continue;
        if (normalizeText(t).startsWith(normalizeText(session))) session = t;
        else if (!normalizeText(session).endsWith(normalizeText(t))) session += ' ' + t;
      }
      current = session.trim();
      lastSpeech = Date.now();
      input.value = (text + ' ' + current).trim();
      input.scrollLeft = input.scrollWidth;
      if (STOP_WORDS.test(current)) finish();
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        toast('Povoľ Family Grid mikrofón v nastaveniach prehliadača.', true);
        active = false;
        btn.classList.remove('listening');
        input.placeholder = placeholder;
      } else if (e.error === 'network') {
        toast('Rozpoznávanie reči potrebuje internet.', true);
        finish();
      }
    };
    rec.onend = () => {
      // telefón po chvíli ticha počúvanie ukončí – úsek si odlož a počúvaj ďalej
      rec = null;
      text = (text + ' ' + current).trim();
      current = '';
      if (!active) return;
      if (!input.isConnected) return (active = false);
      if (Date.now() - lastSpeech > VOICE_IDLE_MS) return finish();
      setTimeout(() => active && !rec && listen(), 200);
    };
    try {
      rec.start();
    } catch {
      finish();
    }
  };

  const start = () => {
    active = true;
    text = '';
    current = '';
    lastSpeech = Date.now();
    preview.classList.add('hidden');
    btn.classList.add('listening');
    input.placeholder = 'Diktuj celý zoznam… potom ťukni na mikrofón';
    listen();
  };

  btn.onclick = () => (active ? finish() : start());
}

function productSources() {
  return [(state.detail && state.detail.products) || [], typeof PRODUKTY !== 'undefined' ? PRODUKTY : []];
}

function storeSources() {
  return [(state.detail && state.detail.stores) || [], DEFAULT_STORES];
}

// -------------------------------------------------------------------------
// Detail činnosti s checklistom
// -------------------------------------------------------------------------

// Kópia splitQty_ z Code.gs, aby sa počet oddelil hneď vo formulári.
const splitQty = (() => {
  function cleanItemText_(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  // Jednotky počtu; „x“, „krát“ a samotné číslo znamenajú kusy.
  const QTY_UNITS = {
    x: 'ks', '×': 'ks', 'krát': 'ks', ks: 'ks', kus: 'ks', kusy: 'ks', kusov: 'ks',
    kg: 'kg', dkg: 'dkg', g: 'g', l: 'l', dl: 'dl', ml: 'ml',
    bal: 'bal.', 'bal.': 'bal.', balenie: 'bal.', balenia: 'bal.', balení: 'bal.',
  };
  const QTY_NUM = '(\\d+(?:[.,]\\d+)?)';
  const QTY_UNIT = '(x|×|krát|ks|kusy|kusov|kus|kg|dkg|g|l|dl|ml|bal\\.?|balenie|balenia|balení)';
  const QTY_PREFIX = new RegExp('^' + QTY_NUM + '\\s*' + QTY_UNIT + '?\\s+(.+)$', 'i');
  const QTY_SUFFIX = new RegExp('^(.+?)\\s+' + QTY_NUM + '\\s*' + QTY_UNIT + '?$', 'i');
  const QTY_TIMES = new RegExp('^(.+?)\\s+[x×]\\s*(\\d+)$', 'i');

  function formatQty_(num, unit) {
    return num.replace('.', ',') + ' ' + QTY_UNITS[String(unit || 'ks').toLowerCase()];
  }

  /**
   * Oddelí počet od názvu položky: „2x mlieko“, „mlieko 2 ks“, „1,5 kg zemiaky“,
   * „mlieko x2“ → { text: 'Mlieko', qty: '2 ks' }. Ak je počet zadaný zvlášť, má prednosť.
   */
  function splitQty_(text, qty) {
    text = cleanItemText_(text);
    qty = String(qty || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (/^\d+(?:[.,]\d+)?$/.test(qty)) qty = formatQty_(qty, 'ks');
    else if (qty) {
      const m = qty.match(new RegExp('^' + QTY_NUM + '\\s*' + QTY_UNIT + '$', 'i'));
      if (m) qty = formatQty_(m[1], m[2]);
    }
    if (!qty) {
      let m = text.match(QTY_PREFIX);
      if (m) {
        qty = formatQty_(m[1], m[2]);
        text = m[3];
      } else if ((m = text.match(QTY_TIMES))) {
        qty = formatQty_(m[2], 'ks');
        text = m[1];
      } else if ((m = text.match(QTY_SUFFIX))) {
        qty = formatQty_(m[2], m[3]);
        text = m[1];
      }
      if (qty) text = text.charAt(0).toUpperCase() + text.slice(1);
    }
    return { text, qty };
  }

  return splitQty_;
})();

/** Miniatúra položky (napr. zakrúžkovaná v letáku); ťuknutím sa zväčší. */
function thumbHtml(i) {
  return i.image ? '<img class="check-thumb" src="' + esc(i.image) + '" alt="" loading="lazy" data-preview="' + esc(i.image) + '">' : '';
}

function qtyHtml(i) {
  return (
    (i.price ? '<span class="check-price">' + esc(formatPrice(i.price)) + '</span>' : '') +
    (i.qty ? '<span class="check-qty">' + esc(i.qty) + '</span>' : '')
  );
}

/** „2.49“ → „2,49 €“ */
function formatPrice(p) {
  return Number(p).toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** Odhad sumy za neodškrtnuté položky s cenou (počet v kusoch/baleniach sa násobí). */
function itemsTotal(c) {
  let sum = 0;
  let any = false;
  (c.items || []).forEach((i) => {
    if (!i.price || i.done || i.missing) return;
    any = true;
    const m = String(i.qty || '').match(/^(\d+(?:,\d+)?) (ks|bal\.)$/);
    sum += Number(i.price) * (m ? Number(m[1].replace(',', '.')) : 1);
  });
  return any ? sum : null;
}

function itemProgress(c) {
  const items = c.items || [];
  // „nemali“ je tiež vybavené – nákup sa dá dať za hotový
  return { done: items.filter((i) => i.done || i.missing).length, total: items.length };
}

/** Ikona stavu položky: odškrtnutá, nemali, alebo ešte nie. */
function itemIcon(i) {
  return i.done ? 'check_box' : i.missing ? 'remove_shopping_cart' : 'check_box_outline_blank';
}

/** Tlačidlo „Nemali“ pri položke nákupu (vnútri riadku – rozlíši sa podľa data-miss). */
function missHtml(c, i) {
  if (c.kind !== 'nakup') return '';
  return (
    '<span class="miss-btn' + (i.missing ? ' on' : '') + '" data-miss="' + esc(i.id) + '" title="' +
    (i.missing ? 'Zrušiť – predsa mali' : 'Nemali') + '"><span class="ms">remove_shopping_cart</span>' +
    (i.missing ? '<span>nemali</span>' : '') + '</span>'
  );
}

const itemClass = (i) => (i.done ? ' done' : i.missing ? ' missing' : '');

/** opts.focus: hneď písať položky (nový nákupný zoznam). */
function showTaskDetail(id, opts) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  if (!c) return;
  const shopping = true; // v Nákupoch je každá činnosť nákup
  const meta = [];
  if (c.store) meta.push('<span class="tag"><span class="ms">storefront</span>' + esc(c.store) + '</span>');
  meta.push('<span class="tag"><span class="ms">calendar_month</span>' + esc(c.dueDate ? formatDateShort(c.dueDate) + (c.dueTime ? ' ' + c.dueTime : '') : 'Bez termínu') + '</span>');
  if (c.periodicity !== 'none') meta.push('<span class="tag"><span class="ms">repeat</span>' + esc(periodicityLabel(c)) + '</span>');
  meta.push('<span class="tag"><span class="ms">' + assigneeIcon(c.assignedTo) + '</span>' + esc(shortName(c.assignedTo)) + '</span>');

  openModal(
    '<h2>' + esc(c.name) + '</h2>' +
      '<div class="meta" style="margin:6px 0 14px">' + meta.join('') + '</div>' +
      (c.description ? '<div class="subtitle">' + esc(c.description) + '</div>' : '') +
      (c.shoppingBy && c.shoppingBy !== state.email
        ? '<div class="shop-note"><span class="ms">shopping_cart_checkout</span>' + esc(shortName(c.shoppingBy)) + ' práve nakupuje – čo pridáš, hneď uvidí.</div>'
        : '') +
      '<div class="field"><div class="check-head"><label id="checkLabel"></label>' +
      (shopping ? '<button type="button" class="chip small hidden" id="sortMode"></button>' : '') + '</div>' +
      '<div class="item-add">' + stepperHtml('id="qtyInput"') +
      '<input id="itemInput" maxlength="100" placeholder="' +
      (shopping ? 'Pridať produkt…' : 'Pridať položku…') + '" autocomplete="off">' +
      '<button type="button" class="btn tonal small" id="itemAdd"><span class="ms">add</span></button></div>' +
      '<div class="suggest hidden" id="itemSuggest"></div>' +
      (shopping
        ? '<div class="shop-tools"><button type="button" class="btn tonal small" id="leaflets"><span class="ms">newspaper</span>Vybrať z letáku</button></div>'
        : '') +
      '<div class="checklist" id="checklist"></div></div>' +
      '<div class="field comments"><label><span class="ms">chat</span>Komentáre</label><div id="commentList"><div class="hint">Načítavam…</div></div>' +
      '<div class="item-add"><input id="commentInput" maxlength="500" autocomplete="off" placeholder="Napíš komentár pre ostatných…">' +
      '<button type="button" class="btn tonal small" id="commentSend" title="Poslať"><span class="ms">send</span></button></div></div>' +
      '<div class="actions">' +
      '<button type="button" class="btn text" id="edit"><span class="ms">edit</span>Upraviť</button>' +
      '<button type="button" class="btn text" id="cancel" style="margin-left:auto">Zavrieť</button>' +
      '<button type="button" class="btn" id="startShop"><span class="ms">shopping_cart_checkout</span>' +
      (c.shoppingBy === state.email ? 'Pokračovať v nákupe' : 'Zahájiť nákup') + '</button>' +
      '</div>',
    (root) => {
      const listEl = root.querySelector('#checklist');
      const input = root.querySelector('#itemInput');

      const renderList = () => {
        const items = c.items || [];
        const p = itemProgress(c);
        const total = itemsTotal(c);
        root.querySelector('#checkLabel').textContent =
          (shopping ? 'Nakúpiť' : 'Checklist') + (p.total ? ' (' + p.done + '/' + p.total + ')' : '') +
          (total !== null ? ' · spolu ~' + formatPrice(total) : '');
        const open = (i) => !i.done && !i.missing;
        const row = (i) =>
          '<button type="button" class="check-item' + itemClass(i) + '" data-item="' + esc(i.id) + '">' +
          '<span class="ms">' + itemIcon(i) + '</span>' + thumbHtml(i) +
          '<span class="check-text">' + esc(i.text) +
          (shopping && !i.done && !i.missing ? offerLineHtml(i) : '') + '</span>' + qtyHtml(i) + missHtml(c, i) + '</button>';
        const rest = items.filter((i) => i.missing).concat(items.filter((i) => i.done));
        const byDept = shopping && byDeptMode();
        const groups = byDept ? groupByDept(items.filter(open)) : [['', items.filter(open)]];
        const sortBtn = root.querySelector('#sortMode');
        if (sortBtn) {
          sortBtn.classList.toggle('hidden', items.length < 2);
          sortBtn.innerHTML = '<span class="ms">' + (byDept ? 'storefront' : 'schedule') + '</span>' + (byDept ? 'Podľa oddelení' : 'Podľa pridania');
        }
        listEl.innerHTML = items.length
          ? groups.map(([d, list]) => (byDept && groups.length > 1 ? deptHead(d) : '') + list.map(row).join('')).join('') +
            (rest.length && byDept ? deptHead('Vybavené') : '') + rest.map(row).join('')
          : '<div class="hint">Zatiaľ žiadne položky.</div>';
        loadOffersFor(items.filter(open), renderList);
        listEl.querySelectorAll('[data-item]').forEach((b) => {
          b.onclick = (e) => {
            if (e.target.dataset.preview) return showImagePreview(e.target.dataset.preview);
            if (e.target.closest('[data-miss]')) return toggleMissingItem(c, b.dataset.item, renderList);
            if (e.target.closest('[data-offer]')) return showOffers(c, b.dataset.item, renderList);
            toggle(b.dataset.item);
          };
        });
      };

      const toggle = (itemId) => toggleChecklistItem(c, itemId, renderList);
      // Komentáre
      const commentList = root.querySelector('#commentList');
      const commentInput = root.querySelector('#commentInput');
      const renderComments = (list) => {
        commentList.innerHTML = list.length
          ? list
              .map(
                (k) =>
                  '<div class="comment' + (k.author === state.email ? ' mine' : '') + '"><div class="comment-head"><b>' + esc(shortName(k.author)) +
                  '</b><span class="hint">' + esc(commentTime(k.createdAt)) + '</span>' +
                  (k.author === state.email
                    ? '<button type="button" class="icon-btn small" data-del-comment="' + esc(k.id) + '" title="Zmazať"><span class="ms">close</span></button>'
                    : '') +
                  '</div><div class="comment-text">' + esc(k.text) + '</div></div>'
              )
              .join('')
          : '<div class="hint">Zatiaľ žiadne. Napíš napr. „kúp radšej polotučné“.</div>';
        commentList.querySelectorAll('[data-del-comment]').forEach((b) => {
          b.onclick = async () => {
            try {
              await api('deleteComment', b.dataset.delComment);
              c.comments = Math.max(0, (c.comments || 1) - 1);
              loadComments();
            } catch (err) {
              showError(err);
            }
          };
        });
      };
      const loadComments = async () => {
        try {
          const list = await apiQuiet('getComments', c.id);
          if (root.querySelector('#commentList') === commentList) renderComments(list);
        } catch {
          commentList.innerHTML = '<div class="hint">Komentáre sa nepodarilo načítať.</div>';
        }
      };
      const sendComment = async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        const btn = root.querySelector('#commentSend');
        btn.disabled = true;
        try {
          await api('addComment', c.id, text);
          commentInput.value = '';
          c.comments = (c.comments || 0) + 1;
          await loadComments();
        } catch (err) {
          showError(err);
        }
        btn.disabled = false;
      };
      root.querySelector('#commentSend').onclick = sendComment;
      commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendComment();
        }
      });
      if (String(c.id).startsWith('tmp-')) commentList.innerHTML = '<div class="hint">Ukladá sa…</div>';
      else loadComments();

      // nákup naživo: zmeny od ostatných sa prekreslia priamo v otvorenom detaile
      state.openTask = {
        id: c.id,
        update: (fresh) => {
          const newComments = (fresh.comments || 0) !== (c.comments || 0);
          if (!fresh.comments) delete c.comments;
          Object.assign(c, fresh);
          renderList();
          if (newComments) loadComments();
        },
      };
      if (root.querySelector('#sortMode')) {
        root.querySelector('#sortMode').onclick = () => {
          setByDeptMode(!byDeptMode());
          renderList();
          refreshTaskCards(c);
        };
      }

      const qtyInput = root.querySelector('#qtyInput');
      const add = async (text) => {
        text = String(text || '').trim();
        if (!text) return;
        const qty = qtyInput.value;
        input.value = '';
        qtyInput.value = '';
        suggest.clear();
        try {
          const item = await api('addItem', c.id, text, qty);
          c.items = [item].concat(c.items || []);
          if (!state.detail.products.some((x) => normalizeText(x) === normalizeText(item.text))) {
            state.detail.products.unshift(item.text);
          }
          renderList();
          // pri zoskupení podľa oddelení môže byť nová položka nižšie – ukáž ju
          const added = listEl.querySelector('[data-item="' + item.id + '"]');
          if (added) {
            added.classList.add('flash');
            added.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } catch (err) {
          showError(err);
        }
        input.focus();
      };

      const suggest = attachSuggest(input, root.querySelector('#itemSuggest'), productSources,
        () => (c.items || []).map((i) => i.text), add);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          add(input.value);
        }
      });
      root.querySelector('#itemAdd').onclick = () => add(input.value);
      attachVoice(input, add);
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#edit').onclick = () => showCinnostForm(c);
      root.querySelector('#leaflets').onclick = () => {
        closeModal(true);
        // po zatvorení letákov sa vráti sem, k zoznamu
        openLeaflets({ taskId: c.id, store: c.store, returnTo: c.id });
      };
      root.querySelector('#startShop').onclick = () => startShopping(c.id);
      renderList();
      if (opts && opts.focus) input.focus();
    },
    { focus: false, onClose: () => state.detail && renderDetail() }
  );
}

/** Obchod a položky nového/upraveného nákupu hneď ponúkaj v našepkávaní. */
function rememberLocally(c) {
  const d = state.detail;
  d.stores = d.stores || [];
  d.products = d.products || [];
  if (c.store && !d.stores.some((x) => normalizeText(x) === normalizeText(c.store))) d.stores.push(c.store);
  (c.items || []).forEach((i) => {
    if (!d.products.some((x) => normalizeText(x) === normalizeText(i.text))) d.products.unshift(i.text);
  });
}

let tempIds = 0;

/** Lokálna podoba nákupu zo zadaných údajov, kým ho server neuloží. */
function optimisticTask(data, previous) {
  const done = new Map(((previous && previous.items) || []).map((i) => [i.id, i.done]));
  const images = new Map(((previous && previous.items) || []).map((i) => [i.id, i.image]));
  const prices = new Map(((previous && previous.items) || []).map((i) => [i.id, i.price]));
  return {
    ...(previous || { id: 'tmp-' + ++tempIds, householdId: state.hh }),
    priestorId: '',
    name: String(data.name).trim(),
    description: String(data.description || '').trim(),
    assignedTo: data.assignedTo,
    dueDate: data.dueDate,
    dueTime: data.dueTime || '',
    periodicity: data.periodicity,
    repeatInterval: data.periodicity === 'none' ? null : Number(data.repeatInterval) || 1,
    icon: data.icon,
    color: data.color,
    kind: 'nakup',
    store: String(data.store || '').trim(),
    items: data.items
      .map((i) => ({
        id: i.id || 'tmp-' + ++tempIds,
        ...splitQty(i.text, i.qty),
        done: Boolean(i.id && done.get(i.id)),
        ...(i.id && images.get(i.id) && { image: images.get(i.id) }),
        ...(i.id && prices.get(i.id) && { price: prices.get(i.id) }),
      }))
      .filter((i) => i.text),
    pending: true,
  };
}

/** Po vytvorení nákupu: ponúkni letáky, z ktorých sa tovar pridá rovno do neho. */
function offerLeaflets(c) {
  openModal(
    '<h2>Otvoriť letáky?</h2>' +
      '<div class="subtitle">Pozri si akcie v letákoch a tovar pridaj rovno do nákupu „' + esc(c.name) + '“.</div>' +
      '<div class="actions"><button type="button" class="btn text" id="no">Teraz nie</button>' +
      '<button type="button" class="btn" id="yes"><span class="ms">newspaper</span>Otvoriť letáky</button></div>',
    (root) => {
      root.querySelector('#no').onclick = closeModal;
      root.querySelector('#yes').onclick = () => {
        closeModal(true);
        openLeaflets({ taskId: c.id, store: c.store });
      };
    },
    { focus: false }
  );
}

// -------------------------------------------------------------------------
// Tlačidlá − / + pri počte a písanie na mobile
// -------------------------------------------------------------------------

// Tlačidlá − / + pri počte (fungujú v každom okne s .stepper).
$('modalContent').addEventListener('pointerdown', (e) => {
  if (e.target.closest('.stepper .step')) e.preventDefault(); // nech pole s textom nestratí fokus
});
$('modalContent').addEventListener('click', (e) => {
  const btn = e.target.closest('.stepper .step');
  if (!btn) return;
  const input = btn.parentNode.querySelector('input');
  const next = stepQty(input.value, Number(btn.dataset.step));
  if (next === null) return;
  input.value = next;
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

// Krok podľa jednotky: kusy po 1, kg a l po 0,5, g a ml po 100, dkg po 10.
const QTY_STEPS = { kg: 0.5, l: 0.5, g: 100, ml: 100, dkg: 10 };

/** Zvýši / zníži počet („2 ks“, „1,5 kg“); prázdny počet je 1 ks. null = nedá sa. */
function stepQty(qty, dir) {
  qty = String(qty || '').trim();
  const m = qty ? qty.match(/^(\d+(?:[.,]\d+)?)\s*([^\d\s].*)?$/) : ['', '1', 'ks'];
  if (!m) return null;
  const unit = (m[2] || 'ks').trim();
  const step = QTY_STEPS[unit.toLowerCase()] || 1;
  const n = Math.round((parseFloat(m[1].replace(',', '.')) + dir * step) * 100) / 100;
  if (n < step || (unit === 'ks' && n < 1)) return null;
  if (unit === 'ks' && n === 1) return '';
  return String(n).replace('.', ',') + ' ' + unit;
}

function stepperHtml(attrs, value) {
  return (
    '<div class="stepper"><button type="button" class="step" data-step="-1" title="Menej"><span class="ms">remove</span></button>' +
    '<input class="qty-input" ' + attrs + ' maxlength="20" placeholder="1" autocomplete="off" value="' + esc(value || '') + '">' +
    '<button type="button" class="step" data-step="1" title="Viac"><span class="ms">add</span></button></div>'
  );
}

// Na mobile pri písaní: okno presuň k hornému okraju a pole posuň tak, aby
// bolo nad klávesnicou (spolu s popiskom nad ním).
const TEXT_INPUT = 'textarea, input:not([type]), input[type=text], input[type=email], input[type=number], input[type=search], input[type=tel], input[type=url], input[type=password]';
const isPhone = () => window.matchMedia('(max-width: 600px)').matches;

function keepFieldVisible(field) {
  const card = $('modalContent');
  const label = field.closest('.field');
  const target = label || field;
  const offset = target.getBoundingClientRect().top - card.getBoundingClientRect().top - 12;
  card.scrollTop += offset;
}

$('modalContent').addEventListener('focusin', (e) => {
  if (!isPhone() || !e.target.matches(TEXT_INPUT) || e.target.readOnly) return;
  $('modal').classList.add('typing');
  // Klávesnica sa vysúva postupne – pozíciu doladíme aj po jej otvorení.
  requestAnimationFrame(() => keepFieldVisible(e.target));
  setTimeout(() => document.activeElement === e.target && keepFieldVisible(e.target), 350);
});

$('modalContent').addEventListener('focusout', () => {
  setTimeout(() => {
    const active = document.activeElement;
    if (!active || !$('modalContent').contains(active) || !active.matches(TEXT_INPUT)) {
      $('modal').classList.remove('typing');
    }
  }, 150);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal();
});

// -------------------------------------------------------------------------
// Štart a nákup naživo
// -------------------------------------------------------------------------

async function start() {
  state.email = FG.state.email;
  state.nickname = FG.state.nickname;
  const h = FG.currentHousehold();
  state.hh = h ? h.id : null;
  if (!state.hh) return render();
  FG.setHousehold(state.hh);
  if (!state.detail || state.detail.householdId !== state.hh) {
    state.detail = readSnapshot();
    state.history = null;
  }
  render();
  try {
    await load(Boolean(state.detail));
    if (canRefreshView()) render({ quiet: true });
  } catch (err) {
    if (err.offline && state.detail) toast('Bez internetu – ukazujem posledné uložené údaje');
    else if (!isLoginRequired(err)) {
      showError(err);
      if (!state.detail) $('view').innerHTML = '<div class="center">' + esc(errorMessage(err)) + '</div>';
    }
  }
}

document.querySelectorAll('#tabs .tab').forEach((t) => {
  t.onclick = () => {
    state.tab = t.dataset.tab;
    if (state.tab === 'historia') state.history = null; // vždy čerstvá (dokončiť mohol aj niekto iný)
    render();
    window.scrollTo(0, 0);
  };
});

// Nákup naživo: každé 4 s sa lacno overí verzia rodiny (getRev) a celé údaje sa načítajú len
// pri zmene (odškrtnutie od iného člena sa ukáže takmer hneď, aj v otvorenom detaile nákupu).
const AUTO_REFRESH_MS = 4000;

async function autoRefresh(force) {
  if (document.hidden || !state.detail || !state.email || pending) return;
  if (state.detail.cinnosti.some((c) => c.pending)) return;
  const id = state.hh;
  const live = state.openTask && $('modalContent').querySelector('#checklist') ? state.openTask : null;
  if (!canRefreshView() && !live) return;
  const before = mutations;
  try {
    const rev = await apiQuiet('getRev', id);
    const changed = lastRev.id !== id || lastRev.rev !== rev;
    lastRev = { id, rev };
    if (!force && !changed) return;
    const fresh = await apiQuiet('nakupy/getData', id);
    // Medzičasom niečo zmenené alebo iná rodina – čerstvé údaje by to prepísali.
    if (mutations !== before || pending || state.hh !== id || fresh.householdId !== id) return;
    lastRev = { id, rev: fresh.rev };
    if (JSON.stringify(fresh) === JSON.stringify(state.detail)) return;
    const openNow = state.openTask && $('modalContent').querySelector('#checklist') ? state.openTask : null;
    if (canRefreshView()) {
      state.detail = fresh;
      render({ quiet: true });
    } else if (openNow) {
      // otvorený detail nákupu: obnov jeho zoznam aj karty pod ním
      state.detail = fresh;
      const task = fresh.cinnosti.find((c) => c.id === openNow.id);
      render({ quiet: true });
      if (task) openNow.update(task);
    }
  } catch (err) {
    // Obnova na pozadí je nepovinná; chyby (napr. bez internetu) neukazuj.
  }
}

setInterval(autoRefresh, AUTO_REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  autoRefresh(true);
  // návrat do appky počas nákupu: rovno na jeho obrazovku (a displej znova nezhasína)
  if (shop.id) keepScreenOn(true);
  else resumeShopping();
});

FG.start({ onReady: () => start() });
