// Tlačidlo Späť v podaplikáciách Family Grid (Gazda, Nákupy, Zdravko, Skládko, QuickStash, Financie).
//
// Family Grid sa otvára rovno v naposledy otvorenej podaplikácii. Aby Späť z jej hlavnej obrazovky
// aplikáciu nezavrel, vloží si podaplikácia pri otvorení pod seba „spodný“ záznam histórie
// ({ fgBase: 1 }). Keď naň človek príde tlačidlom Späť, otvorí sa rozcestník Family Grid –
// a až tam sa Späť opýta, či aplikáciu zavrieť (pozri grid.js).
//
// - spodný záznam si pamätá, či pod ním je rozcestník (podaplikácia otvorená dlaždicou):
//   vtedy sa naň vráti (history.back), inak ho otvorí namiesto seba (location.replace),
// - tlačidlo dlaždíc (odkazy /?grid=1…) robí to isté – vráti sa po histórii až na spodný záznam,
//   takže rozcestník je v histórii vždy len raz a úplne naspodku,
// - otvorené okno zavrie Späť najprv samo.
//
// Musí sa načítať pred vlastným skriptom podaplikácie (jej popstate beží až po tomto).

(function () {
  var FROM_GRID = 'fg.fromGrid'; // nastaví rozcestník pri ťuknutí na dlaždicu
  var TO_GRID = 'fg.toGrid'; // práve sa vraciame na rozcestník (tlačidlom dlaždíc)
  var GRID_HASH = 'fg.gridHash'; // čo má rozcestník po návrate otvoriť (napr. #kalendar)

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

  // Späť po histórii; keby sa nič nestalo (záznam chýba), otvor rozcestník priamo.
  var fallback = null;
  function backOr(url) {
    clearTimeout(fallback);
    fallback = setTimeout(function () {
      session(TO_GRID, null);
      location.replace(url);
    }, 700);
    history.back();
  }
  // stránka odložená v pamäti prehliadača (bfcache) nesmie po návrate dobehnúť náhradné presmerovanie
  window.addEventListener('pagehide', function () {
    clearTimeout(fallback);
  });

  function toGrid(base) {
    session(TO_GRID, null);
    if (base.grid) backOr('/?grid=1');
    else location.replace('/?grid=1');
  }

  function modalOpen() {
    var m = document.getElementById('modal');
    return Boolean(m && !m.classList.contains('hidden'));
  }

  function closeModal() {
    if (window.FG && window.FG.closeModal) window.FG.closeModal();
    else if (typeof window.closeModal === 'function') window.closeModal();
  }

  var state = history.state;
  if (state && state.fgBase) {
    // stránka sa načítala rovno na spodnom zázname
    toGrid(state);
    return;
  }

  // Staré odkazy Gazdy na nákup ju hneď presmerujú do Nákupov – tie si spodný záznam vložia samy.
  var redirecting = location.pathname === '/gazda/' && /[?&](akcia=nakup|nakup=)/.test(location.search);
  var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || {};
  var fromGrid = session(FROM_GRID) === '1';
  session(FROM_GRID, null);
  session(TO_GRID, null);
  // po obnovení stránky alebo návrate po histórii spodný záznam už existuje
  if (!redirecting && nav.type !== 'reload' && nav.type !== 'back_forward') {
    history.replaceState({ fgBase: 1, grid: fromGrid }, '');
    history.pushState(state, '');
  }

  window.addEventListener('popstate', function (e) {
    clearTimeout(fallback);
    var s = e.state;
    if (!(s && s.fgBase)) {
      if (session(TO_GRID)) backOr('/?grid=1'); // pokračuj až na spodný záznam
      return;
    }
    if (!session(TO_GRID) && modalOpen()) {
      // Späť najprv zavrie otvorené okno, podaplikácia ostane
      closeModal();
      history.pushState(null, '');
      return;
    }
    toGrid(s);
  });

  // Tlačidlo dlaždíc (aj odkaz na kalendár na rozcestníku)
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href^="/?grid=1"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    session(GRID_HASH, a.hash || null);
    if (history.state && history.state.fgBase) toGrid(history.state);
    else {
      session(TO_GRID, '1');
      backOr('/?grid=1');
    }
  });
})();
