// Rozcestník Family Grid: dlaždice podaplikácií s krátkym prehľadom.
// Ťuknutie na dlaždicu otvorí podaplikáciu; tá sa zapamätá a pri ďalšom spustení
// Family Grid sa otvorí rovno ona (pozri skript v index.html).

(function () {
  const { APPS, $, esc } = FG;

  function plural(n, one, few, many) {
    return n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  }

  /** Člen niektorej rodiny podľa e-mailu (kvôli prezývke). */
  function memberOf(email) {
    for (const h of FG.state.households) {
      const m = (h.members || []).find((x) => x.email === email);
      if (m) return m;
    }
    return { email };
  }

  function info(app, overview) {
    const o = (overview || {})[app];
    if (!o) return '';
    if (app === 'gazda') {
      if (o.overdue) return { text: 'Po termíne: ' + plural(o.overdue, 'úloha', 'úlohy', 'úloh'), warn: true };
      if (o.today) return { text: 'Dnes ' + plural(o.today, 'úloha', 'úlohy', 'úloh') };
      return { text: 'Na dnes nič' };
    }
    if (app === 'nakupy') {
      if (o.shoppingBy) return { text: 'Nakupuje ' + FG.memberName(memberOf(o.shoppingBy)) };
      if (o.open) return { text: 'Kúpiť: ' + plural(o.open, 'vec', 'veci', 'vecí') };
      return o.lists ? { text: 'Všetko kúpené' } : '';
    }
    if (app === 'zdravko') {
      if (!o.upcoming) return '';
      const d = new Date(o.nextAt);
      return { text: 'Najbližšie: ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.' };
    }
    if (app === 'skladko') {
      if (o.expiring) return { text: 'Končí trvanlivosť: ' + o.expiring, warn: true };
      if (o.low) return { text: 'Dochádza: ' + o.low, warn: true };
      return o.items ? { text: plural(o.items, 'vec', 'veci', 'vecí') } : '';
    }
    if (app === 'quickstash') {
      return o.entries ? { text: plural(o.entries, 'položka', 'položky', 'položiek') } : '';
    }
    if (app === 'financie') {
      if (o.remaining === undefined) return '';
      const eur = Math.round(Math.abs(o.remaining) / 100).toLocaleString('sk-SK') + ' €';
      return o.remaining < 0 ? { text: 'Chýba ' + eur + ' / mes.', warn: true } : { text: 'Zostáva ' + eur + ' / mes.' };
    }
    return '';
  }

  function render(family) {
    const h = FG.currentHousehold();
    $('view').innerHTML =
      (h
        ? '<button type="button" class="fg-family" id="family"><span class="fg-faces">' +
          h.members.slice(0, 5).map((m) => '<i>' + esc(FG.memberName(m).charAt(0).toUpperCase()) + '</i>').join('') +
          '</span><b>' + esc(h.name) + '</b><span class="ms">person_add</span></button>'
        : '<button type="button" class="fg-family" id="family"><span class="ms">group_add</span><b>Vytvoriť rodinu a zdieľať</b></button>') +
      '<div class="fg-tiles">' +
      Object.entries(APPS)
        .map(([id, a]) => {
          const i = family ? info(id, family.overview) : '';
          return (
            '<a class="fg-tile" href="' + a.url + '" data-app="' + id + '">' +
            '<img src="/icons/' + id + '/icon.svg" alt="">' +
            '<div class="name">' + esc(a.name) + '</div>' +
            (i ? '<div class="info' + (i.warn ? ' warn' : '') + '">' + esc(i.text) + '</div>' : '') +
            '</a>'
          );
        })
        .join('') +
      '</div>';
    $('family').onclick = () => FG.showFamily(() => FG.loadFamily(true).then(render).catch(FG.showError));
    // Zapamätaj hneď pri ťuknutí (podaplikácia to potvrdí aj sama po načítaní).
    $('view').querySelectorAll('.fg-tile').forEach((t) => {
      t.addEventListener('click', () => {
        FG.writeStore(FG.LAST_APP_KEY, t.dataset.app);
        fromGrid();
      });
    });
  }

  // ---- Tlačidlo Späť ---------------------------------------------------------------------------
  // Rozcestník je v histórii naspodku: { fg: 'grid' } a nad ním strážny záznam { fg: 'guard' }.
  // Späť zo strážneho záznamu aplikáciu nezavrie, ale opýta sa. Podaplikácia otvorená dlaždicou
  // sa sem vráti po histórii (pozri shared/back.js).

  function session(key, value) {
    try {
      if (value === undefined) return sessionStorage.getItem(key);
      if (value === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, value);
    } catch (e) {
      // bez sessionStorage
    }
    return null;
  }

  /** Podaplikácia otvorená odtiaľto – jej Späť sa vráti po histórii sem. */
  function fromGrid() {
    session('fg.fromGrid', '1');
  }

  function arm() {
    if (history.state && history.state.fg === 'guard') return;
    history.replaceState({ fg: 'grid' }, '', '/');
    history.pushState({ fg: 'guard' }, '', '/');
  }

  /** Má sa po návrate otvoriť kalendár (odkaz /?grid=1#kalendar z podaplikácie)? */
  function takeCalendar() {
    const hash = session('fg.gridHash');
    session('fg.gridHash', null);
    return hash === '#kalendar' || location.hash === '#kalendar';
  }

  let asking = false;
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.fg === 'guard') return;
    if (FG.modalOpen()) {
      // Späť najprv zavrie otvorené okno
      FG.closeModal();
      arm();
      return;
    }
    if (asking) return;
    asking = true;
    // Ďalšie Späť počas otázky aplikáciu už zavrie (pod rozcestníkom nič nie je).
    FG.confirmDialog('Zavrieť Family Grid?', '', 'Zavrieť').then((ok) => {
      asking = false;
      if (!ok) return arm();
      window.close();
      // nainštalovaná aplikácia sa nemusí dať zavrieť skriptom
      setTimeout(() => FG.toast('Zavrieš ju ešte jedným stlačením Späť'), 300);
    });
  });

  // návrat na rozcestník z pamäte prehliadača (bfcache)
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (FG.modalOpen() && !asking) FG.closeModal();
    arm();
    if (takeCalendar()) FG.showCalendarFeed();
  });

  let openCalendar = takeCalendar();
  arm();

  FG.start({
    onReady: async (family) => {
      // Na novom zariadení (nič v pamäti) otvor podaplikáciu, ktorú mal človek otvorenú naposledy inde.
      const local = FG.readStore(FG.LAST_APP_KEY);
      if (family && family.lastApp && !local && !window.FG_GRID) {
        fromGrid();
        location.replace(APPS[family.lastApp].url);
        return;
      }
      render(family);
      if (openCalendar) {
        openCalendar = false;
        FG.showCalendarFeed();
      }
    },
  });
})();
