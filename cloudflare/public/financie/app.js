// Financie – rodinný rozpočet podľa tabuľky „Financie“ (Excel). Podaplikácia Family Grid.
//
// Údaje rodiny (príjmy, mesačné a ročné výdavky, kategórie, rezerva) sa načítajú naraz
// (financie/getData); súčty, percentá, finančné zdravie a rezervu počíta táto stránka – tak
// ako vzorce v tabuľke. Zmeny idú na server po jednej a každých pár sekúnd sa overí verzia
// (getRev), takže zmeny od ostatných členov rodiny sa ukážu samé.

(function () {
  const { $, esc, api, apiQuiet, toast, showError, openModal, closeModal, modalOpen, confirmDialog } = FG;

  const MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
  const KIND = {
    income: { title: 'Príjmy', one: 'príjem', icon: 'payments', hint: 'Výplaty, prídavky, rodičovský príspevok… – mesačne.' },
    monthly: { title: 'Mesačné výdavky', one: 'mesačný výdavok', icon: 'receipt_long', hint: 'Výdavky, ktoré platíš každý mesiac.' },
    yearly: { title: 'Ročné výdavky', one: 'ročný výdavok', icon: 'event', hint: 'Výdavky raz za rok – „sporiť mesačne“ ukazuje, koľko na ne odkladať.' },
  };

  const S = {
    hh: null, // id rodiny
    data: null, // { householdId, rev, reserve, reserveMonths, categories, items }
    tab: 'overview', // overview | income | expenses
    sub: 'monthly', // na karte Výdavky: monthly | yearly | categories
    openCat: null, // rozbalená kategória v prehľade
  };

  const snapKey = () => 'financie.snap.' + S.hh;

  function saveSnapshot() {
    try {
      localStorage.setItem(snapKey(), JSON.stringify(S.data));
    } catch (e) {
      // plná pamäť – nevadí
    }
  }

  // ---- Pomocné ----------------------------------------------------------------------------

  const EUR = new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' });
  const EUR0 = new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  /** Centy → „1 234,56 €“ (round = bez centov). */
  const money = (cents, round) => (round ? EUR0 : EUR).format((cents || 0) / 100);
  const pct = (x) => (x * 100).toLocaleString('sk-SK', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
  const items = (kind) => S.data.items.filter((i) => i.kind === kind);
  const sum = (list) => list.reduce((s, i) => s + i.amount, 0);
  const category = (id) => S.data.categories.find((c) => c.id === id);
  const item = (id) => S.data.items.find((i) => i.id === id);

  /** „1 234,56“, „1234.5“, „12 €“ → centy; neplatné → null. */
  function parseAmount(text) {
    const s = String(text || '')
      .replace(/[\s €]/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .replace(',', '.');
    if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
    return Math.round(Number(s) * 100);
  }
  const amountText = (cents) => (cents ? (cents / 100).toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ') : '');

  /** Všetky výpočty tabuľky (súhrn, zdravie, rezerva) – sumy v centoch. */
  function totals() {
    const income = sum(items('income'));
    const monthly = sum(items('monthly'));
    const yearly = sum(items('yearly'));
    const yearlyMonthly = yearly / 12;
    const expenses = monthly + yearlyMonthly; // výdavky spolu prepočítané na mesiac
    const saving = sum(items('monthly').filter((i) => (category(i.categoryId) || {}).saving));
    const spend = expenses - saving; // bežné výdavky (bez sporenia)
    const remaining = income - expenses;
    const months = S.data.reserveMonths || 6;
    const target = expenses * months;
    return {
      income,
      monthly,
      yearly,
      yearlyMonthly,
      expenses,
      saving,
      spend,
      remaining,
      share: income ? expenses / income : 0,
      health: health(income, spend, remaining),
      reserve: S.data.reserve,
      months,
      target,
      lasts: expenses ? S.data.reserve / expenses : 0,
      fill: target ? Math.min(1, S.data.reserve / target) : 0,
    };
  }

  /**
   * Finančné zdravie podľa bežných výdavkov (bez sporenia) voči príjmu: do 50 % výborné,
   * do 70 % dobré, do 90 % na hrane, inak (alebo keď výdavky prevyšujú príjem) zlé.
   */
  function health(income, spend, remaining) {
    if (!income) return null;
    const r = spend / income;
    if (remaining < 0 || r > 0.9) return { label: 'Zlé', cls: 'bad', icon: 'warning', ratio: r };
    if (r > 0.7) return { label: 'Na hrane', cls: 'edge', icon: 'warning', ratio: r };
    if (r > 0.5) return { label: 'Dobré', cls: 'good', icon: 'check_circle', ratio: r };
    return { label: 'Výborné', cls: 'great', icon: 'star', ratio: r };
  }

  /** Mesiacov do splatnosti ročného výdavku (0 = tento mesiac). */
  const monthsTo = (m) => (m - 1 - new Date().getMonth() + 12) % 12;

  // ---- Načítanie ------------------------------------------------------------------------------

  async function load(quiet) {
    if (!S.hh) return;
    const fresh = await (quiet ? apiQuiet : api)('financie/getData', S.hh);
    if (fresh.householdId !== S.hh) return;
    S.data = fresh;
    saveSnapshot();
  }

  async function reload() {
    try {
      await load(true);
      if (!modalOpen()) render();
    } catch (err) {
      showError(err);
    }
  }

  let checking = false;
  async function checkRev() {
    if (document.hidden || !S.data || checking || modalOpen()) return;
    checking = true;
    try {
      const rev = await apiQuiet('financie/getRev', S.hh);
      if (rev !== S.data.rev) await reload();
    } catch (e) {
      // obnova na pozadí je nepovinná
    } finally {
      checking = false;
    }
  }
  setInterval(checkRev, 8000);
  document.addEventListener('visibilitychange', () => document.hidden || checkRev());

  /** Uloží zmenu a obnoví obrazovku. */
  async function act(fn, ok) {
    try {
      const res = await fn();
      await load(true);
      render();
      if (ok) toast(ok);
      return res || true;
    } catch (err) {
      showError(err);
      return null;
    }
  }

  // ---- Kostra ---------------------------------------------------------------------------------

  function tabs(list) {
    const nav = $('tabs');
    if (!list) {
      nav.classList.add('hidden');
      document.body.classList.remove('with-tabs');
      return;
    }
    nav.innerHTML = list
      .map(([id, icon, label]) => '<button data-tab="' + id + '" class="tab' + (id === S.tab ? ' active' : '') + '"><span class="ms">' + icon + '</span><span>' + esc(label) + '</span></button>')
      .join('');
    nav.classList.remove('hidden');
    document.body.classList.add('with-tabs');
    nav.querySelectorAll('[data-tab]').forEach((b) => {
      b.onclick = () => {
        S.tab = b.dataset.tab;
        render();
        window.scrollTo(0, 0);
      };
    });
  }

  function fab(html, onClick) {
    const el = $('fab');
    el.innerHTML = html || '';
    el.classList.toggle('hidden', !html);
    if (onClick) el.querySelector('button').onclick = onClick;
  }

  function render() {
    $('title').textContent = 'Financie';
    if (!S.hh) {
      tabs(null);
      fab('');
      $('view').innerHTML = FG.emptyFamilyHtml('Príjmy a výdavky');
      FG.bindEmptyFamily(() => start());
      return;
    }
    if (!S.data) {
      $('view').innerHTML = '<div class="center muted">Načítavam…</div>';
      return;
    }
    tabs([
      ['overview', 'account_balance_wallet', 'Prehľad'],
      ['income', 'payments', 'Príjmy'],
      ['expenses', 'receipt_long', 'Výdavky'],
    ]);
    const body = S.tab === 'income' ? listHtml('income') : S.tab === 'expenses' ? expensesHtml() : overviewHtml();
    $('view').innerHTML = FG.householdPickerHtml() + body;
    FG.bindHouseholdPicker((id) => {
      S.hh = id;
      S.data = FG.readJson(snapKey());
      render();
      reload();
    });
    bindView();
    if (S.tab === 'overview') fab('');
    else if (S.tab === 'expenses' && S.sub === 'categories') fab('<button type="button" class="btn"><span class="ms">add</span>Kategória</button>', () => categoryForm(null));
    else {
      const kind = S.tab === 'income' ? 'income' : S.sub;
      fab('<button type="button" class="btn"><span class="ms">add</span>Pridať</button>', () => itemForm(null, kind));
    }
  }

  // ---- Prehľad (Súhrn, Finančné zdravie, Núdzová rezerva, Kategórie) ------------------------------------

  function overviewHtml() {
    if (!S.data.items.length) {
      return (
        '<div class="page-head"><h2>Financie</h2><p>Rodinný rozpočet – koľko prichádza, koľko odchádza a koľko zostáva.</p></div>' +
        '<div class="empty"><span class="ms" style="font-size:48px">savings</span><h2>Zatiaľ prázdne</h2>' +
        '<div>Pridaj príjmy a výdavky na kartách dole, alebo načítaj svoju tabuľku <b>Financie</b> z Excelu.</div>' +
        '<button type="button" class="btn" data-import style="margin-top:16px"><span class="ms">upload</span>Import z Excelu</button></div>'
      );
    }
    const t = totals();
    const neg = t.remaining < 0;
    // pás: bežné výdavky | sporenie | zostáva (z väčšieho z príjmu a výdavkov)
    const base = Math.max(t.income, t.expenses) || 1;
    const segs = [
      ['spend', 'Bežné výdavky', t.spend],
      ['saving', 'Sporenie', t.saving],
      ['left', neg ? 'Chýba' : 'Zostáva', Math.abs(t.remaining)],
    ].filter((s) => s[2] > 0);
    const bar =
      '<div class="fi-bar" role="img" aria-label="' + esc(segs.map((s) => s[1] + ' ' + money(s[2])).join(', ')) + '">' +
      segs.map((s) => '<span class="fi-seg ' + s[0] + (neg && s[0] === 'left' ? ' neg' : '') + '" style="flex-basis:' + ((s[2] / base) * 100).toFixed(2) + '%" title="' + esc(s[1] + ': ' + money(s[2])) + '"></span>').join('') +
      '</div><div class="fi-legend">' +
      segs.map((s) => '<span><i class="fi-dot ' + s[0] + (neg && s[0] === 'left' ? ' neg' : '') + '"></i>' + esc(s[1]) + ' <b>' + money(s[2], true) + '</b></span>').join('') +
      '</div>';
    const h = t.health;
    const stat = (label, value, sub) => '<div class="fi-stat"><div class="fi-stat-label">' + label + '</div><div class="fi-stat-value">' + value + '</div>' + (sub ? '<div class="fi-stat-sub">' + sub + '</div>' : '') + '</div>';

    // najbližšie ročné platby
    const upcoming = items('yearly')
      .filter((i) => i.dueMonth)
      .sort((a, b) => monthsTo(a.dueMonth) - monthsTo(b.dueMonth))
      .slice(0, 3);

    return (
      '<div class="fi-hero card">' +
      '<div class="fi-hero-label">' + (neg ? 'Chýba každý mesiac' : 'Zostáva každý mesiac') + '</div>' +
      '<div class="fi-hero-value' + (neg ? ' neg' : '') + '">' + money(Math.abs(t.remaining)) + '</div>' +
      '<div class="fi-hero-sub">Príjem ' + money(t.income) + ' · výdavky ' + money(Math.round(t.expenses)) + (t.income ? ' (' + pct(t.share) + ' z príjmu)' : '') + '</div>' +
      bar +
      (h
        ? '<div class="fi-health ' + h.cls + '"><span class="ms">' + h.icon + '</span><div><b>Finančné zdravie: ' + h.label + '</b>' +
          '<small>Bežné výdavky (bez sporenia) sú ' + pct(h.ratio) + ' príjmu' + (t.saving ? ', sporíš ' + money(t.saving, true) + ' mesačne' : '') + '.</small></div></div>'
        : '') +
      '</div>' +
      '<div class="fi-stats">' +
      stat('Príjem / rok', money(t.income * 12, true)) +
      stat('Mesačné výdavky', money(t.monthly, true), items('monthly').length + ' položiek') +
      stat('Ročné výdavky', money(t.yearly, true), money(Math.round(t.yearlyMonthly)) + ' mesačne') +
      stat('Výdavky spolu / mesiac', money(Math.round(t.expenses), true), 'mesačné + ročné / 12') +
      '</div>' +
      reserveHtml(t) +
      categoriesHtml() +
      (upcoming.length
        ? '<div class="section-title">Najbližšie ročné platby</div>' +
          upcoming
            .map((i) => {
              const n = monthsTo(i.dueMonth);
              return (
                '<div class="card clickable fi-row" data-item="' + esc(i.id) + '"><span class="fi-icon yearly"><span class="ms">event</span></span>' +
                '<div class="card-body"><div class="card-title">' + esc(i.name) + '</div><div class="card-sub">' + esc(cap(MONTHS[i.dueMonth - 1])) +
                ' · ' + (n === 0 ? '<b class="fi-now">tento mesiac</b>' : n === 1 ? 'budúci mesiac' : 'o ' + n + ' mesiacov') + '</div></div>' +
                '<div class="fi-amount">' + money(i.amount) + '</div></div>'
              );
            })
            .join('')
        : '')
    );
  }

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function reserveHtml(t) {
    return (
      '<div class="section-title">Núdzová rezerva</div>' +
      '<button type="button" class="card clickable fi-reserve" id="reserve">' +
      '<div class="fi-reserve-top"><span class="fi-icon reserve"><span class="ms">shield</span></span>' +
      '<div class="card-body"><div class="card-title">' + money(t.reserve) + '</div>' +
      '<div class="card-sub">Cieľ ' + t.months + '× mesačné výdavky: ' + money(Math.round(t.target)) + '</div></div>' +
      '<div class="fi-reserve-pct">' + Math.round(t.fill * 100) + ' %</div></div>' +
      '<div class="fi-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(t.fill * 100) + '" aria-label="Naplnenie cieľa rezervy"><span style="width:' + (t.fill * 100).toFixed(1) + '%"></span></div>' +
      '<div class="fi-reserve-sub">' +
      (t.reserve ? 'Vydrží ' + t.lasts.toLocaleString('sk-SK', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' mes. bez príjmu' : 'Ťukni a zadaj, koľko máte odložené na horšie časy') +
      (t.reserve && t.reserve < t.target ? ' · chýba ' + money(Math.round(t.target - t.reserve), true) : '') +
      '</div></button>'
    );
  }

  /** Mesačné výdavky podľa kategórií (ako „Kategórie výdavkov“ v tabuľke) – ťuknutím detail. */
  function categoriesHtml() {
    const groups = new Map();
    for (const i of items('monthly')) {
      const key = category(i.categoryId) ? i.categoryId : '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    const rows = [...groups]
      .map(([id, list]) => ({ id, name: id ? category(id).name : 'Bez kategórie', saving: id && category(id).saving, list, total: sum(list) }))
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total);
    if (!rows.length) return '';
    const max = rows[0].total;
    const all = sum(items('monthly')) || 1;
    return (
      '<div class="section-title">Mesačné výdavky podľa kategórií</div><div class="card fi-cats">' +
      rows
        .map((g) => {
          const open = S.openCat === (g.id || '-');
          return (
            '<button type="button" class="fi-cat' + (open ? ' open' : '') + '" data-cat="' + esc(g.id || '-') + '" title="' + esc(g.name + ': ' + money(g.total) + ' (' + pct(g.total / all) + ')') + '">' +
            '<span class="fi-cat-name">' + esc(g.name) + (g.saving ? ' <span class="ms" title="Sporenie">savings</span>' : '') + '</span>' +
            '<span class="fi-cat-amount">' + money(g.total, true) + '</span>' +
            '<span class="fi-cat-track"><span style="width:' + ((g.total / max) * 100).toFixed(1) + '%"></span></span></button>' +
            (open
              ? '<div class="fi-cat-items">' + g.list.map((i) => '<div><span>' + esc(i.name) + '</span><span>' + money(i.amount) + '</span></div>').join('') + '</div>'
              : '')
          );
        })
        .join('') +
      '</div>'
    );
  }

  // ---- Zoznamy položiek -----------------------------------------------------------------------------

  function rowHtml(i) {
    let sub = '';
    if (i.kind === 'monthly') {
      const c = category(i.categoryId);
      sub = c ? esc(c.name) : '<span class="muted">bez kategórie</span>';
    } else if (i.kind === 'yearly') {
      sub = (i.dueMonth ? esc(cap(MONTHS[i.dueMonth - 1])) + ' · ' : '') + 'sporiť ' + money(Math.round(i.amount / 12)) + ' mesačne';
    }
    return (
      '<div class="card clickable fi-row" data-item="' + esc(i.id) + '"><span class="fi-icon ' + i.kind + '"><span class="ms">' + KIND[i.kind].icon + '</span></span>' +
      '<div class="card-body"><div class="card-title">' + esc(i.name) + '</div>' + (sub ? '<div class="card-sub">' + sub + '</div>' : '') + '</div>' +
      '<div class="fi-amount">' + money(i.amount) + '</div></div>'
    );
  }

  function listHtml(kind) {
    const list = items(kind);
    const k = KIND[kind];
    const total = sum(list);
    return (
      (kind === 'income' ? '<div class="page-head"><h2>' + k.title + '</h2><p>' + k.hint + '</p></div>' : '<p class="fi-hint">' + k.hint + '</p>') +
      (list.length
        ? list.map(rowHtml).join('') +
          '<div class="fi-total"><span>Spolu</span><b>' + money(total) + '</b>' +
          (kind === 'yearly' ? '<small>' + money(Math.round(total / 12)) + ' mesačne</small>' : kind === 'income' ? '<small>' + money(total * 12) + ' ročne</small>' : '') +
          '</div>'
        : '<div class="empty compact"><span class="ms">' + k.icon + '</span><div>Zatiaľ žiadny ' + k.one + '.</div></div>')
    );
  }

  function expensesHtml() {
    const chip = (v, label) => '<button type="button" class="chip' + (S.sub === v ? ' active' : '') + '" data-sub="' + v + '">' + label + '</button>';
    return (
      '<div class="page-head"><h2>Výdavky</h2></div>' +
      '<div class="chips">' + chip('monthly', 'Mesačné') + chip('yearly', 'Ročné') + chip('categories', 'Kategórie') + '</div>' +
      (S.sub === 'categories' ? categoryListHtml() : listHtml(S.sub))
    );
  }

  function categoryListHtml() {
    return (
      '<p class="fi-hint">Kategórie mesačných výdavkov. Označ tie, ktoré sú <b>sporenie</b> – nepočítajú sa do bežných výdavkov pri finančnom zdraví.</p>' +
      (S.data.categories.length
        ? S.data.categories
            .map((c) => {
              const list = items('monthly').filter((i) => i.categoryId === c.id);
              return (
                '<div class="card clickable fi-row" data-category="' + esc(c.id) + '"><span class="fi-icon ' + (c.saving ? 'saving' : 'monthly') + '"><span class="ms">' + (c.saving ? 'savings' : 'category') + '</span></span>' +
                '<div class="card-body"><div class="card-title">' + esc(c.name) + '</div><div class="card-sub">' +
                (list.length ? list.length + (list.length === 1 ? ' výdavok' : list.length < 5 ? ' výdavky' : ' výdavkov') : 'zatiaľ nič') + (c.saving ? ' · sporenie' : '') + '</div></div>' +
                '<div class="fi-amount">' + money(sum(list)) + '</div></div>'
              );
            })
            .join('')
        : '<div class="empty compact"><span class="ms">category</span><div>Žiadne kategórie.</div></div>')
    );
  }

  function bindView() {
    const v = $('view');
    v.querySelectorAll('[data-item]').forEach((b) => (b.onclick = () => itemForm(item(b.dataset.item))));
    v.querySelectorAll('[data-category]').forEach((b) => (b.onclick = () => categoryForm(category(b.dataset.category))));
    v.querySelectorAll('[data-sub]').forEach((b) => {
      b.onclick = () => {
        S.sub = b.dataset.sub;
        render();
      };
    });
    v.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = () => {
        S.openCat = S.openCat === b.dataset.cat ? null : b.dataset.cat;
        render();
      };
    });
    v.querySelectorAll('[data-import]').forEach((b) => (b.onclick = importDialog));
    const r = $('reserve');
    if (r) r.onclick = reserveForm;
  }

  // ---- Formuláre ----------------------------------------------------------------------------------

  function itemForm(it, kind) {
    kind = it ? it.kind : kind;
    const k = KIND[kind];
    const list = items(kind);
    const idx = it ? list.findIndex((x) => x.id === it.id) : -1;
    const catOptions =
      '<option value="">— bez kategórie —</option>' +
      S.data.categories.map((c) => '<option value="' + esc(c.id) + '"' + (it && it.categoryId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
    const monthOptions =
      '<option value="0">neurčené</option>' +
      MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (it && it.dueMonth === i + 1 ? ' selected' : '') + '>' + cap(m) + '</option>').join('');
    openModal(
      '<h2>' + (it ? 'Upraviť' : 'Nový ' + k.one) + '</h2>' + (it ? '<div class="subtitle">' + k.title + '</div>' : '') +
        '<form id="f"><div class="field"><label>Názov</label><input name="name" required maxlength="80" value="' + esc(it ? it.name : '') + '" placeholder="' +
        (kind === 'income' ? 'napr. Výplata' : kind === 'monthly' ? 'napr. Hypotéka' : 'napr. Poistenie auta') + '"></div>' +
        '<div class="field"><label>Suma (€)' + (kind === 'yearly' ? ' za rok' : ' mesačne') + '</label><input name="amount" inputmode="decimal" autocomplete="off" required value="' + esc(it ? amountText(it.amount) : '') + '" placeholder="0,00">' +
        (kind === 'yearly' ? '<div class="hint" id="perMonth"></div>' : '') + '</div>' +
        (kind === 'monthly' ? '<div class="field"><label>Kategória</label><select name="cat">' + catOptions + '</select></div>' : '') +
        (kind === 'yearly' ? '<div class="field"><label>Splatnosť</label><select name="month">' + monthOptions + '</select></div>' : '') +
        '<div class="actions">' +
        (it
          ? '<button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' +
            (idx > 0 ? '<button type="button" class="icon-btn small" id="up" title="Posunúť vyššie"><span class="ms">arrow_upward</span></button>' : '') +
            (idx < list.length - 1 ? '<button type="button" class="icon-btn small" id="down" title="Posunúť nižšie"><span class="ms">arrow_downward</span></button>' : '')
          : '') +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">' + (it ? 'Uložiť' : 'Pridať') + '</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        root.querySelector('#cancel').onclick = closeModal;
        const per = root.querySelector('#perMonth');
        const syncPer = () => {
          const a = parseAmount(f.amount.value);
          if (per) per.textContent = a ? 'Sporiť mesačne: ' + money(Math.round(a / 12)) : '';
        };
        f.amount.oninput = syncPer;
        syncPer();
        const move = (dir) => async () => {
          if (await act(() => api('financie/moveItem', it.id, dir))) closeModal();
        };
        if (root.querySelector('#up')) root.querySelector('#up').onclick = move(-1);
        if (root.querySelector('#down')) root.querySelector('#down').onclick = move(1);
        const del = root.querySelector('#del');
        if (del) {
          del.onclick = async () => {
            if (!(await confirmDialog('Vymazať „' + it.name + '“?', 'Zmizne všetkým v rodine.', 'Vymazať', true))) return itemForm(it);
            act(() => api('financie/deleteItem', it.id), 'Vymazané');
          };
        }
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const amount = parseAmount(f.amount.value);
          if (amount === null) return toast('Zadaj sumu, napr. 120 alebo 12,50.', true);
          const data = {
            id: it && it.id,
            kind,
            name: f.name.value,
            amount,
            categoryId: f.cat ? f.cat.value : '',
            dueMonth: f.month ? Number(f.month.value) : 0,
          };
          if (await act(() => api('financie/saveItem', S.hh, data), it ? 'Uložené' : '✓ Pridané: ' + data.name.trim())) closeModal();
        };
      }
    );
  }

  function categoryForm(c) {
    const count = c ? items('monthly').filter((i) => i.categoryId === c.id).length : 0;
    openModal(
      '<h2>' + (c ? 'Upraviť kategóriu' : 'Nová kategória') + '</h2>' +
        '<form id="f"><div class="field"><label>Názov</label><input name="name" required maxlength="80" value="' + esc(c ? c.name : '') + '" placeholder="napr. Deti, Zvieratá"></div>' +
        '<label class="fi-check"><input type="checkbox" name="saving"' + (c && c.saving ? ' checked' : '') + '><span>Sporenie' +
        '<small>Peniaze, ktoré odkladáš (sporenie, investície). Pri finančnom zdraví sa nepočítajú medzi bežné výdavky.</small></span></label>' +
        '<div class="actions">' +
        (c ? '<button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' : '') +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">' + (c ? 'Uložiť' : 'Pridať') + '</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        root.querySelector('#cancel').onclick = closeModal;
        const del = root.querySelector('#del');
        if (del) {
          del.onclick = async () => {
            if (!(await confirmDialog('Vymazať kategóriu „' + c.name + '“?', count ? 'Jej výdavky (' + count + ') ostanú, len bez kategórie.' : '', 'Vymazať', true))) return categoryForm(c);
            act(() => api('financie/deleteCategory', c.id), 'Vymazané');
          };
        }
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const data = { id: c && c.id, name: f.name.value, saving: f.saving.checked };
          if (await act(() => api('financie/saveCategory', S.hh, data), c ? 'Uložené' : '✓ Pridaná kategória')) closeModal();
        };
      }
    );
  }

  function reserveForm() {
    const t = totals();
    const opts = [3, 6, 9, 12, 24];
    if (!opts.includes(t.months)) opts.push(t.months);
    openModal(
      '<h2>Núdzová rezerva</h2><div class="subtitle">Peniaze odložené na horšie časy (strata práce, choroba, veľká oprava). ' +
        'Odporúča sa mať aspoň 3–6 mesačných výdavkov.</div>' +
        '<form id="f"><div class="field"><label>Aktuálna rezerva (€)</label><input name="amount" inputmode="decimal" autocomplete="off" value="' + esc(amountText(t.reserve)) + '" placeholder="0,00"></div>' +
        '<div class="field"><label>Cieľ</label><select name="months">' +
        opts.sort((a, b) => a - b).map((m) => '<option value="' + m + '"' + (m === t.months ? ' selected' : '') + '>' + m + '× mesačné výdavky (' + money(Math.round(t.expenses * m), true) + ')</option>').join('') +
        '</select></div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Uložiť</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        root.querySelector('#cancel').onclick = closeModal;
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const amount = f.amount.value.trim() ? parseAmount(f.amount.value) : 0;
          if (amount === null) return toast('Zadaj sumu, napr. 5000 alebo 5 000,50.', true);
          if (await act(() => api('financie/setReserve', S.hh, amount, Number(f.months.value)), 'Uložené')) closeModal();
        };
      }
    );
  }

  // ---- Import z Excelu ----------------------------------------------------------------------------

  function importDialog() {
    if (!S.hh) return toast('Najprv vytvor rodinu.', true);
    const has = S.data && S.data.items.length;
    openModal(
      '<h2>Import z Excelu</h2>' +
        '<div class="subtitle">Vyber svoju tabuľku <b>Financie</b> (.xlsx). Načítajú sa tabuľky <i>Príjmy</i>, <i>Mesačné výdavky</i>, ' +
        '<i>Ročné výdavky</i>, <i>Kategórie výdavkov</i> a aktuálna núdzová rezerva. Súčty a percentá sa vypočítajú samé.' +
        (has ? '<br><br><b>Doterajšie príjmy, výdavky a kategórie rodiny sa nahradia.</b>' : '') + '</div>' +
        '<form id="f"><div class="field"><label>Súbor</label><input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required></div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn"><span class="ms">upload</span>Importovať</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        const f = root.querySelector('#f');
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const file = f.file.files && f.file.files[0];
          if (!file) return;
          if (file.size > 700 * 1024) return toast('Súbor je príliš veľký (najviac 700 kB).', true);
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(file);
          }).catch(() => null);
          if (!dataUrl) return toast('Súbor sa nepodarilo prečítať.', true);
          try {
            const res = await api('financie/importExcel', S.hh, dataUrl);
            S.data = res.data;
            saveSnapshot();
            closeModal(true);
            S.tab = 'overview';
            render();
            toast('Import: ' + res.income + ' príjmy, ' + res.monthly + ' mesačné a ' + res.yearly + ' ročné výdavky');
          } catch (err) {
            showError(err);
          }
        };
      }
    );
  }

  // ---- Štart -----------------------------------------------------------------------------------

  async function start() {
    const h = FG.currentHousehold();
    S.hh = h ? h.id : null;
    if (!S.hh) return render();
    FG.setHousehold(S.hh);
    if (!S.data || S.data.householdId !== S.hh) S.data = FG.readJson(snapKey());
    render();
    try {
      await load(Boolean(S.data));
      render();
    } catch (err) {
      if (err.offline && S.data) toast('Bez internetu – ukazujem posledné uložené údaje');
      else if (!FG.isLoginRequired(err)) showError(err);
    }
  }

  FG.start({
    onReady: () => start(),
    accountExtra: () => [
      '<button type="button" class="btn tonal small" id="fiImport" style="margin:4px 0 12px"><span class="ms">upload</span>Import z Excelu</button>',
      (root) => {
        root.querySelector('#fiImport').onclick = importDialog;
      },
    ],
  });
})();
