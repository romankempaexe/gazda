// Zdravko – zdravie rodiny. Podaplikácia Family Grid.
//
// Údaje rodiny (členovia, záznamy, miery) sa načítajú naraz (zdravko/getData), zmeny
// sa posielajú po jednej a každých pár sekúnd sa overí verzia (getRev) – zápis od
// druhého rodiča (napr. podaný liek) sa ukáže sám.

(function () {
  const { $, esc, api, apiQuiet, toast, showError, openModal, closeModal, modalOpen } = FG;
  const DATA = window.ZDRAVKO_DATA;

  const EVENT_TYPES = {
    doctor_visit: { name: 'Návšteva lekára', icon: 'local_hospital', color: '#1d72b8' },
    examination: { name: 'Vyšetrenie', icon: 'medical_services', color: '#7c3aed' },
    vaccination: { name: 'Očkovanie', icon: 'vaccines', color: '#059669' },
  };
  const REST_METHODS = {
    rest_telo_na_telo: 'Telo na telo',
    rest_zabal_koncatin: 'Zábal končatín',
    rest_zabal_cekeho_tela: 'Zábal celého tela',
    rest_obklad_na_hlavu: 'Obklad na hlavu',
    'rest_kupeľ': 'Kúpeľ',
    rest_sprcha: 'Sprcha',
    rest_lad_do_podpazusia_ci_slabin: 'Ľad do podpazušia alebo slabín',
    rest_otieranie: 'Otieranie',
  };
  const REMINDERS = { week_before: '1 týždeň pred', day_before: '1 deň pred', hour_before: '1 hodinu pred' };
  const UNITS = [['tbl', 'tableta'], ['ml', 'mililiter'], ['kvp', 'kvapky'], ['kps', 'kapsula'], ['g', 'gram'], ['čípok', 'čípok']];
  const RANGES = [['day', 'Deň', 1], ['3days', '3 dni', 3], ['week', 'Týždeň', 7], ['month', 'Mesiac', 30], ['3months', '3 mesiace', 90]];
  const MONTHS = ['január', 'február', 'marec', 'apríl', 'máj', 'jún', 'júl', 'august', 'september', 'október', 'november', 'december'];
  const WEEKDAYS = ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'];

  const S = {
    hh: null,
    data: null,
    view: { name: 'home', tab: 'members' },
    range: FG.readStore('zdravko.range') || '3days',
    day: null, // vybraný deň v zázname choroby (yyyy-MM-dd), null = dnes
    calMonth: null, // { y, m } v kalendári
    calDay: null,
  };

  const snapKey = () => 'zdravko.snap.' + S.hh;
  // Naposledy otvorená osoba (a jej karta) v rodine – pri ďalšom otvorení Zdravka sa otvorí rovno ona.
  const lastKey = () => 'zdravko.lastMember.' + S.hh;

  // ---- Pomocné: dátumy a čísla -----------------------------------------------------------

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  const parseYmd = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const addDays = (s, n) => {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  const hm = (iso) => {
    const d = new Date(iso);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const dm = (iso) => {
    const d = new Date(iso);
    return d.getDate() + '. ' + (d.getMonth() + 1) + '.';
  };
  const dmy = (s) => {
    const d = s.length === 10 ? parseYmd(s) : new Date(s);
    return d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + d.getFullYear();
  };
  const dayLabel = (s) => {
    if (s === today()) return 'Dnes';
    if (s === addDays(today(), -1)) return 'Včera';
    if (s === addDays(today(), 1)) return 'Zajtra';
    const d = parseYmd(s);
    return WEEKDAYS[d.getDay()] + ' ' + d.getDate() + '. ' + (d.getMonth() + 1) + '.' + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  };
  const localInput = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  const fmt = (n, digits = 1) => (n === null || n === undefined ? '' : String(Math.round(n * 10 ** digits) / 10 ** digits).replace('.', ','));
  const plural = (n, one, few, many) => n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

  /** Vek ako v mobilnom Zdravkovi: „2 roky, 3 mesiace a 5 dní“ (k dátumu at). */
  function age(birth, at) {
    if (!birth) return '';
    const b = parseYmd(birth);
    const t = at ? parseYmd(at) : new Date();
    let y = t.getFullYear() - b.getFullYear();
    let m = t.getMonth() - b.getMonth();
    let d = t.getDate() - b.getDate();
    if (d < 0) {
      m--;
      d += new Date(t.getFullYear(), t.getMonth(), 0).getDate();
    }
    if (m < 0) {
      y--;
      m += 12;
    }
    if (y < 0) return '';
    const parts = [];
    if (y) parts.push(plural(y, 'rok', 'roky', 'rokov'));
    if (m) parts.push(plural(m, 'mesiac', 'mesiace', 'mesiacov'));
    if (d || !parts.length) parts.push(plural(d, 'deň', 'dni', 'dní'));
    if (y >= 3) return parts[0]; // staršie deti a dospelí – stačia roky
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' a ' + parts[parts.length - 1] : parts[0];
  }

  function ago(iso) {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return 'práve teraz';
    if (min < 60) return 'pred ' + min + ' min';
    const h = Math.floor(min / 60);
    if (h < 24) return 'pred ' + h + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
    const days = Math.floor(h / 24);
    return 'pred ' + days + (days === 1 ? ' dňom' : ' dňami');
  }

  const tempClass = (t) => (t <= 37.2 ? 'ok' : t <= 38 ? 'warn' : 'bad');

  const member = (id) => S.data.members.find((m) => m.id === id);
  const recordsOf = (memberId) => S.data.records.filter((r) => r.memberId === memberId);
  const events = () => S.data.records.filter((r) => r.type === 'calendar_event');

  function recordTitle(r) {
    if (r.type === 'temperature') return 'Teplota';
    if (r.type === 'medicine') return r.medicineName;
    if (r.type === 'rest') return REST_METHODS[r.method] || 'Fyzikálna metóda';
    return EVENT_TYPES[r.eventType].name;
  }

  function recordDetail(r) {
    if (r.type === 'temperature') return fmt(r.temperature) + ' °C';
    if (r.type === 'medicine') return r.dosage || 'liek';
    if (r.type === 'rest') return fmt(r.durationHours) + ' h';
    return r.subtype;
  }

  const recordIcon = (r) => ({ temperature: 'thermometer', medicine: 'medication', rest: 'water_drop' })[r.type] || EVENT_TYPES[r.eventType].icon;

  // ---- Navigácia ------------------------------------------------------------------------------

  function go(view, replace) {
    S.view = view;
    if (replace) history.replaceState(view, '');
    else history.pushState(view, '');
    render();
    window.scrollTo(0, 0);
  }

  window.addEventListener('popstate', (e) => {
    if (modalOpen()) closeModal(true);
    S.view = e.state && e.state.name ? e.state : { name: 'home', tab: 'members' };
    render();
  });

  $('backBtn').onclick = () => {
    if (history.state && history.state.name === 'member') history.back();
    else go({ name: 'home', tab: 'members' }, true);
  };

  // ---- Načítanie ------------------------------------------------------------------------------

  async function load(quiet) {
    if (!S.hh) return;
    const fresh = await (quiet ? apiQuiet : api)('zdravko/getData', S.hh);
    if (fresh.householdId !== S.hh) return;
    S.data = fresh;
    try {
      localStorage.setItem(snapKey(), JSON.stringify(fresh));
    } catch (e) {}
  }

  let checking = false;
  async function checkRev() {
    if (document.hidden || !S.data || checking || modalOpen()) return;
    checking = true;
    try {
      const rev = await apiQuiet('zdravko/getRev', S.hh);
      if (rev !== S.data.rev) {
        await load(true);
        if (!modalOpen()) render();
      }
    } catch (e) {
      // nepovinné
    } finally {
      checking = false;
    }
  }
  setInterval(checkRev, 8000);
  document.addEventListener('visibilitychange', () => !document.hidden && checkRev());

  async function act(fn, ok) {
    try {
      const res = await fn();
      closeModal(true);
      await load(true);
      render();
      if (ok) toast(ok);
      return res;
    } catch (err) {
      showError(err);
      return null;
    }
  }

  // ---- Kostra obrazovky ---------------------------------------------------------------------------

  function header(title, showBack) {
    $('title').textContent = title;
    $('backBtn').classList.toggle('hidden', !showBack);
    $('brand').classList.toggle('hidden', showBack);
  }

  function tabs(list, active, onPick) {
    const nav = $('tabs');
    if (!list) {
      nav.classList.add('hidden');
      document.body.classList.remove('with-tabs');
      return;
    }
    nav.innerHTML = list
      .map(([id, icon, label]) => '<button data-tab="' + id + '" class="tab' + (id === active ? ' active' : '') + '"><span class="ms">' + icon + '</span><span>' + esc(label) + '</span></button>')
      .join('');
    nav.classList.remove('hidden');
    document.body.classList.add('with-tabs');
    nav.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => onPick(b.dataset.tab)));
  }

  function fab(html, bind) {
    const el = $('fab');
    el.innerHTML = html || '';
    el.classList.toggle('hidden', !html);
    if (bind) bind(el);
  }

  function render() {
    if (!S.hh) {
      header('Zdravko', false);
      tabs(null);
      fab('');
      $('view').innerHTML = FG.emptyFamilyHtml('Členovia a ich zdravotné záznamy');
      FG.bindEmptyFamily(() => start());
      return;
    }
    if (!S.data) {
      $('view').innerHTML = '<div class="center muted">Načítavam…</div>';
      return;
    }
    if (S.view.name === 'member') {
      const m = member(S.view.memberId);
      if (!m) {
        FG.writeStore(lastKey(), null);
        return go({ name: 'home', tab: 'members' }, true);
      }
      FG.writeStore(lastKey(), JSON.stringify({ memberId: m.id, tab: S.view.tab || 'sick' }));
      return renderMember(m);
    }
    renderHome();
  }

  // ---- Domov: členovia a kalendár rodiny ------------------------------------------------------------

  function renderHome() {
    header('Zdravko', false);
    const tab = S.view.tab || 'members';
    tabs([['members', 'group', 'Členovia'], ['calendar', 'calendar_month', 'Kalendár']], tab, (t) => go({ name: 'home', tab: t }, true));
    if (tab === 'calendar') return renderCalendar(null);
    const d = S.data;
    const cards = d.members
      .map((m) => {
        const recs = recordsOf(m.id);
        const lastTemp = [...recs].reverse().find((r) => r.type === 'temperature');
        const lastMed = [...recs].reverse().find((r) => r.type === 'medicine');
        const recent = (r) => r && Date.now() - Date.parse(r.recordedAt) < 48 * 3600000;
        const next = events().filter((e) => e.memberId === m.id && Date.parse(e.eventAt) >= Date.now()).sort((a, b) => a.eventAt.localeCompare(b.eventAt))[0];
        const facts = [m.weight ? fmt(m.weight) + ' kg' : '', m.height ? fmt(m.height, 0) + ' cm' : '', m.bloodGroup].filter(Boolean).join(' · ');
        return (
          '<div class="card zd-member" data-member="' + esc(m.id) + '">' +
          '<div class="zd-avatar' + (m.isChild ? ' child' : '') + '"><span class="ms">' + (m.isChild ? 'child_care' : 'person') + '</span></div>' +
          '<div class="card-body"><div class="card-title">' + esc(m.name) + '</div>' +
          '<div class="card-sub">' + esc(age(m.birthDate)) + (facts ? ' · ' + esc(facts) : '') + '</div>' +
          (recent(lastTemp) || recent(lastMed) || next
            ? '<div class="zd-chips">' +
              (recent(lastTemp) ? '<span class="zd-chip ' + tempClass(lastTemp.temperature) + '"><span class="ms">thermometer</span>' + fmt(lastTemp.temperature) + ' °C · ' + esc(ago(lastTemp.recordedAt)) + '</span>' : '') +
              (recent(lastMed) ? '<span class="zd-chip"><span class="ms">medication</span>' + esc(lastMed.medicineName) + ' · ' + esc(ago(lastMed.recordedAt)) + '</span>' : '') +
              (next ? '<span class="zd-chip event"><span class="ms">' + EVENT_TYPES[next.eventType].icon + '</span>' + esc(dm(next.eventAt)) + ' ' + hm(next.eventAt) + ' · ' + esc(next.subtype) + '</span>' : '') +
              '</div>'
            : '') +
          '</div><span class="ms zd-go">chevron_right</span></div>'
        );
      })
      .join('');
    $('view').innerHTML =
      FG.householdPickerHtml() +
      '<div class="page-head"><h2>Rodina</h2><p>' + (d.members.length ? plural(d.members.length, 'člen', 'členovia', 'členov') : 'Pridaj členov rodiny – deti aj dospelých.') + '</p></div>' +
      (cards ||
        '<div class="empty"><span class="ms">favorite</span><h2>Zatiaľ nikto</h2><div>Pridaj prvého člena rodiny. Máš údaje v mobilnom Zdravkovi? ' +
          'Prenesieš ich v <b>Môj účet</b> → <b>Preniesť z mobilného Zdravka</b>.</div></div>');
    FG.bindHouseholdPicker((id) => {
      S.hh = id;
      S.data = FG.readJson(snapKey());
      render();
      load(true).then(render).catch(showError);
    });
    $('view').querySelectorAll('[data-member]').forEach((el) => (el.onclick = () => go({ name: 'member', memberId: el.dataset.member, tab: 'sick' })));
    fab('<button type="button" class="btn" id="addMember"><span class="ms">add</span>Člen rodiny</button>', (el) => {
      el.querySelector('#addMember').onclick = () => memberForm(null);
    });
  }

  function memberForm(m) {
    let gender = m ? m.gender : '';
    openModal(
      '<h2>' + (m ? 'Upraviť člena rodiny' : 'Nový člen rodiny') + '</h2><form id="f">' +
        '<div class="field"><label>Meno</label><input name="name" required maxlength="60" value="' + esc(m ? m.name : '') + '" placeholder="napr. Janko"></div>' +
        '<div class="field"><label>Dátum narodenia</label><input type="date" name="birthDate" required max="' + today() + '" value="' + esc(m ? m.birthDate : '') + '"></div>' +
        '<label class="switch"><input type="checkbox" name="isChild"' + (m && m.isChild ? ' checked' : '') + '><span class="switch-track"></span>Dieťa (sledovať miery – váha, výška, obvod hlavičky)</label>' +
        '<div class="row"><div class="field"><label>Váha (kg)</label><input name="weight" inputmode="decimal" value="' + esc(m && m.weight ? fmt(m.weight, 2) : '') + '"></div>' +
        '<div class="field"><label>Výška (cm)</label><input name="height" inputmode="decimal" value="' + esc(m && m.height ? fmt(m.height) : '') + '"></div></div>' +
        '<div class="row"><div class="field"><label>Krvná skupina</label><select name="bloodGroup"><option value="">–</option>' +
        ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => '<option' + (m && m.bloodGroup === b ? ' selected' : '') + '>' + b + '</option>').join('') + '</select></div>' +
        '<div class="field"><label>Pohlavie</label><div class="chips zd-seg">' +
        ['Muž', 'Žena'].map((g) => '<button type="button" class="chip' + (gender === g ? ' active' : '') + '" data-gender="' + g + '">' + g + '</button>').join('') + '</div></div></div>' +
        '<div class="field"><label>E-mail (nepovinné – na pozvánky do kalendára)</label><input type="email" name="email" value="' + esc(m ? m.email : '') + '"></div>' +
        '<div class="actions">' + (m ? '<button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' : '') +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Uložiť</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelectorAll('[data-gender]').forEach((b) => {
          b.onclick = () => {
            gender = gender === b.dataset.gender ? '' : b.dataset.gender;
            root.querySelectorAll('[data-gender]').forEach((x) => x.classList.toggle('active', x.dataset.gender === gender));
          };
        });
        const del = root.querySelector('#del');
        if (del) {
          del.onclick = async () => {
            if (!(await FG.confirmDialog('Vymazať ' + m.name + '?', 'Vymažú sa aj všetky jeho záznamy, udalosti a miery. Nedá sa to vrátiť.', 'Vymazať', true))) return;
            await act(() => api('zdravko/deleteMember', m.id), m.name + ' vymazaný z rodiny');
            go({ name: 'home', tab: 'members' }, true);
          };
        }
        root.querySelector('#f').onsubmit = (e) => {
          e.preventDefault();
          const f = e.target;
          act(
            () => api('zdravko/saveMember', S.hh, {
              id: m && m.id,
              name: f.name.value,
              birthDate: f.birthDate.value,
              isChild: f.isChild.checked,
              weight: f.weight.value,
              height: f.height.value,
              bloodGroup: f.bloodGroup.value,
              gender,
              email: f.email.value,
            }),
            m ? 'Uložené' : f.name.value.trim() + ' pridaný do rodiny'
          );
        };
      }
    );
  }

  // ---- Detail člena ------------------------------------------------------------------------------

  function renderMember(m) {
    header(m.name, true);
    const tab = S.view.tab || 'sick';
    const list = [['sick', 'thermometer', 'Choroba'], ['calendar', 'calendar_month', 'Kalendár'], ['dose', 'calculate', 'Dávkovanie']];
    if (m.isChild) list.push(['growth', 'straighten', 'Miery']);
    tabs(list, tab, (t) => go({ ...S.view, tab: t }, true));
    const head =
      '<div class="zd-head"><div class="zd-avatar' + (m.isChild ? ' child' : '') + '"><span class="ms">' + (m.isChild ? 'child_care' : 'person') + '</span></div>' +
      '<div><div class="card-title">' + esc(m.name) + '</div><div class="card-sub">' + esc(age(m.birthDate)) +
      [m.weight ? fmt(m.weight, 2) + ' kg' : '', m.height ? fmt(m.height) + ' cm' : '', m.bloodGroup].filter(Boolean).map((x) => ' · ' + esc(x)).join('') +
      '</div></div><button type="button" class="icon-btn" id="editMember" title="Upraviť"><span class="ms">edit</span></button></div>';
    if (tab === 'calendar') renderCalendar(m, head);
    else if (tab === 'dose') renderDosage(m, head);
    else if (tab === 'growth' && m.isChild) renderGrowth(m, head);
    else renderSickness(m, head);
    $('editMember').onclick = () => memberForm(m);
  }

  // ---- Záznam choroby ------------------------------------------------------------------------------

  function period() {
    const days = (RANGES.find((r) => r[0] === S.range) || RANGES[1])[2];
    const end = S.day || today();
    const from = parseYmd(addDays(end, -(days - 1)));
    const to = parseYmd(addDays(end, 1));
    return { from: from.getTime(), to: to.getTime(), days, end };
  }

  function renderSickness(m, head) {
    const p = period();
    const recs = recordsOf(m.id)
      .filter((r) => r.type !== 'calendar_event')
      .filter((r) => {
        const t = Date.parse(r.recordedAt);
        return t >= p.from && t < p.to;
      });
    const temps = recs.filter((r) => r.type === 'temperature');
    const meds = recordsOf(m.id).filter((r) => r.type === 'medicine' && Date.now() - Date.parse(r.recordedAt) < 72 * 3600000);
    const tempView = FG.readStore('zdravko.tempView') || 'chart';

    $('view').innerHTML =
      head +
      lastBox(m) +
      '<div class="zd-period"><select id="range">' + RANGES.map(([id, label]) => '<option value="' + id + '"' + (id === S.range ? ' selected' : '') + '>' + label + '</option>').join('') + '</select>' +
      '<button type="button" class="icon-btn" id="prevDay" title="Skôr"><span class="ms">chevron_left</span></button>' +
      '<label class="zd-date"><span>' + esc(dayLabel(p.end)) + '</span><input type="date" id="day" max="' + today() + '" value="' + p.end + '"></label>' +
      '<button type="button" class="icon-btn" id="nextDay" title="Neskôr"' + (p.end >= today() ? ' disabled' : '') + '><span class="ms">chevron_right</span></button></div>' +
      // lieky za posledné 3 dni + kedy smie ďalší
      (meds.length ? medsBox(meds) : '') +
      '<div class="section-title zd-sec"><span class="ms">thermometer</span>Teplota' +
      '<div class="chips zd-mini"><button type="button" class="chip' + (tempView === 'chart' ? ' active' : '') + '" data-tv="chart"><span class="ms">show_chart</span></button>' +
      '<button type="button" class="chip' + (tempView === 'table' ? ' active' : '') + '" data-tv="table"><span class="ms">table_rows</span></button></div></div>' +
      (temps.length
        ? tempView === 'chart'
          ? chartSvg(temps, p)
          : '<div class="zd-table">' + [...temps].reverse().map((r) => '<div><span>' + dm(r.recordedAt) + ' ' + hm(r.recordedAt) + '</span><b class="t-' + tempClass(r.temperature) + '">' + fmt(r.temperature) + ' °C</b></div>').join('') + '</div>'
        : '<div class="empty compact"><div>Žiadne merania teploty v tomto období.</div></div>') +
      '<div class="section-title zd-sec"><span class="ms">history</span>Záznamy</div>' +
      (recs.length ? timeline(recs) : '<div class="empty compact"><span class="ms">healing</span><div>Bez záznamov v tomto období. Teplotu, liek alebo zábal pridáš tlačidlom dole.</div></div>');

    $('range').onchange = (e) => {
      S.range = e.target.value;
      FG.writeStore('zdravko.range', S.range);
      render();
    };
    $('day').onchange = (e) => {
      S.day = e.target.value && e.target.value < today() ? e.target.value : null;
      render();
    };
    $('prevDay').onclick = () => {
      S.day = addDays(p.end, -p.days);
      render();
    };
    $('nextDay').onclick = () => {
      const next = addDays(p.end, p.days);
      S.day = next >= today() ? null : next;
      render();
    };
    $('view').querySelectorAll('[data-tv]').forEach((b) => (b.onclick = () => {
      FG.writeStore('zdravko.tempView', b.dataset.tv);
      render();
    }));
    $('view').querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!(await FG.confirmDialog('Vymazať záznam?', '', 'Vymazať', true))) return;
        act(() => api('zdravko/deleteRecord', b.dataset.del), 'Záznam vymazaný');
      };
    });
    fab('<button type="button" class="btn" id="addRec"><span class="ms">add</span>Záznam</button>', (el) => {
      el.querySelector('#addRec').onclick = () => recordForm(m);
    });
  }

  /**
   * Vždy navrchu: posledný podaný liek a posledná nameraná teplota (bez ohľadu na zvolené obdobie),
   * kedy to bolo a pri ibuprofene/paracetamole kedy sa smie podať znova.
   */
  function lastBox(m) {
    const all = recordsOf(m.id);
    const latest = (type) => all.filter((r) => r.type === type).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
    const med = latest('medicine');
    const temp = latest('temperature');
    const when = (r) => esc(dayLabel(ymd(new Date(r.recordedAt)))) + ' ' + hm(r.recordedAt) + ' · <span data-ago="' + esc(r.recordedAt) + '">' + esc(ago(r.recordedAt)) + '</span>';
    let next = '';
    if (med && (med.substanceId === 'ibuprofen' || med.substanceId === 'paracetamol')) {
      const ok = Date.parse(med.recordedAt) + 8 * 3600000;
      next =
        ok <= Date.now()
          ? '<div class="zd-last-next ok"><span class="ms">check_circle</span>Už sa smie podať znova</div>'
          : '<div class="zd-last-next"><span class="ms">timer</span>Znova najskôr ' + esc(dayLabel(ymd(new Date(ok)))).toLowerCase() + ' o ' + hm(new Date(ok).toISOString()) + '</div>';
    }
    return (
      '<div class="zd-last">' +
      '<div class="zd-last-card med' + (med ? '' : ' none') + '"><span class="zd-last-icon"><span class="ms">medication</span></span><div>' +
      '<div class="zd-last-label">Posledný liek</div>' +
      (med
        ? '<div class="zd-last-value">' + esc(med.medicineName) + (med.dosage ? ' <small>' + esc(med.dosage) + '</small>' : '') + '</div><div class="zd-last-when">' + when(med) + '</div>' + next
        : '<div class="zd-last-when">Zatiaľ žiadny</div>') +
      '</div></div>' +
      '<div class="zd-last-card temp' + (temp ? ' t-' + tempClass(temp.temperature) : ' none') + '"><span class="zd-last-icon"><span class="ms">thermometer</span></span><div>' +
      '<div class="zd-last-label">Posledná teplota</div>' +
      (temp
        ? '<div class="zd-last-value">' + fmt(temp.temperature) + ' °C</div><div class="zd-last-when">' + when(temp) + '</div>'
        : '<div class="zd-last-when">Zatiaľ nemeraná</div>') +
      '</div></div></div>'
    );
  }

  // „pred X min“ v prehľade navrchu sa obnovuje samo
  setInterval(() => {
    document.querySelectorAll('.zd-last [data-ago]').forEach((el) => (el.textContent = ago(el.dataset.ago)));
  }, 30000);

  function medsBox(meds) {
    const bySubstance = {};
    for (const r of meds) if (r.substanceId) bySubstance[r.substanceId] = r; // posledný
    const hints = ['ibuprofen', 'paracetamol']
      .filter((s) => bySubstance[s])
      .map((s) => {
        const last = Date.parse(bySubstance[s].recordedAt);
        const ok = last + 8 * 3600000;
        const name = s === 'ibuprofen' ? 'Ibuprofen' : 'Paracetamol';
        return ok <= Date.now()
          ? '<div><span class="ms">check_circle</span>' + name + ' sa už smie podať znova</div>'
          : '<div><span class="ms">timer</span>' + name + ' znova najskôr o ' + hm(new Date(ok).toISOString()) + ' (8 h od ' + hm(bySubstance[s].recordedAt) + ')</div>';
      });
    return (
      '<div class="section-title zd-sec"><span class="ms">medication</span>Lieky za posledné 3 dni</div><div class="members">' +
      [...meds].reverse().slice(0, 8).map((r) => '<div><span class="ms">medication</span><b>' + esc(r.medicineName) + '</b>' + (r.dosage ? ' ' + esc(r.dosage) : '') +
        '<span class="muted" style="margin-left:auto">' + dm(r.recordedAt) + ' ' + hm(r.recordedAt) + ' · ' + esc(ago(r.recordedAt)) + '</span></div>').join('') +
      hints.join('') + '</div>'
    );
  }

  function timeline(recs) {
    const groups = [];
    for (const r of [...recs].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))) {
      const key = r.recordedAt.slice(0, 16);
      const g = groups.find((x) => x.key === key);
      if (g) g.items.push(r);
      else groups.push({ key, at: r.recordedAt, items: [r] });
    }
    let lastDay = '';
    return (
      '<div class="zd-timeline">' +
      groups
        .map((g) => {
          const day = ymd(new Date(g.at));
          const dayHead = day !== lastDay ? '<div class="zd-day">' + esc(dayLabel(day)) + '</div>' : '';
          lastDay = day;
          return (
            dayHead +
            '<div class="zd-tl"><div class="zd-time">' + hm(g.at) + '</div><div class="zd-tl-items">' +
            g.items
              .map((r) =>
                '<div class="zd-rec ' + r.type + (r.type === 'temperature' ? ' t-' + tempClass(r.temperature) : '') + '"><span class="ms">' + recordIcon(r) + '</span>' +
                '<div><b>' + esc(recordTitle(r)) + '</b> ' + esc(recordDetail(r)) + '</div>' +
                '<button type="button" class="icon-btn small" data-del="' + esc(r.id) + '" title="Vymazať"><span class="ms">delete</span></button></div>')
              .join('') +
            '</div></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** Graf teploty (SVG): pásma 36–37 zelená, 37–38 oranžová, nad 38 červená. */
  function chartSvg(temps, p) {
    const W = 640;
    const H = 230;
    const L = 40;
    const R = 10;
    const T = 10;
    const B = 26;
    const minY = 35.5;
    const maxY = 41.5;
    const x = (t) => L + ((t - p.from) / (p.to - p.from)) * (W - L - R);
    const y = (v) => T + ((maxY - Math.max(minY, Math.min(maxY, v))) / (maxY - minY)) * (H - T - B);
    const band = (a, b, cls) => '<rect class="' + cls + '" x="' + L + '" width="' + (W - L - R) + '" y="' + y(b) + '" height="' + (y(a) - y(b)) + '"/>';
    let grid = '';
    for (let v = 36; v <= 41; v++) grid += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="yl" x="' + (L - 6) + '" y="' + (y(v) + 4) + '">' + v + '°</text>';
    // popisky času: hodiny pri dni, inak dni
    const step = p.days === 1 ? 3 * 3600000 : Math.ceil(p.days / 8) * 86400000;
    let labels = '';
    for (let t = p.from; t < p.to; t += step) {
      const d = new Date(t);
      labels += '<text class="xl" x="' + x(t) + '" y="' + (H - 8) + '">' + (p.days === 1 ? pad(d.getHours()) + ':00' : d.getDate() + '.' + (d.getMonth() + 1) + '.') + '</text>';
    }
    const pts = [...temps].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).map((r) => [x(Date.parse(r.recordedAt)), y(r.temperature), r]);
    const line = pts.length > 1 ? '<polyline class="line" points="' + pts.map(([a, b]) => a.toFixed(1) + ',' + b.toFixed(1)).join(' ') + '"/>' : '';
    const dots = pts
      .map(([a, b, r]) => '<circle class="t-' + tempClass(r.temperature) + '" cx="' + a.toFixed(1) + '" cy="' + b.toFixed(1) + '" r="5"><title>' + dm(r.recordedAt) + ' ' + hm(r.recordedAt) + ' – ' + fmt(r.temperature) + ' °C</title></circle>')
      .join('');
    const max = Math.max(...temps.map((r) => r.temperature));
    return (
      '<div class="zd-chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Graf teploty">' +
      band(36, 37, 'b-ok') + band(37, 38, 'b-warn') + band(38, maxY, 'b-bad') + grid + labels + line + dots + '</svg>' +
      '<div class="zd-chart-note">Najvyššia: <b class="t-' + tempClass(max) + '">' + fmt(max) + ' °C</b> · meraní: ' + temps.length + '</div></div>'
    );
  }

  /** Pridať záznam: teplota, liek a fyzikálna metóda naraz (v jednom čase). */
  function recordForm(m) {
    const subs = DATA.substances;
    const usedNames = [...new Set(S.data.records.filter((r) => r.type === 'medicine' && !r.substanceId).map((r) => r.medicineName))];
    let substance = null;
    let restMethod = null;
    openModal(
      '<h2>Pridať záznam – ' + esc(m.name) + '</h2><form id="f">' +
        '<div class="field"><label>Čas</label><div class="row"><input type="datetime-local" name="at" value="' + localInput() + '" max="' + localInput(new Date(Date.now() + 3600000).toISOString()) + '">' +
        '<button type="button" class="btn text small" data-shift="-10" style="flex:0 0 auto">−10 min</button><button type="button" class="btn text small" data-shift="-30" style="flex:0 0 auto">−30 min</button></div></div>' +
        '<div class="field"><label>Teplota (°C)</label><div class="row zd-temp"><input name="temp" inputmode="decimal" placeholder="napr. 38,2" autocomplete="off">' +
        ['37,5', '38', '38,5', '39'].map((v) => '<button type="button" class="chip" data-temp="' + v + '">' + v + '</button>').join('') + '</div></div>' +
        '<div class="field"><label>Liek</label><div class="chips wrap zd-subs">' +
        subs.map((s) => '<button type="button" class="chip" data-sub="' + esc(s.id) + '">' + esc(s.name) + '</button>').join('') +
        '<button type="button" class="chip" data-sub="other">Iný liek</button></div>' +
        '<div id="medBox" class="hidden"><input name="medName" list="medNames" placeholder="Názov lieku" maxlength="80" style="margin-top:8px">' +
        '<datalist id="medNames">' + usedNames.map((n) => '<option value="' + esc(n) + '">').join('') + '</datalist>' +
        '<div class="row" style="margin-top:8px"><input name="amount" inputmode="decimal" placeholder="Dávka (napr. 5)">' +
        '<select name="unit">' + UNITS.map(([u, label]) => '<option value="' + u + '">' + label + '</option>').join('') + '</select></div></div></div>' +
        '<div class="field"><label>Fyzikálna metóda</label><div class="hint zd-warn"><span class="ms">warning</span>Fyzikálnu metódu použi len vtedy, ak má dieťa teplé končatiny.</div>' +
        '<div class="chips wrap">' + Object.entries(REST_METHODS).map(([k, v]) => '<button type="button" class="chip" data-rest="' + esc(k) + '">' + esc(v) + '</button>').join('') + '</div>' +
        '<div id="restBox" class="hidden row" style="margin-top:8px;align-items:center"><span>Trvanie (h)</span><input name="hours" inputmode="decimal" value="1"></div></div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Uložiť</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelectorAll('[data-shift]').forEach((b) => {
          b.onclick = () => {
            const d = new Date(f.at.value || Date.now());
            d.setMinutes(d.getMinutes() + Number(b.dataset.shift));
            f.at.value = localInput(d.toISOString());
          };
        });
        root.querySelectorAll('[data-temp]').forEach((b) => (b.onclick = () => (f.temp.value = b.dataset.temp)));
        root.querySelectorAll('[data-sub]').forEach((b) => {
          b.onclick = () => {
            substance = substance === b.dataset.sub ? null : b.dataset.sub;
            root.querySelectorAll('[data-sub]').forEach((x) => x.classList.toggle('active', x.dataset.sub === substance));
            root.querySelector('#medBox').classList.toggle('hidden', !substance);
            f.medName.classList.toggle('hidden', substance !== 'other');
            if (substance === 'other') f.medName.focus();
          };
        });
        root.querySelectorAll('[data-rest]').forEach((b) => {
          b.onclick = () => {
            restMethod = restMethod === b.dataset.rest ? null : b.dataset.rest;
            root.querySelectorAll('[data-rest]').forEach((x) => x.classList.toggle('active', x.dataset.rest === restMethod));
            root.querySelector('#restBox').classList.toggle('hidden', !restMethod);
          };
        });
        f.onsubmit = async (e) => {
          e.preventDefault();
          const data = { recordedAt: new Date(f.at.value).toISOString() };
          if (f.temp.value.trim()) data.temperature = f.temp.value.trim();
          if (substance) {
            const s = subs.find((x) => x.id === substance);
            const amount = f.amount.value.trim().replace(',', '.');
            data.medicine = {
              name: s ? s.name : f.medName.value,
              substanceId: s ? s.id : '',
              dosage: amount ? amount + ' ' + f.unit.value : '',
            };
          }
          if (restMethod) data.rest = { method: restMethod, durationHours: f.hours.value };
          const button = f.querySelector('button:not([type])');
          button.disabled = true;
          try {
            await api('zdravko/addRecords', m.id, data);
            closeModal(true);
            await load(true);
            render();
            toast('Uložené' + (data.medicine && ['ibuprofen', 'paracetamol'].includes(data.medicine.substanceId) ? ' – o 4 h a 8 h príde pripomienka' : ''));
          } catch (err) {
            button.disabled = false;
            showError(err);
          }
        };
      },
      { focus: '[name=temp]' }
    );
  }

  // ---- Kalendár (rodiny alebo člena) ------------------------------------------------------------------

  function renderCalendar(m, head) {
    const now = new Date();
    if (!S.calMonth) S.calMonth = { y: now.getFullYear(), m: now.getMonth() };
    const { y, m: mon } = S.calMonth;
    const list = events()
      .filter((e) => !m || e.memberId === m.id)
      .sort((a, b) => a.eventAt.localeCompare(b.eventAt));
    const inMonth = list.filter((e) => {
      const d = new Date(e.eventAt);
      return d.getFullYear() === y && d.getMonth() === mon;
    });
    const sickDays = m ? new Set(recordsOf(m.id).filter((r) => r.type !== 'calendar_event').map((r) => ymd(new Date(r.recordedAt)))) : new Set();
    const eventDays = new Set(inMonth.map((e) => ymd(new Date(e.eventAt))));
    // Celý mesiac naraz ako v mobilnom Zdravkovi: týždeň od pondelka, pod číslom bodky udalostí
    // (farba podľa druhu) a červená bodka za záznam choroby.
    const daysInMonth = new Date(y, mon + 1, 0).getDate();
    const lead = (new Date(y, mon, 1).getDay() + 6) % 7;
    let days = ['po', 'ut', 'st', 'št', 'pi', 'so', 'ne'].map((w) => '<div class="zd-wd">' + w + '</div>').join('') + '<span></span>'.repeat(lead);
    for (let d = 1; d <= daysInMonth; d++) {
      const key = ymd(new Date(y, mon, d));
      const types = [...new Set(inMonth.filter((e) => ymd(new Date(e.eventAt)) === key).map((e) => e.eventType))];
      const dots =
        types.slice(0, 3).map((t) => '<i style="background:' + EVENT_TYPES[t].color + '"></i>').join('') + (sickDays.has(key) ? '<i class="sick"></i>' : '');
      days +=
        '<button type="button" class="zd-mday' + (key === today() ? ' today' : '') + (key === S.calDay ? ' selected' : '') + (types.length ? ' has-ev' : '') + '" data-day="' + key + '">' +
        '<span class="num">' + d + '</span><span class="zd-dots">' + dots + '</span></button>';
    }
    const shown = S.calDay ? inMonth.filter((e) => ymd(new Date(e.eventAt)) === S.calDay) : inMonth;
    const upcoming = list.filter((e) => Date.parse(e.eventAt) >= Date.now()).slice(0, 5);
    let lastDay = '';
    const cards = shown
      .map((e) => {
        const day = ymd(new Date(e.eventAt));
        const dh = day !== lastDay ? '<div class="zd-day">' + esc(dayLabel(day)) + '</div>' : '';
        lastDay = day;
        return dh + eventCard(e, !m);
      })
      .join('');
    $('view').innerHTML =
      (head || FG.householdPickerHtml()) +
      (!m && upcoming.length && !S.calDay
        ? '<div class="section-title zd-sec"><span class="ms">event</span>Najbližšie</div>' + upcoming.map((e) => eventCard(e, true)).join('')
        : '') +
      '<div class="calendar"><div class="cal-head"><span class="month">' + MONTHS[mon].replace(/^./, (c) => c.toUpperCase()) + ' ' + y + '</span>' +
      '<button type="button" class="icon-btn" id="prevM"><span class="ms">chevron_left</span></button><button type="button" class="icon-btn" id="nextM"><span class="ms">chevron_right</span></button></div>' +
      '<div class="zd-month" id="month">' + days + '</div></div>' +
      '<div class="zd-legend">' + Object.values(EVENT_TYPES).map((t) => '<span><i class="dot" style="background:' + t.color + '"></i>' + esc(t.name.toLowerCase()) + '</span>').join('') +
      (m ? '<span><i class="dot sick"></i>choroba</span>' : '') + '</div>' +
      (!m ? '<button type="button" class="btn tonal small zd-widget" id="calFeed"><span class="ms">event</span>Kalendár na plochu (Google Kalendár)</button>' : '') +
      (cards || '<div class="empty compact"><span class="ms">calendar_month</span><div>' + (S.calDay ? 'V tento deň nič.' : 'V tomto mesiaci žiadne udalosti.') + '</div></div>');
    FG.bindHouseholdPicker((id) => {
      S.hh = id;
      S.data = FG.readJson(snapKey());
      render();
      load(true).then(render).catch(showError);
    });
    const shift = (n) => {
      const d = new Date(y, mon + n, 1);
      S.calMonth = { y: d.getFullYear(), m: d.getMonth() };
      S.calDay = null;
      render();
    };
    if ($('calFeed')) $('calFeed').onclick = FG.showCalendarFeed;
    $('prevM').onclick = () => shift(-1);
    $('nextM').onclick = () => shift(1);
    $('view').querySelectorAll('[data-day]').forEach((b) => {
      b.onclick = () => {
        S.calDay = S.calDay === b.dataset.day ? null : b.dataset.day;
        if (m && S.calDay && sickDays.has(S.calDay) && !eventDays.has(S.calDay)) {
          S.day = S.calDay < today() ? S.calDay : null;
          S.range = 'day';
          S.calDay = null;
          return go({ ...S.view, tab: 'sick' }, true);
        }
        render();
      };
    });
    // potiahnutie prstom do strany = iný mesiac (ako v mobilnom)
    let touchX = null;
    $('month').addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
    $('month').addEventListener('touchend', (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
    });
    $('view').querySelectorAll('[data-event]').forEach((el) => (el.onclick = () => eventDetail(S.data.records.find((r) => r.id === el.dataset.event))));
    fab('<button type="button" class="btn" id="addEvent"><span class="ms">add</span>Udalosť</button>', (el) => {
      el.querySelector('#addEvent').onclick = () => {
        if (m) return eventForm(m, null);
        if (!S.data.members.length) return toast('Najprv pridaj člena rodiny.', true);
        if (S.data.members.length === 1) return eventForm(S.data.members[0], null);
        pickMember((x) => eventForm(x, null));
      };
    });
  }

  function pickMember(then) {
    openModal(
      '<h2>Pre koho?</h2><div class="pick-list">' + S.data.members.map((x) => '<button type="button" class="btn tonal" data-m="' + esc(x.id) + '">' + esc(x.name) + '</button>').join('') +
        '</div><div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => then(member(b.dataset.m))));
      },
      { focus: false }
    );
  }

  function eventCard(e, showMember) {
    const t = EVENT_TYPES[e.eventType];
    const past = Date.parse(e.eventAt) < Date.now();
    const who = member(e.memberId);
    return (
      '<div class="card zd-event' + (past ? ' past' : '') + '" data-event="' + esc(e.id) + '" style="--ev:' + t.color + '">' +
      '<div class="zd-ev-icon"><span class="ms">' + t.icon + '</span></div>' +
      '<div class="card-body"><div class="card-title">' + esc(e.subtype) + '</div>' +
      '<div class="card-sub">' + esc(t.name) + (showMember && who ? ' · ' + esc(who.name) : '') + ' · ' + esc(dm(e.eventAt)) + ' o ' + hm(e.eventAt) +
      (e.cost ? ' · ' + fmt(e.cost, 2) + ' €' : '') + (e.reminders.length ? ' · <span class="ms" style="font-size:14px;vertical-align:-2px">notifications_active</span>' : '') + '</div></div></div>'
    );
  }

  function icsDate(iso) {
    return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function eventDetail(e) {
    const t = EVENT_TYPES[e.eventType];
    const who = member(e.memberId);
    const end = new Date(Date.parse(e.eventAt) + 3600000).toISOString();
    const title = (who ? who.name + ' – ' : '') + t.name + ': ' + e.subtype;
    const details = [e.notes, e.cost ? 'Cena: ' + fmt(e.cost, 2) + ' €' : ''].filter(Boolean).join('\n');
    const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) +
      '&dates=' + icsDate(e.eventAt) + '/' + icsDate(end) + '&details=' + encodeURIComponent(details) +
      (who && who.email ? '&add=' + encodeURIComponent(who.email) : '');
    openModal(
      '<h2>' + esc(e.subtype) + '</h2><div class="subtitle">' + esc(t.name) + (who ? ' · ' + esc(who.name) : '') + '</div>' +
        '<div class="members"><div><span class="ms">schedule</span>' + esc(dayLabel(ymd(new Date(e.eventAt)))) + ' o ' + hm(e.eventAt) + '</div>' +
        (e.reminders.length ? '<div><span class="ms">notifications_active</span>Pripomenúť: ' + e.reminders.map((r) => REMINDERS[r]).join(', ') + '</div>' : '') +
        (e.cost ? '<div><span class="ms">payments</span>' + fmt(e.cost, 2) + ' €</div>' : '') +
        (e.notes ? '<div><span class="ms">notes</span>' + esc(e.notes) + '</div>' : '') + '</div>' +
        '<div class="pick-list"><a class="btn tonal" href="' + esc(gcal) + '" target="_blank" rel="noopener"><span class="ms">open_in_new</span>Pridať do Google Kalendára</a>' +
        '<button type="button" class="btn tonal" id="ics"><span class="ms">download</span>Stiahnuť do kalendára (.ics)</button></div>' +
        '<div class="actions"><button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' +
        '<button type="button" class="btn text" id="cancel">Zavrieť</button><button type="button" class="btn" id="edit"><span class="ms">edit</span>Upraviť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#edit').onclick = () => eventForm(who, e);
        root.querySelector('#ics').onclick = () => {
          const esc2 = (s) => String(s).replace(/[\\,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
          const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Family Grid//Zdravko//SK', 'BEGIN:VEVENT', 'UID:' + e.id + '@family-grid',
            'DTSTAMP:' + icsDate(new Date().toISOString()), 'DTSTART:' + icsDate(e.eventAt), 'DTEND:' + icsDate(end), 'SUMMARY:' + esc2(title),
            ...(details ? ['DESCRIPTION:' + esc2(details)] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
          a.download = 'zdravko-' + ymd(new Date(e.eventAt)) + '.ics';
          a.click();
        };
        root.querySelector('#del').onclick = async () => {
          if (!(await FG.confirmDialog('Vymazať udalosť?', esc(e.subtype) + ' – ' + dm(e.eventAt) + ' o ' + hm(e.eventAt), 'Vymazať', true))) return;
          act(() => api('zdravko/deleteRecord', e.id), 'Udalosť vymazaná');
        };
      },
      { focus: false }
    );
  }

  function eventForm(m, e) {
    let type = e ? e.eventType : 'doctor_visit';
    const day = S.calDay && S.calDay >= today() ? S.calDay : addDays(today(), 1);
    const at = e ? localInput(e.eventAt) : day + 'T09:00';
    openModal(
      '<h2>' + (e ? 'Upraviť udalosť' : 'Nová udalosť') + ' – ' + esc(m.name) + '</h2><form id="f">' +
        '<div class="chips zd-types">' + Object.entries(EVENT_TYPES).map(([k, v]) => '<button type="button" class="chip' + (k === type ? ' active' : '') + '" data-type="' + k + '"><span class="ms">' + v.icon + '</span>' + v.name + '</button>').join('') + '</div>' +
        '<div class="field"><label>Podtyp (lekár, vyšetrenie, očkovanie)</label><input name="subtype" list="subtypes" required maxlength="120" autocomplete="off" placeholder="Začni písať, napr. pediater" value="' + esc(e ? e.subtype : '') + '"><datalist id="subtypes"></datalist></div>' +
        '<div class="field"><label>Dátum a čas</label><input type="datetime-local" name="at" required value="' + at + '"></div>' +
        '<div class="field"><label>Pripomenúť (všetkým v rodine)</label><div class="chips wrap">' +
        Object.entries(REMINDERS).map(([k, v]) => '<label class="chip zd-check"><input type="checkbox" name="rem" value="' + k + '"' + (e && e.reminders.includes(k) ? ' checked' : !e && k === 'day_before' ? ' checked' : '') + '>' + v + '</label>').join('') + '</div></div>' +
        '<div class="row"><div class="field"><label>Cena (€, nepovinné)</label><input name="cost" inputmode="decimal" value="' + esc(e && e.cost ? fmt(e.cost, 2) : '') + '"></div></div>' +
        '<div class="field"><label>Poznámky</label><textarea name="notes" rows="2" maxlength="1000" placeholder="napr. vziať kartičku poistenca">' + esc(e ? e.notes : '') + '</textarea></div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Uložiť</button></div></form>',
      (root) => {
        const f = root.querySelector('#f');
        const fill = () => {
          root.querySelector('#subtypes').innerHTML = DATA.subtypes[type].map((n) => '<option value="' + esc(n) + '">').join('');
        };
        fill();
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelectorAll('[data-type]').forEach((b) => {
          b.onclick = () => {
            if (type !== b.dataset.type) f.subtype.value = '';
            type = b.dataset.type;
            root.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('active', x === b));
            fill();
          };
        });
        f.onsubmit = (ev) => {
          ev.preventDefault();
          act(
            () => api('zdravko/saveEvent', m.id, {
              id: e && e.id,
              eventType: type,
              subtype: f.subtype.value,
              eventAt: new Date(f.at.value).toISOString(),
              reminders: [...f.querySelectorAll('[name=rem]:checked')].map((x) => x.value),
              cost: f.cost.value,
              notes: f.notes.value,
            }),
            e ? 'Udalosť uložená' : 'Udalosť pridaná'
          );
        };
      },
      { focus: e ? false : '[name=subtype]' }
    );
  }

  // ---- Dávkovanie (ibuprofen, paracetamol) --------------------------------------------------------------

  const round05 = (v) => Math.round(v * 2) / 2;

  /** Výpočet ako v mobilnom Zdravkovi (assets/medication_dosages.json). */
  function dosage(medId, formId, concIdx, weight) {
    const med = DATA.dosages[medId];
    const form = med && med.forms[formId];
    if (!form) return 'Vyber liek a formu.';
    let w = weight;
    if (!(w > 0)) return 'Zadaj váhu dieťaťa.';
    if (formId === 'suppositories') w = Math.ceil(w);
    const every = medId === 'ibuprofen' ? 'každých 6 – 8 hodín' : 'každých 4 – 6 hodín';
    const match = (rules) => rules.find((r) => w >= r.minWeight && w <= r.maxWeight);
    if (form.weightBasedDosages) {
      const r = match(form.weightBasedDosages);
      return r ? med.name + ': ' + fmt(r.dose, 2) + ' ' + r.unit + ' ' + every : 'Váha ' + fmt(w) + ' kg nie je v podporovanom rozsahu pre túto formu.';
    }
    const conc = form.concentrations && form.concentrations[concIdx];
    if (!conc) return 'Vyber koncentráciu.';
    if (conc.weightBasedDosages) {
      const r = match(conc.weightBasedDosages);
      return r ? med.name + ': ' + fmt(r.dose, 2) + ' ' + r.unit + ' ' + every : 'Váha ' + fmt(w) + ' kg nie je v podporovanom rozsahu pre túto koncentráciu.';
    }
    const mg = round05(w * (medId === 'ibuprofen' ? 10 : 15));
    const ml = round05(mg / conc.value);
    return med.name + ': ' + fmt(mg) + ' mg (' + fmt(ml) + ' ml) ' + every;
  }

  function renderDosage(m, head) {
    const st = S.dose || (S.dose = { med: 'ibuprofen', form: 'syrup', conc: 0 });
    const weight = st.weight ?? m.weight ?? '';
    const med = DATA.dosages[st.med];
    const form = med.forms[st.form] || Object.values(med.forms)[0];
    $('view').innerHTML =
      head +
      '<div class="section-title zd-sec"><span class="ms">calculate</span>Kalkulačka dávkovania</div>' +
      '<div class="field"><label>Váha dieťaťa (kg)</label><input id="w" inputmode="decimal" value="' + esc(weight === '' ? '' : fmt(weight, 2)) + '"></div>' +
      '<div class="field"><label>Liek</label><div class="chips zd-seg">' + Object.entries(DATA.dosages).map(([k, v]) => '<button type="button" class="chip' + (k === st.med ? ' active' : '') + '" data-med="' + k + '">' + esc(v.name) + '</button>').join('') + '</div>' +
      '<div class="hint">' + esc(med.brands.join(', ')) + '</div></div>' +
      '<div class="field"><label>Forma</label><div class="chips zd-seg">' + Object.entries(med.forms).map(([k, v]) => '<button type="button" class="chip' + (k === st.form ? ' active' : '') + '" data-form="' + k + '">' + esc(v.name) + '</button>').join('') + '</div></div>' +
      (form.concentrations
        ? '<div class="field"><label>Koncentrácia</label><div class="chips wrap">' + form.concentrations.map((c, i) => '<button type="button" class="chip' + (i === st.conc ? ' active' : '') + '" data-conc="' + i + '">' + c.value + ' ' + esc(c.unit) + '</button>').join('') + '</div></div>'
        : '') +
      '<div class="zd-dose"><div class="muted">Odporúčané dávkovanie</div><b id="result"></b>' + (med.interval ? '<div class="hint">' + esc(med.interval) + '</div>' : '') + '</div>' +
      '<div class="grid-note">Len orientačne podľa príbalového letáku – pri pochybnostiach sa poraď s lekárom alebo lekárnikom. Ibuprofen a paracetamol sa môžu striedať (o 4 h ten druhý, o 8 h ten istý) – Zdravko pripomenie, keď podanie zapíšeš.</div>';
    const update = () => {
      const w = parseFloat(String($('w').value).replace(',', '.'));
      st.weight = Number.isFinite(w) ? w : '';
      $('result').textContent = dosage(st.med, st.form, st.conc, w);
    };
    $('w').oninput = update;
    update();
    $('view').querySelectorAll('[data-med]').forEach((b) => (b.onclick = () => {
      st.med = b.dataset.med;
      st.form = Object.keys(DATA.dosages[st.med].forms)[0];
      st.conc = 0;
      render();
    }));
    $('view').querySelectorAll('[data-form]').forEach((b) => (b.onclick = () => {
      st.form = b.dataset.form;
      st.conc = 0;
      render();
    }));
    $('view').querySelectorAll('[data-conc]').forEach((b) => (b.onclick = () => {
      st.conc = Number(b.dataset.conc);
      render();
    }));
    fab('');
  }

  // ---- Miery dieťaťa -----------------------------------------------------------------------------------

  function growthChart(list, key, unit, label) {
    const pts = list.filter((x) => x[key] !== null && x[key] !== undefined);
    if (pts.length < 2) return '';
    const W = 640;
    const H = 160;
    const L = 46;
    const R = 12;
    const T = 12;
    const B = 24;
    const t0 = parseYmd(pts[0].measuredAt).getTime();
    const t1 = parseYmd(pts[pts.length - 1].measuredAt).getTime() || t0 + 1;
    const vals = pts.map((x) => x[key]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad2 = (hi - lo) * 0.15 || 1;
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + ((hi + pad2 - v) / (hi - lo + 2 * pad2)) * (H - T - B);
    const line = pts.map((p) => x(parseYmd(p.measuredAt).getTime()).toFixed(1) + ',' + y(p[key]).toFixed(1)).join(' ');
    return (
      '<div class="zd-chart small"><div class="zd-chart-title">' + label + '</div><svg viewBox="0 0 ' + W + ' ' + H + '">' +
      '<text class="yl" x="' + (L - 6) + '" y="' + (y(hi) + 4) + '">' + fmt(hi, 2) + '</text><text class="yl" x="' + (L - 6) + '" y="' + (y(lo) + 4) + '">' + fmt(lo, 2) + '</text>' +
      '<text class="xl" x="' + L + '" y="' + (H - 6) + '" style="text-anchor:start">' + dmy(pts[0].measuredAt) + '</text>' +
      '<text class="xl" x="' + (W - R) + '" y="' + (H - 6) + '" style="text-anchor:end">' + dmy(pts[pts.length - 1].measuredAt) + '</text>' +
      '<polyline class="line growth" points="' + line + '"/>' +
      pts.map((p) => '<circle class="g" cx="' + x(parseYmd(p.measuredAt).getTime()).toFixed(1) + '" cy="' + y(p[key]).toFixed(1) + '" r="4"><title>' + dmy(p.measuredAt) + ': ' + fmt(p[key], 2) + ' ' + unit + '</title></circle>').join('') +
      '</svg></div>'
    );
  }

  function renderGrowth(m, head) {
    const list = S.data.measurements.filter((x) => x.memberId === m.id).sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
    $('view').innerHTML =
      head +
      growthChart(list, 'weight', 'kg', 'Váha (kg)') +
      growthChart(list, 'height', 'cm', 'Výška (cm)') +
      '<div class="section-title zd-sec"><span class="ms">straighten</span>Merania</div>' +
      (list.length
        ? [...list].reverse().map((x) =>
            '<div class="card zd-meas"><div class="card-body"><div class="card-title">' + dmy(x.measuredAt) + ' <span class="muted">· ' + esc(age(m.birthDate, x.measuredAt)) + '</span></div>' +
            '<div class="card-sub">' + [x.weight ? Math.round(x.weight * 1000) + ' g' : '', x.height ? fmt(x.height) + ' cm' : '', x.head ? 'hlavička ' + fmt(x.head) + ' cm' : ''].filter(Boolean).join(' · ') + '</div></div>' +
            '<button type="button" class="icon-btn" data-cur="' + esc(x.id) + '" title="Nastaviť ako aktuálne"><span class="ms">check_circle</span></button>' +
            '<button type="button" class="icon-btn" data-edit="' + esc(x.id) + '" title="Upraviť"><span class="ms">edit</span></button></div>').join('')
        : '<div class="empty compact"><span class="ms">monitor_weight</span><div>Zatiaľ žiadne merania. Zapíš váhu, výšku a obvod hlavičky (napr. z poradne).</div></div>');
    $('view').querySelectorAll('[data-cur]').forEach((b) => {
      b.onclick = async () => {
        if (!(await FG.confirmDialog('Nastaviť ako aktuálne?', 'Váha a výška z tohto merania sa uložia ako aktuálne údaje dieťaťa.', 'Nastaviť'))) return;
        act(() => api('zdravko/setCurrentMeasurement', b.dataset.cur), 'Váha a výška dieťaťa aktualizované');
      };
    });
    $('view').querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => measurementForm(m, S.data.measurements.find((x) => x.id === b.dataset.edit))));
    fab('<button type="button" class="btn" id="addMeas"><span class="ms">add</span>Meranie</button>', (el) => {
      el.querySelector('#addMeas').onclick = () => measurementForm(m, null);
    });
  }

  function measurementForm(m, x) {
    openModal(
      '<h2>' + (x ? 'Upraviť meranie' : 'Nové meranie') + ' – ' + esc(m.name) + '</h2><form id="f">' +
        '<div class="field"><label>Dátum</label><input type="date" name="date" required max="' + today() + '" value="' + (x ? x.measuredAt : today()) + '"></div>' +
        '<div class="row"><div class="field"><label>Váha (g)</label><input name="grams" inputmode="numeric" value="' + (x && x.weight ? Math.round(x.weight * 1000) : '') + '" placeholder="napr. 7850"></div>' +
        '<div class="field"><label>Výška (cm)</label><input name="height" inputmode="decimal" value="' + esc(x && x.height ? fmt(x.height) : '') + '"></div></div>' +
        '<div class="field"><label>Obvod hlavičky (cm, nepovinné)</label><input name="head" inputmode="decimal" value="' + esc(x && x.head ? fmt(x.head) : '') + '"></div>' +
        '<div class="actions">' + (x ? '<button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' : '') +
        '<button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">Uložiť</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        const del = root.querySelector('#del');
        if (del) {
          del.onclick = async () => {
            if (!(await FG.confirmDialog('Vymazať meranie?', '', 'Vymazať', true))) return;
            act(() => api('zdravko/deleteMeasurement', x.id), 'Meranie vymazané');
          };
        }
        root.querySelector('#f').onsubmit = (e) => {
          e.preventDefault();
          const f = e.target;
          const grams = parseFloat(String(f.grams.value).replace(',', '.'));
          act(
            () => api('zdravko/saveMeasurement', m.id, {
              id: x && x.id,
              measuredAt: f.date.value,
              weight: Number.isFinite(grams) ? grams / 1000 : null,
              height: f.height.value,
              head: f.head.value,
            }),
            'Meranie uložené'
          );
        };
      }
    );
  }

  // ---- Prenos z mobilného Zdravka ---------------------------------------------------------------------

  function importDialog() {
    const h = FG.currentHousehold();
    openModal(
      '<h2>Preniesť z mobilného Zdravka</h2>' +
        '<div class="subtitle">Prenesie členov rodiny, záznamy choroby (teplota, lieky, zábaly), udalosti u lekára s pripomienkami a miery detí ' +
        'z aplikácie Zdravko v telefóne do rodiny <b>' + esc(h ? h.name : '') + '</b>. Použije sa účet Zdravka s e-mailom <b>' + esc(FG.state.email) + '</b>.</div>' +
        '<ol class="steps"><li>Dá sa zopakovať – nič sa nezdvojí.</li><li>Záznamy vymazaných členov (mobilný Zdravko ich nechal vo Firebase) sa nepreniesú.</li></ol>' +
        '<button type="button" class="btn text" id="other" style="padding-left:0"><span class="ms">swap_horiz</span>Zdravko v telefóne má iný Google účet</button>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button type="button" class="btn" id="go"><span class="ms">sync</span>Preniesť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#other').onclick = () => FG.otherAccountImport('Zdravko', runImport);
        root.querySelector('#go').onclick = () => {
          closeModal();
          runImport();
        };
      },
      { focus: false }
    );
  }

  /** credential = Google ID token iného účtu (inak účet prihláseného). */
  async function runImport(credential) {
    try {
      const res = await api('zdravko/importFirebase', S.hh, credential || null);
      await load(true);
      render();
      toast(res.members
        ? 'Prenesené: ' + plural(res.members, 'člen', 'členovia', 'členov') + ', ' + plural(res.records, 'záznam', 'záznamy', 'záznamov') + ', ' + plural(res.measurements, 'meranie', 'merania', 'meraní')
        : 'V mobilnom Zdravkovi nie sú žiadni členovia rodiny.');
    } catch (err) {
      showError(err);
    }
  }

  // ---- Štart ---------------------------------------------------------------------------------------------

  async function start() {
    const h = FG.currentHousehold();
    S.hh = h ? h.id : null;
    if (!S.hh) return render();
    FG.setHousehold(S.hh);
    if (!S.data || S.data.householdId !== S.hh) S.data = FG.readJson(snapKey());
    reopenLast();
    render();
    try {
      await load(Boolean(S.data));
      render();
    } catch (err) {
      if (err.offline && S.data) toast('Bez internetu – ukazujem posledné uložené údaje');
      else if (!FG.isLoginRequired(err)) showError(err);
    }
  }

  S.view = history.state && history.state.name ? history.state : { name: 'home', tab: 'members' };
  history.replaceState(S.view, '');
  let reopened = Boolean(history.state && history.state.name === 'member'); // obnovená stránka už osobu má

  /**
   * Pri otvorení Zdravka rovno naposledy otvorená osoba (raz, nie pri prepnutí rodiny).
   * Pod ňou ostane zoznam rodiny, takže Späť vedie na členov.
   */
  function reopenLast() {
    if (reopened || S.view.name !== 'home') return;
    reopened = true;
    const last = FG.readJson(lastKey());
    if (!last || !last.memberId) return;
    S.view = { name: 'member', memberId: last.memberId, tab: last.tab || 'sick' };
    history.pushState(S.view, '');
  }

  FG.start({
    onReady: () => start(),
    accountExtra: () => [
      '<button type="button" class="btn tonal small" id="zdImport" style="margin:4px 0 12px"><span class="ms">sync</span>Preniesť z mobilného Zdravka</button>',
      (root) => {
        root.querySelector('#zdImport').onclick = () => {
          if (!S.hh) return toast('Najprv vytvor rodinu.', true);
          importDialog();
        };
      },
    ],
  });
})();
