/**
 * Gazda – Google Apps Script web aplikácia na plánovanie domácich prác.
 *
 * Dáta sú uložené v Google tabuľke v štyroch listoch:
 *   households – domácnosti
 *   members    – členovia domácností (kto má k domácnosti prístup)
 *   priestory  – priestory domácnosti (kuchyňa, kúpeľňa, ...)
 *   cinnosti   – činnosti (úlohy) priradené k priestoru
 *
 * Pred prvým použitím spusti z editora funkciu setup().
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
};

const PERIODICITIES = ['none', 'weekly', 'monthly', 'annually'];
const SPREADSHEET_ID_KEY = 'SPREADSHEET_ID';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// ---------------------------------------------------------------------------
// Web app
// ---------------------------------------------------------------------------

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Gazda')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Spusti raz z editora: vytvorí tabuľku (ak treba) a listy s hlavičkami. */
function setup() {
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

function getHouseholdData(householdId) {
  const member = requireMember_(householdId);
  const household = readTable_('households').find((h) => h.id === householdId);
  if (!household) throw new Error('Domácnosť neexistuje.');

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
  requireMember_(householdId);
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

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Chýba list „' + name + '“ – spusti v editore funkciu setup().');
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
