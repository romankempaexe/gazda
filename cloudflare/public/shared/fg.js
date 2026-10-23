// Family Grid – spoločná časť pre rozcestník a podaplikácie Zdravko, Skládko a QuickStash
// (Gazda má svoju vlastnú, staršiu verziu tých istých funkcií v gazda/app.js):
// volania servera, prihlásenie Google účtom, okná, upozornenia, inštalácia, vzhľad,
// výber rodiny a zapamätanie poslednej podaplikácie.
//
// Stránka potrebuje prvky: #view, #modal > #modalContent, #toast, #busy a v hlavičke
// #title, #bellBtn, #avatar (voliteľne #gridBtn, #backBtn, #brand).

(function () {
  const APPS = {
    gazda: { name: 'Gazda', desc: 'Domáce práce, nákupy a letáky', url: '/gazda/' },
    zdravko: { name: 'Zdravko', desc: 'Zdravie rodiny: teplota, lieky, lekári', url: '/zdravko/' },
    skladko: { name: 'Skládko', desc: 'Čo máme doma a kde to je', url: '/skladko/' },
    quickstash: { name: 'QuickStash', desc: 'Texty, odkazy a heslá na skopírovanie', url: '/quickstash/' },
  };
  const THEME_COLORS = { family: '#4f46e5', gazda: '#16a34a', zdravko: '#1d72b8', skladko: '#ea580c', quickstash: '#0d9488' };
  const LAST_APP_KEY = 'fg.lastApp';
  const THEME_KEY = 'gazda.theme'; // spoločné s Gazdou
  const LOGGED_OUT_KEY = 'gazda.loggedOut';
  const INSTALL_DISMISSED_KEY = 'fg.installDismissed';

  const $ = (id) => document.getElementById(id);
  const appId = document.documentElement.dataset.app || 'family';

  const state = { email: '', nickname: '', households: [], family: null };

  // ---- Pomocné ----------------------------------------------------------------

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readStore(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function writeStore(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      // bez úložiska platí len do zatvorenia
    }
  }

  function readJson(key) {
    try {
      return JSON.parse(readStore(key) || 'null');
    } catch (e) {
      return null;
    }
  }

  // ---- Server --------------------------------------------------------------------

  let pending = 0;
  let onLoginRequired = () => showLogin(true);

  function api(fn, ...args) {
    return request(fn, args, false);
  }

  function apiQuiet(fn, ...args) {
    return request(fn, args, true);
  }

  async function request(fn, args, quiet) {
    pending++;
    if (!quiet) $('busy').classList.remove('hidden');
    try {
      let res;
      try {
        res = await fetch('/api/' + fn, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ args }),
        });
      } catch (e) {
        throw Object.assign(new Error('Nepodarilo sa spojiť so serverom. Skontroluj pripojenie na internet.'), { offline: true });
      }
      let body = null;
      try {
        body = await res.json();
      } catch (e) {
        // odpoveď nie je JSON (výpadok servera)
      }
      if (!res.ok || !body || body.error) {
        throw Object.assign(new Error((body && body.error) || 'Server je nedostupný (' + res.status + '). Skús to o chvíľu.'), {
          code: body && body.code,
          status: res.status,
        });
      }
      return body.result;
    } catch (err) {
      if (isLoginRequired(err)) onLoginRequired();
      throw err;
    } finally {
      pending--;
      if (!pending) $('busy').classList.add('hidden');
    }
  }

  function isLoginRequired(err) {
    return Boolean(err && err.code === 'LOGIN_REQUIRED');
  }

  function errorMessage(err) {
    return (err && err.message ? err.message : String(err)).replace(/^Error:\s*/, '');
  }

  let toastTimer;
  function toast(message, isError = false) {
    const el = $('toast');
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 6000 : 3000);
  }

  function showError(err) {
    if (!isLoginRequired(err)) toast(errorMessage(err), true);
  }

  // ---- Okná -------------------------------------------------------------------------

  let modalOnClose = null;
  let modalPersistent = false;
  let modalOpenedAt = 0;

  function openModal(html, onMount, opts) {
    opts = opts || {};
    modalOnClose = opts.onClose || null;
    modalPersistent = Boolean(opts.persistent);
    $('modalContent').innerHTML = html;
    $('modal').classList.remove('hidden');
    modalOpenedAt = Date.now();
    if (onMount) onMount($('modalContent'));
    if (opts.focus !== false) {
      const first = $('modalContent').querySelector(typeof opts.focus === 'string' ? opts.focus : 'input, textarea, select');
      if (first) first.focus();
    }
  }

  function closeModal(force) {
    if (modalPersistent && force !== true) return;
    modalPersistent = false;
    const onClose = modalOnClose;
    modalOnClose = null;
    if (onClose) setTimeout(onClose, 0);
    $('modal').classList.add('hidden');
    $('modalContent').innerHTML = '';
  }

  function modalOpen() {
    return !$('modal').classList.contains('hidden');
  }

  /** Potvrdenie (napr. pred vymazaním); vráti Promise<boolean>. */
  function confirmDialog(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      let answered = false;
      openModal(
        '<h2>' + esc(title) + '</h2>' + (text ? '<div class="subtitle">' + text + '</div>' : '') +
          '<div class="actions"><button type="button" class="btn text" id="no">Zrušiť</button>' +
          '<button type="button" class="btn' + (danger ? ' danger' : '') + '" id="yes">' + esc(okLabel || 'OK') + '</button></div>',
        (root) => {
          root.querySelector('#no').onclick = () => closeModal();
          root.querySelector('#yes').onclick = () => {
            answered = true;
            closeModal(true);
            resolve(true);
          };
        },
        { focus: false, onClose: () => answered || resolve(false) }
      );
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('modal').addEventListener('click', (e) => {
      if (e.target === $('modal') && Date.now() - modalOpenedAt > 500) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalOpen()) closeModal();
    });
  });

  // ---- Vzhľad -------------------------------------------------------------------------

  function currentTheme() {
    const t = readStore(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  }

  function applyTheme(theme) {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#151a17' : THEME_COLORS[appId]);
  }

  function setTheme(theme) {
    writeStore(THEME_KEY, theme === 'auto' ? null : theme);
    applyTheme(theme);
  }

  // ---- Prihlásenie Google účtom ------------------------------------------------------------

  const loginListeners = [];
  // Po zmene rodiny (prepnutie, nový člen…) sa stránka znova načíta zo servera.
  let familyChanged = () => loginListeners.forEach((fn) => fn());

  function showLogin(expired) {
    closeModal(true);
    state.email = '';
    ['backBtn', 'bellBtn', 'avatar', 'tabs'].forEach((id) => $(id) && $(id).classList.add('hidden'));
    document.body.classList.remove('with-tabs');
    // Prihlásenie je spoločné pre celý Family Grid (Gazda, Zdravko, Skládko, QuickStash).
    $('view').innerHTML =
      '<div class="empty login"><img class="login-logo" src="/icons/family/icon.svg" alt="">' +
      '<h2>Prihlás sa do Family Grid</h2>' +
      '<div>' + (expired ? 'Prihlásenie vypršalo. ' : '') +
      'Použi svoj Google účet – ten e-mail, s ktorým ti niekto zdieľal Family Grid. Jedno prihlásenie platí pre všetky aplikácie Family Grid.</div>' +
      '<div id="googleBtn" class="google-btn"></div>' +
      '<div class="hint" id="loginHint"></div></div>';
    renderGoogleButton();
  }

  let gisScript = null;
  function loadGoogleScript() {
    if (!gisScript) {
      gisScript = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'https://accounts.google.com/gsi/client';
        el.async = true;
        el.onload = resolve;
        el.onerror = () => {
          gisScript = null;
          reject(new Error('Prihlásenie Google sa nepodarilo načítať. Skontroluj internet.'));
        };
        document.head.append(el);
      });
    }
    return gisScript;
  }

  async function renderGoogleButton() {
    const hint = $('loginHint');
    try {
      const config = await fetch('/api/auth/config').then((r) => r.json());
      const clientId = config && config.result && config.result.googleClientId;
      if (!clientId) {
        hint.textContent = 'Prihlásenie Google účtom ešte nie je nastavené (chýba Client ID).';
        return;
      }
      await loadGoogleScript();
      google.accounts.id.initialize({
        client_id: clientId,
        callback: onGoogleCredential,
        auto_select: true,
        use_fedcm_for_prompt: true,
        itp_support: true,
      });
      if (readStore(LOGGED_OUT_KEY) === '1') {
        google.accounts.id.disableAutoSelect();
        writeStore(LOGGED_OUT_KEY, null);
      }
      const box = $('googleBtn');
      if (!box) return;
      google.accounts.id.renderButton(box, {
        theme: 'filled_blue',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        locale: 'sk',
        width: Math.min(320, box.clientWidth || 320),
      });
      google.accounts.id.prompt();
    } catch (err) {
      if (hint) hint.textContent = errorMessage(err);
    }
  }

  async function onGoogleCredential(response) {
    $('busy').classList.remove('hidden');
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || body.error) throw new Error((body && body.error) || 'Prihlásenie sa nepodarilo.');
      // Iný človek na tomto zariadení – údaje predchádzajúceho zabudni.
      const last = readJson('fg.me');
      if (last && last.email !== body.result.email) forgetDevice();
      loginListeners.forEach((fn) => fn());
    } catch (err) {
      showError(err);
    } finally {
      if (!pending) $('busy').classList.add('hidden');
    }
  }

  /** Zabudne uložené údaje všetkých aplikácií v tomto zariadení (odhlásenie / iný účet). */
  function forgetDevice() {
    try {
      Object.keys(localStorage)
        .filter((k) => /^(fg\.me|fg\.calendar|fg\.household|gazda\.snap|gazda\.token|zdravko\.|skladko\.|quickstash\.)/.test(k))
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  }

  async function logout() {
    try {
      await disablePush();
    } catch (e) {
      // aj tak pokračuj v odhlásení
    }
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    } catch (e) {
      // aj bez internetu zabudni údaje v telefóne
    }
    forgetDevice();
    writeStore(LOGGED_OUT_KEY, '1');
    showLogin(false);
  }

  // ---- Identita a rodiny --------------------------------------------------------------------

  function showIdentity(email, nickname) {
    state.email = email;
    state.nickname = nickname || '';
    const name = state.nickname || email;
    $('avatar').textContent = name.charAt(0).toUpperCase();
    $('avatar').title = name;
    $('avatar').classList.remove('hidden');
    $('bellBtn').classList.remove('hidden');
  }

  /** Načíta používateľa a rodiny (getFamily); pri neprihlásenom ukáže prihlásenie. */
  async function loadFamily(quiet) {
    const res = await (quiet ? apiQuiet : api)('getFamily');
    state.family = res;
    state.households = res.households;
    showIdentity(res.email, res.nickname);
    writeStore('fg.me', JSON.stringify({ email: res.email, nickname: res.nickname, households: res.households }));
    if (!res.nickname && !document.querySelector('#modal input[name=nickname]')) {
      setTimeout(() => showNicknameForm(res.suggestedNickname, true), 0);
    }
    return res;
  }

  function cachedFamily() {
    return readJson('fg.me');
  }

  function memberName(m) {
    return (m && (m.nickname || m.email.split('@')[0])) || '';
  }

  /** Rodina, v ktorej podaplikácia pracuje (naposledy zvolená, inak prvá). */
  // Zvolená rodina je spoločná pre celý Family Grid: v zariadení fg.household,
  // na serveri users.last_household_id (podľa nej sa otvorí aj Gazda).
  function currentHousehold() {
    // server má prednosť (rodinu mohol prepnúť aj v Gazde alebo na inom zariadení)
    const id = (state.family && state.family.lastHouseholdId) || readStore('fg.household');
    return state.households.find((h) => h.id === id) || state.households[0] || null;
  }

  function setHousehold(id) {
    const changed = readStore('fg.household') !== id;
    writeStore('fg.household', id);
    if (changed || (state.family && state.family.lastHouseholdId !== id)) {
      if (state.family) state.family.lastHouseholdId = id;
      apiQuiet('setCurrentFamily', id).catch(() => {});
    }
  }

  /** Tlačidlo s menom rodiny (len keď ich je viac) – po výbere zavolá onChange(id). */
  function householdPickerHtml() {
    if (state.households.length < 2) return '';
    const h = currentHousehold();
    return '<button type="button" class="family-pick" id="familyPick"><span class="ms">group</span>' + esc(h ? h.name : '') +
      '<span class="ms">expand_more</span></button>';
  }

  function bindHouseholdPicker(onChange) {
    const btn = $('familyPick');
    if (btn) btn.onclick = () => showFamily(() => onChange(currentHousehold() && currentHousehold().id));
  }

  /** Používateľ zatiaľ nemá žiadnu rodinu – ponuka vytvoriť ju (zdieľa sa ako domácnosť v Gazde). */
  function emptyFamilyHtml(what) {
    return (
      '<div class="empty"><span class="ms" style="font-size:48px">group_add</span><h2>Najprv rodina</h2>' +
      '<div>' + esc(what) + ' patria rodine – zdieľajú sa so všetkými jej členmi (rovnako ako domácnosť v Gazde).</div>' +
      '<button type="button" class="btn" id="newFamily" style="margin-top:16px"><span class="ms">add</span>Vytvoriť rodinu</button></div>'
    );
  }

  function bindEmptyFamily(onCreated) {
    const btn = $('newFamily');
    if (btn) btn.onclick = () => newFamilyForm(onCreated);
  }

  // ---- Rodina a zdieľanie Family Grid ---------------------------------------------------------

  /**
   * Rodina = komu je Family Grid zdieľaný. Všetci jej členovia vidia a menia údaje Gazdy,
   * Zdravka aj Skládka tejto rodiny. onChange() sa zavolá po zmene (iná rodina, nový člen…).
   */
  function showFamily(onChange) {
    const done = () => {
      if (onChange) onChange();
    };
    const h = currentHousehold();
    if (!h) {
      return newFamilyForm(done);
    }
    const me = h.members.find((m) => m.email === state.email) || {};
    const owner = me.role === 'owner';
    const others = state.households.filter((x) => x.id !== h.id);
    openModal(
      '<h2>' + esc(h.name) + '</h2><div class="subtitle">Family Grid je zdieľaný s týmito ľuďmi – všetci vidia Gazdu, Zdravka, Skládko aj spoločné položky QuickStashu tejto rodiny.</div>' +
        '<div class="members fg-members">' +
        h.members
          .map((m) =>
            '<div><span class="ms">' + (m.role === 'owner' ? 'star' : 'person') + '</span><span class="fg-m-name">' + esc(m.nickname || m.email) +
            (m.nickname ? '<small>' + esc(m.email) + '</small>' : '') + (m.joined ? '' : '<small>ešte sa neprihlásil(a)</small>') + '</span>' +
            ((owner && m.email !== state.email && m.role !== 'owner') ? '<button type="button" class="icon-btn small" data-remove="' + esc(m.email) + '" title="Odobrať"><span class="ms">close</span></button>' : '') +
            '</div>')
          .join('') +
        '</div>' +
        '<form id="share" class="row" style="align-items:flex-end"><div class="field" style="flex:1;margin:0"><label>Zdieľať s (Google e-mail)</label>' +
        '<input type="email" name="email" required placeholder="napr. mama@gmail.com" autocomplete="email"></div>' +
        '<button class="btn" style="flex:0 0 auto"><span class="ms">person_add</span>Pridať</button></form>' +
        '<div class="pick-list" style="margin-top:16px">' +
        others.map((x) => '<button type="button" class="btn tonal" data-switch="' + esc(x.id) + '"><span class="ms">swap_horiz</span>Prepnúť na ' + esc(x.name) + '</button>').join('') +
        '<button type="button" class="btn tonal" id="invite"><span class="ms">share</span>Poslať pozvánku</button></div>' +
        '<div class="actions"><button type="button" class="btn text" id="more" style="margin-right:auto"><span class="ms">more_horiz</span>Ďalšie</button>' +
        '<button type="button" class="btn" id="close">Hotovo</button></div>',
      (root) => {
        root.querySelector('#close').onclick = closeModal;
        root.querySelector('#share').onsubmit = async (e) => {
          e.preventDefault();
          const email = e.target.email.value.trim().toLowerCase();
          try {
            const res = await api('shareHousehold', h.id, email);
            state.households = res.households;
            done();
            invite([email]);
          } catch (err) {
            showError(err);
          }
        };
        root.querySelector('#invite').onclick = () => invite(h.members.filter((m) => !m.joined).map((m) => m.email));
        root.querySelectorAll('[data-switch]').forEach((b) => {
          b.onclick = () => {
            setHousehold(b.dataset.switch);
            closeModal();
            toast('Rodina: ' + state.households.find((x) => x.id === b.dataset.switch).name);
            done();
          };
        });
        root.querySelectorAll('[data-remove]').forEach((b) => {
          b.onclick = async () => {
            const email = b.dataset.remove;
            if (!(await confirmDialog('Odobrať ' + email + '?', 'Prestane vidieť Gazdu, Zdravka, Skládko aj QuickStash tejto rodiny (jeho súkromné položky v QuickStashi sa zmažú).', 'Odobrať', true))) return showFamily(onChange);
            try {
              const res = await api('removeFamilyMember', h.id, email);
              state.households = res.households;
              done();
              showFamily(onChange);
            } catch (err) {
              showError(err);
            }
          };
        });
        root.querySelector('#more').onclick = () => familyMore(h, owner, onChange);
      },
      { focus: false }
    );
  }

  function familyMore(h, owner, onChange) {
    const done = () => onChange && onChange();
    openModal(
      '<h2>' + esc(h.name) + '</h2><div class="pick-list">' +
        '<button type="button" class="btn tonal" id="rename"><span class="ms">edit</span>Premenovať rodinu</button>' +
        '<button type="button" class="btn tonal" id="new"><span class="ms">group_add</span>Nová rodina</button>' +
        (owner
          ? '<button type="button" class="btn tonal danger-text" id="delete"><span class="ms">delete</span>Vymazať rodinu</button>'
          : '<button type="button" class="btn tonal danger-text" id="leave"><span class="ms">logout</span>Odísť z rodiny</button>') +
        '</div><div class="actions"><button type="button" class="btn text" id="back">Späť</button></div>',
      (root) => {
        root.querySelector('#back').onclick = () => showFamily(onChange);
        root.querySelector('#new').onclick = () => newFamilyForm(done);
        root.querySelector('#rename').onclick = () =>
          openModal(
            '<h2>Premenovať rodinu</h2><form id="f"><div class="field"><label>Názov</label><input name="name" required maxlength="60" value="' + esc(h.name) + '"></div>' +
              '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Uložiť</button></div></form>',
            (r) => {
              r.querySelector('#cancel').onclick = () => showFamily(onChange);
              r.querySelector('#f').onsubmit = async (e) => {
                e.preventDefault();
                try {
                  state.households = (await api('renameFamily', h.id, e.target.name.value)).households;
                  done();
                  showFamily(onChange);
                } catch (err) {
                  showError(err);
                }
              };
            }
          );
        const leave = root.querySelector('#leave');
        if (leave) {
          leave.onclick = async () => {
            if (!(await confirmDialog('Odísť z rodiny ' + h.name + '?', 'Prestaneš vidieť jej Gazdu, Zdravka, Skládko aj QuickStash (tvoje súkromné položky QuickStashu v nej sa zmažú). Vrátiť ťa môže len niekto z rodiny.', 'Odísť', true))) return;
            try {
              state.households = (await api('removeFamilyMember', h.id, state.email)).households;
              writeStore('fg.household', null);
              done();
            } catch (err) {
              showError(err);
            }
          };
        }
        const del = root.querySelector('#delete');
        if (del) {
          del.onclick = async () => {
            if (!(await confirmDialog('Vymazať rodinu ' + h.name + '?', 'Vymažú sa <b>všetky</b> jej údaje – úlohy a nákupy v Gazde, zdravotné záznamy v Zdravkovi aj sklady v Skládku – pre všetkých členov. Nedá sa to vrátiť.', 'Vymazať všetko', true))) return;
            try {
              state.households = (await api('deleteHousehold', h.id)).households;
              writeStore('fg.household', null);
              done();
              toast('Rodina vymazaná');
            } catch (err) {
              showError(err);
            }
          };
        }
      },
      { focus: false }
    );
  }

  function newFamilyForm(done) {
    openModal(
      '<h2>Nová rodina</h2><div class="subtitle">Vlastný Family Grid s vlastnými údajmi – napr. pre chatu alebo starých rodičov.</div>' +
        '<form id="f"><div class="field"><label>Názov</label><input name="name" required maxlength="60" placeholder="napr. Novákovci"></div>' +
        '<div class="field"><label>Zdieľať s (e-maily, nepovinné)</label><input name="emails" placeholder="mama@gmail.com, ocko@gmail.com"></div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Vytvoriť</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#f').onsubmit = async (e) => {
          e.preventDefault();
          try {
            const emails = e.target.emails.value;
            const res = await api('createHousehold', e.target.name.value, emails);
            state.households = res.households;
            setHousehold(res.households[res.households.length - 1].id);
            closeModal();
            done();
            const list = emails.split(/[\s,;]+/).filter((x) => x.includes('@'));
            if (list.length) invite(list);
          } catch (err) {
            showError(err);
          }
        };
      }
    );
  }

  /** Pozvánka: adresa Family Grid na poslanie (prihlási sa Google účtom s tým e-mailom). */
  function invite(emails) {
    const url = location.origin + '/';
    const text = 'Pridal(a) som ťa do Family Grid (Gazda, Zdravko, Skládko, QuickStash). Otvor ' + url + ' a prihlás sa Google účtom' +
      (emails.length === 1 ? ' ' + emails[0] : '') + '.';
    openModal(
      '<h2>Daj im vedieť</h2><div class="subtitle">' + (emails.length ? esc(emails.join(', ')) + ' sa prihlási' + (emails.length > 1 ? 'a' : '') + ' Google účtom s tým e-mailom. ' : '') +
        'Pošli adresu Family Grid:</div>' +
        '<div class="field"><div class="row" style="align-items:center"><input readonly id="appUrl" value="' + esc(url) + '" style="flex:3">' +
        '<button type="button" class="btn tonal small" id="copy" style="flex:0 0 auto"><span class="ms">content_copy</span></button></div></div>' +
        '<div class="actions"><button type="button" class="btn text" id="done">Hotovo</button><button type="button" class="btn" id="send"><span class="ms">share</span>Poslať</button></div>',
      (root) => {
        root.querySelector('#done').onclick = closeModal;
        root.querySelector('#copy').onclick = async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast('Skopírované');
          } catch (e) {
            root.querySelector('#appUrl').select();
          }
        };
        root.querySelector('#send').onclick = async () => {
          if (navigator.share) {
            try {
              await navigator.share({ title: 'Family Grid', text });
              return;
            } catch (e) {
              if (e && e.name === 'AbortError') return;
            }
          }
          window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
        };
      },
      { focus: false }
    );
  }

  // ---- Kalendár na plochu (Google Kalendár / iPhone) -----------------------------------------

  const CAL_KEY = 'fg.calendarUrl'; // adresa je tajná – ukáže sa len pri vytvorení, preto si ju zariadenie pamätá

  /** Súkromná adresa kalendára s udalosťami Zdravka a úlohami Gazdy (widget Google Kalendára). */
  async function showCalendarFeed() {
    let status;
    try {
      status = await api('getCalendarFeed');
    } catch (err) {
      return showError(err);
    }
    let base = status.active ? readStore(CAL_KEY) : null;
    let gazda = readStore('fg.calendarGazda') || 'mine';
    const render = () => {
      const url = base ? base + (gazda === 'mine' ? '' : '?gazda=' + gazda) : '';
      const webcal = url.replace(/^https:/, 'webcal:');
      // Pridanie kalendára z adresy ide v Google Kalendári len na webe (v počítačovej verzii stránky).
      const addByUrl = 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl';
      openModal(
        '<h2>Kalendár na plochu</h2>' +
          '<div class="subtitle">Udalosti Zdravka (lekár, vyšetrenia, očkovania) a úlohy Gazdy v Google Kalendári alebo v kalendári iPhonu – ' +
          'na plochu potom dáš widget kalendára s najbližšími udalosťami.</div>' +
          '<div class="field"><label>Úlohy z Gazdy</label><div class="chips">' +
          [['mine', 'Moje a spoločné'], ['all', 'Všetky'], ['none', 'Žiadne']]
            .map(([v, l]) => '<button type="button" class="chip' + (gazda === v ? ' active' : '') + '" data-g="' + v + '">' + l + '</button>')
            .join('') +
          '</div></div>' +
          (url
            ? '<div class="section-title fg-cal-h">Android – Google Kalendár</div>' +
              '<ol class="steps">' +
              '<li><button type="button" class="btn small" id="copy"><span class="ms">content_copy</span>Kopírovať adresu</button></li>' +
              '<li><a class="btn tonal small" href="' + esc(addByUrl) + '" target="_blank" rel="noopener"><span class="ms">open_in_new</span>Otvoriť Google Kalendár na webe</a><br>' +
              'Ak sa namiesto stránky otvorí aplikácia, v Chrome ťukni <b>⋮ → Počítačová verzia</b> a otvor odkaz znova.</li>' +
              '<li>Do poľa <b>Webová adresa kalendára</b> vlož adresu a ťukni <b>Pridať kalendár</b>.</li>' +
              '<li>V aplikácii Kalendár Google: ☰ → Nastavenia → <b>Family Grid</b> → zapni <b>Synchronizácia</b> (kalendár sa objaví do pár minút).</li>' +
              '<li>Podrž prst na ploche → <b>Miniaplikácie</b> → Kalendár Google → <b>Plán</b>.</li></ol>' +
              '<div class="section-title fg-cal-h">iPhone / iPad</div>' +
              '<ol class="steps"><li><a class="btn tonal small" href="' + esc(webcal) + '"><span class="ms">event</span>Pridať do iPhonu</a> → <b>Odoberať</b>.</li>' +
              '<li>Widget <b>Kalendár</b> pridáš podržaním plochy → <b>+</b>.</li></ol>' +
              '<div class="hint">Google Kalendár si kalendár obnovuje sám približne každých pár hodín – nové udalosti sa vo widgete ukážu s oneskorením ' +
              '(upozornenia z Family Grid chodia hneď). Adresu nikomu neposielaj; každý člen rodiny si vytvorí vlastnú.</div>'
            : status.active
              ? '<div class="hint">Adresu kalendára už máš (vytvorená ' + esc(new Date(status.createdAt).toLocaleDateString('sk-SK')) + ') – kvôli bezpečnosti ju server neukazuje znova. ' +
                'Ak ju potrebuješ, vytvor novú (stará prestane fungovať a v kalendári ju treba pridať znova).</div>'
              : '') +
          (status.active
            ? '<div class="members"><div><span class="ms">' + (status.lastAccess ? 'check_circle' : 'schedule') + '</span><span>' +
              (status.lastAccess
                ? 'Kalendár si naposledy stiahol Google / iPhone: <b>' + esc(new Date(status.lastAccess).toLocaleString('sk-SK')) + '</b>'
                : 'Google ani iPhone si kalendár <b>zatiaľ nestiahol</b> – pridanie ešte neprebehlo (alebo ho Google stiahne o chvíľu).') +
              '</span></div></div>'
            : '') +
          '<div class="actions">' +
          (status.active ? '<button type="button" class="btn text danger-text" id="off" style="margin-right:auto">Zrušiť adresu</button>' : '') +
          '<button type="button" class="btn text" id="cancel">Zavrieť</button>' +
          (url ? '' : '<button type="button" class="btn" id="create"><span class="ms">add</span>' + (status.active ? 'Vytvoriť novú adresu' : 'Vytvoriť kalendár') + '</button>') +
          '</div>',
        (root) => {
          root.querySelector('#cancel').onclick = closeModal;
          root.querySelectorAll('[data-g]').forEach((b) => {
            b.onclick = () => {
              gazda = b.dataset.g;
              writeStore('fg.calendarGazda', gazda);
              render();
            };
          });
          const copy = root.querySelector('#copy');
          if (copy) {
            copy.onclick = async () => {
              try {
                await navigator.clipboard.writeText(url);
                toast('Adresa skopírovaná');
              } catch (e) {
                toast(url);
              }
            };
          }
          const create = root.querySelector('#create');
          if (create) {
            create.onclick = async () => {
              try {
                base = (await api('createCalendarFeed')).url;
                writeStore(CAL_KEY, base);
                status = { active: true, createdAt: new Date().toISOString() };
                render();
              } catch (err) {
                showError(err);
              }
            };
          }
          const off = root.querySelector('#off');
          if (off) {
            off.onclick = async () => {
              if (!(await confirmDialog('Zrušiť adresu kalendára?', 'Kalendár Family Grid v Google Kalendári prestane dostávať novinky.', 'Zrušiť adresu', true))) return;
              try {
                status = await api('deleteCalendarFeed');
                base = null;
                writeStore(CAL_KEY, null);
                toast('Adresa zrušená – kalendár môžeš z Google Kalendára odstrániť');
              } catch (err) {
                showError(err);
              }
            };
          }
        },
        { focus: false }
      );
    };
    render();
  }

  function showNicknameForm(value, first) {
    openModal(
      '<h2>' + (first ? 'Ako ťa majú volať?' : 'Zmeniť prezývku') + '</h2>' +
        '<div class="subtitle">Ostatní v rodine uvidia namiesto e-mailu túto prezývku.</div>' +
        '<form id="f"><div class="field"><label>Prezývka</label>' +
        '<input name="nickname" maxlength="30" required autocomplete="nickname" placeholder="napr. Roman, Mama, Ocino" value="' + esc(value || '') + '"></div>' +
        '<div class="actions">' + (first ? '' : '<button type="button" class="btn text" id="cancel">Zrušiť</button>') +
        '<button class="btn">' + (first ? 'Pokračovať' : 'Uložiť') + '</button></div></form>',
      (root) => {
        if (!first) root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#f').onsubmit = async (e) => {
          e.preventDefault();
          const button = e.target.querySelector('button:not([type])');
          button.disabled = true;
          try {
            const res = await api('setNickname', e.target.nickname.value);
            showIdentity(state.email, res.nickname);
            closeModal(true);
            toast(first ? 'Vitaj, ' + res.nickname + '!' : 'Prezývka uložená');
          } catch (err) {
            button.disabled = false;
            showError(err);
          }
        };
      },
      { persistent: first }
    );
  }

  /** Môj účet: prezývka, vzhľad, inštalácia, upozornenia, odhlásenie (+ voliteľné tlačidlá podaplikácie). */
  function showAccount(extraHtml, bindExtra) {
    openModal(
      '<h2>' + esc(state.nickname || state.email) + '</h2><div class="subtitle">' + esc(state.email) + '</div>' +
        '<div class="members"><div><span class="ms">lock</span>Prihlásený Google účtom – jedno prihlásenie pre všetky aplikácie Family Grid.</div></div>' +
        (canInstall()
          ? '<button type="button" class="btn small" id="install" style="margin:4px 8px 12px 0"><span class="ms">add</span>Nainštalovať Family Grid</button>'
          : '') +
        '<div class="field"><label>Vzhľad</label><div class="chips seg theme-seg">' +
        [['auto', 'brightness_auto', 'Podľa telefónu'], ['light', 'light_mode', 'Svetlý'], ['dark', 'dark_mode', 'Tmavý']]
          .map(([v, icon, label]) =>
            '<button type="button" class="chip' + (currentTheme() === v ? ' active' : '') + '" data-theme-pick="' + v + '"><span class="ms">' + icon + '</span>' + label + '</button>')
          .join('') +
        '</div></div>' +
        '<button type="button" class="btn tonal small" id="family" style="margin:4px 8px 12px 0"><span class="ms">group</span>Rodina a zdieľanie</button>' +
        '<button type="button" class="btn tonal small" id="calendar" style="margin:4px 8px 12px 0"><span class="ms">event</span>Kalendár na plochu</button>' +
        (extraHtml || '') +
        '<div class="actions"><button type="button" class="btn text" id="nick" style="margin-right:auto"><span class="ms">edit</span>Prezývka</button>' +
        '<button type="button" class="btn text" id="cancel">Zavrieť</button>' +
        '<button type="button" class="btn danger" id="logout">Odhlásiť sa</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#logout').onclick = logout;
        root.querySelector('#nick').onclick = () => showNicknameForm(state.nickname, false);
        root.querySelectorAll('[data-theme-pick]').forEach((b) => {
          b.onclick = () => {
            setTheme(b.dataset.themePick);
            root.querySelectorAll('[data-theme-pick]').forEach((x) => x.classList.toggle('active', x === b));
          };
        });
        const install = root.querySelector('#install');
        if (install) install.onclick = installApp;
        root.querySelector('#family').onclick = () => showFamily(familyChanged);
        root.querySelector('#calendar').onclick = showCalendarFeed;
        if (bindExtra) bindExtra(root);
      },
      { focus: false }
    );
  }

  // ---- Upozornenia (push) -------------------------------------------------------------------

  function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function base64UrlToBytes(text) {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  }

  async function currentSubscription() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function updateBell() {
    let on = false;
    try {
      on = Boolean(await currentSubscription()) && Notification.permission === 'granted';
    } catch (e) {}
    $('bellBtn').querySelector('.ms').textContent = on ? 'notifications_active' : 'notifications_off';
    $('bellBtn').title = on ? 'Upozornenia sú zapnuté' : 'Zapnúť upozornenia';
  }

  async function syncPush() {
    try {
      const sub = Notification.permission === 'granted' ? await currentSubscription() : null;
      if (sub) await apiQuiet('subscribePush', sub.toJSON());
    } catch (e) {
      // nepovinné
    }
    updateBell();
  }

  async function enablePush() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Upozornenia nie sú povolené. Povoľ ich pre Family Grid v nastaveniach prehliadača alebo telefónu.');
    }
    const { publicKey } = await api('getPushKey');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
    await api('subscribePush', sub.toJSON());
  }

  async function disablePush() {
    const sub = await currentSubscription();
    if (!sub) return;
    try {
      await api('unsubscribePush', sub.endpoint);
    } finally {
      await sub.unsubscribe();
    }
  }

  async function showNotificationSettings() {
    const what =
      '<div class="members">' +
      '<div><img src="/icons/gazda/icon.svg" alt="" class="notif-app">Gazda: ranný prehľad úloh, pridelené úlohy, akcie</div>' +
      '<div><img src="/icons/zdravko/icon.svg" alt="" class="notif-app">Zdravko: lieky, návštevy lekára, očkovania</div>' +
      '<div><img src="/icons/skladko/icon.svg" alt="" class="notif-app">Skládko: čo dochádza a čomu končí trvanlivosť</div></div>';
    let status;
    let buttons = '<button type="button" class="btn text" id="cancel">Zavrieť</button>';
    if (!pushSupported()) {
      status =
        isIos() && !isStandalone()
          ? 'Na iPhone fungujú upozornenia len vo Family Grid pridanom na plochu: v Safari ťukni <b>Zdieľať</b> → <b>Pridať na plochu</b>, otvor ho z plochy a zapni ich tam.'
          : 'Tento prehliadač upozornenia nepodporuje. Skús Chrome (Android) alebo Family Grid pridaný na plochu (iPhone).';
    } else if (Notification.permission === 'denied') {
      status = 'Upozornenia sú <b>zablokované</b> v nastaveniach prehliadača alebo telefónu. Povoľ ich tam a vráť sa sem.';
    } else if ((await currentSubscription().catch(() => null)) && Notification.permission === 'granted') {
      status = '✅ Upozornenia sú na tomto zariadení <b>zapnuté</b> – pre všetky aplikácie, každá s vlastnou ikonou.';
      buttons =
        '<button type="button" class="btn text danger-text" id="off" style="margin-right:auto">Vypnúť</button>' + buttons +
        '<button type="button" class="btn tonal" id="test"><span class="ms">send</span>Skúšobné</button>';
    } else {
      status = 'Upozornenia sú na tomto zariadení vypnuté. Jedno zapnutie platí pre všetky aplikácie Family Grid.';
      buttons += '<button type="button" class="btn" id="on"><span class="ms">notifications_active</span>Zapnúť</button>';
    }
    openModal(
      '<h2>Upozornenia</h2><div class="subtitle">' + status + '</div>' + what + '<div class="actions">' + buttons + '</div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        const act = (id, fn, ok) => {
          const b = root.querySelector(id);
          if (!b) return;
          b.onclick = async () => {
            b.disabled = true;
            try {
              const res = await fn();
              if (ok) toast(typeof ok === 'function' ? ok(res) : ok);
              if (id !== '#test') showNotificationSettings();
            } catch (err) {
              showError(err);
            } finally {
              b.disabled = false;
            }
            updateBell();
          };
        };
        act('#on', enablePush, 'Upozornenia zapnuté');
        act('#off', disablePush, 'Upozornenia vypnuté');
        act('#test', () => api('testPush'), (res) =>
          res.sent ? 'Odoslané – o chvíľu príde notifikácia' : 'Nepodarilo sa doručiť – skús upozornenia vypnúť a zapnúť');
      },
      { focus: false }
    );
  }

  // ---- Inštalácia ----------------------------------------------------------------------------

  let installPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    refreshInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    refreshInstallBanner();
    toast('Family Grid je nainštalovaný – nájdeš ho medzi aplikáciami');
  });

  function isIosSafari() {
    return isIos() && /safari/i.test(navigator.userAgent) && !/crios|fxios|edgios|gsa/i.test(navigator.userAgent);
  }

  function canInstall() {
    return !isStandalone() && Boolean(installPrompt || isIosSafari());
  }

  async function installApp() {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (!choice || choice.outcome !== 'accepted') installPrompt = prompt;
      refreshInstallBanner();
      return;
    }
    openModal(
      '<h2>Nainštaluj si Family Grid</h2><div class="subtitle">Na iPhone sa inštaluje cez Safari:</div>' +
        '<ol class="steps"><li>Ťukni dole na <b>Zdieľať</b> (štvorček so šípkou).</li>' +
        '<li>Zvoľ <b>Pridať na plochu</b> a potvrď <b>Pridať</b>.</li>' +
        '<li>Otvor Family Grid z plochy, prihlás sa a zapni upozornenia 🔔.</li></ol>' +
        '<div class="actions"><button type="button" class="btn" id="cancel">Rozumiem</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
      },
      { focus: false }
    );
  }

  function refreshInstallBanner() {
    const current = $('installBanner');
    const show = state.email && canInstall() && readStore(INSTALL_DISMISSED_KEY) !== '1';
    if (!show) {
      if (current) current.remove();
      return;
    }
    if (current) return;
    $('view').insertAdjacentHTML(
      'afterbegin',
      '<div class="install-banner" id="installBanner"><img src="/icons/family/icon.svg" alt="">' +
        '<div class="text"><b>Nainštaluj si Family Grid</b>Gazda, Zdravko, Skládko a QuickStash v jednej aplikácii</div>' +
        '<button type="button" class="btn small" data-install>Inštalovať</button>' +
        '<button type="button" class="icon-btn small" data-install-close title="Teraz nie"><span class="ms">close</span></button></div>'
    );
    const banner = $('installBanner');
    banner.querySelector('[data-install]').onclick = installApp;
    banner.querySelector('[data-install-close]').onclick = () => {
      writeStore(INSTALL_DISMISSED_KEY, '1');
      banner.remove();
    };
  }

  // ---- Posledná podaplikácia ----------------------------------------------------------------

  /** Zapamätá si otvorenú podaplikáciu – Family Grid ju pri ďalšom spustení otvorí rovno. */
  function rememberApp(app) {
    writeStore(LAST_APP_KEY, app);
    apiQuiet('setLastApp', app).catch(() => {});
  }

  // ---- Štart ---------------------------------------------------------------------------------

  /**
   * Spustí stránku: hlavička, vzhľad, service worker; onReady(family) sa zavolá po načítaní
   * používateľa (aj po prihlásení). onAccount = vlastné tlačidlá v „Môj účet“.
   */
  function start({ onReady, accountExtra }) {
    applyTheme(currentTheme());
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(currentTheme()));
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    $('bellBtn').onclick = showNotificationSettings;
    $('avatar').onclick = () => (accountExtra ? showAccount(...accountExtra()) : showAccount());

    const ready = async () => {
      try {
        const family = await loadFamily(true);
        if (appId !== 'family') rememberApp(appId);
        syncPush();
        await onReady(family);
        refreshInstallBanner();
      } catch (err) {
        if (isLoginRequired(err)) return;
        if (err.offline && cachedFamily()) {
          const c = cachedFamily();
          state.households = c.households || [];
          showIdentity(c.email, c.nickname);
          toast('Bez internetu – ukazujem posledné uložené údaje');
          await onReady(null);
          return;
        }
        $('view').innerHTML = '<div class="center">' + esc(errorMessage(err)) + '</div>';
      }
    };
    loginListeners.push(ready);
    ready();
  }

  window.FG = {
    APPS,
    LAST_APP_KEY,
    state,
    $,
    esc,
    api,
    apiQuiet,
    toast,
    showError,
    errorMessage,
    isLoginRequired,
    openModal,
    closeModal,
    modalOpen,
    confirmDialog,
    readStore,
    writeStore,
    readJson,
    start,
    loadFamily,
    memberName,
    currentHousehold,
    setHousehold,
    householdPickerHtml,
    bindHouseholdPicker,
    emptyFamilyHtml,
    bindEmptyFamily,
    showAccount,
    showFamily,
    showCalendarFeed,
    showNotificationSettings,
    installApp,
    canInstall,
    rememberApp,
    setLoginHandler: (fn) => (onLoginRequired = fn),
  };
})();
