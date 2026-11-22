// QuickStash – texty, odkazy a heslá na rýchle skopírovanie. Podaplikácia Family Grid
// (webová verzia desktopového QuickStashu).
//
// Všetky položky, ktoré používateľ vidí (spoločné rodiny a jeho súkromné), sa načítajú naraz
// (quickstash/getData) a hľadá sa v nich v prehliadači. Zmeny idú na server po jednej a každých
// pár sekúnd sa overí verzia (getRev) – zmeny od ostatných členov rodiny sa ukážu samé.
//
// Synchronizácia so súborom na Google Drive: prehliadač si vyžiada Google prístup na čítanie
// Drive, stiahne súbor (JSON QuickStashu, Google Tabuľka alebo Dokument) a server položky zosúladí.
// Zámok biometriou (WebAuthn): server vydá položky až po overení odtlačkom prsta / tvárou.

(function () {
  const { $, esc, api, apiQuiet, toast, showError, openModal, closeModal, modalOpen, confirmDialog } = FG;

  const S = {
    hh: null, // id rodiny
    data: null, // { householdId, rev, entries }
    q: '', // hľadaný text
    filter: 'all', // all | shared | private
    revealed: null, // id hesla, ktoré je práve odkryté
    locked: false, // zámok biometriou – čaká sa na odomknutie
  };

  const LOCK_KEY = 'quickstash.lock'; // '1' = zámok zapnutý (údaje sa neukladajú do pamäte telefónu)
  const CRED_KEY = 'quickstash.credId'; // kľúč (odtlačok) tohto zariadenia
  const RELOCK_MS = 60000; // po minúte na pozadí sa QuickStash zamkne
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

  const snapKey = () => 'quickstash.snap.' + S.hh;
  const lockOn = () => FG.readStore(LOCK_KEY) === '1';
  const isLocked = (err) => Boolean(err && err.code === 'QS_LOCKED');

  function setLockFlag(on) {
    FG.writeStore(LOCK_KEY, on ? '1' : null);
    if (!on) return;
    // so zámkom sa heslá nesmú dať prečítať z pamäte telefónu
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('quickstash.snap.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      // bez úložiska nie je čo mazať
    }
  }

  function saveSnapshot() {
    if (lockOn()) return;
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
    S.locked = false;
    if (Boolean(fresh.lock) !== lockOn()) setLockFlag(fresh.lock);
    saveSnapshot();
  }

  async function reload() {
    try {
      await load(true);
      if (!modalOpen()) renderList();
    } catch (err) {
      if (isLocked(err)) showLock();
      else showError(err);
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
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hideSecret();
      hiddenAt = Date.now();
    } else if (lockOn() && S.data && hiddenAt && Date.now() - hiddenAt > RELOCK_MS) {
      apiQuiet('quickstash/lockNow').catch(() => {});
      showLock();
    } else checkRev();
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
      if (isLocked(err)) showLock();
      else showError(err);
      return null;
    }
  }

  // ---- Vykreslenie ----------------------------------------------------------------------------

  function render() {
    $('title').textContent = 'QuickStash';
    if (!S.hh) return renderNoFamily();
    if (S.locked) return showLock();
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
      syncBarHtml() +
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
    bindSyncBar();
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
      '<div class="qs-name">' + esc(e.name) + (e.private ? '<span class="ms" title="Len pre teba">lock</span>' : '') +
      (e.synced ? '<span class="ms" title="Zo súboru na Google Drive">cloud_sync</span>' : '') + '</div>' +
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
        '<div style="margin-top:8px">Máš súbor z desktopového QuickStashu? <b>Môj účet</b> → <b>Google Drive</b> (synchronizácia) alebo <b>Import zálohy</b>.</div></div>';
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
        (e && e.synced ? '<div class="hint qs-note"><span class="ms">cloud_sync</span>Položka je zo súboru na Google Drive – pri ďalšej synchronizácii ju súbor prepíše. Zmeny rob radšej v súbore.</div>' : '') +
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
            if (isLocked(err)) showLock();
            else showError(err);
          }
        };
      }
    );
  }

  // ---- Synchronizácia so súborom na Google Drive ------------------------------------------------

  function syncBarHtml() {
    const link = S.data && S.data.sync;
    if (!link) return '';
    const when = link.syncedAt ? new Date(link.syncedAt).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return (
      '<div class="qs-sync"><button type="button" class="qs-sync-file" id="syncFile" title="Zmeniť súbor alebo odpojiť">' +
      '<span class="ms">cloud_sync</span><span><b>' + esc(link.fileName || 'Súbor na Google Drive') + '</b>' +
      (when ? '<small>synchronizované ' + esc(when) + '</small>' : '') + '</span></button>' +
      '<button type="button" class="btn tonal small" id="syncNow"><span class="ms">sync</span>Synchronizovať</button></div>'
    );
  }

  function bindSyncBar() {
    if (!$('syncNow')) return;
    if (!S.data.sync.url) FG.prepareGoogleAccess(); // okno Google sa musí otvoriť hneď po ťuknutí
    $('syncNow').onclick = () => syncNow();
    $('syncFile').onclick = () => driveDialog();
  }

  /** Volanie Google Drive API (v3) s prístupovým tokenom. */
  async function drive(token, path, asText) {
    let res;
    try {
      res = await fetch('https://www.googleapis.com/drive/v3/' + path, { headers: { authorization: 'Bearer ' + token } });
    } catch (e) {
      throw new Error('Google Drive je nedostupný. Skontroluj pripojenie na internet.');
    }
    if (!res.ok) {
      let msg = '';
      try {
        const body = await res.json();
        msg = (body.error && body.error.message) || '';
      } catch (e) {
        // bez popisu
      }
      if (res.status === 401) FG.forgetGoogleAccess(DRIVE_SCOPE);
      if (res.status === 404) throw new Error('Súbor sa na Google Drive nenašiel (je zmazaný alebo k nemu nemáš prístup).');
      if (res.status === 403 && /has not been used|is disabled|not been enabled/i.test(msg)) {
        throw new Error('V Google Cloud projekte nie je zapnuté Google Drive API – pozri návod v README (QuickStash → Google Drive).');
      }
      throw new Error('Google Drive: ' + (msg || 'chyba ' + res.status));
    }
    return asText ? res.text() : res.json();
  }

  /** Stiahne súbor (meta = { id, name, mimeType }) – text prečíta server (JSON alebo tabuľka). */
  async function readDriveFile(token, meta) {
    const id = encodeURIComponent(meta.id);
    let text;
    if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') text = await drive(token, 'files/' + id + '/export?mimeType=text%2Fcsv', true);
    else if (meta.mimeType === 'application/vnd.google-apps.document') text = await drive(token, 'files/' + id + '/export?mimeType=text%2Fplain', true);
    else if (/^application\/vnd\.google-apps\./.test(meta.mimeType || '')) {
      throw new Error('Tento typ súboru sa nedá synchronizovať – použi JSON, Google Tabuľku alebo Google Dokument.');
    } else text = await drive(token, 'files/' + id + '?alt=media&supportsAllDrives=true', true);
    return text;
  }

  const fileMeta = (token, id) => drive(token, 'files/' + encodeURIComponent(id) + '?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true');

  function syncSummary(res) {
    const parts = [];
    if (res.added) parts.push('pribudlo ' + res.added);
    if (res.updated) parts.push('zmenené ' + res.updated);
    if (res.removed) parts.push('zmazané ' + res.removed);
    return '✓ Synchronizované' + (parts.length ? ': ' + parts.join(', ') : ' – bez zmien');
  }

  /** Stiahne súbor a pošle ho na server (zosúladenie položiek). */
  async function syncWith(token, fileId, isPrivate) {
    const meta = await fileMeta(token, fileId);
    const text = await readDriveFile(token, meta);
    const res = await api('quickstash/syncFile', S.hh, { id: meta.id, name: meta.name }, text, isPrivate);
    S.data = res.data;
    saveSnapshot();
    return res;
  }

  async function syncNow() {
    const link = S.data && S.data.sync;
    if (!link) return driveDialog();
    try {
      let res;
      if (link.url) {
        // podľa odkazu – server súbor stiahne sám
        res = await api('quickstash/syncLink', S.hh);
        S.data = res.data;
        saveSnapshot();
      } else res = await syncWith(await FG.googleAccessToken(DRIVE_SCOPE), link.fileId, link.private);
      render();
      toast(syncSummary(res));
    } catch (err) {
      if (isLocked(err)) showLock();
      else showError(err);
    }
  }

  /** Id súboru z odkazu Google Drive (…/d/<id>/…, ?id=<id>) alebo samotné id. */
  function fileIdFrom(text) {
    const t = String(text || '').trim();
    const m = /\/d\/([A-Za-z0-9_-]{10,})/.exec(t) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(t);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{10,200}$/.test(t) ? t : '';
  }

  const FILE_ICONS = { 'application/vnd.google-apps.spreadsheet': 'table', 'application/vnd.google-apps.document': 'description' };

  /**
   * Synchronizácia podľa odkazu: súbor zdieľaný „Ktokoľvek s odkazom“ – server ho pri každom
   * Synchronizovať stiahne nanovo, netreba nič nastavovať v Google Cloud.
   */
  function driveDialog() {
    const link = S.data && S.data.sync;
    openModal(
      '<h2>Synchronizácia so súborom</h2>' +
        '<div class="subtitle">Vlož odkaz na súbor z Google Drive – JSON z desktopového QuickStashu (<code>data.json</code>), ' +
        'Google Tabuľku so stĺpcami <b>Názov | Hodnota | Typ</b> (heslo / text) alebo Google Dokument s JSON. ' +
        'Keď súbor upravíš, ťukni na <b>Synchronizovať</b> a stiahne sa nanovo: zmenené položky sa prepíšu, nové pribudnú, ' +
        'zmazané zmiznú. Položky pridané tu v aplikácii ostanú.</div>' +
        '<form id="f"><div class="field"><label>Odkaz na súbor</label>' +
        '<input name="url" type="url" required placeholder="https://drive.google.com/file/d/…" autocomplete="off" value="' + esc((link && link.url) || '') + '">' +
        '<div class="hint">Na Google Drive: <b>Zdieľať → Všeobecný prístup → Ktokoľvek s odkazom</b> → Kopírovať odkaz.</div></div>' +
        '<div class="hint qs-note qs-warn"><span class="ms">warning</span><span>Súbor zdieľaný odkazom si môže otvoriť každý, kto odkaz pozná – aj s heslami. ' +
        'Súkromný súbor vyberieš cez <b>Môj Drive</b> (raz treba zapnúť Google Drive API – návod v README).</span></div>' +
        '<label class="qs-check"><input type="checkbox" name="priv"' + (!link || link.private ? ' checked' : '') + '><span>Len pre mňa' +
        '<small>Nové položky zo súboru budú súkromné. Bez zaškrtnutia ich uvidí celá rodina.</small></span></label>' +
        '<div class="actions qs-actions-wrap">' +
        (link ? '<button type="button" class="btn text danger-text" id="unlink"><span class="ms">link_off</span>Odpojiť</button>' : '') +
        '<button type="button" class="btn text" id="mine" style="margin-right:auto"><span class="ms">cloud_sync</span>Môj Drive</button>' +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn"><span class="ms">sync</span>Synchronizovať</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#mine').onclick = () => {
          FG.prepareGoogleAccess();
          drivePickerDialog();
        };
        const unlink = root.querySelector('#unlink');
        if (unlink) unlink.onclick = () => unlinkFile(driveDialog);
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          try {
            const res = await api('quickstash/syncLink', S.hh, f.url.value.trim(), f.priv.checked);
            S.data = res.data;
            saveSnapshot();
            closeModal(true);
            render();
            toast(syncSummary(res));
          } catch (err) {
            if (isLocked(err)) {
              closeModal(true);
              showLock();
            } else showError(err);
          }
        };
      }
    );
  }

  async function unlinkFile(back) {
    if (!(await confirmDialog('Odpojiť súbor?', 'Položky ostanú, len sa už nebudú synchronizovať.', 'Odpojiť'))) return back();
    try {
      S.data = await api('quickstash/unlinkSync', S.hh);
      saveSnapshot();
      render();
      toast('Súbor odpojený');
    } catch (err) {
      if (isLocked(err)) showLock();
      else showError(err);
    }
  }

  /** Výber súboru z môjho Google Drive (Google prístup na čítanie – vyžaduje zapnuté Drive API). */
  async function drivePickerDialog() {
    const link = S.data && S.data.sync;
    let token;
    try {
      token = await FG.googleAccessToken(DRIVE_SCOPE);
    } catch (err) {
      return showError(err);
    }
    let files = [];
    try {
      const q =
        "trashed = false and (mimeType = 'application/json' or mimeType = 'text/plain' or mimeType = 'text/csv' or " +
        "mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.document' or name contains '.json')";
      const params = new URLSearchParams({ q, pageSize: '100', orderBy: 'modifiedTime desc', fields: 'files(id,name,mimeType,modifiedTime)' });
      files = (await drive(token, 'files?' + params)).files || [];
    } catch (err) {
      return showError(err);
    }
    let chosen = link ? link.fileId : '';
    if (link && !files.some((f) => f.id === link.fileId)) files.unshift({ id: link.fileId, name: link.fileName || 'Prepojený súbor', mimeType: '' });
    const fileRow = (f) =>
      '<button type="button" class="qs-file" data-file="' + esc(f.id) + '"><span class="ms">' + (FILE_ICONS[f.mimeType] || 'data_object') + '</span>' +
      '<span><b>' + esc(f.name) + '</b>' + (f.modifiedTime ? '<small>upravený ' + esc(new Date(f.modifiedTime).toLocaleString('sk-SK', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</small>' : '') +
      '</span></button>';
    openModal(
      '<h2>Synchronizácia s Google Drive</h2>' +
        '<div class="subtitle">Vyber súbor – JSON z desktopového QuickStashu (<code>data.json</code>), Google Tabuľku so stĺpcami ' +
        '<b>Názov | Hodnota | Typ</b> (heslo / text) alebo Google Dokument s JSON. Keď súbor upravíš, ťukni na <b>Synchronizovať</b>: ' +
        'položky zo súboru sa prepíšu, nové pribudnú a zmazané zmiznú. Položky pridané tu v aplikácii ostanú.</div>' +
        '<form id="f"><div class="field"><input type="search" id="fq" placeholder="Hľadať súbor…" autocomplete="off"></div>' +
        '<div class="qs-files" id="files"></div>' +
        '<div class="field"><label>alebo odkaz na súbor</label><input name="url" placeholder="https://drive.google.com/file/d/…" autocomplete="off"></div>' +
        '<label class="qs-check"><input type="checkbox" name="priv"' + (!link || link.private ? ' checked' : '') + '><span>Len pre mňa' +
        '<small>Nové položky zo súboru budú súkromné. Bez zaškrtnutia ich uvidí celá rodina.</small></span></label>' +
        '<div class="actions">' +
        (link ? '<button type="button" class="btn text danger-text" id="unlink" style="margin-right:auto"><span class="ms">link_off</span>Odpojiť</button>' : '') +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn"><span class="ms">sync</span>Synchronizovať</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        const box = root.querySelector('#files');
        const show = () => {
          const terms = fold(root.querySelector('#fq').value).split(/\s+/).filter(Boolean);
          const list = files.filter((x) => terms.every((t) => fold(x.name).includes(t)));
          box.innerHTML = list.length ? list.map(fileRow).join('') : '<div class="muted qs-files-empty">Žiadny vhodný súbor (JSON, Tabuľka, Dokument).</div>';
          box.querySelectorAll('[data-file]').forEach((b) => {
            b.classList.toggle('active', b.dataset.file === chosen);
            b.onclick = () => {
              chosen = b.dataset.file;
              f.url.value = '';
              show();
            };
          });
        };
        root.querySelector('#fq').oninput = show;
        f.url.oninput = () => {
          if (f.url.value.trim()) {
            chosen = '';
            show();
          }
        };
        show();
        root.querySelector('#cancel').onclick = closeModal;
        const unlink = root.querySelector('#unlink');
        if (unlink) unlink.onclick = () => unlinkFile(drivePickerDialog);
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          const id = f.url.value.trim() ? fileIdFrom(f.url.value) : chosen;
          if (!id) return toast(f.url.value.trim() ? 'Toto nie je odkaz na súbor Google Drive.' : 'Vyber súbor.', true);
          try {
            const res = await syncWith(token, id, f.priv.checked);
            closeModal(true);
            render();
            toast(syncSummary(res));
          } catch (err) {
            if (isLocked(err)) {
              closeModal(true);
              showLock();
            } else showError(err);
          }
        };
      }
    );
  }

  // ---- Zámok biometriou (WebAuthn) ------------------------------------------------------------------

  const b64e = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), (ch) => ch.charCodeAt(0));
  const webauthnSupported = () => Boolean(window.PublicKeyCredential && navigator.credentials);

  function deviceName() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Zariadenie';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return os + (browser ? ' · ' + browser : '');
  }

  function webauthnError(err) {
    if (err && err.name === 'NotAllowedError') return 'Overenie bolo zrušené alebo vypršalo – skús znova.';
    if (err && err.name === 'InvalidStateError') return 'Toto zariadenie už je pridané.';
    if (err && err.name === 'SecurityError') return 'Overenie tu nie je povolené (otvor aplikáciu cez https).';
    return FG.errorMessage(err);
  }

  let unlockPrep = null; // výzva pripravená vopred – Safari chce okno odtlačku hneď po ťuknutí
  function prepareUnlock() {
    unlockPrep = apiQuiet('quickstash/unlockBegin')
      .then((b) => ({ ...b, at: Date.now() }))
      .catch(() => null);
  }

  /** Zamknutá obrazovka – položky sú preč z pamäte, kým sa človek neoverí. */
  function showLock() {
    S.locked = true;
    S.data = null;
    S.revealed = null;
    if (!lockOn()) setLockFlag(true);
    if (modalOpen()) closeModal(true);
    $('fab').classList.add('hidden');
    $('view').innerHTML =
      '<div class="empty qs-lock"><span class="ms">lock</span><h2>QuickStash je zamknutý</h2>' +
      '<div>Odomkni ho odtlačkom prsta, tvárou alebo zámkom obrazovky.</div>' +
      '<button type="button" class="btn" id="unlockBtn"><span class="ms">fingerprint</span>Odomknúť</button>' +
      '<div class="hint" id="lockHint"></div></div>';
    $('unlockBtn').onclick = () => doUnlock(false);
    prepareUnlock();
    // Chrome otvorí overenie aj bez ťuknutia; Safari (iPhone, Mac) len po ťuknutí
    if (!/iPhone|iPad|Macintosh/.test(navigator.userAgent) && document.hasFocus()) doUnlock(true);
  }

  let unlocking = false;
  async function doUnlock(auto) {
    if (unlocking) return;
    unlocking = true;
    const hint = $('lockHint');
    if (hint) hint.textContent = '';
    try {
      if (!webauthnSupported()) throw new Error('Tento prehliadač nepodporuje odtlačok prsta ani Face ID.');
      let begin = unlockPrep && (await unlockPrep);
      unlockPrep = null;
      if (!begin || Date.now() - begin.at > 4 * 60000) begin = await apiQuiet('quickstash/unlockBegin');
      const cred = await navigator.credentials.get({
        publicKey: {
          challenge: b64d(begin.challenge),
          rpId: begin.rpId,
          allowCredentials: begin.allow.map((id) => ({ type: 'public-key', id: b64d(id) })),
          userVerification: 'required',
          timeout: 60000,
        },
      });
      const r = cred.response;
      await api('quickstash/unlock', {
        id: cred.id,
        clientDataJSON: b64e(r.clientDataJSON),
        authenticatorData: b64e(r.authenticatorData),
        signature: b64e(r.signature),
      });
      S.locked = false;
      unlocking = false;
      await start();
    } catch (err) {
      unlocking = false;
      if (err && err.status === 400 && /nie je zapnutý/.test(err.message)) {
        // zámok medzičasom vypli na inom zariadení
        setLockFlag(false);
        S.locked = false;
        return start();
      }
      if (FG.isLoginRequired(err)) return;
      prepareUnlock();
      const box = $('lockHint');
      if (box && !(auto && err && err.name === 'NotAllowedError')) box.textContent = webauthnError(err);
    }
  }

  /** Zapne zámok / pridá toto zariadenie (vytvorí kľúč chránený biometriou). */
  async function addThisDevice(prep) {
    let begin = prep && (await prep);
    if (!begin) begin = await api('quickstash/lockBegin');
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: b64d(begin.challenge),
        rp: { id: begin.rpId, name: 'Family Grid' },
        user: { id: b64d(begin.userId), name: begin.userName, displayName: FG.state.nickname || begin.userName },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        excludeCredentials: begin.exclude.map((id) => ({ type: 'public-key', id: b64d(id) })),
        attestation: 'none',
        timeout: 60000,
      },
    });
    const r = cred.response;
    const publicKey = r.getPublicKey ? r.getPublicKey() : null;
    if (!publicKey || !r.getAuthenticatorData) throw new Error('Tento prehliadač je na zámok odtlačkom príliš starý – aktualizuj ho.');
    const info = await api('quickstash/lockEnable', {
      id: cred.id,
      publicKey: b64e(publicKey),
      alg: r.getPublicKeyAlgorithm(),
      clientDataJSON: b64e(r.clientDataJSON),
      authenticatorData: b64e(r.getAuthenticatorData()),
      device: deviceName(),
    });
    FG.writeStore(CRED_KEY, cred.id);
    setLockFlag(true);
    return info;
  }

  async function lockDialog() {
    if (!webauthnSupported()) return toast('Tento prehliadač nepodporuje odtlačok prsta ani Face ID.', true);
    let info;
    try {
      info = await api('quickstash/getLock');
    } catch (err) {
      return showError(err);
    }
    if (info.enabled && !info.unlocked) {
      closeModal(true);
      return showLock();
    }
    const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
    const mine = FG.readStore(CRED_KEY);
    const canAdd = platform && !info.devices.some((d) => d.id === mine);
    const prep = canAdd ? apiQuiet('quickstash/lockBegin').catch(() => null) : null;
    const date = (iso) => (iso ? new Date(iso).toLocaleDateString('sk-SK') : '');
    openModal(
      '<h2>Zámok odtlačkom prsta</h2>' +
        '<div class="subtitle">' +
        (info.enabled
          ? 'QuickStash sa na každom tvojom zariadení otvorí až po overení odtlačkom prsta, tvárou (Face ID) alebo zámkom obrazovky. Sám sa zamkne, keď je aplikácia viac ako minútu na pozadí.'
          : 'Po zapnutí sa QuickStash otvorí až po overení odtlačkom prsta, tvárou (Face ID) alebo zámkom obrazovky – na každom tvojom zariadení (aj počítači, tam cez Windows Hello alebo telefón). Heslá sa potom neukladajú do pamäte telefónu.') +
        '</div>' +
        (info.devices.length
          ? '<div class="qs-devices">' +
            info.devices
              .map(
                (d) =>
                  '<div class="qs-device"><span class="ms">fingerprint</span><span><b>' + esc(d.device) + (d.id === mine ? ' (toto zariadenie)' : '') + '</b>' +
                  '<small>pridané ' + esc(date(d.createdAt)) + (d.lastUsedAt ? ' · naposledy ' + esc(date(d.lastUsedAt)) : '') + '</small></span>' +
                  '<button type="button" class="icon-btn small" data-remove="' + esc(d.id) + '" title="Odobrať"><span class="ms">delete</span></button></div>'
              )
              .join('') +
            '</div>'
          : '') +
        (!platform ? '<div class="hint">Toto zariadenie nemá odtlačok prsta ani Windows Hello. ' + (info.enabled ? 'Odomkneš ho prístupovým kľúčom z telefónu (QR kód).' : 'Zapni zámok na telefóne.') + '</div>' : '') +
        '<div class="actions">' +
        (info.enabled ? '<button type="button" class="btn text danger-text" id="off" style="margin-right:auto"><span class="ms">lock_open</span>Vypnúť</button>' : '') +
        '<button type="button" class="btn text" id="cancel">Zavrieť</button>' +
        (canAdd ? '<button type="button" class="btn" id="on"><span class="ms">fingerprint</span>' + (info.enabled ? 'Pridať toto zariadenie' : 'Zapnúť') + '</button>' : '') +
        '</div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        const on = root.querySelector('#on');
        if (on) {
          on.onclick = async () => {
            try {
              await addThisDevice(prep);
              closeModal(true);
              toast(info.enabled ? '✓ Zariadenie pridané' : '✓ Zámok zapnutý');
            } catch (err) {
              toast(webauthnError(err), true);
              if (!err || err.name !== 'InvalidStateError') lockDialog();
            }
          };
        }
        const off = root.querySelector('#off');
        if (off) {
          off.onclick = async () => {
            if (!(await confirmDialog('Vypnúť zámok?', 'QuickStash sa bude otvárať bez overenia na všetkých zariadeniach.', 'Vypnúť', true))) return lockDialog();
            try {
              await api('quickstash/lockDisable');
              setLockFlag(false);
              FG.writeStore(CRED_KEY, null);
              saveSnapshot();
              toast('Zámok vypnutý');
            } catch (err) {
              if (isLocked(err)) showLock();
              else showError(err);
            }
          };
        }
        root.querySelectorAll('[data-remove]').forEach((b) => {
          b.onclick = async () => {
            const d = info.devices.find((x) => x.id === b.dataset.remove);
            const last = info.devices.length === 1;
            if (!(await confirmDialog('Odobrať ' + d.device + '?', last ? 'Je to posledné zariadenie – zámok sa vypne.' : 'Toto zariadenie sa potom odomkne len iným kľúčom.', 'Odobrať', true))) return lockDialog();
            try {
              const res = await api('quickstash/lockRemove', d.id);
              if (d.id === mine) FG.writeStore(CRED_KEY, null);
              if (!res.enabled) {
                setLockFlag(false);
                saveSnapshot();
              }
              lockDialog();
            } catch (err) {
              if (isLocked(err)) showLock();
              else showError(err);
            }
          };
        });
      }
    );
  }

  // ---- Štart -----------------------------------------------------------------------------------

  async function start() {
    const h = FG.currentHousehold();
    S.hh = h ? h.id : null;
    if (!S.hh) return render();
    FG.setHousehold(S.hh);
    if (!S.data || S.data.householdId !== S.hh) S.data = lockOn() ? null : FG.readJson(snapKey());
    render();
    try {
      await load(Boolean(S.data));
      render();
    } catch (err) {
      if (isLocked(err)) showLock();
      else if (err.offline && S.data) toast('Bez internetu – ukazujem posledné uložené údaje');
      else if (!FG.isLoginRequired(err)) showError(err);
    }
  }

  FG.start({
    onReady: () => start(),
    accountExtra: () => [
      '<button type="button" class="btn tonal small" id="qsDrive" style="margin:4px 8px 8px 0"><span class="ms">cloud_sync</span>Google Drive</button>' +
        '<button type="button" class="btn tonal small" id="qsLock" style="margin:4px 0 8px"><span class="ms">fingerprint</span>Zámok odtlačkom</button><br>' +
        '<button type="button" class="btn tonal small" id="qsImport" style="margin:4px 8px 12px 0"><span class="ms">upload</span>Import zálohy</button>' +
        '<button type="button" class="btn tonal small" id="qsExport" style="margin:4px 0 12px"><span class="ms">download</span>Stiahnuť zálohu</button>',
      (root) => {
        root.querySelector('#qsDrive').onclick = () => {
          if (!S.hh) return toast('Najprv vytvor rodinu.', true);
          if (!S.data) return S.locked ? showLock() : toast('Počkaj, kým sa položky načítajú.', true);
          driveDialog();
        };
        root.querySelector('#qsLock').onclick = () => lockDialog();
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
