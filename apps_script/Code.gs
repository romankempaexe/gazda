/**
 * Gazda – Google Apps Script web aplikácia na plánovanie domácich prác.
 *
 * Dáta sú uložené v Google tabuľke v piatich listoch:
 *   households – domácnosti
 *   members    – členovia domácností (kto má k domácnosti prístup)
 *   priestory  – priestory domácnosti (kuchyňa, kúpeľňa, ...)
 *   cinnosti   – činnosti (úlohy) priradené k priestoru
 *   users      – nastavenia používateľov (téma pre upozornenia ntfy, posledná domácnosť)
 *
 * Pred prvým použitím spusti z editora funkciu setup().
 * Upozornenia: v editore pridaj spúšťač pre funkciu notificationTick (každých 15 minút).
 */

const SHEETS = {
  households: ['id', 'name', 'createdByEmail', 'createdAt'],
  members: ['householdId', 'email', 'role', 'addedAt'],
  priestory: ['id', 'householdId', 'name', 'createdAt'],
  cinnosti: [
    'id',
    'householdId',
    'priestorId',
    'name',
    'description',
    'assignedTo',
    'icon',
    'color',
    'dueDate',
    'periodicity',
    'repeatInterval',
    'createdAt',
  ],
  users: ['email', 'ntfyTopic', 'createdAt', 'lastHouseholdId'],
};

const PERIODICITIES = ['none', 'weekly', 'monthly', 'annually'];
const SPREADSHEET_ID_KEY = 'SPREADSHEET_ID';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// Upozornenia (ntfy.sh). Server a prístupový token sa dajú zmeniť vo vlastnostiach
// skriptu NTFY_SERVER a NTFY_TOKEN, adresa aplikácie pre preklik vo vlastnosti APP_URL.
const NTFY_DEFAULT_SERVER = 'https://ntfy.sh';
const MORNING_HOUR = 8; // ranný prehľad chodí medzi 8:00 a 8:15
const MORNING_LAST_HOUR = 11; // neskôr ako o 11:00 sa zmeškaný prehľad už neposiela
const LAST_DIGEST_KEY = 'LAST_DIGEST_DATE';
const DAY_NAMES_SHORT = ['ne', 'po', 'ut', 'st', 'št', 'pi', 'so'];

// ---------------------------------------------------------------------------
// Web app
// ---------------------------------------------------------------------------

function doGet() {
  // Google pri autorizácii umožňuje odškrtnúť jednotlivé oprávnenia.
  // Ak niektoré chýba, namiesto chyby ukáž stránku s odkazom na autorizáciu.
  const auth = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (auth.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    return authorizationPage_(auth.getAuthorizationUrl());
  }
  rememberAppUrl_();

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Gazda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function authorizationPage_(url) {
  const html =
    '<!DOCTYPE html><html lang="sk"><head><base target="_top"><meta charset="UTF-8">' +
    '<style>body{font-family:system-ui,sans-serif;background:#f4f6f3;color:#0f172a;margin:0;' +
    'display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px;box-sizing:border-box}' +
    '.c{background:#fff;border-radius:24px;padding:28px;max-width:440px;box-shadow:0 4px 12px rgba(0,0,0,.08)}' +
    'h1{font-size:22px;margin:0 0 8px}p{color:#64748b;line-height:1.5}' +
    'a.b{display:inline-block;background:#16a34a;color:#fff;text-decoration:none;font-weight:600;' +
    'padding:12px 22px;border-radius:999px;margin-top:8px}</style></head><body><div class="c">' +
    '<h1>Gazda potrebuje povolenie</h1>' +
    '<p>Aplikácia ukladá dáta do Google tabuľky a posiela upozornenia, preto potrebuje prístup ' +
    'k Tabuľkám, k tvojej e-mailovej adrese a k externým službám. Na stránke Google zaškrtni ' +
    '<b>Vybrať všetko</b> a klikni <b>Pokračovať</b>.</p>' +
    '<a class="b" href="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" target="_blank">Povoliť prístup</a>' +
    '<p>Po povolení túto stránku obnov.</p></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Gazda – povolenie')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Spusti raz z editora: vytvorí tabuľku (ak treba) a listy s hlavičkami. */
function setup() {
  // Ak pri autorizácii nebolo povolené všetko, editor si oprávnenia vypýta znova.
  if (typeof ScriptApp.requireAllScopes === 'function') {
    ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  }

  let ss = getSpreadsheet_(false);
  if (!ss) {
    ss = SpreadsheetApp.create('Gazda – dáta');
  }
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_KEY, ss.getId());

  Object.keys(SHEETS).forEach((name) => ensureSheet_(ss, name));

  // Odstráň prázdny predvolený list, ak tabuľka bola nová.
  ss.getSheets()
    .filter((s) => !SHEETS[s.getName()] && s.getLastRow() === 0)
    .forEach((s) => ss.deleteSheet(s));

  Logger.log('Dáta sú v tabuľke: ' + ss.getUrl());
  return ss.getUrl();
}

// ---------------------------------------------------------------------------
// API volané z prehliadača (google.script.run)
// ---------------------------------------------------------------------------

function getHouseholds() {
  const email = currentEmail_();
  const members = readTable_('members');
  const myIds = new Set(members.filter((m) => m.email === email).map((m) => m.householdId));

  const households = readTable_('households')
    .filter((h) => myIds.has(h.id))
    .map((h) => ({
      ...strip_(h),
      members: members.filter((m) => m.householdId === h.id).map(strip_),
    }));

  return { email, households };
}

function createHousehold(name, emails) {
  const email = currentEmail_();
  name = requireText_(name, 'Zadaj názov domácnosti.');
  const shareWith = parseEmails_(emails).filter((e) => e !== email);

  const warnings = withLock_(() => {
    const now = nowIso_();
    const id = Utilities.getUuid();
    appendRow_('households', { id, name, createdByEmail: email, createdAt: now });
    appendRow_('members', { householdId: id, email, role: 'owner', addedAt: now });
    return shareWith
      .map((e) => {
        appendRow_('members', { householdId: id, email: e, role: 'member', addedAt: now });
        return shareSpreadsheet_(e);
      })
      .filter(Boolean);
  });

  return { ...getHouseholds(), warnings };
}

function shareHousehold(householdId, newEmail) {
  requireMember_(householdId);
  newEmail = String(newEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(newEmail)) throw new Error('Zadaj platný e-mail.');

  const warning = withLock_(() => {
    const exists = readTable_('members').some(
      (m) => m.householdId === householdId && m.email === newEmail
    );
    if (exists) throw new Error('Domácnosť je už zdieľaná s ' + newEmail);
    appendRow_('members', { householdId, email: newEmail, role: 'member', addedAt: nowIso_() });
    return shareSpreadsheet_(newEmail);
  });

  return { ...getHouseholds(), warnings: warning ? [warning] : [] };
}

function deleteHousehold(householdId) {
  const member = requireMember_(householdId);
  if (member.role !== 'owner') throw new Error('Domácnosť môže vymazať len jej zakladateľ.');

  withLock_(() => {
    deleteRowsWhere_('cinnosti', (r) => r.householdId === householdId);
    deleteRowsWhere_('priestory', (r) => r.householdId === householdId);
    deleteRowsWhere_('members', (r) => r.householdId === householdId);
    deleteRowsWhere_('households', (r) => r.id === householdId);
  });

  return getHouseholds();
}

/**
 * Údaje pri štarte aplikácie: zoznam domácností a ak má používateľ uloženú
 * naposledy otvorenú domácnosť, rovno aj jej detail.
 */
function getStartData() {
  const res = getHouseholds();
  const user = readTable_('users').find((u) => u.email === res.email);
  const lastId = user && user.lastHouseholdId;
  if (lastId && res.households.some((h) => h.id === lastId)) {
    res.lastDetail = getHouseholdData(lastId);
  }
  return res;
}

function getHouseholdData(householdId) {
  const member = requireMember_(householdId);
  const household = readTable_('households').find((h) => h.id === householdId);
  if (!household) throw new Error('Domácnosť neexistuje.');
  rememberLastHousehold_(member.email, householdId);

  return {
    email: member.email,
    role: member.role,
    household: strip_(household),
    members: readTable_('members')
      .filter((m) => m.householdId === householdId)
      .map(strip_),
    priestory: readTable_('priestory')
      .filter((p) => p.householdId === householdId)
      .map(strip_),
    cinnosti: readTable_('cinnosti')
      .filter((c) => c.householdId === householdId)
      .map(toCinnost_),
  };
}

function addPriestor(householdId, name) {
  requireMember_(householdId);
  name = requireText_(name, 'Zadaj názov priestoru.');
  const priestor = { id: Utilities.getUuid(), householdId, name, createdAt: nowIso_() };
  withLock_(() => appendRow_('priestory', priestor));
  return priestor;
}

function addCinnost(householdId, data) {
  const member = requireMember_(householdId);
  data = data || {};

  const priestor = readTable_('priestory').find(
    (p) => p.id === data.priestorId && p.householdId === householdId
  );
  if (!priestor) throw new Error('Vyber priestor.');

  const assignedTo = String(data.assignedTo || '').trim().toLowerCase();
  if (assignedTo) {
    const isMember = readTable_('members').some(
      (m) => m.householdId === householdId && m.email === assignedTo
    );
    if (!isMember) throw new Error('Činnosť môžeš prideliť len členovi domácnosti.');
  }

  const dueDate = String(data.dueDate || '');
  if (!DATE_RE.test(dueDate)) throw new Error('Zadaj termín.');

  const periodicity = PERIODICITIES.includes(data.periodicity) ? data.periodicity : 'none';
  let repeatInterval = '';
  if (periodicity !== 'none') {
    repeatInterval = parseInt(data.repeatInterval, 10);
    if (!(repeatInterval >= 1)) throw new Error('Interval opakovania musí byť aspoň 1.');
  }

  const cinnost = {
    id: Utilities.getUuid(),
    householdId,
    priestorId: priestor.id,
    name: requireText_(data.name, 'Zadaj názov činnosti.'),
    description: String(data.description || '').trim(),
    assignedTo,
    icon: String(data.icon || 'home'),
    color: COLOR_RE.test(data.color) ? data.color : '#4CAF50',
    dueDate,
    periodicity,
    repeatInterval,
    createdAt: nowIso_(),
  };

  withLock_(() => appendRow_('cinnosti', cinnost));
  if (assignedTo && assignedTo !== member.email) {
    notifyAssigned_(cinnost, priestor, member.email);
  }
  return toCinnost_(cinnost);
}

function deleteCinnost(cinnostId) {
  withLock_(() => {
    const cinnost = findCinnost_(cinnostId);
    deleteRowsWhere_('cinnosti', (r) => r.id === cinnost.id);
  });
  return { deleted: true };
}

/**
 * Označí činnosť za hotovú. Jednorazová činnosť sa vymaže,
 * opakovaná sa posunie na ďalší termín.
 */
function completeCinnost(cinnostId) {
  return withLock_(() => {
    const cinnost = findCinnost_(cinnostId);

    if (cinnost.periodicity === 'none' || !PERIODICITIES.includes(cinnost.periodicity)) {
      deleteRowsWhere_('cinnosti', (r) => r.id === cinnost.id);
      return { deleted: true };
    }

    const nextDueDate = nextDueDate_(
      cinnost.dueDate,
      cinnost.periodicity,
      parseInt(cinnost.repeatInterval, 10) || 1
    );
    updateRow_('cinnosti', cinnost._row, { ...cinnost, dueDate: nextDueDate });
    return { deleted: false, cinnost: toCinnost_({ ...cinnost, dueDate: nextDueDate }) };
  });
}

// ---------------------------------------------------------------------------
// Upozornenia (ntfy)
// ---------------------------------------------------------------------------

/** Nastavenia upozornení pre prihláseného používateľa (téma sa vytvorí pri prvom otvorení). */
function getNotificationSettings() {
  const email = currentEmail_();
  return {
    topic: ensureTopic_(email),
    server: ntfyServer_(),
    morningHour: MORNING_HOUR,
  };
}

function sendTestNotification() {
  const email = currentEmail_();
  const ok = sendNtfy_(ensureTopic_(email), {
    title: 'Gazda funguje',
    message: 'Toto je skúšobné upozornenie. Takto ti budú chodiť upozornenia na úlohy.',
    tags: 'white_check_mark',
  });
  if (!ok) throw new Error('Upozornenie sa nepodarilo odoslať. Skús to neskôr.');
  return { sent: true };
}

/**
 * Spúšťa sa časovačom každých 15 minút. Raz denne po 8:00 pošle každému
 * ranný prehľad úloh na dnes a zvlášť upozornenie na úlohy po termíne.
 */
function notificationTick() {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, tz, 'H'));
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const props = PropertiesService.getScriptProperties();

  if (hour < MORNING_HOUR || hour > MORNING_LAST_HOUR) return;
  if (props.getProperty(LAST_DIGEST_KEY) === today) return;

  props.setProperty(LAST_DIGEST_KEY, today);
  sendMorningDigest_(today);
}

/** Na vyskúšanie z editora: pošle ranný prehľad hneď. */
function testRannyPrehlad() {
  return sendMorningDigest_(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
}

function sendMorningDigest_(today) {
  const households = new Map(readTable_('households').map((h) => [h.id, h]));
  const priestory = new Map(readTable_('priestory').map((p) => [p.id, p]));
  const memberKeys = new Set(readTable_('members').map((m) => m.householdId + '|' + m.email));
  const topics = new Map(readTable_('users').filter((u) => u.ntfyTopic).map((u) => [u.email, u.ntfyTopic]));

  const byUser = new Map();
  readTable_('cinnosti').forEach((c) => {
    if (!c.assignedTo || !topics.has(c.assignedTo) || !DATE_RE.test(c.dueDate)) return;
    if (c.dueDate > today) return;
    if (!households.has(c.householdId) || !memberKeys.has(c.householdId + '|' + c.assignedTo)) return;
    if (!byUser.has(c.assignedTo)) byUser.set(c.assignedTo, { today: [], overdue: [] });
    byUser.get(c.assignedTo)[c.dueDate === today ? 'today' : 'overdue'].push(c);
  });

  const where = (c) => {
    const p = priestory.get(c.priestorId);
    return (p ? p.name + ' · ' : '') + households.get(c.householdId).name;
  };
  const byName = (a, b) => a.name.localeCompare(b.name);

  let sent = 0;
  byUser.forEach((tasks, email) => {
    const topic = topics.get(email);
    if (tasks.today.length) {
      const ok = sendNtfy_(topic, {
        title: 'Dnes ťa čaká ' + tasksLabel_(tasks.today.length),
        message: tasks.today.sort(byName).map((c) => '• ' + c.name + ' (' + where(c) + ')').join('\n'),
        tags: 'house',
      });
      if (ok) sent++;
    }
    if (tasks.overdue.length) {
      const ok = sendNtfy_(topic, {
        title: 'Po termíne: ' + tasksLabel_(tasks.overdue.length),
        message: tasks.overdue
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((c) => '• ' + c.name + ' – od ' + formatShortDate_(c.dueDate) + ' (' + where(c) + ')')
          .join('\n'),
        tags: 'warning',
        priority: 4,
      });
      if (ok) sent++;
    }
  });
  return sent;
}

function notifyAssigned_(cinnost, priestor, fromEmail) {
  try {
    const user = readTable_('users').find((u) => u.email === cinnost.assignedTo && u.ntfyTopic);
    if (!user) return;
    const household = readTable_('households').find((h) => h.id === cinnost.householdId);
    const details = [priestor.name + (household ? ' · ' + household.name : '')];
    let when = 'Termín: ' + formatShortDate_(cinnost.dueDate);
    if (cinnost.periodicity !== 'none') {
      const labels = { weekly: 'týždenne', monthly: 'mesačne', annually: 'ročne' };
      const n = Number(cinnost.repeatInterval) || 1;
      when += ' · opakuje sa ' + labels[cinnost.periodicity] + (n > 1 ? ' (každých ' + n + ')' : '');
    }
    details.push(when);
    if (cinnost.description) details.push(cinnost.description);
    sendNtfy_(user.ntfyTopic, {
      title: 'Nová úloha od ' + fromEmail.split('@')[0] + ': ' + cinnost.name,
      message: details.join('\n'),
      tags: 'memo',
    });
  } catch (e) {
    // Upozornenie nesmie pokaziť uloženie činnosti.
    console.warn('Upozornenie o pridelení sa nepodarilo odoslať: ' + e);
  }
}

/** Pošle správu do témy ntfy. Vráti true, ak ju server prijal. */
function sendNtfy_(topic, msg) {
  const headers = {};
  const token = PropertiesService.getScriptProperties().getProperty('NTFY_TOKEN');
  if (token) headers.Authorization = 'Bearer ' + token;
  const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL');

  const payload = { topic, title: msg.title, message: msg.message, tags: [].concat(msg.tags || []) };
  if (msg.priority) payload.priority = msg.priority;
  if (appUrl) payload.click = appUrl;

  try {
    const res = UrlFetchApp.fetch(ntfyServer_(), {
      method: 'post',
      contentType: 'application/json',
      headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return true;
    console.warn('ntfy odpovedal ' + code + ': ' + res.getContentText());
  } catch (e) {
    console.warn('ntfy nedostupný: ' + e);
  }
  return false;
}

function rememberLastHousehold_(email, householdId) {
  try {
    const user = readTable_('users').find((u) => u.email === email);
    if (user && user.lastHouseholdId === householdId) return;
    withLock_(() => {
      const row = readTable_('users').find((u) => u.email === email);
      if (row) {
        updateRow_('users', row._row, { ...row, lastHouseholdId: householdId });
      } else {
        appendRow_('users', { email, ntfyTopic: '', createdAt: nowIso_(), lastHouseholdId: householdId });
      }
    });
  } catch (e) {
    // Zapamätanie je len pohodlnosť – nesmie zabrániť otvoreniu domácnosti.
    console.warn('Poslednú domácnosť sa nepodarilo uložiť: ' + e);
  }
}

function ensureTopic_(email) {
  const existing = readTable_('users').find((u) => u.email === email);
  if (existing && existing.ntfyTopic) return existing.ntfyTopic;

  return withLock_(() => {
    const users = readTable_('users');
    const row = users.find((u) => u.email === email);
    if (row && row.ntfyTopic) return row.ntfyTopic;

    const name = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'user';
    const random = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    const topic = 'gazda-' + name + '-' + random;
    if (row) {
      updateRow_('users', row._row, { ...row, ntfyTopic: topic });
    } else {
      appendRow_('users', { email, ntfyTopic: topic, createdAt: nowIso_() });
    }
    return topic;
  });
}

function ntfyServer_() {
  const server = PropertiesService.getScriptProperties().getProperty('NTFY_SERVER') || NTFY_DEFAULT_SERVER;
  return server.replace(/\/+$/, '');
}

/** Zapamätá si adresu web app (/exec), aby sa po ťuknutí na upozornenie otvorila aplikácia. */
function rememberAppUrl_() {
  try {
    const url = ScriptApp.getService().getUrl();
    if (!url || !/\/exec$/.test(url)) return;
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('APP_URL') !== url) props.setProperty('APP_URL', url);
  } catch (e) {
    // Bez adresy budú upozornenia fungovať, len bez prekliku.
  }
}

function tasksLabel_(n) {
  if (n === 1) return '1 úloha';
  return n + (n >= 2 && n <= 4 ? ' úlohy' : ' úloh');
}

function formatShortDate_(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_NAMES_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + ' ' + d + '. ' + m + '.';
}

// ---------------------------------------------------------------------------
// Doménová logika
// ---------------------------------------------------------------------------

/** Vypočíta ďalší termín opakovanej činnosti (dátumy vo formáte yyyy-MM-dd). */
function nextDueDate_(dueDate, periodicity, interval) {
  const [y, m, d] = dueDate.split('-').map(Number);
  let next;
  switch (periodicity) {
    case 'weekly':
      next = new Date(Date.UTC(y, m - 1, d + 7 * interval));
      break;
    case 'monthly':
      next = addMonthsClamped_(y, m, d, interval);
      break;
    case 'annually':
      next = addMonthsClamped_(y, m, d, 12 * interval);
      break;
    default:
      return dueDate;
  }
  return next.toISOString().slice(0, 10);
}

/** Pridá mesiace; ak deň v cieľovom mesiaci neexistuje (31. 2.), použije posledný deň. */
function addMonthsClamped_(y, m, d, months) {
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
}

function findCinnost_(cinnostId) {
  const cinnost = readTable_('cinnosti').find((c) => c.id === cinnostId);
  if (!cinnost) throw new Error('Činnosť neexistuje (možno ju medzičasom niekto vymazal).');
  requireMember_(cinnost.householdId);
  return cinnost;
}

function toCinnost_(row) {
  const c = strip_(row);
  c.repeatInterval = c.repeatInterval === '' ? null : Number(c.repeatInterval);
  if (!PERIODICITIES.includes(c.periodicity)) c.periodicity = 'none';
  return c;
}

// ---------------------------------------------------------------------------
// Používateľ a oprávnenia
// ---------------------------------------------------------------------------

function currentEmail_() {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) {
    throw new Error(
      'Nepodarilo sa zistiť tvoj Google účet. Web app musí bežať ako ' +
        '„Používateľ, ktorý k aplikácii pristupuje“.'
    );
  }
  return email;
}

function requireMember_(householdId) {
  const email = currentEmail_();
  const member = readTable_('members').find(
    (m) => m.householdId === householdId && m.email === email
  );
  if (!member) throw new Error('K tejto domácnosti nemáš prístup.');
  return member;
}

/**
 * Web app beží pod účtom používateľa, takže každý člen potrebuje
 * prístup na úpravu tabuľky. Vráti upozornenie, ak sa zdieľanie nepodarí.
 */
function shareSpreadsheet_(email) {
  try {
    getSpreadsheet_().addEditor(email);
    return null;
  } catch (e) {
    return 'Tabuľku sa nepodarilo zdieľať s ' + email + '. Zdieľaj ju ručne (Editor).';
  }
}

// ---------------------------------------------------------------------------
// Práca s tabuľkou
// ---------------------------------------------------------------------------

function getSpreadsheet_(required = true) {
  const id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_KEY);
  if (id) return SpreadsheetApp.openById(id);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  if (required) throw new Error('Aplikácia nie je nastavená – spusti v editore funkciu setup().');
  return null;
}

function ensureSheet_(ss, name) {
  const headers = SHEETS[name];
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  // Všetko ukladáme ako text, aby tabuľka neprevádzala dátumy a čísla.
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  return sheet;
}

const checkedSheets_ = {};

function getSheet_(name) {
  const ss = getSpreadsheet_();
  // Chýbajúci list alebo stĺpec (po aktualizácii aplikácie) sa doplní automaticky.
  const sheet = ss.getSheetByName(name);
  if (!sheet) return ensureSheet_(ss, name);
  if (!checkedSheets_[name]) {
    const headers = SHEETS[name];
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((h, i) => current[i] !== h)) ensureSheet_(ss, name);
    checkedSheets_[name] = true;
  }
  return sheet;
}

function readTable_(name) {
  const sheet = getSheet_(name);
  const headers = SHEETS[name];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  return sheet
    .getRange(2, 1, lastRow - 1, headers.length)
    .getValues()
    .map((values, i) => {
      const row = { _row: i + 2 };
      headers.forEach((h, j) => (row[h] = cellToString_(values[j])));
      return row;
    })
    .filter((row) => headers.some((h) => row[h] !== ''));
}

function cellToString_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function appendRow_(name, obj) {
  const sheet = getSheet_(name);
  const headers = SHEETS[name];
  sheet
    .getRange(sheet.getLastRow() + 1, 1, 1, headers.length)
    .setNumberFormat('@')
    .setValues([headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h])))]);
}

function updateRow_(name, rowIndex, obj) {
  const headers = SHEETS[name];
  getSheet_(name)
    .getRange(rowIndex, 1, 1, headers.length)
    .setValues([headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h])))]);
}

function deleteRowsWhere_(name, predicate) {
  const sheet = getSheet_(name);
  readTable_(name)
    .filter(predicate)
    .map((r) => r._row)
    .sort((a, b) => b - a)
    .forEach((row) => sheet.deleteRow(row));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Pomocné funkcie
// ---------------------------------------------------------------------------

function strip_(row) {
  const copy = { ...row };
  delete copy._row;
  return copy;
}

function requireText_(value, message) {
  const text = String(value || '').trim();
  if (!text) throw new Error(message);
  return text;
}

function parseEmails_(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/);
  const emails = list.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  if (invalid.length) throw new Error('Neplatný e-mail: ' + invalid.join(', '));
  return [...new Set(emails)];
}

function nowIso_() {
  return new Date().toISOString();
}
