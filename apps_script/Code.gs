/**
 * Gazda – Google Apps Script web aplikácia na plánovanie domácich prác.
 *
 * Dáta sú uložené v Google tabuľke v piatich listoch:
 *   households – domácnosti
 *   members    – členovia domácností (kto má k domácnosti prístup)
 *   priestory  – priestory domácnosti (kuchyňa, kúpeľňa, ...)
 *   cinnosti   – činnosti (úlohy) priradené k priestoru
 *   users      – používatelia (odtlačok osobného kľúča, kanál upozornení, Telegram, posledná domácnosť)
 *   polozky    – checklist (položky) jednotlivých činností
 *   obchody    – obchody zadané pri nákupoch (našepkávanie)
 *   produkty   – položky, ktoré domácnosť už pridávala (našepkávanie, podľa počtu použití)
 *
 * Web app beží pod účtom vlastníka („Spustiť ako: Ja“, prístup „Ktokoľvek“).
 * Používateľa identifikuje osobný tajný odkaz …/exec?k=<kľúč>; v tabuľke je len
 * SHA-256 odtlačok kľúča. Každé volanie z prehliadača posiela kľúč ako prvý parameter.
 *
 * Pred prvým použitím spusti z editora funkciu setup() a potom mojOdkaz().
 * Upozornenia (e-mail / Telegram): v editore pridaj spúšťač pre funkciu notificationTick
 * (každých 15 minút); pre Telegram nastav vlastnosť skriptu TELEGRAM_BOT_TOKEN.
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
    'kind', // '' = bežná činnosť, 'nakup' = nákup
    'store', // obchod pri nákupe
  ],
  polozky: ['id', 'cinnostId', 'householdId', 'text', 'done', 'position', 'createdAt', 'createdBy', 'qty'],
  obchody: ['householdId', 'name', 'createdAt'],
  produkty: ['householdId', 'name', 'uses', 'lastUsed'],
  // ntfyTopic sa už nepoužíva; stĺpec ostáva, aby sa neposunuli dáta v existujúcich tabuľkách.
  users: [
    'email',
    'ntfyTopic',
    'createdAt',
    'lastHouseholdId',
    'tokenHash',
    'notifyChannel',
    'telegramChatId',
    'telegramLinkCode',
  ],
};

const PERIODICITIES = ['none', 'weekly', 'monthly', 'annually'];
const SPREADSHEET_ID_KEY = 'SPREADSHEET_ID';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const MAX_ITEMS = 100;
const MAX_ITEM_LENGTH = 100;
const TOKEN_RE = /^[0-9a-f]{32}$/;
// interactive-widget: pri otvorení klávesnice sa stránka zmenší, takže okná
// a polia sa posunú nad klávesnicu (inak ich klávesnica prekryje).
const VIEWPORT = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';
const INVALID_LINK = 'NEPLATNY_ODKAZ';

// Upozornenia chodia e-mailom (Gmail vlastníka) alebo cez Telegram bota.
// Token bota je vo vlastnosti skriptu TELEGRAM_BOT_TOKEN, adresa aplikácie v APP_URL.
const CHANNELS = ['telegram', 'email', 'none'];
const TELEGRAM_API = 'https://api.telegram.org/bot';
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
    .addMetaTag('viewport', VIEWPORT);
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
    .addMetaTag('viewport', VIEWPORT);
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
    deleteRowsWhere_('polozky', (r) => r.householdId === householdId);
    deleteRowsWhere_('obchody', (r) => r.householdId === householdId);
    deleteRowsWhere_('produkty', (r) => r.householdId === householdId);
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
    cinnosti: withItems_(
      householdId,
      readTable_('cinnosti')
        .filter((c) => c.householdId === householdId)
        .map(toCinnost_)
    ),
    stores: readTable_('obchody')
      .filter((o) => o.householdId === householdId)
      .map((o) => o.name)
      .sort((a, b) => a.localeCompare(b)),
    products: readTable_('produkty')
      .filter((p) => p.householdId === householdId)
      .sort((a, b) => Number(b.uses) - Number(a.uses) || b.lastUsed.localeCompare(a.lastUsed))
      .slice(0, 500)
      .map((p) => p.name),
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
  const { priestor, fields, items } = validateCinnost_(householdId, data);
  const cinnost = { id: Utilities.getUuid(), householdId, ...fields, createdAt: nowIso_() };

  withLock_(() => {
    appendRow_('cinnosti', cinnost);
    syncItems_(cinnost, items, member.email);
    rememberShopping_(householdId, cinnost.store, items.map((i) => i.text));
  });
  const saved = withItems_(householdId, [toCinnost_(cinnost)])[0];
  if (cinnost.assignedTo && cinnost.assignedTo !== member.email) {
    notifyAssigned_(saved, priestor, member.email);
  }
  return saved;
}

/** Uloží zmeny činnosti (názov, popis, priestor, pridelenie, termín, opakovanie, ikona, farba). */
function updateCinnost(token, cinnostId, data) {
  const email = authenticate_(token);
  const result = withLock_(() => {
    const cinnost = findCinnost_(cinnostId);
    const { priestor, fields, items } = validateCinnost_(cinnost.householdId, data);
    const updated = { ...cinnost, ...fields };
    updateRow_('cinnosti', cinnost._row, updated);
    syncItems_(updated, items, email);
    rememberShopping_(cinnost.householdId, updated.store, items.filter((i) => !i.id).map((i) => i.text));
    return { previous: cinnost, updated, priestor };
  });

  const saved = withItems_(result.updated.householdId, [toCinnost_(result.updated)])[0];
  // Upozorni len nového riešiteľa (nie seba ani toho, kto ju už mal).
  const assignee = saved.assignedTo;
  if (assignee && assignee !== email && assignee !== result.previous.assignedTo) {
    notifyAssigned_(saved, result.priestor, email);
  }
  return saved;
}

/** Pridá položku do checklistu činnosti (môže ktokoľvek z domácnosti). */
function addItem(token, cinnostId, text, qty) {
  const email = authenticate_(token);
  ({ text, qty } = splitQty_(text, qty));
  if (!text) throw new Error('Zadaj položku.');
  return withLock_(() => {
    const cinnost = findCinnost_(cinnostId);
    const existing = readTable_('polozky').filter((i) => i.cinnostId === cinnost.id);
    if (existing.length >= MAX_ITEMS) throw new Error('Činnosť môže mať najviac ' + MAX_ITEMS + ' položiek.');
    const position = existing.reduce((max, i) => Math.max(max, Number(i.position) || 0), 0) + 1;
    const item = {
      id: Utilities.getUuid(),
      cinnostId: cinnost.id,
      householdId: cinnost.householdId,
      text,
      done: '',
      position,
      createdAt: nowIso_(),
      createdBy: email,
      qty,
    };
    appendRow_('polozky', item);
    rememberShopping_(cinnost.householdId, '', [text]);
    return toItem_(item);
  });
}

/** Odškrtne / zruší odškrtnutie položky. */
function toggleItem(token, itemId, done) {
  authenticate_(token);
  return withLock_(() => {
    const item = readTable_('polozky').find((i) => i.id === itemId);
    if (!item) throw new Error('Položka neexistuje (možno ju medzičasom niekto vymazal).');
    requireMember_(item.householdId);
    const updated = { ...item, done: done ? '1' : '' };
    updateRow_('polozky', item._row, updated);
    return toItem_(updated);
  });
}

/** Overí údaje činnosti z formulára a vráti hodnoty na uloženie. */
function validateCinnost_(householdId, data) {
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

  const kind = data.kind === 'nakup' ? 'nakup' : '';
  const store = kind ? String(data.store || '').trim().slice(0, 60) : '';

  const items = (Array.isArray(data.items) ? data.items : [])
    .map((i) => {
      const obj = typeof i === 'object' && i ? i : { text: i };
      return { id: obj.id ? String(obj.id) : '', ...splitQty_(obj.text, obj.qty) };
    })
    .filter((i) => i.text);
  if (items.length > MAX_ITEMS) throw new Error('Činnosť môže mať najviac ' + MAX_ITEMS + ' položiek.');

  return {
    priestor,
    items,
    fields: {
      kind,
      store,
      priestorId: priestor.id,
      name: requireText_(data.name, 'Zadaj názov činnosti.'),
      description: String(data.description || '').trim(),
      assignedTo,
      icon: String(data.icon || 'home'),
      color: COLOR_RE.test(data.color) ? data.color : '#4CAF50',
      dueDate,
      periodicity,
      repeatInterval,
    },
  };
}

function deleteCinnost(token, cinnostId) {
  authenticate_(token);
  withLock_(() => {
    const cinnost = findCinnost_(cinnostId);
    deleteRowsWhere_('polozky', (r) => r.cinnostId === cinnost.id);
    deleteRowsWhere_('cinnosti', (r) => r.id === cinnost.id);
  });
  return { deleted: true };
}

/**
 * Označí činnosť za hotovú. Jednorazová činnosť sa vymaže, opakovaná sa posunie
 * na ďalší termín – pri úlohe po termíne na najbližší termín po dnešku, aby
 * hneď znova nebola po termíne.
 */
function completeCinnost(token, cinnostId) {
  authenticate_(token);
  return withLock_(() => {
    const cinnost = findCinnost_(cinnostId);

    if (cinnost.periodicity === 'none' || !PERIODICITIES.includes(cinnost.periodicity)) {
      deleteRowsWhere_('polozky', (r) => r.cinnostId === cinnost.id);
      deleteRowsWhere_('cinnosti', (r) => r.id === cinnost.id);
      return { deleted: true };
    }

    // Opakovaná činnosť: odškrtnuté položky zmiznú, neodškrtnuté prejdú na ďalší termín.
    deleteRowsWhere_('polozky', (r) => r.cinnostId === cinnost.id && r.done === '1');

    const interval = parseInt(cinnost.repeatInterval, 10) || 1;
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    let nextDueDate = nextDueDate_(cinnost.dueDate, cinnost.periodicity, interval);
    for (let i = 0; nextDueDate <= today && i < 1000; i++) {
      nextDueDate = nextDueDate_(nextDueDate, cinnost.periodicity, interval);
    }
    updateRow_('cinnosti', cinnost._row, { ...cinnost, dueDate: nextDueDate });
    return {
      deleted: false,
      cinnost: withItems_(cinnost.householdId, [toCinnost_({ ...cinnost, dueDate: nextDueDate })])[0],
    };
  });
}

// ---------------------------------------------------------------------------
// Upozornenia (e-mail / Telegram)
// ---------------------------------------------------------------------------

/** Nastavenia upozornení prihláseného používateľa. */
function getNotificationSettings(token) {
  const email = authenticate_(token);
  const user = userRow_(email);
  return {
    email,
    channel: channelOf_(user),
    morningHour: MORNING_HOUR,
    telegram: {
      available: Boolean(telegramToken_()),
      linked: Boolean(user && user.telegramChatId),
      botUsername: telegramToken_() ? telegramBotUsername_() : '',
    },
  };
}

function setNotificationChannel(token, channel) {
  const email = authenticate_(token);
  if (!CHANNELS.includes(channel)) throw new Error('Neznámy spôsob upozornení.');
  if (channel === 'telegram') {
    const user = userRow_(email);
    if (!user || !user.telegramChatId) throw new Error('Najprv si prepoj Telegram.');
  }
  updateUser_(email, { notifyChannel: channel });
  return getNotificationSettings(token);
}

/** Vytvorí jednorazový odkaz t.me/<bot>?start=<kód> na prepojenie Telegramu. */
function startTelegramLink(token) {
  const email = authenticate_(token);
  if (!telegramToken_()) throw new Error('Vlastník aplikácie ešte nenastavil Telegram bota.');
  const username = telegramBotUsername_();
  if (!username) throw new Error('Telegram bota sa nepodarilo načítať – skontroluj TELEGRAM_BOT_TOKEN.');
  const code = Utilities.getUuid().replace(/-/g, '').toLowerCase();
  updateUser_(email, { telegramLinkCode: code });
  return { url: 'https://t.me/' + username + '?start=' + code };
}

/** Spracuje nové správy pre bota (prepojenia) a vráti aktuálne nastavenia. */
function checkTelegramLink(token) {
  authenticate_(token);
  processTelegramUpdates_();
  return getNotificationSettings(token);
}

function unlinkTelegram(token) {
  const email = authenticate_(token);
  const user = userRow_(email);
  updateUser_(email, {
    telegramChatId: '',
    telegramLinkCode: '',
    notifyChannel: channelOf_(user) === 'telegram' ? 'email' : (user && user.notifyChannel) || '',
  });
  return getNotificationSettings(token);
}

function sendTestNotification(token) {
  const email = authenticate_(token);
  const user = userRow_(email) || { email };
  if (channelOf_(user) === 'none') throw new Error('Upozornenia máš vypnuté – vyber Telegram alebo e-mail.');
  const result = notifyUser_(user, {
    kind: 'test',
    title: 'Gazda funguje',
    lines: ['Toto je skúšobné upozornenie. Takto ti budú chodiť upozornenia na úlohy.'],
  });
  if (!result.ok) throw new Error('Upozornenie sa nepodarilo odoslať. ' + result.error);
  return { sent: true, channel: result.channel };
}

/**
 * Spúšťa sa časovačom každých 15 minút. Spracuje prepojenia Telegramu a raz
 * denne po 8:00 pošle ranný prehľad úloh na dnes a zvlášť úlohy po termíne.
 */
function notificationTick() {
  try {
    processTelegramUpdates_();
  } catch (e) {
    console.warn('Telegram: ' + e);
  }

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
  const users = new Map(readTable_('users').map((u) => [u.email, u]));

  const byUser = new Map();
  readTable_('cinnosti').forEach((c) => {
    if (!c.assignedTo || !DATE_RE.test(c.dueDate) || c.dueDate > today) return;
    if (!households.has(c.householdId) || !memberKeys.has(c.householdId + '|' + c.assignedTo)) return;
    if (!byUser.has(c.assignedTo)) byUser.set(c.assignedTo, { today: [], overdue: [] });
    byUser.get(c.assignedTo)[c.dueDate === today ? 'today' : 'overdue'].push(c);
  });

  const itemCounts = new Map();
  readTable_('polozky').forEach((i) => {
    const n = itemCounts.get(i.cinnostId) || { total: 0, done: 0 };
    n.total++;
    if (i.done === '1') n.done++;
    itemCounts.set(i.cinnostId, n);
  });
  const where = (c) => {
    const p = priestory.get(c.priestorId);
    const parts = [];
    if (c.kind === 'nakup' && c.store) parts.push('🛒 ' + c.store);
    const n = itemCounts.get(c.id);
    if (n) parts.push(n.done + '/' + n.total);
    parts.push((p ? p.name + ' · ' : '') + households.get(c.householdId).name);
    return parts.join(' · ');
  };
  const byName = (a, b) => a.name.localeCompare(b.name);

  let sent = 0;
  byUser.forEach((tasks, email) => {
    const user = users.get(email) || { email };
    if (channelOf_(user) === 'none') return;
    if (tasks.today.length) {
      const res = notifyUser_(user, {
        kind: 'today',
        title: 'Dnes ťa čaká ' + tasksLabel_(tasks.today.length),
        lines: tasks.today.sort(byName).map((c) => '• ' + c.name + ' (' + where(c) + ')'),
      });
      if (res.ok) sent++;
    }
    if (tasks.overdue.length) {
      const res = notifyUser_(user, {
        kind: 'overdue',
        title: 'Po termíne: ' + tasksLabel_(tasks.overdue.length),
        lines: tasks.overdue
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((c) => '• ' + c.name + ' – od ' + formatShortDate_(c.dueDate) + ' (' + where(c) + ')'),
      });
      if (res.ok) sent++;
    }
  });
  return sent;
}

function notifyAssigned_(cinnost, priestor, fromEmail) {
  try {
    const user = userRow_(cinnost.assignedTo) || { email: cinnost.assignedTo };
    if (channelOf_(user) === 'none') return;
    const household = readTable_('households').find((h) => h.id === cinnost.householdId);
    const lines = [];
    if (cinnost.kind === 'nakup') lines.push('🛒 Nákup' + (cinnost.store ? ': ' + cinnost.store : ''));
    lines.push(priestor.name + (household ? ' · ' + household.name : ''));
    let when = 'Termín: ' + formatShortDate_(cinnost.dueDate);
    if (cinnost.periodicity !== 'none') {
      const labels = { weekly: 'týždenne', monthly: 'mesačne', annually: 'ročne' };
      const n = Number(cinnost.repeatInterval) || 1;
      when += ' · opakuje sa ' + labels[cinnost.periodicity] + (n > 1 ? ' (každých ' + n + ')' : '');
    }
    lines.push(when);
    if (cinnost.description) lines.push(cinnost.description);
    const items = cinnost.items || [];
    if (items.length) {
      lines.push('');
      lines.push((cinnost.kind === 'nakup' ? 'Nakúpiť' : 'Checklist') + ' (' + items.length + '):');
      items.slice(0, 40).forEach((i) => lines.push((i.done ? '☑ ' : '☐ ') + i.text + (i.qty ? ' – ' + i.qty : '')));
      if (items.length > 40) lines.push('… a ďalších ' + (items.length - 40));
    }
    notifyUser_(user, {
      kind: 'assigned',
      title: 'Nová úloha od ' + fromEmail.split('@')[0] + ': ' + cinnost.name,
      lines,
    });
  } catch (e) {
    // Upozornenie nesmie pokaziť uloženie činnosti.
    console.warn('Upozornenie o pridelení sa nepodarilo odoslať: ' + e);
  }
}

/** Kanál upozornení používateľa; predvolene e-mail, Telegram len ak je prepojený. */
function channelOf_(user) {
  const channel = user && user.notifyChannel;
  if (channel === 'none') return 'none';
  if (channel === 'telegram' && user.telegramChatId) return 'telegram';
  if (!channel && user && user.telegramChatId) return 'telegram';
  return 'email';
}

/**
 * Pošle upozornenie zvoleným kanálom. msg = { kind, title, lines[] }.
 * Vráti { ok, channel, error }.
 */
function notifyUser_(user, msg) {
  const channel = channelOf_(user);
  try {
    if (channel === 'telegram') return { channel, ...sendTelegram_(user, msg) };
    if (channel === 'email') {
      sendEmail_(user.email, msg);
      return { ok: true, channel };
    }
    return { ok: false, channel, error: 'Upozornenia sú vypnuté.' };
  } catch (e) {
    const text = String((e && e.message) || e);
    console.warn('Upozornenie (' + channel + ') pre ' + user.email + ' zlyhalo: ' + text);
    return { ok: false, channel, error: explainNotifyError_(channel, text) };
  }
}

const KIND_ICONS = { today: '🏠', overdue: '⚠️', assigned: '📝', test: '✅' };

function sendEmail_(to, msg) {
  const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL');
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a">' +
    '<h2 style="font-size:18px;margin:0 0 12px">' + (KIND_ICONS[msg.kind] || '') + ' ' + esc(msg.title) + '</h2>' +
    msg.lines.map((l) => '<div style="margin:4px 0">' + esc(l) + '</div>').join('') +
    (appUrl
      ? '<p style="margin-top:20px"><a href="' + esc(appUrl) + '" style="background:#16a34a;color:#fff;' +
        'padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:bold">Otvoriť Gazdu</a></p>'
      : '') +
    '<p style="color:#64748b;font-size:12px;margin-top:24px">Upozornenia môžeš zmeniť alebo vypnúť v Gazdovi cez 🔔.</p></div>';
  MailApp.sendEmail({
    to,
    subject: 'Gazda: ' + msg.title,
    body: msg.title + '\n\n' + msg.lines.join('\n') + (appUrl ? '\n\nOtvoriť Gazdu: ' + appUrl : ''),
    htmlBody: html,
    name: 'Gazda',
  });
}

function sendTelegram_(user, msg) {
  const appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL');
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const payload = {
    chat_id: user.telegramChatId,
    text: (KIND_ICONS[msg.kind] || '') + ' <b>' + esc(msg.title) + '</b>\n' + msg.lines.map(esc).join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (appUrl) payload.reply_markup = { inline_keyboard: [[{ text: 'Otvoriť Gazdu', url: appUrl }]] };

  const res = telegramApi_('sendMessage', payload);
  if (res.ok) return { ok: true };
  // Používateľ bota zablokoval alebo zmazal chat – prepojenie zrušíme, ďalej pôjde e-mail.
  if (res.error_code === 403 || /chat not found/i.test(res.description || '')) {
    updateUser_(user.email, { telegramChatId: '', notifyChannel: 'email' });
  }
  return { ok: false, error: explainNotifyError_('telegram', 'HTTP ' + res.error_code + ': ' + res.description) };
}

function explainNotifyError_(channel, text) {
  if (channel === 'email') {
    if (/limit|quota|too many/i.test(text)) return 'Prekročený denný limit e-mailov Gmailu, skús to zajtra. (' + text + ')';
    if (/povolen|permission|authoriz/i.test(text)) {
      return 'Vlastník aplikácie musí v editore spustiť setup a povoliť posielanie e-mailov. (' + text + ')';
    }
    return 'E-mail sa nepodarilo odoslať: ' + text;
  }
  if (/HTTP 401/.test(text)) return 'Telegram odmietol token bota – skontroluj TELEGRAM_BOT_TOKEN. (' + text + ')';
  if (/HTTP 403/.test(text)) return 'Bot je v Telegrame zablokovaný – prepojenie sa zrušilo, prepoj ho znova. (' + text + ')';
  if (/povolen|permission|authoriz|UrlFetchApp/i.test(text)) {
    return 'Vlastník aplikácie musí v editore spustiť setup a povoliť pripojenie k externým službám. (' + text + ')';
  }
  return 'Telegram: ' + text;
}

// ---- Telegram bot ----------------------------------------------------------

function telegramToken_() {
  return String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN') || '').trim();
}

function telegramApi_(method, payload) {
  const res = UrlFetchApp.fetch(TELEGRAM_API + telegramToken_() + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
  });
  try {
    return JSON.parse(res.getContentText());
  } catch (e) {
    return { ok: false, error_code: res.getResponseCode(), description: 'neplatná odpoveď' };
  }
}

/** Používateľské meno bota (z getMe), uložené vo vlastnostiach pre aktuálny token. */
function telegramBotUsername_() {
  const props = PropertiesService.getScriptProperties();
  const botId = telegramToken_().split(':')[0];
  const cached = String(props.getProperty('TELEGRAM_BOT_USERNAME') || '').split('|');
  if (cached[0] === botId && cached[1]) return cached[1];
  const res = telegramApi_('getMe');
  if (!res.ok || !res.result || !res.result.username) return '';
  props.setProperty('TELEGRAM_BOT_USERNAME', botId + '|' + res.result.username);
  return res.result.username;
}

/**
 * Prečíta nové správy pre bota (getUpdates) a spracuje:
 *   /start <kód> – prepojí chat s používateľom, ktorému kód patrí,
 *   /stop        – zruší prepojenie.
 */
function processTelegramUpdates_() {
  if (!telegramToken_()) return 0;
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const offset = Number(props.getProperty('TELEGRAM_UPDATE_OFFSET') || 0);
    const res = telegramApi_('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
    if (!res.ok) throw new Error('getUpdates HTTP ' + res.error_code + ': ' + res.description);

    let next = offset;
    let linked = 0;
    (res.result || []).forEach((update) => {
      next = Math.max(next, update.update_id + 1);
      const message = update.message;
      if (!message || !message.chat || typeof message.text !== 'string') return;
      const chatId = String(message.chat.id);
      const text = message.text.trim();
      const start = text.match(/^\/start(?:@\w+)?\s+([0-9a-f]{32})$/i);

      if (start) {
        const user = readTable_('users').find((u) => u.telegramLinkCode && u.telegramLinkCode === start[1].toLowerCase());
        if (!user) {
          telegramApi_('sendMessage', { chat_id: chatId, text: 'Tento odkaz už neplatí. Otvor Gazdu, ťukni na 🔔 a prepoj Telegram znova.' });
          return;
        }
        // Rovnaký chat nemôže byť prepojený s dvoma používateľmi.
        readTable_('users')
          .filter((u) => u.telegramChatId === chatId && u.email !== user.email)
          .forEach((u) => updateRow_('users', u._row, { ...u, telegramChatId: '' }));
        const fresh = readTable_('users').find((u) => u.email === user.email);
        updateRow_('users', fresh._row, { ...fresh, telegramChatId: chatId, telegramLinkCode: '', notifyChannel: 'telegram' });
        telegramApi_('sendMessage', {
          chat_id: chatId,
          text: '✅ Hotovo! Upozornenia z Gazdu ti budú chodiť sem (' + user.email + ').\nZrušiť ich môžeš v Gazdovi cez 🔔 alebo príkazom /stop.',
        });
        linked++;
      } else if (/^\/stop(?:@\w+)?$/i.test(text)) {
        readTable_('users')
          .filter((u) => u.telegramChatId === chatId)
          .forEach((u) => updateRow_('users', u._row, { ...u, telegramChatId: '', notifyChannel: 'email' }));
        telegramApi_('sendMessage', { chat_id: chatId, text: 'Prepojenie zrušené. Upozornenia ti budú chodiť e-mailom.' });
      } else if (/^\/start/i.test(text)) {
        telegramApi_('sendMessage', {
          chat_id: chatId,
          text: 'Ahoj! Toto je bot aplikácie Gazda. Prepojíš ho v Gazdovi: ťukni na 🔔 → Prepojiť s Telegramom.',
        });
      }
    });

    if (next !== offset) props.setProperty('TELEGRAM_UPDATE_OFFSET', String(next));
    return linked;
  });
}

// ---- Používatelia -----------------------------------------------------------

function userRow_(email) {
  return readTable_('users').find((u) => u.email === email) || null;
}

/** Zmení údaje používateľa v liste users (riadok vytvorí, ak neexistuje). */
function updateUser_(email, fields) {
  withLock_(() => {
    const row = readTable_('users').find((u) => u.email === email);
    if (row) {
      updateRow_('users', row._row, { ...row, ...fields });
    } else {
      appendRow_('users', { email, createdAt: nowIso_(), ...fields });
    }
  });
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

/** Pripojí k činnostiam ich checklist (zoradený podľa poradia). */
function withItems_(householdId, cinnosti) {
  const byTask = new Map();
  readTable_('polozky')
    .filter((i) => i.householdId === householdId)
    .forEach((i) => {
      if (!byTask.has(i.cinnostId)) byTask.set(i.cinnostId, []);
      byTask.get(i.cinnostId).push(i);
    });
  return cinnosti.map((c) => ({
    ...c,
    items: (byTask.get(c.id) || [])
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
      .map(toItem_),
  }));
}

function toItem_(row) {
  return { id: row.id, text: row.text, qty: row.qty || '', done: row.done === '1' };
}

function cleanItemText_(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH);
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

/**
 * Zosúladí checklist činnosti so zoznamom z formulára: nové položky pridá,
 * chýbajúce vymaže, zmení text a poradie. Stav odškrtnutia ostáva z tabuľky
 * (formulár ho nemení, aby neprepísal odškrtnutie od iného člena).
 * Volá sa vnútri withLock_.
 */
function syncItems_(cinnost, items, email) {
  const existing = readTable_('polozky').filter((i) => i.cinnostId === cinnost.id);
  const byId = new Map(existing.map((i) => [i.id, i]));
  const keep = new Set();
  items.forEach((item, index) => {
    const position = index + 1;
    const current = item.id && byId.get(item.id);
    if (current) {
      keep.add(current.id);
      if (current.text !== item.text || (current.qty || '') !== item.qty || Number(current.position) !== position) {
        updateRow_('polozky', current._row, { ...current, text: item.text, qty: item.qty, position });
      }
    } else {
      const id = Utilities.getUuid();
      keep.add(id);
      appendRow_('polozky', {
        id,
        cinnostId: cinnost.id,
        householdId: cinnost.householdId,
        text: item.text,
        done: '',
        position,
        createdAt: nowIso_(),
        createdBy: email,
        qty: item.qty,
      });
    }
  });
  if (existing.some((i) => !keep.has(i.id))) {
    deleteRowsWhere_('polozky', (r) => r.cinnostId === cinnost.id && !keep.has(r.id));
  }
}

/** Zapamätá obchod a položky domácnosti pre našepkávanie. Volá sa vnútri withLock_. */
function rememberShopping_(householdId, store, texts) {
  if (store) {
    const known = readTable_('obchody').some(
      (o) => o.householdId === householdId && o.name.toLowerCase() === store.toLowerCase()
    );
    if (!known) appendRow_('obchody', { householdId, name: store, createdAt: nowIso_() });
  }
  const now = nowIso_();
  const seen = new Set();
  texts.forEach((text) => {
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    const row = readTable_('produkty').find((p) => p.householdId === householdId && p.name.toLowerCase() === key);
    if (row) {
      updateRow_('produkty', row._row, { ...row, uses: (Number(row.uses) || 0) + 1, lastUsed: now });
    } else {
      appendRow_('produkty', { householdId, name: text, uses: 1, lastUsed: now });
    }
  });
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

// Objekty tabuľky sa v rámci jedného spustenia otvárajú len raz.
let spreadsheet_ = null;
const sheets_ = {};

function getSpreadsheet_(required = true) {
  if (spreadsheet_) return spreadsheet_;
  const id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_KEY);
  spreadsheet_ = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet_ && required) throw new Error('Aplikácia nie je nastavená – spusti v editore funkciu setup().');
  return spreadsheet_;
}

function ensureSheet_(ss, name) {
  const headers = SHEETS[name];
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  // Všetko ukladáme ako text, aby tabuľka neprevádzala dátumy a čísla.
  sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  sheets_[name] = sheet;
  invalidate_(name);
  return sheet;
}

function getSheet_(name) {
  if (sheets_[name]) return sheets_[name];
  const ss = getSpreadsheet_();
  // Chýbajúci list (napr. po aktualizácii aplikácie) sa vytvorí automaticky.
  sheets_[name] = ss.getSheetByName(name) || ensureSheet_(ss, name);
  return sheets_[name];
}

// ---------------------------------------------------------------------------
// Čítanie tabuliek s vyrovnávacou pamäťou
//
// Každý list sa v rámci spustenia číta najviac raz (tables_). Medzi spusteniami
// sa obsah drží v CacheService pod kľúčom s verziou listu; každý zápis verziu
// zmení, takže sa staré údaje už nepoužijú. Ručné úpravy v tabuľke sa prejavia
// najneskôr po CACHE_TTL sekundách.
// ---------------------------------------------------------------------------

const CACHE_TTL = 300;
const CACHE_MAX_CHARS = 90000; // CacheService dovolí najviac 100 kB na kľúč
const tables_ = {};
const dirtyTables_ = new Set();

function cache_() {
  try {
    return CacheService.getScriptCache();
  } catch (e) {
    return null;
  }
}

function readTable_(name) {
  if (!tables_[name]) tables_[name] = loadTable_(name);
  return tables_[name].slice();
}

function loadTable_(name) {
  const cache = cache_();
  let version = null;
  if (cache) {
    version = cache.get('ver:' + name);
    if (version) {
      const cached = cache.get('tbl:' + name + ':' + version);
      if (cached) return JSON.parse(cached);
    } else {
      version = newVersion_();
      cache.put('ver:' + name, version, 21600);
    }
  }

  const rows = readSheet_(name);
  if (cache) {
    const json = JSON.stringify(rows);
    if (json.length <= CACHE_MAX_CHARS) cache.put('tbl:' + name + ':' + version, json, CACHE_TTL);
  }
  return rows;
}

/** Prečíta celý list jedným volaním; ak nesedí hlavička (nové stĺpce), opraví ju. */
function readSheet_(name) {
  const headers = SHEETS[name];
  let values = getSheet_(name).getDataRange().getValues();
  const current = values[0] || [];
  if (headers.some((h, i) => current[i] !== h)) {
    ensureSheet_(getSpreadsheet_(), name);
    values = getSheet_(name).getDataRange().getValues();
  }
  return values
    .slice(1)
    .map((cells, i) => {
      const row = { _row: i + 2 };
      headers.forEach((h, j) => (row[h] = j < cells.length ? cellToString_(cells[j]) : ''));
      return row;
    })
    .filter((row) => headers.some((h) => row[h] !== ''));
}

function newVersion_() {
  return Utilities.getUuid().slice(0, 8);
}

/** Po zápise do listu zahodí jeho uložený obsah (v tomto spustení aj v CacheService). */
function invalidate_(name) {
  delete tables_[name];
  dirtyTables_.add(name);
  bumpVersion_(name);
}

function bumpVersion_(name) {
  const cache = cache_();
  if (cache) cache.put('ver:' + name, newVersion_(), 21600);
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
  invalidate_(name);
}

function updateRow_(name, rowIndex, obj) {
  const headers = SHEETS[name];
  getSheet_(name)
    .getRange(rowIndex, 1, 1, headers.length)
    .setValues([headers.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h])))]);
  invalidate_(name);
}

function deleteRowsWhere_(name, predicate) {
  const sheet = getSheet_(name);
  const rows = readTable_(name)
    .filter(predicate)
    .map((r) => r._row)
    .sort((a, b) => b - a);
  rows.forEach((row) => sheet.deleteRow(row));
  if (rows.length) invalidate_(name);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    // Verziu zmeň aj po uložení – iné spustenie mohlo medzitým uložiť do
    // vyrovnávacej pamäte ešte neuložený stav.
    dirtyTables_.forEach(bumpVersion_);
    dirtyTables_.clear();
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
