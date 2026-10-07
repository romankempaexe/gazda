// -------------------------------------------------------------------------
// Konštanty
// -------------------------------------------------------------------------

// Názov ikony (uložený v tabuľke) -> Material Symbol
const ICONS = {
  home: 'home', kitchen: 'kitchen', bathtub: 'bathtub', bed: 'bed', chair: 'chair',
  door: 'door_front', window: 'window', light: 'lightbulb', floor: 'apartment',
  roof: 'roofing', stairs: 'stairs', garage: 'garage', garden: 'nature', grass: 'grass',
  pool: 'pool', balcony: 'balcony', dining: 'dinner_dining', shopping: 'shopping_cart',
  clean: 'cleaning_services', laundry: 'local_laundry_service', wash: 'wash',
  dishes: 'dishwasher', trash: 'delete', recycle: 'recycling',
  repair: 'home_repair_service', tools: 'construction', hammer: 'handyman',
  wrench: 'plumbing', paint: 'format_paint', drill: 'precision_manufacturing', key: 'key',
  lock: 'lock', unlock: 'lock_open', security: 'security', camera: 'videocam',
  plants: 'eco', water: 'water_drop', sun: 'wb_sunny', snow: 'ac_unit', wind: 'air',
  thermometer: 'thermostat', humidity: 'opacity', calendar: 'calendar_month',
  clock: 'schedule', star: 'star', favorite: 'favorite', person: 'person',
  family: 'group', check: 'check_circle', done: 'done_all', task: 'task_alt', list: 'list',
};

const COLORS = {
  'Zelená': '#4CAF50', 'Modrá': '#2196F3', 'Červená': '#F44336', 'Oranžová': '#FF9800',
  'Fialová': '#9C27B0', 'Ružová': '#E91E63', 'Tyrkysová': '#00BCD4', 'Žltá': '#FFEB3B',
  'Hnedá': '#795548', 'Šedá': '#9E9E9E',
};

const PERIODICITY = {
  none: { label: 'Bez opakovania' },
  weekly: { label: 'Týždenne', unit: 'týždňov', hint: 'Napr. 2 = každé 2 týždne' },
  monthly: { label: 'Mesačne', unit: 'mesiacov', hint: 'Napr. 3 = každé 3 mesiace' },
  annually: { label: 'Ročne', unit: 'rokov', hint: 'Napr. 2 = každé 2 roky' },
};

const MONTHS = ['Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún', 'Júl', 'August',
  'September', 'Október', 'November', 'December'];
const WEEKDAYS_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
const WEEKDAYS = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];

// -------------------------------------------------------------------------
// Stav
// -------------------------------------------------------------------------

const state = {
  email: '',
  nickname: '',
  households: [],
  detail: null, // { household, members, priestory, cinnosti, role }
  tab: 'rozpis',
  selectedDate: todayYmd(),
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth() + 1,
  selectedUser: null,
};

const $ = (id) => document.getElementById(id);

// -------------------------------------------------------------------------
// Komunikácia so serverom
// -------------------------------------------------------------------------

let pending = 0;

// -------------------------------------------------------------------------
// Posledné načítané údaje v prehliadači – aplikácia ich ukáže hneď pri
// otvorení a čerstvé údaje zo servera dotiahne na pozadí.
// -------------------------------------------------------------------------

const SNAPSHOT_DETAILS = 5;

const SNAPSHOT_KEY = 'gazda.snap';

function snapshotKey() {
  return SNAPSHOT_KEY;
}

function clearSnapshot() {
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
    localStorage.removeItem('gazda.token'); // z čias osobných odkazov
  } catch (e) {}
}

function readSnapshot() {
  try {
    const snap = JSON.parse(localStorage.getItem(snapshotKey()) || 'null');
    return snap && snap.email && Array.isArray(snap.households) ? snap : null;
  } catch (e) {
    return null;
  }
}

function saveSnapshot() {
  if (!state.email) return;
  try {
    const snap = readSnapshot() || { details: {} };
    snap.email = state.email;
snap.nickname = state.nickname;
    snap.households = state.households;
    snap.details = snap.details || {};
    if (state.detail) {
      const id = state.detail.household.id;
      delete snap.details[id];
      // Neuložené (práve ukladané) úlohy do pamäte telefónu nedávaj.
      snap.details[id] = { ...state.detail, cinnosti: state.detail.cinnosti.filter((c) => !c.pending) };
      snap.lastId = id;
      // Drž len niekoľko naposledy otvorených domácností.
      Object.keys(snap.details)
        .slice(0, -SNAPSHOT_DETAILS)
        .forEach((k) => delete snap.details[k]);
    }
    // Domácnosti, ku ktorým už nemám prístup, zabudni.
    Object.keys(snap.details).forEach((k) => {
      if (!state.households.some((h) => h.id === k)) delete snap.details[k];
    });
    localStorage.setItem(snapshotKey(), JSON.stringify(snap));
  } catch (e) {
    // Plné alebo nedostupné úložisko – aplikácia funguje aj bez neho.
  }
}

function cachedDetail(householdId) {
  const snap = readSnapshot();
  return (snap && snap.details && snap.details[householdId]) || null;
}

/** Smie sa obrazovka prekresliť čerstvými údajmi? (nie keď je otvorené okno) */
function canRefreshView() {
  return $('modal').classList.contains('hidden');
}

// Funkcie, ktoré len čítajú; ostatné menia údaje (pozri mutations nižšie).
const READ_ONLY = new Set(['getHouseholds', 'getStartData', 'getHouseholdData']);
let mutations = 0;

/** Zavolá funkciu servera (POST /api/<fn>) s osobným kľúčom. */
function api(fn, ...args) {
  return request(fn, args, false);
}

/** Ako api(), ale bez točiaceho sa kolieska (obnova na pozadí). */
function apiQuiet(fn, ...args) {
  return request(fn, args, true);
}

async function request(fn, args, quiet) {
  pending++;
  if (!READ_ONLY.has(fn)) mutations++;
  if (!quiet) $('busy').classList.remove('hidden');
  try {
    let res;
    try {
      res = await fetch('/api/' + fn, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args }),
      });
    } catch (e) {
      throw Object.assign(new Error('Nepodarilo sa spojiť so serverom. Skontroluj pripojenie na internet.'), {
        offline: true,
      });
    }
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      // odpoveď nie je JSON (výpadok servera)
    }
    if (!res.ok || !body || body.error) {
      throw Object.assign(
        new Error((body && body.error) || 'Server je nedostupný (' + res.status + '). Skús to o chvíľu.'),
        { code: body && body.code }
      );
    }
    return body.result;
  } catch (err) {
    // „Vypršalo“ len ak bol človek na tomto zariadení už prihlásený (má uložené údaje).
    if (isLoginRequired(err)) showLogin(Boolean(readSnapshot()));
    throw err;
  } finally {
    pending--;
    if (!pending) $('busy').classList.add('hidden');
  }
}

function isLoginRequired(err) {
  return Boolean(err && err.code === 'LOGIN_REQUIRED');
}

function errorMessage(err) {
  return (err && err.message ? err.message : String(err)).replace(/^Error:\s*/, '');
}

let toastTimer;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 6000 : 3000);
}

function showError(err) {
  toast(errorMessage(err), true);
}

// -------------------------------------------------------------------------
// Prihlásenie Google účtom
// -------------------------------------------------------------------------

/** Obrazovka prihlásenia (expired = relácia vypršala alebo bola zrušená). */
function showLogin(expired) {
  closeModal(true);
  state.detail = null;
  state.email = '';
  ['backBtn', 'bellBtn', 'avatar', 'tabs'].forEach((id) => $(id).classList.add('hidden'));
  $('brand').classList.remove('hidden');
  document.body.classList.remove('with-tabs');
  $('title').textContent = 'Gazda';
  $('view').innerHTML =
    '<div class="empty login"><img class="login-logo" src="/icons/icon.svg" alt="">' +
    '<h2>Prihlás sa do Gazdu</h2>' +
    '<div>' + (expired ? 'Prihlásenie vypršalo. ' : '') +
    'Použi svoj Google účet – ten e-mail, s ktorým ti niekto zdieľal domácnosť.</div>' +
    '<div id="googleBtn" class="google-btn"></div>' +
    '<div class="hint" id="loginHint"></div></div>';
  renderGoogleButton();
}

let gisScript = null;
function loadGoogleScript() {
  if (!gisScript) {
    gisScript = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.onload = resolve;
      el.onerror = () => {
        gisScript = null;
        reject(new Error('Prihlásenie Google sa nepodarilo načítať. Skontroluj internet.'));
      };
      document.head.append(el);
    });
  }
  return gisScript;
}

async function renderGoogleButton() {
  const hint = $('loginHint');
  try {
    const config = await fetch('/api/auth/config').then((r) => r.json());
    const clientId = config && config.result && config.result.googleClientId;
    if (!clientId) {
      hint.textContent = 'Prihlásenie Google účtom ešte nie je nastavené (chýba Client ID).';
      return;
    }
    await loadGoogleScript();
    google.accounts.id.initialize({
      client_id: clientId,
      callback: onGoogleCredential,
      auto_select: true, // kto sa už raz prihlásil, prihlási sa sám
      use_fedcm_for_prompt: true,
      itp_support: true,
    });
    // Po odhlásení sa nesmie hneď znova prihlásiť automaticky (Google si to zapamätá).
    if (readFlag(LOGGED_OUT_KEY)) {
      google.accounts.id.disableAutoSelect();
      setFlag(LOGGED_OUT_KEY, false);
    }
    const box = $('googleBtn');
    if (!box) return;
    google.accounts.id.renderButton(box, {
      theme: 'filled_blue',
      size: 'large',
      shape: 'pill',
      text: 'signin_with',
      locale: 'sk',
      width: Math.min(320, box.clientWidth || 320),
    });
    google.accounts.id.prompt();
  } catch (err) {
    if (hint) hint.textContent = errorMessage(err);
  }
}

/** Google vrátil ID token – server ho overí a nastaví prihlásenie (cookie). */
async function onGoogleCredential(response) {
  $('busy').classList.remove('hidden');
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.error) throw new Error((body && body.error) || 'Prihlásenie sa nepodarilo.');
    // Iný človek na tomto zariadení – údaje predchádzajúceho nepoužívaj.
    const snap = readSnapshot();
    if (snap && snap.email !== body.result.email) clearSnapshot();
    await loadHouseholds(true);
  } catch (err) {
    showError(err);
  } finally {
    if (!pending) $('busy').classList.add('hidden');
  }
}

async function logout() {
  try {
    await disablePush();
  } catch (e) {
    // aj tak pokračuj v odhlásení
  }
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  } catch (e) {
    // aj bez internetu zabudni údaje v telefóne
  }
  clearSnapshot();
  state.households = [];
  // Automatické prihlásenie vypni, keď sa načíta prihlasovanie Google (renderGoogleButton).
  setFlag(LOGGED_OUT_KEY, true);
  showLogin(false);
}

const LOGGED_OUT_KEY = 'gazda.loggedOut';

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch (e) {
    return false;
  }
}

function setFlag(key, on) {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch (e) {}
}

/** Po zdieľaní: povedz novému členovi, kde je Gazda a ktorým účtom sa prihlásiť. */
function showInviteInfo(emails) {
  if (!emails.length) return;
  const url = location.origin + '/';
  openModal(
    '<h2>Daj im vedieť</h2>' +
      '<div class="subtitle">' + esc(emails.join(', ')) + ' sa do Gazdu prihlási svojím Google účtom ' +
      '(tým e-mailom). Pošli ' + (emails.length === 1 ? 'mu' : 'im') + ' adresu aplikácie:</div>' +
      '<div class="field"><div class="row" style="align-items:center">' +
      '<input readonly id="appUrl" value="' + esc(url) + '" style="flex:3">' +
      '<button type="button" class="btn tonal small" id="copy" style="flex:0 0 auto" title="Kopírovať">' +
      '<span class="ms">content_copy</span></button>' +
      '<button type="button" class="btn tonal small" id="send" style="flex:0 0 auto" title="Poslať">' +
      '<span class="ms">share</span></button></div></div>' +
      '<div class="actions"><button type="button" class="btn" id="done">Hotovo</button></div>',
    (root) => {
      root.querySelector('#done').onclick = closeModal;
      root.querySelector('#copy').onclick = () => copyText(root.querySelector('#appUrl'));
      root.querySelector('#send').onclick = async () => {
        const text = 'Pridal som ťa do aplikácie Gazda. Otvor ' + url + ' a prihlás sa Google účtom.';
        if (navigator.share) {
          try {
            await navigator.share({ title: 'Gazda', text });
            return;
          } catch (e) {
            if (e && e.name === 'AbortError') return;
          }
        }
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
      };
    },
    { focus: false }
  );
}

async function copyText(input) {
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    toast('Skopírované');
  } catch (e) {
    const copied = document.execCommand && document.execCommand('copy');
    toast(copied ? 'Skopírované' : 'Text je označený – podrž prst a skopíruj ho');
  }
}

function showAccount() {
  openModal(
    '<h2>' + esc(state.nickname || state.email) + '</h2><div class="subtitle">' + esc(state.email) + '</div>' +
      '<div class="members"><div><span class="ms">lock</span>Prihlásený Google účtom. ' +
      'Na tomto zariadení ostaneš prihlásený, kým sa neodhlásiš.</div></div>' +
      (canInstall()
        ? '<button type="button" class="btn small" id="install" style="margin:4px 8px 12px 0">' +
          '<span class="ms">add</span>Nainštalovať Gazdu</button>'
        : '') +
      '<button type="button" class="btn tonal small" id="import" style="margin:4px 0 12px">' +
      '<span class="ms">refresh</span>Preniesť zo starej Gazdy</button>' +
      '<div class="actions"><button type="button" class="btn text" id="nick" style="margin-right:auto">' +
      '<span class="ms">edit</span>Prezývka</button>' +
      '<button type="button" class="btn text" id="cancel">Zavrieť</button>' +
      '<button type="button" class="btn danger" id="logout">Odhlásiť sa</button></div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#logout').onclick = logout;
      root.querySelector('#nick').onclick = () => showNicknameForm(state.nickname, false);
      root.querySelector('#import').onclick = showImportCode;
      const install = root.querySelector('#install');
      if (install) install.onclick = installApp;
    }
  );
}

/** Prenos zo starej Gazdy (Google tabuľka): jednorazový kód, ktorý sa zadá v starej Gazde. */
async function showImportCode() {
  let res;
  try {
    res = await api('createImportCode');
  } catch (err) {
    showError(err);
    return;
  }
  const code = res.code.slice(0, 4) + '-' + res.code.slice(4);
  openModal(
    '<h2>Prenos zo starej Gazdy</h2>' +
      '<div class="subtitle">Prenesie domácnosti, členov, priestory, úlohy, checklisty a našepkávanie ' +
      'z Google tabuľky. Dá sa zopakovať – nič sa nezdvojí.</div>' +
      '<div class="import-code" id="code">' + esc(code) + '</div>' +
      '<ol class="steps">' +
      '<li>Otvor <b>starú Gazdu</b> (Google) a ťukni na svoj krúžok vpravo hore.</li>' +
      '<li>Zvoľ <b>Preniesť do novej Gazdy</b>.</li>' +
      '<li>Zadaj adresu <b>' + esc(res.appUrl) + '</b> a tento kód.</li></ol>' +
      '<div class="hint">Kód platí ' + res.minutes + ' minút a dá sa použiť raz. Prenos môže spustiť len ' +
      'vlastník starej Gazdy a musí byť prihlásený tým istým Google účtom ako tu.</div>' +
      '<div class="actions"><button type="button" class="btn text" id="cancel">Zavrieť</button>' +
      '<button type="button" class="btn" id="done"><span class="ms">refresh</span>Hotovo – načítať</button></div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#done').onclick = () => {
        closeModal();
        loadHouseholds(true);
      };
    },
    { focus: false }
  );
}

/** Prezývka: po prvom prihlásení povinná (first = true), neskôr z „Môj účet“. */
function showNicknameForm(value, first) {
  openModal(
    '<h2>' + (first ? 'Ako ťa majú volať?' : 'Zmeniť prezývku') + '</h2>' +
      '<div class="subtitle">Ostatní v domácnosti uvidia namiesto e-mailu túto prezývku.</div>' +
      '<form id="f"><div class="field"><label>Prezývka</label>' +
      '<input name="nickname" maxlength="30" required autocomplete="nickname" placeholder="napr. Roman, Mama, Ocino" value="' +
      esc(value || '') + '"></div>' +
      '<div class="actions">' +
      (first ? '' : '<button type="button" class="btn text" id="cancel">Zrušiť</button>') +
      '<button class="btn">' + (first ? 'Pokračovať' : 'Uložiť') + '</button></div></form>',
    (root) => {
      if (!first) root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button:not([type])');
        button.disabled = true;
        try {
          const res = await api('setNickname', e.target.nickname.value);
          showIdentity(state.email, res.nickname);
          closeModal(true);
          if (state.detail) renderDetail({ quiet: true });
          else renderHouseholds();
          toast(first ? 'Vitaj, ' + res.nickname + '!' : 'Prezývka uložená');
        if (first && (!pushSupported() || Notification.permission === 'default')) showNotificationSettings();
        } catch (err) {
          button.disabled = false;
          showError(err);
        }
      };
    },
    { persistent: first }
  );
}

// -------------------------------------------------------------------------
// Pomocné funkcie
// -------------------------------------------------------------------------

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function dayNumber(p) {
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
}

function weekday(s) {
  const p = parseYmd(s);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

function formatDate(s) {
  const p = parseYmd(s);
  return p.d + '. ' + p.m + '. ' + p.y;
}

function formatDateShort(s) {
  const p = parseYmd(s);
  return WEEKDAYS_SHORT[weekday(s)].toLowerCase() + ' ' + p.d + '. ' + p.m + '.';
}

function formatDateLong(s) {
  return WEEKDAYS[weekday(s)] + ', ' + formatDate(s);
}

/** Ako sa človek zobrazuje: prezývka, kým ju nemá, tak časť e-mailu pred @. */
function shortName(email) {
  if (!email) return 'Nepriradené';
  return nicknameOf(email) || email.split('@')[0];
}

function nicknameOf(email) {
  if (email === state.email && state.nickname) return state.nickname;
  const lists = [(state.detail && state.detail.members) || []].concat(state.households.map((h) => h.members || []));
  for (const list of lists) {
    const m = list.find((x) => x.email === email && x.nickname);
    if (m) return m.nickname;
  }
  return '';
}

function membersLabel(n) {
  if (n === 1) return '1 člen';
  return n + (n >= 2 && n <= 4 ? ' členovia' : ' členov');
}

function iconName(name) {
  return ICONS[name] || 'home';
}

function periodicityLabel(c) {
  const p = PERIODICITY[c.periodicity] || PERIODICITY.none;
  if (c.periodicity === 'none') return p.label;
  const n = c.repeatInterval || 1;
  return n === 1 ? p.label : p.label + ' (každých ' + n + ' ' + p.unit + ')';
}

/** Vyskytuje sa činnosť v daný deň? (rovnaká logika ako vo Flutter verzii) */
function occursOn(c, date) {
  if (c.dueDate === date) return true;
  if (c.periodicity === 'none') return false;

  const a = parseYmd(c.dueDate);
  const b = parseYmd(date);
  const diff = dayNumber(b) - dayNumber(a);
  if (diff < 0) return false;
  const n = Math.max(1, c.repeatInterval || 1);

  switch (c.periodicity) {
    case 'weekly':
      return diff % 7 === 0 && (diff / 7) % n === 0;
    case 'monthly':
      return a.d === b.d && ((b.y - a.y) * 12 + (b.m - a.m)) % n === 0;
    case 'annually':
      return a.d === b.d && a.m === b.m && (b.y - a.y) % n === 0;
  }
  return false;
}

function tasksForDate(date, onlyMine) {
  if (!state.detail) return [];
  return state.detail.cinnosti
    .filter((c) => occursOn(c, date))
    .filter((c) => !onlyMine || c.assignedTo === state.email)
    .sort((x, y) => x.name.localeCompare(y.name, 'sk'));
}

function priestorName(id) {
  const p = state.detail.priestory.find((p) => p.id === id);
  if (!id) return '';
  return p ? p.name : 'Neznámy priestor';
}

// -------------------------------------------------------------------------
// Modálne okno
// -------------------------------------------------------------------------

let modalOnClose = null;

/** opts.focus = false: neotvárať klávesnicu; opts.onClose: zavolá sa po zatvorení okna. */
let modalPersistent = false;

function openModal(html, onMount, opts) {
  opts = opts || {};
  modalOnClose = opts.onClose || null;
  modalPersistent = Boolean(opts.persistent);
  $('modalContent').innerHTML = html;
  $('modal').classList.remove('hidden');
  if (onMount) onMount($('modalContent'));
  if (opts.focus !== false) {
    const sel = typeof opts.focus === 'string' ? opts.focus : 'input, textarea, select';
    const first = $('modalContent').querySelector(sel);
    if (first) first.focus();
  }
}

function closeModal(force) {
  if (modalPersistent && force !== true) return;
  modalPersistent = false;
  const onClose = modalOnClose;
  modalOnClose = null;
  if (onClose) setTimeout(onClose, 0);
  $('modal').classList.remove('typing');
  $('modal').classList.add('hidden');
  $('modalContent').innerHTML = '';
}

$('modal').addEventListener('click', (e) => {
  if (e.target === $('modal')) closeModal();
});

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
// Zoznam domácností
// -------------------------------------------------------------------------

/** initial = true pri štarte aplikácie: rovno otvorí naposledy použitú domácnosť. */
function showIdentity(email, nickname) {
  state.email = email;
  state.nickname = nickname || '';
  const name = state.nickname || email;
  $('avatar').textContent = name.charAt(0).toUpperCase();
  $('avatar').title = name;
  $('avatar').classList.remove('hidden');
  $('bellBtn').classList.remove('hidden');
}

async function loadHouseholds(initial = false) {
  // Okamžite ukáž posledné známe údaje (ak sú), čerstvé prídu o chvíľu.
  let shownSnapshot = false;
  if (initial) {
    const snap = readSnapshot();
    if (snap) {
      showIdentity(snap.email, snap.nickname);
      state.households = snap.households;
      const detail = snap.lastId && snap.details && snap.details[snap.lastId];
      if (detail) showDetail(detail);
      else renderHouseholds();
      shownSnapshot = true;
    }
  } else if (state.households.length) {
    renderHouseholds();
    shownSnapshot = true;
  }

  try {
    const res = await api(initial ? 'getStartData' : 'getHouseholds');
    showIdentity(res.email, res.nickname);
    if (initial) syncPush();
    state.households = res.households;
    // Po prvom prihlásení si človek zvolí prezývku (vidia ju ostatní namiesto e-mailu).
    if (!res.nickname && !document.querySelector('#modal input[name=nickname]')) {
    setTimeout(() => showNicknameForm(res.suggestedNickname, true), 0);
  }
    if (!shownSnapshot) {
      if (res.lastDetail) showDetail(res.lastDetail);
      else renderHouseholds();
      return;
    }
    if (!canRefreshView()) {
      saveSnapshot();
      return;
    }
    if (state.detail) {
      const id = state.detail.household.id;
      if (res.lastDetail && res.lastDetail.household.id === id) {
        state.detail = res.lastDetail;
        renderDetail();
      } else if (!res.households.some((h) => h.id === id)) {
        renderHouseholds(); // domácnosť medzičasom zmizla
      } else {
        refreshDetail(id);
      }
    } else {
      renderHouseholds();
    }
  } catch (err) {
    if (!isLoginRequired(err) && !shownSnapshot) {
      $('view').innerHTML = '<div class="center">' + esc(errorMessage(err)) + '</div>';
    } else if (err.offline) {
      toast('Bez internetu – ukazujem posledné uložené údaje');
    } else if (!isLoginRequired(err)) {
      toast('Nepodarilo sa načítať čerstvé údaje: ' + errorMessage(err), true);
    }
  }
}

/** Na pozadí dotiahne čerstvý detail a prekreslí ho, ak je stále na obrazovke. */
async function refreshDetail(householdId) {
  try {
    const fresh = await api('getHouseholdData', householdId);
    if (state.detail && state.detail.household.id === householdId && canRefreshView()) {
      state.detail = fresh;
      renderDetail();
    }
  } catch (err) {
    if (!isLoginRequired(err)) toast('Nepodarilo sa načítať čerstvé údaje: ' + errorMessage(err), true);
  }
}

function renderHouseholds() {
  state.detail = null;
  $('title').textContent = 'Gazda';
  $('backBtn').classList.add('hidden');
  $('brand').classList.remove('hidden');
  $('tabs').classList.add('hidden');
  document.body.classList.remove('with-tabs');

  saveSnapshot();
  const list = state.households
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'sk'));

  let html =
    '<div class="page-head"><h2>Ahoj, ' + esc(shortName(state.email)) + '</h2>' +
    '<p>' + (list.length ? 'Tvoje domácnosti' : 'Začni vytvorením domácnosti') + '</p></div>';
  if (!list.length) {
    html +=
      '<div class="empty"><span class="ms">home</span>' +
      '<h2>Žiadne domácnosti</h2><div>Vytvor si prvú domácnosť a pozvi do nej ostatných.</div></div>';
  } else {
    html += list
      .map((h) => {
        const isOwner = h.createdByEmail === state.email;
        return (
          '<div class="card clickable" data-open="' + esc(h.id) + '">' +
          '<span class="ms house-icon">home</span>' +
          '<div class="card-body"><div class="card-title">' + esc(h.name) + '</div>' +
          '<div class="card-sub">' + (isOwner ? 'Moja domácnosť' : 'Zdieľa ' + esc(shortName(h.createdByEmail))) +
          '</div><div class="meta"><span class="tag"><span class="ms">group</span>' +
          membersLabel(h.members.length) + '</span></div></div>' +
          '<button class="icon-btn" title="Zdieľať" data-share="' + esc(h.id) + '"><span class="ms">share</span></button>' +
          (isOwner
            ? '<button class="icon-btn danger" title="Vymazať" data-delete="' + esc(h.id) + '"><span class="ms">delete</span></button>'
            : '') +
          '</div>'
        );
      })
      .join('');
  }

  html +=
    '<div class="fab-bar"><button class="btn" id="addHouseholdBtn">' +
    '<span class="ms">add</span>Pridať domácnosť</button></div>';
  $('view').innerHTML = installBannerHtml() + html;
  bindInstallBanner();

  $('addHouseholdBtn').onclick = showAddHousehold;
  $('view').querySelectorAll('[data-open]').forEach((el) => {
    el.onclick = () => openHousehold(el.dataset.open);
  });
  $('view').querySelectorAll('[data-share]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      showShareHousehold(el.dataset.share);
    };
  });
  $('view').querySelectorAll('[data-delete]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      confirmDeleteHousehold(el.dataset.delete);
    };
  });
}

function showAddHousehold() {
  openModal(
    '<h2>Nová domácnosť</h2><div class="subtitle">Napr. Byt, Chata, Dom u rodičov</div>' +
      '<form id="f"><div class="field"><label>Názov *</label><input name="name" maxlength="80" required></div>' +
      '<div class="field"><label>Zdieľať s (e-maily)</label>' +
      '<textarea name="emails" rows="2" placeholder="jana@gmail.com, peter@gmail.com"></textarea>' +
      '<div class="hint">Oddeľ čiarkou alebo novým riadkom. Môžeš pridať aj neskôr.</div></div>' +
      '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn">Vytvoriť</button></div></form>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        form.querySelector('button:not([type])').disabled = true;
        try {
          const res = await api('createHousehold', form.name.value, form.emails.value);
          state.households = res.households;
          closeModal();
          renderHouseholds();
          toast('Domácnosť „' + form.name.value.trim() + '“ bola vytvorená');
          const created = res.households[res.households.length - 1];
          showInviteInfo(created ? created.members.filter((m) => !m.joined).map((m) => m.email) : []);
        } catch (err) {
          form.querySelector('button:not([type])').disabled = false;
          showError(err);
        }
      };
    }
  );
}

function showShareHousehold(householdId) {
  const h = state.households.find((x) => x.id === householdId);
  const members = h.members
    .map(
      (m) =>
        '<div><span class="ms">' + (m.role === 'owner' ? 'star' : 'person') + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' +
        // Kto sa ešte neprihlásil, nemá prezývku – ukáž e-mail, nech je jasné, koho si pozval.
        esc(m.nickname || (m.email === state.email && state.nickname) || m.email) +
        (m.role === 'owner' ? ' <span class="muted">(zakladateľ)</span>' : '') +
        (m.joined ? '' : ' <span class="muted">· ešte sa neprihlásil</span>') +
        '</span></div>'
    )
    .join('');
  openModal(
    '<h2>Zdieľať domácnosť</h2><div class="subtitle">' + esc(h.name) + '</div>' +
      '<div class="members">' + members + '</div>' +
      '<form id="f"><div class="field"><label>E-mail</label>' +
      '<input name="email" type="email" required placeholder="meno@gmail.com"></div>' +
      '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn">Zdieľať</button></div></form>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();
        try {
          const res = await api('shareHousehold', householdId, email);
          state.households = res.households;
          closeModal();
          if (state.detail) {
            await reloadDetail();
          } else {
            renderHouseholds();
          }
          toast('Domácnosť zdieľaná s ' + email);
          const added = res.households.find((x) => x.id === householdId);
          const member = added && added.members.find((m) => m.email === email.toLowerCase());
          if (member && !member.joined) showInviteInfo([member.email]);
        } catch (err) {
          showError(err);
        }
      };
    }
  );
}

function confirmDeleteHousehold(householdId) {
  const h = state.households.find((x) => x.id === householdId);
  openModal(
    '<h2>Vymazať domácnosť?</h2>' +
      '<div class="subtitle">Domácnosť „' + esc(h.name) + '“ sa vymaže aj so všetkými ' +
      'priestormi a činnosťami. Táto akcia sa nedá vrátiť.</div>' +
      '<div class="actions"><button class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn danger" id="ok">Vymazať</button></div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#ok').onclick = async () => {
        try {
          const res = await api('deleteHousehold', householdId);
          state.households = res.households;
          closeModal();
          renderHouseholds();
          toast('Domácnosť bola vymazaná');
        } catch (err) {
          showError(err);
        }
      };
    }
  );
}

// -------------------------------------------------------------------------
// Detail domácnosti
// -------------------------------------------------------------------------

async function openHousehold(householdId) {
  const cached = cachedDetail(householdId);
  if (cached) {
    showDetail(cached);
    refreshDetail(householdId);
    return;
  }
  $('view').innerHTML = '<div class="center muted">Načítavam…</div>';
  try {
    showDetail(await api('getHouseholdData', householdId));
  } catch (err) {
    showError(err);
    renderHouseholds();
  }
}

function showDetail(detail) {
  state.detail = detail;
  state.tab = 'rozpis';
  state.selectedUser = null;
  goToToday(false);
  renderDetail();
}

async function reloadDetail() {
  state.detail = await api('getHouseholdData', state.detail.household.id);
  renderDetail();
}

function goToToday(render = true) {
  const now = new Date();
  state.calYear = now.getFullYear();
  state.calMonth = now.getMonth() + 1;
  state.selectedDate = todayYmd();
  if (render) renderDetail();
}

function changeMonth(delta) {
  state.calMonth += delta;
  if (state.calMonth < 1) {
    state.calMonth = 12;
    state.calYear--;
  } else if (state.calMonth > 12) {
    state.calMonth = 1;
    state.calYear++;
  }
  renderDetail();
}

function renderDetail(opts) {
  const d = state.detail;
  saveSnapshot();
  $('title').textContent = d.household.name;
  $('backBtn').classList.remove('hidden');
  $('brand').classList.add('hidden');
  $('tabs').classList.remove('hidden');
  document.body.classList.add('with-tabs');
  document.querySelectorAll('#tabs .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === state.tab);
  });
  const overdueCount = myOverdueTasks().length;
  const badge = $('overdueBadge');
  badge.textContent = overdueCount;
  badge.classList.toggle('hidden', !overdueCount);

  const onlyMine = state.tab === 'rozpis';
  let html = renderCalendar(onlyMine);
  html += onlyMine ? renderRozpis() : renderPlanovanie();
  $('view').innerHTML = installBannerHtml() + html;
  bindInstallBanner();
  // Tiché prekreslenie (po uložení) bez animácie kariet, aby nepreblikli.
  $('view').classList.toggle('no-anim', Boolean(opts && opts.quiet));
  bindDetailEvents();

  const selected = $('view').querySelector('.cal-day.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function renderCalendar(onlyMine) {
  const daysInMonth = new Date(state.calYear, state.calMonth, 0).getDate();
  const today = todayYmd();
  let days = '';
  for (let day = 1; day <= daysInMonth; day++) {
    const date = ymd(state.calYear, state.calMonth, day);
    const cls = ['cal-day'];
    if (date === state.selectedDate) cls.push('selected');
    if (date === today) cls.push('today');
    if (tasksForDate(date, onlyMine).length) cls.push('has');
    days +=
      '<button class="' + cls.join(' ') + '" data-date="' + date + '">' +
      '<div class="wd">' + WEEKDAYS_SHORT[weekday(date)] + '</div>' +
      '<div class="num">' + day + '</div><div class="dot"></div></button>';
  }
  return (
    '<div class="calendar"><div class="cal-head">' +
    '<button class="icon-btn" data-month="-1" title="Predchádzajúci mesiac"><span class="ms">chevron_left</span></button>' +
    '<div class="month">' + MONTHS[state.calMonth - 1] + ' ' + state.calYear + '</div>' +
    '<button class="btn tonal small" id="todayBtn">Dnes</button>' +
    '<button class="icon-btn" data-month="1" title="Ďalší mesiac"><span class="ms">chevron_right</span></button>' +
    '</div><div class="cal-days">' + days + '</div></div>'
  );
}

/** mode: 'mine' (Môj rozpis), 'overdue' (po termíne) alebo 'plan' (Plánovanie). */
function taskCard(c, mode) {
  const tag = (icon, text, cls) =>
    '<span class="tag' + (cls ? ' ' + cls : '') + '"><span class="ms">' + icon + '</span>' + esc(text) + '</span>';
  const info = [];
  if (c.pending) info.push(tag('schedule', 'Ukladá sa…'));
  if (mode === 'overdue') info.push(tag('warning', 'od ' + formatDateShort(c.dueDate), 'tag-danger'));
  if (c.kind === 'nakup') info.push(tag('shopping_cart', c.store || 'Nákup'));
  const progress = itemProgress(c);
  if (progress.total) {
    info.push(
      '<span class="tag' + (progress.done === progress.total ? ' tag-ok' : '') + '" data-progress="' + esc(c.id) + '">' +
        '<span class="ms">checklist</span><span>' + progress.done + '/' + progress.total + '</span></span>'
    );
  }
  if (c.priestorId) info.push(tag('location_on', priestorName(c.priestorId)));
  if (c.periodicity !== 'none') info.push(tag('repeat', periodicityLabel(c)));
  if (mode === 'plan') info.push(tag('person', shortName(c.assignedTo)));

  const action =
    mode === 'plan'
      ? '<button class="icon-btn" title="Upraviť" data-edit-task="' + esc(c.id) + '">' +
        '<span class="ms">edit</span></button>'
      : '<button class="btn tonal small' + (progress.total && progress.done === progress.total ? ' pulse' : '') +
        '" data-complete="' + esc(c.id) + '">' +
        '<span class="ms">check</span>Hotové</button>';

  return (
    '<div class="card clickable' + (mode === 'overdue' ? ' overdue' : '') + (progress.total ? ' has-list' : '') +
    (c.pending ? ' pending' : '') +
    '" data-open-task="' + esc(c.id) + '">' +
    '<span class="ms task-icon" style="background:' + esc(c.color) + '">' + iconName(c.icon) + '</span>' +
    '<div class="card-body"><div class="card-title">' + esc(c.name) + '</div>' +
    (c.description ? '<div class="card-sub">' + esc(c.description) + '</div>' : '') +
    '<div class="meta">' + info.join('') + '</div></div>' +
    action +
    cardChecklist(c) +
    '</div>'
  );
}

const CARD_ITEMS = 12;

/** Checklist priamo v karte – položky sa dajú odškrtnúť bez otvárania detailu.
 * Položky z letáka (s obrázkom) sú veľké dlaždice vedľa seba (posúvajú sa do strany),
 * ostatné sú pod nimi ako zoznam. */
function cardChecklist(c) {
  const items = c.items || [];
  if (!items.length) return '';
  const pictures = items.filter((i) => i.image);
  const plain = items.filter((i) => !i.image);
  const more = plain.length - CARD_ITEMS;
  const tiles = pictures.length
    ? '<div class="card-tiles">' +
      pictures
        .map(
          (i) =>
            '<button type="button" class="tile' + (i.done ? ' done' : '') + '" data-card-item="' + esc(i.id) +
            '" data-task="' + esc(c.id) + '"><span class="ms tile-check">' + (i.done ? 'check_box' : 'check_box_outline_blank') +
            '</span><span class="tile-zoom" data-preview="' + esc(i.image) + '"><span class="ms">zoom_in</span></span>' +
            '<img src="' + esc(i.image) + '" alt="" loading="lazy">' +
            '<span class="tile-text">' + esc(i.text) + '</span>' +
            '<span class="tile-meta">' + qtyHtml(i) + '</span></button>'
        )
        .join('') +
      '</div>'
    : '';
  return (
    '<div class="card-checklist">' +
    tiles +
    plain
      .slice(0, CARD_ITEMS)
      .map(
        (i) =>
          '<button type="button" class="check-item compact' + (i.done ? ' done' : '') + '" data-card-item="' + esc(i.id) +
          '" data-task="' + esc(c.id) + '"><span class="ms">' + (i.done ? 'check_box' : 'check_box_outline_blank') +
          '</span><span class="check-text">' + esc(i.text) + '</span>' + qtyHtml(i) + '</button>'
      )
      .join('') +
    (more > 0 ? '<div class="hint card-more">+ ďalšie ' + more + ' – ťukni na kartu</div>' : '') +
    '</div>'
  );
}

/** Po odškrtnutí z karty aktualizuje karty tej úlohy bez prekreslenia celého zoznamu. */
function refreshTaskCards(c) {
  const p = itemProgress(c);
  const all = p.total > 0 && p.done === p.total;
  const view = $('view');
  (c.items || []).forEach((i) => {
    view.querySelectorAll('[data-card-item="' + i.id + '"]').forEach((el) => {
      el.classList.toggle('done', i.done);
      el.querySelector('.ms').textContent = i.done ? 'check_box' : 'check_box_outline_blank';
    });
  });
  view.querySelectorAll('[data-progress="' + c.id + '"]').forEach((el) => {
    el.classList.toggle('tag-ok', all);
    el.lastChild.textContent = p.done + '/' + p.total;
  });
  view.querySelectorAll('[data-complete="' + c.id + '"]').forEach((el) => el.classList.toggle('pulse', all));
}

/** Odškrtne položku hneď na obrazovke a uloží na pozadí (pri chybe vráti späť). */
async function toggleChecklistItem(c, itemId, refresh) {
  const item = (c.items || []).find((i) => i.id === itemId);
  if (!item) return;
  item.done = !item.done;
  refresh();
  const p = itemProgress(c);
  if (p.total && p.done === p.total) toast('Všetko odškrtnuté – ťukni Hotové');
  try {
    const saved = await api('toggleItem', itemId, item.done);
    item.done = saved.done;
    saveSnapshot();
  } catch (err) {
    item.done = !item.done;
    refresh();
    showError(err);
  }
}

function emptyDay() {
  return (
    '<div class="empty compact"><span class="ms">event_available</span>' +
    '<div>Na ' + formatDate(state.selectedDate) + ' nie sú žiadne činnosti</div></div>'
  );
}

/** Moje úlohy, ktorých termín už prešiel (najstaršie prvé). */
function myOverdueTasks() {
  if (!state.detail) return [];
  const today = todayYmd();
  return state.detail.cinnosti
    .filter((c) => c.assignedTo === state.email && c.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name, 'sk'));
}

function renderRozpis() {
  const myTasks = state.detail.cinnosti.filter((c) => c.assignedTo === state.email);
  if (!myTasks.length) {
    return (
      '<div class="empty"><span class="ms">checklist</span><h2>Môj rozpis</h2>' +
      '<div>Nemáš žiadne priradené činnosti</div></div>'
    );
  }

  let html = '';
  const overdue = myOverdueTasks();
  if (overdue.length) {
    html +=
      '<div class="section-title danger"><span class="ms">warning</span>Po termíne (' + overdue.length + ')</div>' +
      overdue.map((c) => taskCard(c, 'overdue')).join('') +
      '<div class="section-gap"></div>';
  }

  // Úlohy po termíne už sú hore – v dnešnom (a skoršom) dni ich neopakujeme.
  const overdueIds = new Set(overdue.map((c) => c.id));
  const hideOverdue = state.selectedDate <= todayYmd();
  const tasks = tasksForDate(state.selectedDate, true).filter((c) => !(hideOverdue && overdueIds.has(c.id)));
  html += '<div class="section-title">' + formatDateLong(state.selectedDate) + '</div>';
  if (!tasks.length) {
    html += emptyDay();
  } else {
    html += tasks.map((c) => taskCard(c, 'mine')).join('');
  }
  return html;
}

function renderPlanovanie() {
  const all = tasksForDate(state.selectedDate, false);
  const users = [...new Set(all.map((c) => c.assignedTo))].sort();
  if (state.selectedUser !== null && !users.includes(state.selectedUser)) {
    state.selectedUser = null;
  }
  const tasks =
    state.selectedUser === null ? all : all.filter((c) => c.assignedTo === state.selectedUser);

  let html = '<div class="section-title">' + formatDateLong(state.selectedDate) + '</div>';
  if (users.length > 1) {
    html +=
      '<div class="chips"><button class="chip' + (state.selectedUser === null ? ' active' : '') +
      '" data-user="">Všetci (' + all.length + ')</button>' +
      users
        .map((u) => {
          const n = all.filter((c) => c.assignedTo === u).length;
          return (
            '<button class="chip' + (state.selectedUser === u ? ' active' : '') +
            '" data-user="' + esc(u) + '" data-user-set="1">' + esc(shortName(u)) + ' (' + n + ')</button>'
          );
        })
        .join('') +
      '</div>';
  }

  if (!tasks.length) {
    html += emptyDay();
  } else {
    html += tasks.map((c) => taskCard(c, 'plan')).join('');
  }

  html +=
    '<div class="fab-bar"><button class="btn tonal" id="leafletsBtn"><span class="ms">newspaper</span>Letáky</button>' +
    '<button class="btn" id="addTaskBtn">' +
    '<span class="ms">add</span>Pridať činnosť</button></div>';
  return html;
}

function bindDetailEvents() {
  const view = $('view');
  view.querySelectorAll('[data-date]').forEach((el) => {
    el.onclick = () => {
      state.selectedDate = el.dataset.date;
      renderDetail();
    };
  });
  view.querySelectorAll('[data-month]').forEach((el) => {
    el.onclick = () => changeMonth(Number(el.dataset.month));
  });
  $('todayBtn').onclick = () => goToToday();

  view.querySelectorAll('[data-user]').forEach((el) => {
    el.onclick = () => {
      state.selectedUser = el.dataset.userSet ? el.dataset.user : null;
      renderDetail();
    };
  });
  view.querySelectorAll('[data-complete]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      completeTask(el.dataset.complete, el);
    };
  });
  view.querySelectorAll('[data-edit-task]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      showEditCinnost(el.dataset.editTask);
    };
  });
  view.querySelectorAll('[data-card-item]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const zoom = e.target.closest('[data-preview]');
      if (zoom) return showImagePreview(zoom.dataset.preview);
      const c = state.detail.cinnosti.find((x) => x.id === el.dataset.task);
      if (c) toggleChecklistItem(c, el.dataset.cardItem, () => refreshTaskCards(c));
    };
  });
  view.querySelectorAll('[data-open-task]').forEach((el) => {
    el.onclick = () => showTaskDetail(el.dataset.openTask);
  });
  if ($('addTaskBtn')) $('addTaskBtn').onclick = showPriestorSelector;
  if ($('leafletsBtn')) $('leafletsBtn').onclick = () => openLeaflets();
}

async function completeTask(id, button) {
  button.disabled = true;
  try {
    const res = await api('completeCinnost', id);
    const list = state.detail.cinnosti;
    const index = list.findIndex((c) => c.id === id);
    if (res.deleted) {
      if (index !== -1) list.splice(index, 1);
      toast('Úloha bola vymazaná');
    } else {
      if (index !== -1) list[index] = res.cinnost;
      toast('Úloha presunutá na ' + formatDate(res.cinnost.dueDate));
    }
    renderDetail();
  } catch (err) {
    button.disabled = false;
    showError(err);
  }
}

function deleteTask(id) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  openModal(
    '<h2>Vymazať činnosť?</h2><div class="subtitle">„' + esc(c.name) + '“' +
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
          toast('Činnosť „' + c.name + '“ bola vymazaná');
        } catch (err) {
          showError(err);
        }
      };
    }
  );
}

// -------------------------------------------------------------------------
// Priestory a nová činnosť
// -------------------------------------------------------------------------

function showPriestorSelector() {
  openModal(
    '<h2>Vyber priestor</h2><div class="subtitle">Kde sa má činnosť robiť?</div>' +
      '<div class="card clickable shop-entry" id="shopEntry"><span class="ms">shopping_cart</span>' +
      '<div class="card-body"><div class="card-title">Nákup</div><div class="hint">bez priestoru – stačí obchod a zoznam</div></div>' +
      '<span class="ms muted">chevron_right</span></div>' +
      '<div class="field"><input id="search" placeholder="Hľadaj priestor…"></div>' +
      '<div class="list-select" id="plist"></div>' +
      '<div class="actions"><button class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn tonal" id="newP"><span class="ms">add</span>Nový priestor</button></div>',
    (root) => {
      const renderList = () => {
        const q = root.querySelector('#search').value.trim().toLowerCase();
        const items = state.detail.priestory
          .filter((p) => p.name.toLowerCase().includes(q))
          .sort((a, b) => a.name.localeCompare(b.name, 'sk'));
        root.querySelector('#plist').innerHTML = items.length
          ? items
              .map(
                (p) =>
                  '<div class="card" data-pid="' + esc(p.id) + '"><span class="ms">location_on</span>' +
                  '<div class="card-body card-title">' + esc(p.name) + '</div>' +
                  '<span class="ms muted">chevron_right</span></div>'
              )
              .join('')
          : '<div class="empty">' +
            (state.detail.priestory.length ? 'Nič sa nenašlo' : 'Žiadne priestory. Vytvor si prvý!') +
            '</div>';
        root.querySelectorAll('[data-pid]').forEach((el) => {
          el.onclick = () => showCinnostForm(el.dataset.pid);
        });
      };
      root.querySelector('#search').oninput = renderList;
      root.querySelector('#shopEntry').onclick = () => showCinnostForm('', null, { shopping: true });
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#newP').onclick = showNewPriestor;
      renderList();
    },
    // Bez automatického fokusu – klávesnica by zakryla voľbu Nákup.
    { focus: false }
  );
}

function showNewPriestor() {
  openModal(
    '<h2>Nový priestor</h2><div class="subtitle">Zadajte názov priestoru (napr. Kuchyňa, Záhrada)</div>' +
      '<form id="f"><div class="field"><input name="name" maxlength="60" required></div>' +
      '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn">Pridať</button></div></form>',
    (root) => {
      root.querySelector('#cancel').onclick = showPriestorSelector;
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const p = await api('addPriestor', state.detail.household.id, e.target.name.value);
          state.detail.priestory.push(p);
          toast('Priestor „' + p.name + '“ bol pridaný');
          showCinnostForm(p.id);
        } catch (err) {
          showError(err);
        }
      };
    }
  );
}

// -------------------------------------------------------------------------
// Našepkávanie (položky checklistu, obchody)
// -------------------------------------------------------------------------

const DEFAULT_STORES = ['Lidl', 'Kaufland', 'Tesco', 'Billa', 'Coop Jednota', 'Penny', 'Terno',
  'Fresh', 'Biedronka', 'dm drogerie', 'Teta drogérie', 'Rossmann', 'Hornbach', 'OBI', 'IKEA',
  'Decathlon', 'Lekáreň', 'Pekáreň', 'Mäsiarstvo', 'Trh'];

function normalizeText(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

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
    if (!i.price || i.done) return;
    any = true;
    const m = String(i.qty || '').match(/^(\d+(?:,\d+)?) (ks|bal\.)$/);
    sum += Number(i.price) * (m ? Number(m[1].replace(',', '.')) : 1);
  });
  return any ? sum : null;
}

function itemProgress(c) {
  const items = c.items || [];
  return { done: items.filter((i) => i.done).length, total: items.length };
}

function showTaskDetail(id) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  if (!c) return;
  const shopping = c.kind === 'nakup';
  const meta = [];
  if (shopping) meta.push('<span class="tag"><span class="ms">shopping_cart</span>' + esc(c.store || 'Nákup') + '</span>');
  if (c.priestorId) meta.push('<span class="tag"><span class="ms">location_on</span>' + esc(priestorName(c.priestorId)) + '</span>');
  meta.push('<span class="tag"><span class="ms">calendar_month</span>' + esc(formatDateShort(c.dueDate)) + '</span>');
  if (c.periodicity !== 'none') meta.push('<span class="tag"><span class="ms">repeat</span>' + esc(periodicityLabel(c)) + '</span>');
  meta.push('<span class="tag"><span class="ms">person</span>' + esc(shortName(c.assignedTo)) + '</span>');

  openModal(
    '<h2>' + esc(c.name) + '</h2>' +
      '<div class="meta" style="margin:6px 0 14px">' + meta.join('') + '</div>' +
      (c.description ? '<div class="subtitle">' + esc(c.description) + '</div>' : '') +
      '<div class="field"><label id="checkLabel"></label><div class="checklist" id="checklist"></div>' +
      '<div class="item-add">' + stepperHtml('id="qtyInput"') +
      '<input id="itemInput" maxlength="100" placeholder="' +
      (shopping ? 'Pridať produkt…' : 'Pridať položku…') + '" autocomplete="off">' +
      '<button type="button" class="btn tonal small" id="itemAdd"><span class="ms">add</span></button></div>' +
      '<div class="suggest hidden" id="itemSuggest"></div></div>' +
      '<div class="actions">' +
      '<button type="button" class="btn text" id="edit"><span class="ms">edit</span>Upraviť</button>' +
      (shopping ? '<button type="button" class="btn text" id="leaflets"><span class="ms">newspaper</span>Leták</button>' : '') +
      '<button type="button" class="btn text" id="cancel" style="margin-left:auto">Zavrieť</button>' +
      '<button type="button" class="btn" id="done"><span class="ms">check</span>Hotové</button></div>',
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
        const sorted = items.filter((i) => !i.done).concat(items.filter((i) => i.done));
        listEl.innerHTML = sorted.length
          ? sorted
              .map(
                (i) =>
                  '<button type="button" class="check-item' + (i.done ? ' done' : '') + '" data-item="' + esc(i.id) + '">' +
                  '<span class="ms">' + (i.done ? 'check_box' : 'check_box_outline_blank') + '</span>' + thumbHtml(i) +
                  '<span class="check-text">' + esc(i.text) + '</span>' + qtyHtml(i) + '</button>'
              )
              .join('')
          : '<div class="hint">Zatiaľ žiadne položky.</div>';
        root.querySelector('#done').classList.toggle('pulse', p.total > 0 && p.done === p.total);
        listEl.querySelectorAll('[data-item]').forEach((b) => {
          b.onclick = (e) => (e.target.dataset.preview ? showImagePreview(e.target.dataset.preview) : toggle(b.dataset.item));
        });
      };

      const toggle = (itemId) => toggleChecklistItem(c, itemId, renderList);

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
          c.items = (c.items || []).concat([item]);
          if (!state.detail.products.some((x) => normalizeText(x) === normalizeText(item.text))) {
            state.detail.products.unshift(item.text);
          }
          renderList();
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
      root.querySelector('#cancel').onclick = closeModal;
      root.querySelector('#edit').onclick = () => showCinnostForm(c.priestorId, c);
      if (shopping) {
        root.querySelector('#leaflets').onclick = () => {
          closeModal(true);
          openLeaflets({ taskId: c.id });
        };
      }
      root.querySelector('#done').onclick = (e) => {
        closeModal();
        completeTask(c.id, e.currentTarget);
      };
      renderList();
    },
    { focus: false, onClose: () => state.detail && renderDetail() }
  );
}

/** Obchod a položky novej/upravenej činnosti hneď ponúkaj v našepkávaní. */
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

/** Lokálna podoba činnosti zo zadaných údajov, kým ju server neuloží. */
function optimisticTask(data, previous) {
  const done = new Map(((previous && previous.items) || []).map((i) => [i.id, i.done]));
  const images = new Map(((previous && previous.items) || []).map((i) => [i.id, i.image]));
  const prices = new Map(((previous && previous.items) || []).map((i) => [i.id, i.price]));
  const kind = data.kind === 'nakup' ? 'nakup' : '';
  return {
    ...(previous || { id: 'tmp-' + ++tempIds, householdId: state.detail.household.id }),
    priestorId: data.priestorId,
    name: String(data.name).trim(),
    description: String(data.description || '').trim(),
    assignedTo: data.assignedTo,
    dueDate: data.dueDate,
    periodicity: data.periodicity,
    repeatInterval: data.periodicity === 'none' ? null : Number(data.repeatInterval) || 1,
    icon: data.icon,
    color: data.color,
    kind,
    store: kind ? String(data.store || '').trim() : '',
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

function showEditCinnost(id) {
  const c = state.detail.cinnosti.find((x) => x.id === id);
  if (c) showCinnostForm(c.priestorId, c);
}

/** Formulár novej činnosti, alebo úpravy existujúcej (existing). */
function showCinnostForm(priestorId, existing, opts) {
  const edit = Boolean(existing);
  const shopOnly = !edit && Boolean(opts && opts.shopping);
  const draft = opts && opts.draft;
  let v = existing || {
    name: '',
    description: '',
    assignedTo: state.email,
    dueDate: state.selectedDate,
    periodicity: 'none',
    repeatInterval: 1,
    icon: 'home',
    color: COLORS['Zelená'],
    kind: shopOnly ? 'nakup' : '',
    store: '',
    items: [],
  };
  if (draft) {
    // Po chybe pri ukladaní: vyplnené údaje, odškrtnutie položiek ostáva z pôvodnej úlohy.
    const done = new Map((v.items || []).map((i) => [i.id, i.done]));
    const images = new Map((v.items || []).map((i) => [i.id, i.image]));
    const prices = new Map((v.items || []).map((i) => [i.id, i.price]));
    v = {
      ...v,
      ...draft,
      items: draft.items.map((i) => ({ ...i, done: Boolean(i.id && done.get(i.id)), image: i.id && images.get(i.id), price: i.id && prices.get(i.id) })),
    };
  }
  // Pracovná kópia checklistu (formulár mení len texty a poradie, nie odškrtnutie).
  let items = (v.items || []).map((i) => ({ id: i.id, text: i.text, qty: i.qty || '', done: i.done, image: i.image, price: i.price }));
  const members = state.detail.members.map((m) => m.email).sort();
  // Ak je úloha pridelená niekomu, kto už nie je členom, ponecháme ho vo výbere.
  if (v.assignedTo && !members.includes(v.assignedTo)) members.push(v.assignedTo);
  const memberOptions =
    '<option value="">Nepriradené</option>' +
    members
      .map(
        (e) =>
          '<option value="' + esc(e) + '"' + (e === v.assignedTo ? ' selected' : '') + '>' +
          esc(e === state.email ? shortName(e) + ' (ja)' : shortName(e)) + '</option>'
      )
      .join('');
  const periodOptions = Object.keys(PERIODICITY)
    .map((k) => '<option value="' + k + '"' + (k === v.periodicity ? ' selected' : '') + '>' + PERIODICITY[k].label + '</option>')
    .join('');
  const priestorOptions = state.detail.priestory
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'sk'))
    .map((p) => '<option value="' + esc(p.id) + '"' + (p.id === priestorId ? ' selected' : '') + '>' + esc(p.name) + '</option>')
    .join('');
  // Priestor sa vyberá vo formulári pri úprave a pri nákupe (môže byť aj bez priestoru).
  const choosePriestor = edit || shopOnly;
  const priestorSelect =
    '<div class="field' + (choosePriestor ? '' : ' hidden') + '" id="priestorField"><label>Priestor</label><select name="priestorId">' +
    '<option value=""' + (priestorId ? '' : ' selected') + '>Bez priestoru (len nákup)</option>' + priestorOptions + '</select></div>';
  const currentIcon = ICONS[v.icon] ? v.icon : 'home';
  const currentColor = Object.values(COLORS).includes(v.color) ? v.color : COLORS['Zelená'];
  const iconButtons = Object.keys(ICONS)
    .map(
      (k) =>
        '<button type="button" data-icon="' + k + '" class="' + (k === currentIcon ? 'selected' : '') +
        '" title="' + k + '"><span class="ms">' + ICONS[k] + '</span></button>'
    )
    .join('');
  const colorButtons = Object.keys(COLORS)
    .map(
      (name) =>
        '<button type="button" data-color="' + COLORS[name] + '" title="' + name + '" class="' +
        (COLORS[name] === currentColor ? 'selected' : '') + '" style="background:' + COLORS[name] + '"></button>'
    )
    .join('');

  openModal(
    '<h2>' + (edit ? 'Upraviť činnosť' : 'Nová činnosť') + '</h2>' +
      (choosePriestor ? '' : '<div class="subtitle">Priestor: ' + esc(priestorName(priestorId)) + '</div>') +
      '<form id="f">' +
      '<div class="field"><label>Názov *</label><input name="name" maxlength="80" required placeholder="Čo je treba urobiť?" value="' + esc(v.name) + '"></div>' +
      '<label class="switch"><input type="checkbox" name="isShopping"' + (v.kind === 'nakup' ? ' checked' : '') + '>' +
      '<span class="switch-track"></span><span class="ms">shopping_cart</span>Nákup</label>' +
      '<div class="field hidden" id="storeField"><label>Obchod</label>' +
      '<input name="store" maxlength="60" placeholder="Kde? (napr. Lidl)" autocomplete="off" value="' + esc(v.store || '') + '">' +
      '<div class="suggest hidden" id="storeSuggest"></div></div>' +
      '<div class="field"><label id="itemsLabel">Checklist</label><div class="checklist" id="itemList"></div>' +
      '<div class="item-add">' + stepperHtml('id="qtyInput"') +
      '<input id="itemInput" maxlength="100" autocomplete="off" placeholder="Pridať položku…">' +
      '<button type="button" class="btn tonal small" id="itemAdd"><span class="ms">add</span></button></div>' +
      '<div class="suggest hidden" id="itemSuggest"></div></div>' +
      '<div class="field"><label>Popis</label><textarea name="description" rows="2" placeholder="Detaily a inštrukcie…">' + esc(v.description) + '</textarea></div>' +
      priestorSelect +
      '<div class="row"><div class="field"><label>Pridelené</label><select name="assignedTo">' + memberOptions + '</select></div>' +
      '<div class="field"><label>' + (edit ? 'Ďalší termín' : 'Termín') + '</label><input type="date" name="dueDate" required value="' + esc(v.dueDate) + '"></div></div>' +
      '<div class="row"><div class="field"><label>Opakovanie</label><select name="periodicity">' + periodOptions + '</select></div>' +
      '<div class="field hidden" id="intervalField"><label id="intervalLabel">Každých X</label>' +
      '<input type="number" name="repeatInterval" min="1" max="99" value="' + esc(v.repeatInterval || 1) + '"><div class="hint" id="intervalHint"></div></div></div>' +
      '<div class="field"><label>Ikona</label><div class="icon-grid">' + iconButtons + '</div></div>' +
      '<div class="field"><label>Farba</label><div class="color-grid">' + colorButtons + '</div></div>' +
      '<div class="actions">' +
      (edit ? '<button type="button" class="btn text danger-text" id="delete" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' : '') +
      '<button type="button" class="btn text" id="cancel">Zrušiť</button>' +
      '<button class="btn">' + (edit ? 'Uložiť' : 'Vytvoriť činnosť') + '</button></div></form>',
    (root) => {
      const form = root.querySelector('#f');
      let icon = currentIcon;
      let color = currentColor;
      if (edit) root.querySelector('#delete').onclick = () => deleteTask(existing.id);

      // Nákup: obchod s našepkávaním, ikona košíka, texty pre produkty.
      const shopping = form.isShopping;
      const storeInput = form.store;
      const itemInput = root.querySelector('#itemInput');
      const applyKind = () => {
        root.querySelector('#storeField').classList.toggle('hidden', !shopping.checked);
        root.querySelector('#itemsLabel').textContent = shopping.checked ? 'Nakúpiť' : 'Checklist';
        itemInput.placeholder = shopping.checked ? 'Pridať produkt…' : 'Pridať položku…';
        if (shopping.checked && icon === 'home') selectIcon('shopping');
        if (shopping.checked && !form.name.value.trim()) form.name.value = 'Nakúpiť';
      };
      shopping.onchange = applyKind;
      const storeSuggest = attachSuggest(storeInput, root.querySelector('#storeSuggest'), storeSources, null, (name) => {
        storeInput.value = name;
        storeSuggest.clear();
        if (/^nakúpiť$/i.test(form.name.value.trim())) form.name.value = 'Nakúpiť – ' + name;
      });

      // Checklist
      const renderItems = () => {
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
      const qtyInput = root.querySelector('#qtyInput');
      const addItemText = (raw) => {
        const { text, qty } = splitQty(raw, qtyInput.value);
        if (!text) return;
        const same = items.find((i) => normalizeText(i.text) === normalizeText(text));
        if (same) same.qty = qty || same.qty;
        else items.push({ text, qty, done: false });
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
      renderItems();

      form.periodicity.onchange = () => {
        const p = PERIODICITY[form.periodicity.value];
        root.querySelector('#intervalField').classList.toggle('hidden', form.periodicity.value === 'none');
        root.querySelector('#intervalLabel').textContent = p.unit ? 'Každých X ' + p.unit : '';
        root.querySelector('#intervalHint').textContent = p.hint || '';
      };
      function selectIcon(name) {
        root.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('selected', x.dataset.icon === name));
        icon = name;
      }
      root.querySelectorAll('[data-icon]').forEach((b) => {
        b.onclick = () => selectIcon(b.dataset.icon);
      });
      applyKind();
      root.querySelectorAll('[data-color]').forEach((b) => {
        b.onclick = () => {
          root.querySelectorAll('[data-color]').forEach((x) => x.classList.remove('selected'));
          b.classList.add('selected');
          color = b.dataset.color;
        };
      });
      form.periodicity.onchange();
      root.querySelector('#cancel').onclick = closeModal;
      // Pri úprave: posuň mriežku na vybranú ikonu a neotváraj hneď klávesnicu.
      const grid = root.querySelector('.icon-grid');
      const selectedIcon = grid.querySelector('.selected');
      if (selectedIcon) {
        grid.scrollTop += selectedIcon.getBoundingClientRect().top - grid.getBoundingClientRect().top - 4;
      }
      if (edit) setTimeout(() => document.activeElement && document.activeElement.blur(), 0);

      form.onsubmit = async (e) => {
        e.preventDefault();
        if (!form.isShopping.checked && !form.priestorId.value) {
          toast('Vyber priestor (bez priestoru môže byť len nákup)');
          form.priestorId.focus();
          return;
        }
        const submit = form.querySelector('button:not([type])');
        submit.disabled = true;
        const data = {
          priestorId: form.priestorId.value,
          name: form.name.value,
          description: form.description.value,
          assignedTo: form.assignedTo.value,
          dueDate: form.dueDate.value,
          periodicity: form.periodicity.value,
          repeatInterval: form.repeatInterval.value,
          icon,
          color,
          kind: form.isShopping.checked ? 'nakup' : '',
          store: form.isShopping.checked ? form.store.value : '',
          // Text v poli, ktorý ešte nebol pridaný Enterom, tiež pridaj.
          items: items
            .map((i) => ({ id: i.id, text: i.text, qty: i.qty }))
            .concat(itemInput.value.trim() ? [{ text: itemInput.value.trim(), qty: qtyInput.value }] : []),
        };
        // Okno sa zavrie hneď a úloha sa ukáže ako „Ukladá sa…“; server beží na pozadí.
        const list = state.detail.cinnosti;
        const previous = edit ? list.find((x) => x.id === existing.id) : null;
        const optimistic = optimisticTask(data, previous);
        if (previous) list[list.indexOf(previous)] = optimistic;
        else list.push(optimistic);
        rememberLocally(optimistic);
        closeModal();
        renderDetail();
        try {
          const c = edit
            ? await api('updateCinnost', existing.id, data)
            : await api('addCinnost', state.detail.household.id, data);
          const index = state.detail.cinnosti.indexOf(optimistic);
          if (index !== -1) state.detail.cinnosti[index] = c;
          rememberLocally(c);
          renderDetail({ quiet: true });
          toast(edit ? 'Zmeny uložené' : 'Činnosť „' + c.name + '“ bola vytvorená');
        } catch (err) {
          const index = state.detail.cinnosti.indexOf(optimistic);
          if (index !== -1) {
            if (previous) state.detail.cinnosti[index] = previous;
            else state.detail.cinnosti.splice(index, 1);
          }
          renderDetail({ quiet: true });
          showError(err);
          // Formulár znova otvor s tým, čo bolo vyplnené, nech sa nič nestratí.
          showCinnostForm(data.priestorId, previous, { draft: data, shopping: !previous && data.kind === 'nakup' });
        }
      };
    },
    // Pri nákupe rovno do poľa Obchod (názov je predvyplnený).
    { focus: shopOnly ? '[name=store]' : true }
  );
}

// -------------------------------------------------------------------------
// Upozornenia (push notifikácie)
// -------------------------------------------------------------------------

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function base64UrlToBytes(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Zvonček ukazuje, či sú upozornenia na tomto zariadení zapnuté. */
async function updateBell() {
  let on = false;
  try {
    on = Boolean(await currentSubscription()) && Notification.permission === 'granted';
  } catch (e) {}
  $('bellBtn').querySelector('.ms').textContent = on ? 'notifications_active' : 'notifications_off';
  $('bellBtn').title = on ? 'Upozornenia sú zapnuté' : 'Zapnúť upozornenia';
}

/** Pri štarte: existujúci odber zariadenia pošli serveru (napr. iný účet na tom istom telefóne). */
async function syncPush() {
  try {
    const sub = Notification.permission === 'granted' ? await currentSubscription() : null;
    if (sub) await apiQuiet('subscribePush', sub.toJSON());
  } catch (e) {
    // nepovinné
  }
  updateBell();
}

async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Upozornenia nie sú povolené. Povoľ ich pre Gazdu v nastaveniach prehliadača alebo telefónu.');
  }
  const { publicKey } = await api('getPushKey');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  await api('subscribePush', sub.toJSON());
}

async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    await api('unsubscribePush', sub.endpoint);
  } finally {
    await sub.unsubscribe();
  }
}

async function showNotificationSettings() {
  const what =
    '<div class="members">' +
    '<div><span class="ms">wb_sunny</span>Ráno o 8:00 prehľad tvojich úloh na dnes</div>' +
    '<div><span class="ms">warning</span>Úlohy, ktorým prešiel termín</div>' +
    '<div><span class="ms">assignment_add</span>Keď ti niekto pridelí úlohu (aj s checklistom)</div></div>';
  let status;
  let buttons = '<button type="button" class="btn text" id="cancel">Zavrieť</button>';

  if (!pushSupported()) {
    status =
      isIos() && !isStandalone()
        ? 'Na iPhone fungujú upozornenia len v Gazdovi pridanom na plochu: v Safari ťukni <b>Zdieľať</b> → ' +
          '<b>Pridať na plochu</b>, otvor Gazdu z plochy a zapni ich tam.'
        : 'Tento prehliadač upozornenia nepodporuje. Skús Chrome (Android) alebo Gazdu pridanú na plochu (iPhone).';
  } else if (Notification.permission === 'denied') {
    status =
      'Upozornenia sú pre Gazdu <b>zablokované</b> v nastaveniach prehliadača alebo telefónu. ' +
      'Povoľ ich tam (pri adrese stránky alebo v Nastaveniach → Upozornenia) a vráť sa sem.';
  } else if ((await currentSubscription().catch(() => null)) && Notification.permission === 'granted') {
    status = '✅ Upozornenia sú na tomto zariadení <b>zapnuté</b>.';
    buttons =
      '<button type="button" class="btn text danger-text" id="off" style="margin-right:auto">Vypnúť</button>' +
      buttons +
      '<button type="button" class="btn tonal" id="test"><span class="ms">send</span>Skúšobné</button>';
  } else {
    status = 'Upozornenia sú na tomto zariadení vypnuté. Zapni si ich – chodia, aj keď Gazdu nemáš otvorenú.';
    buttons += '<button type="button" class="btn" id="on"><span class="ms">notifications_active</span>Zapnúť</button>';
  }

  const installTip =
    pushSupported() && canInstall()
      ? '<div class="hint" style="margin-bottom:10px">💡 Najprv si Gazdu <a href="#" id="installTip">nainštaluj</a> – ' +
        'upozornenia potom prídu s ikonou a menom Gazdy (nie prehliadača). Zapni ich v nainštalovanej aplikácii.</div>'
      : '';
  openModal(
    '<h2>Upozornenia</h2><div class="subtitle">' + status + '</div>' + what + installTip +
      '<div class="actions">' + buttons + '</div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
      const tip = root.querySelector('#installTip');
      if (tip) {
        tip.onclick = (e) => {
          e.preventDefault();
          installApp();
        };
      }
      const on = root.querySelector('#on');
      if (on) {
        on.onclick = async () => {
          on.disabled = true;
          try {
            await enablePush();
            toast('Upozornenia zapnuté');
            showNotificationSettings();
          } catch (err) {
            on.disabled = false;
            showError(err);
          }
          updateBell();
        };
      }
      const off = root.querySelector('#off');
      if (off) {
        off.onclick = async () => {
          off.disabled = true;
          try {
            await disablePush();
            toast('Upozornenia vypnuté');
            showNotificationSettings();
          } catch (err) {
            off.disabled = false;
            showError(err);
          }
          updateBell();
        };
      }
      const test = root.querySelector('#test');
      if (test) {
        test.onclick = async () => {
          test.disabled = true;
          try {
            const res = await api('testPush');
            toast(res.sent ? 'Odoslané – o chvíľu príde notifikácia' : 'Nepodarilo sa doručiť – skús upozornenia vypnúť a zapnúť');
          } catch (err) {
            showError(err);
          } finally {
            test.disabled = false;
          }
        };
      }
    },
    { focus: false }
  );
}

// -------------------------------------------------------------------------
// Inštalácia aplikácie (vlastná ikona, notifikácie pod menom Gazda)
// -------------------------------------------------------------------------

let installPrompt = null; // Android/Chrome: systémové okno inštalácie
const INSTALL_DISMISSED_KEY = 'gazda.installDismissed';

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // namiesto lišty Chrome ponúkneme inštaláciu v aplikácii
  installPrompt = e;
  refreshInstallBanner();
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  refreshInstallBanner();
  toast('Gazda je nainštalovaná – nájdeš ju medzi aplikáciami');
});

function isIosSafari() {
  return isIos() && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|gsa/i.test(navigator.userAgent);
}

/** Dá sa Gazda nainštalovať (a ešte nie je)? */
function canInstall() {
  return !isStandalone() && Boolean(installPrompt || isIosSafari());
}

async function installApp() {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    if (!choice || choice.outcome !== 'accepted') installPrompt = prompt; // ponuka ostáva
    refreshInstallBanner();
    return;
  }
  openModal(
    '<h2>Nainštaluj si Gazdu</h2>' +
      '<div class="subtitle">Na iPhone sa Gazda inštaluje cez Safari:</div>' +
      '<ol class="steps"><li>Ťukni dole na <b>Zdieľať</b> (štvorček so šípkou).</li>' +
      '<li>Zvoľ <b>Pridať na plochu</b> a potvrď <b>Pridať</b>.</li>' +
      '<li>Otvor Gazdu z plochy, prihlás sa a zapni upozornenia 🔔.</li></ol>' +
      '<div class="actions"><button type="button" class="btn" id="cancel">Rozumiem</button></div>',
    (root) => {
      root.querySelector('#cancel').onclick = closeModal;
    },
    { focus: false }
  );
}

function installBannerHtml() {
  if (!canInstall() || readFlag(INSTALL_DISMISSED_KEY)) return '';
  return (
    '<div class="install-banner" id="installBanner"><img src="/icons/icon.svg" alt="">' +
    '<div class="text"><b>Nainštaluj si Gazdu</b>Ikona a upozornenia s logom Gazdy</div>' +
    '<button type="button" class="btn small" data-install>Inštalovať</button>' +
    '<button type="button" class="icon-btn small" data-install-close title="Teraz nie"><span class="ms">close</span></button></div>'
  );
}

function bindInstallBanner() {
  const banner = $('installBanner');
  if (!banner) return;
  banner.querySelector('[data-install]').onclick = installApp;
  banner.querySelector('[data-install-close]').onclick = () => {
    setFlag(INSTALL_DISMISSED_KEY, true);
    banner.remove();
  };
}

/** Ukáž / skry ponuku inštalácie na aktuálnej obrazovke. */
function refreshInstallBanner() {
  const view = $('view');
  const current = $('installBanner');
  const html = state.email ? installBannerHtml() : '';
  if (!html) {
    if (current) current.remove();
    return;
  }
  if (current) return;
  view.insertAdjacentHTML('afterbegin', html);
  bindInstallBanner();
}

// -------------------------------------------------------------------------
// Štart
// -------------------------------------------------------------------------

$('avatar').onclick = showAccount;
$('bellBtn').onclick = showNotificationSettings;

$('backBtn').onclick = () => {
  loadHouseholds();
};

document.querySelectorAll('#tabs .tab').forEach((t) => {
  t.onclick = () => {
    state.tab = t.dataset.tab;
    renderDetail();
  };
});

// Automatická obnova: zmeny od ostatných členov sa ukážu bez obnovenia stránky
// (pri otvorenej domácnosti každých 20 s a vždy po návrate do aplikácie).
const AUTO_REFRESH_MS = 20000;

async function autoRefresh() {
  if (document.hidden || !state.detail || !state.email || pending || !canRefreshView()) return;
  if (state.detail.cinnosti.some((c) => c.pending)) return;
  const id = state.detail.household.id;
  const before = mutations;
  try {
    const fresh = await apiQuiet('getHouseholdData', id);
    // Medzičasom niečo zmenené alebo iná obrazovka – čerstvé údaje by ju prepísali.
    if (mutations !== before || pending || !canRefreshView()) return;
    if (!state.detail || state.detail.household.id !== id) return;
    if (JSON.stringify(fresh) === JSON.stringify(state.detail)) return;
    state.detail = fresh;
    renderDetail({ quiet: true });
  } catch (err) {
    // Obnova na pozadí je nepovinná; chyby (napr. bez internetu) neukazuj.
  }
}

setInterval(autoRefresh, AUTO_REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) autoRefresh();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

loadHouseholds(true);
