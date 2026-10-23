// Family Grid – spoločná časť pre rozcestník a podaplikácie Zdravko a Skládko
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
  };
  const THEME_COLORS = { family: '#4f46e5', gazda: '#16a34a', zdravko: '#1d72b8', skladko: '#ea580c' };
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

  function showLogin(expired) {
    closeModal(true);
    state.email = '';
    ['backBtn', 'bellBtn', 'avatar', 'tabs'].forEach((id) => $(id) && $(id).classList.add('hidden'));
    document.body.classList.remove('with-tabs');
    const name = appId === 'family' ? 'Family Grid' : APPS[appId].name;
    $('view').innerHTML =
      '<div class="empty login"><img class="login-logo" src="/icons/' + appId + '/icon.svg" alt="">' +
      '<h2>Prihlás sa do ' + esc(appId === 'family' ? 'Family Grid' : name + 'a') + '</h2>' +
      '<div>' + (expired ? 'Prihlásenie vypršalo. ' : '') +
      'Použi svoj Google účet – ten e-mail, s ktorým ti niekto zdieľal rodinu (domácnosť).</div>' +
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
        .filter((k) => /^(fg\.me|gazda\.snap|gazda\.token|zdravko\.|skladko\.)/.test(k))
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
  function currentHousehold() {
    const key = appId + '.household';
    const id = readStore(key);
    return state.households.find((h) => h.id === id) || state.households[0] || null;
  }

  function setHousehold(id) {
    writeStore(appId + '.household', id);
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
    if (!btn) return;
    btn.onclick = () => {
      const cur = currentHousehold();
      openModal(
        '<h2>Rodina</h2><div class="subtitle">Vyber, ktorej rodiny údaje chceš vidieť.</div><div class="pick-list">' +
          state.households
            .map((h) => '<button type="button" class="btn ' + (cur && cur.id === h.id ? '' : 'tonal') + '" data-id="' + esc(h.id) + '">' + esc(h.name) + '</button>')
            .join('') +
          '</div><div class="actions"><button type="button" class="btn text" id="cancel">Zavrieť</button></div>',
        (root) => {
          root.querySelector('#cancel').onclick = closeModal;
          root.querySelectorAll('[data-id]').forEach((b) => {
            b.onclick = () => {
              setHousehold(b.dataset.id);
              closeModal();
              onChange(b.dataset.id);
            };
          });
        },
        { focus: false }
      );
    };
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
    if (!btn) return;
    btn.onclick = () =>
      openModal(
        '<h2>Nová rodina</h2><form id="f"><div class="field"><label>Názov</label>' +
          '<input name="name" required maxlength="60" placeholder="napr. Novákovci"></div>' +
          '<div class="field"><label>Zdieľať s (e-maily, nepovinné)</label>' +
          '<input name="emails" placeholder="mama@gmail.com, ocko@gmail.com"></div>' +
          '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Vytvoriť</button></div></form>',
        (root) => {
          root.querySelector('#cancel').onclick = closeModal;
          root.querySelector('#f').onsubmit = async (e) => {
            e.preventDefault();
            try {
              const res = await api('createHousehold', e.target.name.value, e.target.emails.value);
              state.households = res.households;
              setHousehold(res.households[res.households.length - 1].id);
              closeModal();
              onCreated();
            } catch (err) {
              showError(err);
            }
          };
        }
      );
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
        '<div class="members"><div><span class="ms">lock</span>Prihlásený Google účtom – jedno prihlásenie pre Gazdu, Zdravka aj Skládko.</div></div>' +
        (canInstall()
          ? '<button type="button" class="btn small" id="install" style="margin:4px 8px 12px 0"><span class="ms">add</span>Nainštalovať Family Grid</button>'
          : '') +
        '<div class="field"><label>Vzhľad</label><div class="chips seg theme-seg">' +
        [['auto', 'brightness_auto', 'Podľa telefónu'], ['light', 'light_mode', 'Svetlý'], ['dark', 'dark_mode', 'Tmavý']]
          .map(([v, icon, label]) =>
            '<button type="button" class="chip' + (currentTheme() === v ? ' active' : '') + '" data-theme-pick="' + v + '"><span class="ms">' + icon + '</span>' + label + '</button>')
          .join('') +
        '</div></div>' + (extraHtml || '') +
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
      status = 'Upozornenia sú na tomto zariadení vypnuté. Jedno zapnutie platí pre Gazdu, Zdravka aj Skládko.';
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
        '<div class="text"><b>Nainštaluj si Family Grid</b>Gazda, Zdravko a Skládko v jednej aplikácii</div>' +
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
    showNotificationSettings,
    installApp,
    canInstall,
    rememberApp,
    setLoginHandler: (fn) => (onLoginRequired = fn),
  };
})();
