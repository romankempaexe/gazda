/**
 * Gazda – Google Apps Script web aplikácia na plánovanie domácich prác.
 *
 * Dáta sú uložené v Google tabuľke v piatich listoch:
 *   households – domácnosti
 *   members    – členovia domácností (kto má k domácnosti prístup)
 *   priestory  – priestory domácnosti (kuchyňa, kúpeľňa, ...)
 *   cinnosti   – činnosti (úlohy) priradené k priestoru
 *   users      – používatelia (odtlačok osobného kľúča, téma ntfy, posledná domácnosť)
 *
 * Web app beží pod účtom vlastníka („Spustiť ako: Ja“, prístup „Ktokoľvek“).
 * Používateľa identifikuje osobný tajný odkaz …/exec?k=<kľúč>; v tabuľke je len
 * SHA-256 odtlačok kľúča. Každé volanie z prehliadača posiela kľúč ako prvý parameter.
 *
 * Pred prvým použitím spusti z editora funkciu setup() a potom mojOdkaz().
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
  users: ['email', 'ntfyTopic', 'createdAt', 'lastHouseholdId', 'tokenHash'],
};

const PERIODICITIES = ['none', 'weekly', 'monthly', 'annually'];
const SPREADSHEET_ID_KEY = 'SPREADSHEET_ID';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const TOKEN_RE = /^[0-9a-f]{32}$/;
const INVALID_LINK = 'NEPLATNY_ODKAZ';

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

function doGet(e) {
  // Web app beží pod účtom vlastníka. Ak vlastník nepovolil všetky oprávnenia,
  // ukáž stránku s odkazom na autorizáciu (návštevníkom len vysvetlenie).
  const auth = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (auth.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    return authorizationPage_(auth.getAuthorizationUrl());
  }
  rememberAppUrl_();

  const template = HtmlService.createTemplateFromFile('Index');
  // Kľúč z adresy sa do stránky vloží len ak má presne očakávaný tvar (ochrana pred XSS).
  const k = e && e.parameter && String(e.parameter.k || '').toLowerCase();
  template.token = TOKEN_RE.test(k) ? k : '';
  return template
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
    '<h1>Gazda čaká na nastavenie</h1>' +
    '<p>Vlastník aplikácie musí v Apps Script editore spustiť funkciu <b>setup</b> a povoliť ' +
    'všetky oprávnenia (zaškrtnúť <b>Vybrať všetko</b>).</p>' +
    '<a class="b" href="' + url.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '" target="_blank">Povoliť prístup (vlastník)</a>' +
    '<p>Potom túto stránku obnov.</p></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Gazda – povolenie')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Spusti raz z editora: vytvorí tabuľku (ak treba) a listy s hlavičkami. */
function setup() {
  requireEditor_();
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

/**
 * Spusti z editora: vytvorí NOVÝ osobný odkaz pre vlastníka skriptu a vypíše ho
 * do denníka. Predchádzajúci odkaz vlastníka prestane fungovať.
 */
function mojOdkaz() {
  requireEditor_();
  const email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('Nepodarilo sa zistiť e-mail vlastníka skriptu.');
  const link = personalLink_(issueToken_(email));
  Logger.log('Tvoj osobný odkaz do Gazdu (' + email + '):\n' + link +
    '\nOtvor ho v telefóne a ulož si ho na plochu. Nikomu ho neposielaj.');
  if (!/\/exec\?/.test(link)) {
    Logger.log('Pozor: adresa aplikácie ešte nie je známa. Otvor raz URL /exec z „Spravovať nasadenia“ ' +
      'a funkciu spusti znova, alebo nastav vlastnosť skriptu APP_URL.');
  }
  return link;
}

// ---------------------------------------------------------------------------
// API volané z prehliadača (google.script.run)
// ---------------------------------------------------------------------------

function getHouseholds(token) {
  const email = authenticate_(token);
  const members = readTable_('members');
  const myIds = new Set(members.filter((m) => m.email === email).map((m) => m.householdId));

  const households = readTable_('households')
    .filter((h) => myIds.has(h.id))
    .map((h) => ({
      ...strip_(h),
      members: publicMembers_(members.filter((m) => m.householdId === h.id)),
    }));

  return { email, households };
}

function createHousehold(token, name, emails) {
  const email = authenticate_(token);
  name = requireText_(name, 'Zadaj názov domácnosti.');
  const shareWith = parseEmails_(emails).filter((e) => e !== email);

  withLock_(() => {
    const now = nowIso_();
    const id = Utilities.getUuid();
    appendRow_('households', { id, name, createdByEmail: email, createdAt: now });
    appendRow_('members', { householdId: id, email, role: 'owner', addedAt: now });
    shareWith.forEach((e) => {
      appendRow_('members', { householdId: id, email: e, role: 'member', addedAt: now });
    });
  });

  // Novým používateľom (bez odkazu) rovno vytvor pozývací odkaz.
  const invites = shareWith.map((e) => inviteFor_(e)).filter(Boolean);
  return { ...getHouseholds(token), invites };
}

function shareHousehold(token, householdId, newEmail) {
  authenticate_(token);
  requireMember_(householdId);
  newEmail = String(newEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(newEmail)) throw new Error('Zadaj platný e-mail.');

  withLock_(() => {
    const exists = readTable_('members').some(
      (m) => m.householdId === householdId && m.email === newEmail
    );
    if (exists) throw new Error('Domácnosť je už zdieľaná s ' + newEmail);
    appendRow_('members', { householdId, email: newEmail, role: 'member', addedAt: nowIso_() });
  });

  const invite = inviteFor_(newEmail);
  return { ...getHouseholds(token), invites: invite ? [invite] : [] };
}

/**
 * Vytvorí osobný odkaz pre člena domácnosti. Člen bez odkazu ho môže dostať od
 * hocikoho z domácnosti; nový odkaz pre člena, ktorý už odkaz má, môže vytvoriť
 * len on sám alebo zakladateľ domácnosti (starý odkaz tým prestane fungovať).
 */
function createMemberLink(token, householdId, memberEmail) {
  const email = authenticate_(token);
  const me = requireMember_(householdId);
  memberEmail = String(memberEmail || '').trim().toLowerCase();
  const target = readTable_('members').find(
    (m) => m.householdId === householdId && m.email === memberEmail
  );
  if (!target) throw new Error('Tento človek nie je členom domácnosti.');

  const user = readTable_('users').find((u) => u.email === memberEmail);
  const hasLink = Boolean(user && user.tokenHash);
  if (hasLink && memberEmail !== email && me.role !== 'owner') {
    throw new Error('Nový odkaz pre iného člena môže vytvoriť len zakladateľ domácnosti.');
  }
  return { email: memberEmail, link: personalLink_(issueToken_(memberEmail)), replaced: hasLink };
}

/** Vytvorí nový osobný odkaz pre prihláseného používateľa; starý prestane fungovať. */
function regenerateMyLink(token) {
  const email = authenticate_(token);
  const newToken = issueToken_(email);
  return { email, token: newToken, link: personalLink_(newToken) };
}

function deleteHousehold(token, householdId) {
  authenticate_(token);
  const member = requireMember_(householdId);
  if (member.role !== 'owner') throw new Error('Domácnosť môže vymazať len jej zakladateľ.');

  withLock_(() => {
    deleteRowsWhere_('cinnosti', (r) => r.householdId === householdId);
    deleteRowsWhere_('priestory', (r) => r.householdId === householdId);
    deleteRowsWhere_('members', (r) => r.householdId === householdId);
    deleteRowsWhere_('households', (r) => r.id === householdId);
  });

  return getHouseholds(token);
}

/**
 * Údaje pri štarte aplikácie: zoznam domácností a ak má používateľ uloženú
 * naposledy otvorenú domácnosť, rovno aj jej detail.
 */
function getStartData(token) {
  const res = getHouseholds(token);
  const user = readTable_('users').find((u) => u.email === res.email);
  const lastId = user && user.lastHouseholdId;
  if (lastId && res.households.some((h) => h.id === lastId)) {
    res.lastDetail = getHouseholdData(token, lastId);
  }
  return res;
}

function getHouseholdData(token, householdId) {
  authenticate_(token);
  const member = requireMember_(householdId);
  const household = readTable_('households').find((h) => h.id === householdId);
  if (!household) throw new Error('Domácnosť neexistuje.');
  rememberLastHousehold_(member.email, householdId);

  return {
    email: member.email,
    role: member.role,
    household: strip_(household),
    members: publicMembers_(readTable_('members').filter((m) => m.householdId === householdId)),
    priestory: readTable_('priestory')
      .filter((p) => p.householdId === householdId)
      .map(strip_),
    cinnosti: readTable_('cinnosti')
      .filter((c) => c.householdId === householdId)
      .map(toCinnost_),
  };
}

function addPriestor(token, householdId, name) {
  authenticate_(token);
  requireMember_(householdId);
  name = requireText_(name, 'Zadaj názov priestoru.');
  const priestor = { id: Utilities.getUuid(), householdId, name, createdAt: nowIso_() };
  withLock_(() => appendRow_('priestory', priestor));
  return priestor;
}

function addCinnost(token, householdId, data) {
  authenticate_(token);
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

function deleteCinnost(token, cinnostId) {
  authenticate_(token);
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
function completeCinnost(token, cinnostId) {
  authenticate_(token);
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
function getNotificationSettings(token) {
  const email = authenticate_(token);
  return {
    topic: ensureTopic_(email),
    server: ntfyServer_(),
    morningHour: MORNING_HOUR,
  };
}

function sendTestNotification(token) {
  const email = authenticate_(token);
  const ok = sendNtfy_(ensureTopic_(email), {
    title: 'Gazda funguje',
    message: 'Toto je skúšobné upozornenie. Takto ti budú chodiť upozornenia na úlohy.',
    tags: 'white_check_mark',
  });
  if (!ok) throw new Error('Upozornenie sa nepodarilo odoslať. ' + explainNtfyError_(lastNtfyError_));
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
  requireEditor_();
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

// Posledná chyba pri odosielaní do ntfy: { code, text } alebo { exception }.
let lastNtfyError_ = null;

/** Pošle správu do témy ntfy. Vráti true, ak ju server prijal. */
function sendNtfy_(topic, msg) {
  lastNtfyError_ = null;
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
    lastNtfyError_ = { code, text: String(res.getContentText() || '').slice(0, 300) };
    console.warn('ntfy odpovedal ' + code + ': ' + lastNtfyError_.text);
  } catch (e) {
    lastNtfyError_ = { exception: String((e && e.message) || e) };
    console.warn('ntfy nedostupný: ' + lastNtfyError_.exception);
  }
  return false;
}

/** Zrozumiteľné vysvetlenie chyby z ntfy pre používateľa. */
function explainNtfyError_(err) {
  if (!err) return 'Skús to neskôr.';
  if (err.exception) {
    if (/UrlFetchApp|povolen|permission|authoriz|oprávnen/i.test(err.exception)) {
      return (
        'Chýba povolenie „Pripojenie k externej službe“. Obnov stránku a pri povolení prístupu ' +
        'zaškrtni „Vybrať všetko“. (' + err.exception + ')'
      );
    }
    return 'Server ntfy je nedostupný: ' + err.exception;
  }
  if (err.code === 429) {
    return (
      'ntfy dočasne odmieta správy pre prekročený limit (zdieľané servery Google). Vlastník aplikácie ' +
      'môže nastaviť vlastnosť skriptu NTFY_TOKEN z bezplatného účtu na ntfy.sh. (HTTP 429)'
    );
  }
  if (err.code === 401 || err.code === 403) {
    return 'ntfy odmietol prístup – skontroluj vlastnosť skriptu NTFY_TOKEN. (HTTP ' + err.code + ': ' + err.text + ')';
  }
  return 'ntfy odpovedal HTTP ' + err.code + (err.text ? ': ' + err.text : '');
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

// E-mail používateľa overeného v aktuálnom volaní (nastaví authenticate_).
let currentUserEmail_ = null;

/** Overí osobný kľúč z odkazu a vráti e-mail používateľa, ktorému patrí. */
function authenticate_(token) {
  currentUserEmail_ = null;
  token = String(token || '').toLowerCase();
  if (TOKEN_RE.test(token)) {
    const hash = hashToken_(token);
    const user = readTable_('users').find((u) => u.tokenHash === hash);
    if (user && user.email) currentUserEmail_ = user.email;
  }
  if (!currentUserEmail_) {
    throw new Error(INVALID_LINK + ': Tento odkaz je neplatný alebo bol nahradený novým.');
  }
  return currentUserEmail_;
}

function currentEmail_() {
  if (!currentUserEmail_) throw new Error(INVALID_LINK + ': Chýba osobný odkaz.');
  return currentUserEmail_;
}

/** Vytvorí nový kľúč pre používateľa (uloží len jeho odtlačok) a vráti ho. */
function issueToken_(email) {
  const token = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  const tokenHash = hashToken_(token);
  withLock_(() => {
    const row = readTable_('users').find((u) => u.email === email);
    if (row) {
      updateRow_('users', row._row, { ...row, tokenHash });
    } else {
      appendRow_('users', { email, ntfyTopic: '', createdAt: nowIso_(), lastHouseholdId: '', tokenHash });
    }
  });
  return token;
}

function hashToken_(token) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function personalLink_(token) {
  const props = PropertiesService.getScriptProperties();
  let base = props.getProperty('APP_URL');
  if (!base) {
    try {
      base = ScriptApp.getService().getUrl();
    } catch (e) {
      base = '';
    }
  }
  return (base || '<adresa aplikácie /exec>') + '?k=' + token;
}

/** Pozývací odkaz pre nového používateľa; ak už odkaz má, vráti null. */
function inviteFor_(email) {
  const user = readTable_('users').find((u) => u.email === email);
  if (user && user.tokenHash) return null;
  return { email, link: personalLink_(issueToken_(email)) };
}

/** Členovia domácnosti pre prehliadač – bez interných údajov, s informáciou, či majú odkaz. */
function publicMembers_(members) {
  const linked = new Set(readTable_('users').filter((u) => u.tokenHash).map((u) => u.email));
  return members.map((m) => ({ ...strip_(m), hasLink: linked.has(m.email) }));
}

/**
 * Funkcie určené len pre editor (setup, mojOdkaz…) sú verejné, takže by ich
 * teoreticky šlo zavolať aj z webu. Z webu ich však volá anonymný návštevník,
 * ktorého e-mail sa nedá zistiť – vtedy ich zablokujeme.
 */
function requireEditor_() {
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!active || active !== owner) {
    throw new Error('Túto funkciu môže spustiť len vlastník skriptu v Apps Script editore.');
  }
}

function requireMember_(householdId) {
  const email = currentEmail_();
  const member = readTable_('members').find(
    (m) => m.householdId === householdId && m.email === email
  );
  if (!member) throw new Error('K tejto domácnosti nemáš prístup.');
  return member;
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
