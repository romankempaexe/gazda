// Kontakty – telefónny zoznam dôležitých čísel rodiny. Podaplikácia Family Grid.
//
// Kontakt má meno, telefónne číslo, voliteľne e-mail a poznámku; dôležité (hviezdička) sú navrchu.
// Tlačidlo „Zavolať“ je odkaz tel: (telefón rovno vytočí číslo), „E-mail“ je mailto:.
// Všetky kontakty rodiny sa načítajú naraz (kontakty/getData) a hľadá sa v nich v prehliadači.
// Každých pár sekúnd sa overí verzia (getRev) – zmeny od ostatných členov rodiny sa ukážu samé.
// Posledné údaje sú v pamäti telefónu, takže čísla sú po ruke aj bez internetu.

(function () {
  const { $, esc, api, apiQuiet, toast, showError, openModal, closeModal, modalOpen, confirmDialog } = FG;

  const S = {
    hh: null, // id rodiny
    data: null, // { householdId, rev, contacts }
    q: '', // hľadaný text
  };

  // Tiesňové čísla – dajú sa pridať jedným ťuknutím, kým je zoznam prázdny.
  const EMERGENCY = [
    { name: 'Tiesňová linka (EÚ)', phone: '112', note: 'Jednotné európske číslo tiesňového volania' },
    { name: 'Záchranná služba', phone: '155' },
    { name: 'Hasiči', phone: '150' },
    { name: 'Polícia', phone: '158' },
  ];

  const snapKey = () => 'kontakty.snap.' + S.hh;

  function saveSnapshot() {
    try {
      localStorage.setItem(snapKey(), JSON.stringify(S.data));
    } catch (e) {
      // plná pamäť – nevadí
    }
  }

  // ---- Pomocné ----------------------------------------------------------------------------

  const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const contact = (id) => S.data.contacts.find((c) => c.id === id);
  /** Číslo do odkazu tel: – len číslice a + na začiatku. */
  const telHref = (phone) => 'tel:' + String(phone || '').replace(/(?!^\+)[^\d]/g, '');

  /** Viditeľné kontakty podľa hľadania (viac slov = všetky musia sedieť; v číslach sa ignorujú medzery). */
  function visible() {
    const terms = fold(S.q).split(/\s+/).filter(Boolean);
    return S.data.contacts.filter((c) => {
      const hay = fold(c.name + ' ' + c.email + ' ' + c.note) + ' ' + c.phone.replace(/\D/g, '');
      return terms.every((t) => hay.includes(/^[\d+]+$/.test(t) ? t.replace(/\D/g, '') : t));
    });
  }

  function sorted(list) {
    return list.slice().sort((a, b) => b.favorite - a.favorite || a.name.localeCompare(b.name, 'sk'));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('✓ Skopírované');
    } catch (e) {
      toast('Nepodarilo sa skopírovať.', true);
    }
  }

  // ---- Načítanie ------------------------------------------------------------------------------

  async function load(quiet) {
    if (!S.hh) return;
    const fresh = await (quiet ? apiQuiet : api)('kontakty/getData', S.hh);
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
      const rev = await apiQuiet('kontakty/getRev', S.hh);
      if (rev !== S.data.rev) await reload();
    } catch (e) {
      // obnova na pozadí je nepovinná
    } finally {
      checking = false;
    }
  }
  setInterval(checkRev, 8000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkRev();
  });

  /** Uloží zmenu a obnoví zoznam. */
  async function act(fn, ok) {
    try {
      const res = await fn();
      await load(true);
      renderList();
      if (ok) toast(ok);
      return res || true;
    } catch (err) {
      showError(err);
      return null;
    }
  }

  // ---- Vykreslenie ----------------------------------------------------------------------------

  function render() {
    $('title').textContent = 'Kontakty';
    if (!S.hh) return renderNoFamily();
    if (!S.data) {
      $('view').innerHTML = '<div class="center muted">Načítavam…</div>';
      return;
    }
    $('view').innerHTML =
      FG.householdPickerHtml() +
      '<div class="field kt-search"><span class="ms">search</span>' +
      '<input type="search" id="q" placeholder="Hľadať meno alebo číslo…" value="' + esc(S.q) + '" autocomplete="off" enterkeyhint="search"></div>' +
      '<div id="list" class="kt-list"></div>';
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
    const fab = $('fab');
    fab.innerHTML = '<button type="button" class="btn" id="add"><span class="ms">add</span>Pridať kontakt</button>';
    fab.classList.remove('hidden');
    $('add').onclick = () => contactForm(null);
    renderList();
  }

  function renderNoFamily() {
    $('fab').classList.add('hidden');
    $('view').innerHTML = FG.emptyFamilyHtml('Kontakty');
    FG.bindEmptyFamily(() => start());
  }

  function contactHtml(c) {
    const initial = (c.name.trim().charAt(0) || '?').toUpperCase();
    return (
      '<div class="kt-entry' + (c.favorite ? ' fav' : '') + '">' +
      '<span class="kt-avatar">' + esc(initial) + '</span>' +
      '<button type="button" class="kt-body" data-edit="' + esc(c.id) + '" title="Upraviť">' +
      '<div class="kt-name"><span>' + esc(c.name) + '</span>' + (c.favorite ? '<span class="ms kt-star" title="Dôležitý">star</span>' : '') + '</div>' +
      (c.phone ? '<div class="kt-line kt-phone">' + esc(c.phone) + '</div>' : '') +
      (c.email ? '<div class="kt-line">' + esc(c.email) + '</div>' : '') +
      (c.note ? '<div class="kt-line kt-note">' + esc(c.note) + '</div>' : '') +
      '</button>' +
      '<div class="kt-actions">' +
      (c.email ? '<a class="icon-btn kt-mail" href="mailto:' + esc(c.email) + '" title="Napísať e-mail"><span class="ms">mail</span></a>' : '') +
      (c.phone ? '<a class="kt-call" href="' + esc(telHref(c.phone)) + '" title="Zavolať ' + esc(c.phone) + '"><span class="ms">call</span></a>' : '') +
      '</div></div>'
    );
  }

  function renderList() {
    const box = $('list');
    if (!box || !S.data) return;
    if (!S.data.contacts.length) {
      box.innerHTML =
        '<div class="empty compact"><span class="ms">contact_phone</span><h2>Zatiaľ žiadne kontakty</h2>' +
        '<div>Pridaj dôležité čísla rodiny – lekár, škola, škôlka, susedia, servis, poisťovňa… Celá rodina ich uvidí a môže rovno zavolať.</div>' +
        '<button type="button" class="btn tonal" id="sos" style="margin-top:14px"><span class="ms">emergency</span>Pridať tiesňové čísla (112, 155, 150, 158)</button></div>';
      $('sos').onclick = addEmergency;
      return;
    }
    const list = sorted(visible());
    if (!list.length) {
      box.innerHTML = '<div class="empty compact"><span class="ms">search_off</span><div>Nič sa nenašlo.</div></div>';
      return;
    }
    const fav = list.filter((c) => c.favorite);
    const rest = list.filter((c) => !c.favorite);
    box.innerHTML =
      (fav.length && rest.length ? '<div class="kt-section">Dôležité</div>' : '') +
      fav.map(contactHtml).join('') +
      (fav.length && rest.length ? '<div class="kt-section">Ostatné</div>' : '') +
      rest.map(contactHtml).join('');
    box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => contactForm(contact(b.dataset.edit))));
  }

  async function addEmergency() {
    const ok = await act(async () => {
      for (const c of EMERGENCY) await api('kontakty/saveContact', S.hh, { ...c, favorite: true });
    }, '✓ Tiesňové čísla pridané');
    if (ok) render();
  }

  // ---- Pridanie a úprava ------------------------------------------------------------------------

  function contactForm(c) {
    openModal(
      '<h2>' + (c ? 'Upraviť kontakt' : 'Nový kontakt') + '</h2>' +
        '<form id="f">' +
        '<div class="field"><label>Meno</label><input name="name" required maxlength="80" autocomplete="off" placeholder="napr. Detská lekárka MUDr. Nová"></div>' +
        '<div class="field"><label>Telefónne číslo</label><input name="phone" type="tel" inputmode="tel" maxlength="30" autocomplete="off" placeholder="napr. +421 905 123 456"></div>' +
        '<div class="field"><label>E-mail <span class="muted">(nepovinné)</span></label><input name="email" type="email" maxlength="120" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="napr. ambulancia@example.sk"></div>' +
        '<div class="field"><label>Poznámka <span class="muted">(nepovinné)</span></label><textarea name="note" rows="2" maxlength="500" placeholder="napr. ordinačné hodiny, adresa, kto to je"></textarea></div>' +
        '<label class="kt-check"><input type="checkbox" name="fav"><span><span class="ms">star</span>Dôležitý kontakt<small>Zobrazí sa navrchu zoznamu.</small></span></label>' +
        '<div class="actions">' +
        (c ? '<button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' : '') +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">' + (c ? 'Uložiť' : 'Pridať') + '</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        f.name.value = c ? c.name : '';
        f.phone.value = c ? c.phone : '';
        f.email.value = c ? c.email : '';
        f.note.value = c ? c.note : '';
        f.fav.checked = Boolean(c && c.favorite);
        root.querySelector('#cancel').onclick = closeModal;
        const del = root.querySelector('#del');
        if (del) {
          del.onclick = async () => {
            if (!(await confirmDialog('Vymazať „' + c.name + '“?', 'Kontakt zmizne všetkým v rodine.', 'Vymazať', true))) return contactForm(c);
            act(() => api('kontakty/deleteContact', c.id), 'Vymazané');
          };
        }
        f.onsubmit = async (ev) => {
          ev.preventDefault();
          if (!f.phone.value.trim() && !f.email.value.trim()) {
            f.phone.focus();
            return toast('Zadaj telefónne číslo alebo e-mail.', true);
          }
          const data = {
            id: c && c.id,
            name: f.name.value,
            phone: f.phone.value,
            email: f.email.value,
            note: f.note.value,
            favorite: f.fav.checked,
          };
          const res = await act(() => api('kontakty/saveContact', S.hh, data), c ? 'Uložené' : '✓ Pridané: ' + data.name.trim());
          if (res) closeModal(true);
        };
      }
    );
  }

  // ---- Štart ---------------------------------------------------------------------------------

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
      if (err.offline && S.data) toast('Bez internetu – ukazujem posledné uložené kontakty');
      else if (!FG.isLoginRequired(err)) showError(err);
    }
  }

  FG.start({ onReady: () => start() });

  // Dlhé podržanie kontaktu skopíruje jeho číslo (alebo e-mail) do schránky.
  document.addEventListener('contextmenu', (ev) => {
    const el = ev.target.closest && ev.target.closest('.kt-body');
    if (!el || !S.data) return;
    const c = contact(el.dataset.edit);
    if (!c || !(c.phone || c.email)) return;
    ev.preventDefault();
    copyText(c.phone || c.email);
  });
})();
