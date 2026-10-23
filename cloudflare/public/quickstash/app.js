// QuickStash – texty, odkazy a heslá na rýchle skopírovanie. Podaplikácia Family Grid
// (webová verzia desktopového QuickStashu).
//
// Všetky položky, ktoré používateľ vidí (spoločné rodiny a jeho súkromné), sa načítajú naraz
// (quickstash/getData) a hľadá sa v nich v prehliadači. Zmeny idú na server po jednej a každých
// pár sekúnd sa overí verzia (getRev) – zmeny od ostatných členov rodiny sa ukážu samé.

(function () {
  const { $, esc, api, apiQuiet, toast, showError, openModal, closeModal, modalOpen, confirmDialog } = FG;

  const S = {
    hh: null, // id rodiny
    data: null, // { householdId, rev, entries }
    q: '', // hľadaný text
    filter: 'all', // all | shared | private
    revealed: null, // id hesla, ktoré je práve odkryté
  };

  const snapKey = () => 'quickstash.snap.' + S.hh;

  function saveSnapshot() {
    try {
      localStorage.setItem(snapKey(), JSON.stringify(S.data));
    } catch (e) {
      // plná pamäť – nevadí
    }
  }

  // ---- Pomocné ----------------------------------------------------------------------------

  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const isUrl = (v) => /^https?:\/\//i.test(String(v || '').trim());
  const entry = (id) => S.data.entries.find((e) => e.id === id);
  const MASK = '••••••••••';

  function plural(n, one, few, many) {
    return n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  }

  function kind(e) {
    if (e.type === 'password') return { cls: 'password', icon: 'password' };
    if (isUrl(e.value)) return { cls: 'link', icon: 'link' };
    return { cls: '', icon: 'notes' };
  }

  /** Viditeľné položky podľa hľadania (viac slov = všetky musia sedieť) a filtra. */
  function visible() {
    const terms = fold(S.q).split(/\s+/).filter(Boolean);
    return S.data.entries.filter((e) => {
      if (S.filter === 'shared' && e.private) return false;
      if (S.filter === 'private' && !e.private) return false;
      // heslá sa hľadajú len podľa názvu, texty aj podľa obsahu
      const hay = fold(e.name + ' ' + (e.type === 'password' ? '' : e.value));
      return terms.every((t) => hay.includes(t));
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // starší prehliadač alebo bez povolenia – cez skryté pole
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        ta.remove();
        return toast('Nepodarilo sa skopírovať.', true);
      }
      ta.remove();
    }
    toast('✓ Skopírované');
  }

  function openLink(url) {
    window.open(url.trim(), '_blank', 'noopener');
  }

  /** Hlavná akcia položky (ťuknutie na ňu, Enter v hľadaní): odkaz otvorí, ostatné skopíruje. */
  function primary(e) {
    if (e.type !== 'password' && isUrl(e.value)) openLink(e.value);
    else copyText(e.value);
  }

  // ---- Načítanie ------------------------------------------------------------------------------

  async function load(quiet) {
    if (!S.hh) return;
    const fresh = await (quiet ? apiQuiet : api)('quickstash/getData', S.hh);
    if (fresh.householdId !== S.hh) return;
    S.data = fresh;
    saveSnapshot();
  }

  async function reload() {
    try {
      await load(true);
      if (!modalOpen()) renderList();
    } catch (err) {
      showError(err);
    }
  }

  let checking = false;
  async function checkRev() {
    if (document.hidden || !S.data || checking || modalOpen()) return;
    checking = true;
    try {
      const rev = await apiQuiet('quickstash/getRev', S.hh);
      if (rev !== S.data.rev) await reload();
    } catch (e) {
      // obnova na pozadí je nepovinná
    } finally {
      checking = false;
    }
  }
  setInterval(checkRev, 8000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideSecret();
    else checkRev();
  });

  /** Uloží zmenu a obnoví zoznam. */
  async function act(fn, ok) {
    try {
      const res = await fn();
      await load(true);
      renderList();
      if (ok) toast(typeof ok === 'function' ? ok(res) : ok);
      return res;
    } catch (err) {
      showError(err);
      return null;
    }
  }

  // ---- Vykreslenie ----------------------------------------------------------------------------

  function render() {
    $('title').textContent = 'QuickStash';
    if (!S.hh) return renderNoFamily();
    if (!S.data) {
      $('view').innerHTML = '<div class="center muted">Načítavam…</div>';
      return;
    }
    const chip = (v, label) => '<button type="button" class="chip' + (S.filter === v ? ' active' : '') + '" data-filter="' + v + '">' + label + '</button>';
    $('view').innerHTML =
      FG.householdPickerHtml() +
      '<div class="field qs-search"><span class="ms">search</span>' +
      '<input type="search" id="q" placeholder="Hľadať… (Enter = prvá položka)" value="' + esc(S.q) + '" autocomplete="off" enterkeyhint="go"></div>' +
      '<div class="chips">' + chip('all', 'Všetko') + chip('shared', 'Spoločné v rodine') + chip('private', 'Len moje') + '</div>' +
      '<div id="list" class="qs-list"></div>';
    FG.bindHouseholdPicker((id) => {
      S.hh = id;
      S.data = FG.readJson(snapKey());
      render();
      reload();
    });
    const input = $('q');
    input.oninput = () => {
      S.q = input.value;
      renderList();
    };
    input.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = visible()[0];
      if (first) primary(first);
    };
    $('view').querySelectorAll('[data-filter]').forEach((b) => {
      b.onclick = () => {
        S.filter = b.dataset.filter;
        render();
      };
    });
    const fab = $('fab');
    fab.innerHTML = '<button type="button" class="btn" id="add"><span class="ms">add</span>Pridať</button>';
    fab.classList.remove('hidden');
    $('add').onclick = () => entryForm(null);
    renderList();
  }

  function renderNoFamily() {
    $('fab').classList.add('hidden');
    $('view').innerHTML = FG.emptyFamilyHtml('Texty, odkazy a heslá');
    FG.bindEmptyFamily(() => start());
  }

  function entryHtml(e) {
    const k = kind(e);
    const shown = e.type === 'password' && S.revealed === e.id;
    const value = e.type === 'password' ? (shown ? e.value : MASK) : e.value;
    const btn = (role, icon, title, extra) =>
      '<button type="button" class="icon-btn small' + (extra || '') + '" data-' + role + '="' + esc(e.id) + '" title="' + title + '"><span class="ms">' + icon + '</span></button>';
    return (
      '<div class="qs-entry">' +
      '<span class="qs-kind ' + k.cls + '"><span class="ms">' + k.icon + '</span></span>' +
      '<button type="button" class="qs-body" data-primary="' + esc(e.id) + '" title="' + (k.cls === 'link' ? 'Otvoriť odkaz' : 'Skopírovať') + '">' +
      '<div class="qs-name">' + esc(e.name) + (e.private ? '<span class="ms" title="Len pre teba">lock</span>' : '') + '</div>' +
      '<div class="qs-value' + (e.type === 'password' ? (shown ? ' revealed' : ' secret') : '') + '">' + esc(value) + '</div></button>' +
      '<div class="qs-actions">' +
      (e.type === 'password' ? btn('show', shown ? 'visibility_off' : 'visibility', 'Ukázať / skryť', shown ? ' on' : '') : '') +
      (k.cls === 'link' ? btn('open', 'open_in_new', 'Otvoriť odkaz') : '') +
      btn('copy', 'content_copy', 'Skopírovať') +
      btn('edit', 'edit', 'Upraviť') +
      '</div></div>'
    );
  }

  function renderList() {
    const box = $('list');
    if (!box || !S.data) return;
    const list = visible();
    if (!S.data.entries.length) {
      box.innerHTML =
        '<div class="empty compact"><span class="ms">content_paste</span><h2>Zatiaľ prázdne</h2>' +
        '<div>Pridaj text, odkaz alebo heslo, ktoré často kopíruješ – Wi-Fi heslo, číslo účtu, adresu…</div>' +
        '<div style="margin-top:8px">Máš zálohu z desktopového QuickStashu? <b>Môj účet</b> → <b>Import zálohy</b>.</div></div>';
      return;
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty compact"><span class="ms">search_off</span><div>Nič sa nenašlo.</div></div>';
      return;
    }
    box.innerHTML = list.map(entryHtml).join('');
    box.querySelectorAll('[data-primary]').forEach((b) => (b.onclick = () => primary(entry(b.dataset.primary))));
    box.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => copyText(entry(b.dataset.copy).value)));
    box.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openLink(entry(b.dataset.open).value)));
    box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => entryForm(entry(b.dataset.edit))));
    box.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => toggleSecret(b.dataset.show)));
  }

  // Odkryté heslo sa po chvíli (alebo pri odchode z aplikácie) samo skryje.
  let secretTimer;
  function toggleSecret(id) {
    clearTimeout(secretTimer);
    S.revealed = S.revealed === id ? null : id;
    if (S.revealed) secretTimer = setTimeout(hideSecret, 10000);
    renderList();
  }

  function hideSecret() {
    if (!S.revealed) return;
    S.revealed = null;
    renderList();
  }

  // ---- Pridanie a úprava ------------------------------------------------------------------------

  function entryForm(e) {
    let type = e ? e.type : 'text';
    openModal(
      '<h2>' + (e ? 'Upraviť položku' : 'Nová položka') + '</h2>' +
        '<form id="f"><div class="field"><label>Názov</label><input name="name" required maxlength="80" value="' + esc(e ? e.name : '') + '" placeholder="napr. Wi-Fi doma"></div>' +
        '<div class="field"><label>Typ</label><div class="chips seg qs-seg">' +
        '<button type="button" class="chip" data-type="text"><span class="ms">notes</span>Text / odkaz</button>' +
        '<button type="button" class="chip" data-type="password"><span class="ms">password</span>Heslo</button></div></div>' +
        '<div class="field"><label>Hodnota</label><div class="qs-value-field">' +
        '<input name="val" required maxlength="4000" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Text, odkaz alebo heslo">' +
        '<div class="qs-inline"><button type="button" class="icon-btn small" id="eye" title="Ukázať / skryť"><span class="ms">visibility</span></button>' +
        '<button type="button" class="icon-btn small" id="paste" title="Vložiť zo schránky"><span class="ms">content_paste</span></button></div></div></div>' +
        '<label class="qs-check"><input type="checkbox" name="priv"' + (e && e.private ? ' checked' : '') + '><span>Len pre mňa' +
        '<small>Súkromnú položku neuvidí nikto iný z rodiny. Inak ju vidia a môžu meniť všetci v rodine.</small></span></label>' +
        '<div class="actions">' +
        (e ? '<button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' : '') +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">' + (e ? 'Uložiť' : 'Pridať') + '</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        // hodnotu nastav až tu (heslo sa nemá objaviť v HTML okna)
        f.val.value = e ? e.value : '';
        let shown = false;
        const eye = root.querySelector('#eye');
        const sync = () => {
          root.querySelectorAll('[data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
          const secret = type === 'password' && !shown;
          f.val.type = secret ? 'password' : 'text';
          eye.classList.toggle('hidden', type !== 'password');
          eye.querySelector('.ms').textContent = shown ? 'visibility_off' : 'visibility';
        };
        root.querySelectorAll('[data-type]').forEach((b) => {
          b.onclick = () => {
            type = b.dataset.type;
            sync();
          };
        });
        eye.onclick = () => {
          shown = !shown;
          sync();
        };
        sync();
        root.querySelector('#paste').onclick = async () => {
          try {
            f.val.value = await navigator.clipboard.readText();
          } catch (err) {
            f.val.focus();
            toast('Prehliadač nedovolil čítať schránku – vlož text podržaním prsta v poli.', true);
          }
        };
        root.querySelector('#cancel').onclick = closeModal;
        const del = root.querySelector('#del');
        if (del) {
          del.onclick = async () => {
            if (!(await confirmDialog('Vymazať „' + e.name + '“?', e.private ? '' : 'Zmizne všetkým v rodine.', 'Vymazať', true))) return entryForm(e);
            act(() => api('quickstash/deleteEntry', e.id), 'Vymazané');
          };
        }
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const data = { id: e && e.id, name: f.name.value, value: f.val.value, type, private: f.priv.checked };
          const res = await act(() => api('quickstash/saveEntry', S.hh, data), e ? 'Uložené' : '✓ Pridané: ' + data.name.trim());
          if (res) closeModal();
        };
      }
    );
  }

  // ---- Záloha (JSON kompatibilný s desktopovým QuickStashom) -------------------------------------

  function exportBackup() {
    const out = {};
    for (const e of S.data.entries) out[e.name] = { value: e.value, type: e.type };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quickstash-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('✓ Záloha stiahnutá (obsahuje aj heslá – ulož ju bezpečne)');
  }

  function importDialog() {
    openModal(
      '<h2>Import zálohy</h2>' +
        '<div class="subtitle">Súbor JSON z desktopového QuickStashu (<code>data.json</code>) alebo zo zálohy tejto aplikácie. ' +
        'Položky s rovnakým názvom sa prepíšu. Cesty k súborom a priečinkom sa prenesú ako text.</div>' +
        '<form id="f"><div class="field"><label>Súbor</label><input type="file" name="file" accept="application/json,.json" required></div>' +
        '<label class="qs-check"><input type="checkbox" name="priv" checked><span>Len pre mňa' +
        '<small>Nové položky budú súkromné. Bez zaškrtnutia ich uvidí celá rodina.</small></span></label>' +
        '<label class="qs-check"><input type="checkbox" name="replace"><span>Nahradiť' +
        '<small>Najprv vymaže všetky doterajšie položky v cieli (súkromné alebo spoločné).</small></span></label>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn"><span class="ms">upload</span>Importovať</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        const f = root.querySelector('#f');
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const file = f.file.files && f.file.files[0];
          if (!file) return;
          let entries;
          try {
            entries = JSON.parse(await file.text());
          } catch (err) {
            return toast('Súbor nie je platný JSON.', true);
          }
          const replace = f.replace.checked;
          const priv = f.priv.checked;
          if (replace && !(await confirmDialog('Nahradiť ' + (priv ? 'tvoje súkromné' : 'spoločné') + ' položky?', 'Doterajšie sa vymažú.', 'Nahradiť', true))) return;
          try {
            const res = await api('quickstash/importEntries', S.hh, entries, replace ? 'replace' : 'merge', priv);
            S.data = res.data;
            saveSnapshot();
            closeModal(true);
            render();
            toast('Import: pribudlo ' + res.added + (res.updated ? ', prepísané ' + res.updated : ''));
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
      '<button type="button" class="btn tonal small" id="qsImport" style="margin:4px 8px 12px 0"><span class="ms">upload</span>Import zálohy</button>' +
        '<button type="button" class="btn tonal small" id="qsExport" style="margin:4px 0 12px"><span class="ms">download</span>Stiahnuť zálohu</button>',
      (root) => {
        root.querySelector('#qsImport').onclick = () => {
          if (!S.hh) return toast('Najprv vytvor rodinu.', true);
          importDialog();
        };
        root.querySelector('#qsExport').onclick = () => {
          if (!S.data) return toast('Zatiaľ nie je čo zálohovať.', true);
          exportBackup();
        };
      },
    ],
  });
})();
