// Rozcestník Family Grid: dlaždice podaplikácií s krátkym prehľadom.
// Ťuknutie na dlaždicu otvorí podaplikáciu; tá sa zapamätá a pri ďalšom spustení
// Family Grid sa otvorí rovno ona (pozri skript v index.html).

(function () {
  const { APPS, $, esc } = FG;

  function greeting() {
    const h = new Date().getHours();
    if (h < 10) return 'Dobré ráno';
    if (h < 18) return 'Dobrý deň';
    return 'Dobrý večer';
  }

  function plural(n, one, few, many) {
    return n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  }

  function info(app, overview) {
    const o = (overview || {})[app];
    if (!o) return '';
    if (app === 'gazda') {
      if (o.overdue) return { text: 'Po termíne: ' + plural(o.overdue, 'úloha', 'úlohy', 'úloh'), warn: true };
      if (o.today) return { text: 'Dnes ' + plural(o.today, 'úloha', 'úlohy', 'úloh') };
      return { text: 'Na dnes nič' };
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
    return '';
  }

  function render(family) {
    const me = family || FG.state;
    const name = me.nickname || '';
    const last = FG.readStore(FG.LAST_APP_KEY);
    $('view').innerHTML =
      '<div class="grid-hello"><h2>' + esc(greeting() + (name ? ', ' + name : '')) + '</h2>' +
      '<div class="muted">Vyber aplikáciu. Family Grid si zapamätá poslednú a nabudúce ju otvorí rovno.</div></div>' +
      '<div class="tiles">' +
      Object.entries(APPS)
        .map(([id, a]) => {
          const i = family ? info(id, family.overview) : '';
          return (
            '<a class="tile" href="' + a.url + '" data-app="' + id + '">' +
            (last === id ? '<span class="last">naposledy</span>' : '') +
            '<img src="/icons/' + id + '/icon.svg" alt="">' +
            '<div><div class="name">' + esc(a.name) + '</div><div class="desc">' + esc(a.desc) + '</div></div>' +
            (i ? '<div class="info' + (i.warn ? ' warn' : '') + '">' + esc(i.text) + '</div>' : '') +
            '</a>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="grid-note">Rodiny (domácnosti) a ich členovia sú spoločné pre všetky aplikácie – ' +
      'zakladajú sa a zdieľajú v Gazde alebo priamo v Zdravkovi a Skládku. Upozornenia sa zapínajú raz 🔔 ' +
      'a každá aplikácia v nich má vlastnú ikonu.</div>';
    // Zapamätaj hneď pri ťuknutí (podaplikácia to potvrdí aj sama po načítaní).
    $('view').querySelectorAll('.tile').forEach((t) => {
      t.addEventListener('click', () => FG.writeStore(FG.LAST_APP_KEY, t.dataset.app));
    });
  }

  FG.start({
    onReady: async (family) => {
      // Na novom zariadení (nič v pamäti) otvor podaplikáciu, ktorú mal človek otvorenú naposledy inde.
      const local = FG.readStore(FG.LAST_APP_KEY);
      if (family && family.lastApp && !local) {
        location.replace(APPS[family.lastApp].url);
        return;
      }
      render(family);
    },
  });
})();
