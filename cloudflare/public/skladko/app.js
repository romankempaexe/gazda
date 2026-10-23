// Skládko – čo máme doma a kde to je. Podaplikácia Family Grid.
//
// Celý inventár rodiny sa načíta naraz (skladko/getData) a v prehliadači sa v ňom
// prechádza, hľadá a filtruje. Zmeny idú na server po jednej a každých pár sekúnd
// sa overí verzia (getRev) – zmeny od ostatných členov rodiny sa ukážu samé.

(function () {
  const { $, esc, api, apiQuiet, toast, showError, openModal, closeModal, modalOpen } = FG;

  // ---- Ikony ---------------------------------------------------------------------

  const ICON_CATS = {
    Jedlo: ['restaurant', 'local_dining', 'restaurant_menu', 'fastfood', 'lunch_dining', 'local_pizza', 'bakery_dining', 'breakfast_dining', 'brunch_dining', 'dinner_dining', 'ramen_dining', 'rice_bowl', 'soup_kitchen', 'set_meal', 'takeout_dining', 'tapas', 'egg', 'nutrition', 'grocery', 'food_bank', 'icecream', 'cake', 'cookie'],
    Nápoje: ['local_drink', 'emoji_food_beverage', 'coffee', 'local_cafe', 'free_breakfast', 'water_drop', 'sports_bar', 'wine_bar', 'local_bar', 'liquor', 'water_full'],
    Kuchyňa: ['kitchen', 'countertops', 'blender', 'microwave', 'oven_gen', 'skillet', 'cooking', 'flatware', 'dining', 'coffee_maker', 'kettle', 'cut', 'dishwasher_gen'],
    Čistenie: ['cleaning_services', 'sanitizer', 'soap', 'wash', 'local_laundry_service', 'dry', 'dry_cleaning', 'science', 'air', 'recycling', 'delete'],
    'Hygiena a lieky': ['health_and_safety', 'shower', 'bathtub', 'spa', 'face', 'content_cut', 'medication', 'medical_services', 'healing', 'vaccines', 'monitor_heart', 'thermostat', 'device_thermostat', 'masks', 'local_pharmacy', 'emergency'],
    Deti: ['child_care', 'baby_changing_station', 'toys', 'stroller'],
    Elektronika: ['phone_android', 'computer', 'laptop', 'tv', 'headphones', 'speaker', 'camera', 'videocam', 'tablet', 'watch', 'memory', 'sd_card', 'usb', 'power', 'battery_full', 'cable', 'lightbulb'],
    Oblečenie: ['checkroom', 'styler', 'apparel', 'shopping_bag', 'footprint'],
    Náradie: ['build', 'construction', 'engineering', 'handyman', 'plumbing', 'carpenter', 'electric_bolt', 'hardware', 'precision_manufacturing', 'settings', 'straighten', 'square_foot', 'roofing'],
    'Záhrada a šport': ['grass', 'local_florist', 'park', 'nature', 'forest', 'eco', 'compost', 'deck', 'outdoor_grill', 'camping', 'hiking', 'pool', 'sports_soccer', 'sports_tennis', 'fitness_center', 'directions_bike'],
    Domácnosť: ['home', 'house', 'apartment', 'cottage', 'garage', 'chair', 'bed', 'table_restaurant', 'weekend', 'door_front', 'window', 'stairs', 'balcony'],
    'Knihy a hry': ['menu_book', 'library_books', 'book', 'auto_stories', 'school', 'music_note', 'movie', 'extension', 'sports_esports', 'palette'],
    Uskladnenie: ['inventory', 'inventory_2', 'warehouse', 'store', 'storefront', 'archive', 'folder', 'folder_open', 'shelves', 'package_2', 'deployed_code', 'luggage', 'ac_unit', 'kitchen'],
  };
  const WAREHOUSE_ICONS = ['warehouse', 'inventory', 'inventory_2', 'store', 'business', 'factory', 'home_work', 'garage', 'archive', 'folder', 'storage', 'kitchen', 'home', 'apartment', 'cabin', 'house', 'villa', 'bungalow', 'chalet', 'roofing', 'foundation', 'construction', 'build', 'handyman', 'plumbing', 'balcony', 'ac_unit', 'wine_bar', 'desk', 'meeting_room', 'spa', 'fitness_center', 'pool', 'local_bar', 'local_cafe', 'restaurant', 'medical_services', 'medication', 'shelves', 'package_2', 'luggage', 'door_front', 'stairs', 'bed'];

  // Predvolené sklady (ako v mobilnom Skládku).
  const PRESETS = [
    ['pantry', 'Špajza', 'inventory_2'],
    ['kitchen_cabinet', 'Kuchynská skrinka', 'kitchen'],
    ['fridge', 'Chladnička', 'kitchen'],
    ['freezer', 'Mraznička', 'ac_unit'],
    ['cellar', 'Pivnica', 'home_work'],
    ['garage', 'Garáž', 'garage'],
    ['balcony', 'Balkón', 'balcony'],
    ['storage_room', 'Komora', 'inventory'],
    ['attic', 'Povala', 'roofing'],
    ['utility_room', 'Technická miestnosť', 'build'],
    ['wine_cellar', 'Vinotéka', 'wine_bar'],
    ['office', 'Pracovňa', 'desk'],
  ];

  // Ikony, ktoré stránka načítala (zoznam v adrese písma) – neznáme sa nahradia, nech nevidno text.
  const KNOWN = new Set(
    (new URL(document.querySelector('link[href*="icon_names"]').href).searchParams.get('icon_names') || '').split(',')
  );
  const iconName = (name, fallback = 'inventory_2') => (KNOWN.has(name) ? name : fallback);
  const ic = (name, fallback) => '<span class="ms">' + iconName(name, fallback) + '</span>';

  // ---- Stav ---------------------------------------------------------------------------

  const S = {
    hh: null, // id rodiny
    data: null, // { warehouses, groups, items, shopping, rev }
    view: { name: 'home' },
    moving: null, // { kind: 'item' | 'group', id, name }
    lowThreshold: 5,
    expDays: 7,
  };

  const snapKey = () => 'skladko.snap.' + S.hh;

  function saveSnapshot() {
    try {
      localStorage.setItem(snapKey(), JSON.stringify(S.data));
    } catch (e) {
      // plná pamäť – nevadí
    }
  }

  // ---- Pomocné ----------------------------------------------------------------------------

  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  function todayYmd() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function daysUntil(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const [ty, tm, td] = todayYmd().split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
  }

  function shortDate(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return d + '. ' + m + '. ' + (y !== new Date().getFullYear() ? y : '');
  }

  /** Stav trvanlivosti: { cls, text } alebo null. */
  function expiry(item) {
    if (!item.expirationDate) return null;
    const n = daysUntil(item.expirationDate);
    if (n < 0) return { cls: 'bad', text: 'Prešla ' + shortDate(item.expirationDate).trim() };
    if (n === 0) return { cls: 'bad', text: 'Dnes' };
    if (n === 1) return { cls: 'warn', text: 'Zajtra' };
    if (n <= 7) return { cls: 'warn', text: 'O ' + n + ' dní' };
    return { cls: 'ok', text: shortDate(item.expirationDate).trim() };
  }

  const isLow = (i) => i.minQty > 0 && i.quantity <= i.minQty;

  function plural(n, one, few, many) {
    return n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
  }

  const warehouse = (id) => S.data.warehouses.find((w) => w.id === id);
  const group = (id) => S.data.groups.find((g) => g.id === id);
  const item = (id) => S.data.items.find((i) => i.id === id);

  /** Cesta: [sklad, skupina, podskupina, …] */
  function pathOf(warehouseId, groupId) {
    const out = [];
    let g = groupId ? group(groupId) : null;
    const seen = new Set();
    while (g && !seen.has(g.id)) {
      seen.add(g.id);
      out.unshift(g);
      g = g.parentId ? group(g.parentId) : null;
    }
    const w = warehouse(warehouseId);
    return w ? [w, ...out] : out;
  }

  const pathText = (warehouseId, groupId) => pathOf(warehouseId, groupId).map((x) => x.name).join(' › ');

  /** Všetky skupiny pod skupinou (do hĺbky) vrátane nej. */
  function subtree(groupId) {
    const ids = new Set([groupId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of S.data.groups) {
        if (g.parentId && ids.has(g.parentId) && !ids.has(g.id)) {
          ids.add(g.id);
          grew = true;
        }
      }
    }
    return ids;
  }

  // ---- Navigácia (tlačidlo Späť v telefóne funguje) ------------------------------------------

  function go(view, replace) {
    S.view = view;
    if (replace) history.replaceState(view, '');
    else history.pushState(view, '');
    render();
    window.scrollTo(0, 0);
  }

  window.addEventListener('popstate', (e) => {
    if (modalOpen()) closeModal(true);
    S.view = e.state && e.state.name ? e.state : { name: 'home' };
    render();
  });

  function back() {
    if (history.state && history.state.name && history.state.name !== 'home') history.back();
    else go({ name: 'home' }, true);
  }

  // ---- Načítanie ------------------------------------------------------------------------------

  async function load(quiet) {
    if (!S.hh) return;
    const fresh = await (quiet ? apiQuiet : api)('skladko/getData', S.hh);
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
      const rev = await apiQuiet('skladko/getRev', S.hh);
      if (rev !== S.data.rev) await reload();
    } catch (e) {
      // obnova na pozadí je nepovinná
    } finally {
      checking = false;
    }
  }
  setInterval(checkRev, 8000);
  document.addEventListener('visibilitychange', () => !document.hidden && checkRev());

  /** Uloží zmenu a obnoví údaje (prekreslí obrazovku). */
  async function act(fn, ok) {
    try {
      const res = await fn();
      await load(true);
      render();
      if (ok) toast(typeof ok === 'function' ? ok(res) : ok);
      return res;
    } catch (err) {
      showError(err);
      return null;
    }
  }

  // ---- Vykreslenie ------------------------------------------------------------------------------

  function header(title, showBack) {
    $('title').textContent = title;
    $('backBtn').classList.toggle('hidden', !showBack);
    $('brand').classList.toggle('hidden', showBack);
    const ready = Boolean(S.data);
    $('searchBtn').classList.toggle('hidden', !ready);
    $('filterBtn').classList.toggle('hidden', !ready);
  }

  function render() {
    const v = S.view;
    if (!S.hh) return renderNoFamily();
    if (!S.data) {
      $('view').innerHTML = '<div class="center muted">Načítavam…</div>';
      return;
    }
    if (v.name === 'place') {
      if (!warehouse(v.warehouseId) || (v.groupId && !group(v.groupId))) return go({ name: 'home' }, true);
      return renderPlace(v.warehouseId, v.groupId || '');
    }
    if (v.name === 'search') return renderSearch();
    if (v.name === 'filter') return renderFilter();
    renderHome();
  }

  function renderNoFamily() {
    header('Skládko', false);
    $('fab').classList.add('hidden');
    $('view').innerHTML = FG.emptyFamilyHtml('Sklady a veci v nich');
    FG.bindEmptyFamily(() => start());
  }

  function fab(html) {
    const el = $('fab');
    if (S.moving) {
      el.innerHTML =
        '<button type="button" class="btn text sk-cancel" id="cancelMove"><span class="ms">close</span>Zrušiť</button>' +
        (S.view.name === 'place'
          ? '<button type="button" class="btn" id="paste"><span class="ms">content_paste</span>Vložiť sem</button>'
          : '');
      el.classList.remove('hidden');
      el.querySelector('#cancelMove').onclick = () => {
        S.moving = null;
        render();
      };
      const paste = el.querySelector('#paste');
      if (paste) paste.onclick = pasteHere;
      return;
    }
    el.innerHTML = html || '';
    el.classList.toggle('hidden', !html);
  }

  function movingBar() {
    if (!S.moving) return '';
    return (
      '<div class="sk-moving"><span class="ms">content_cut</span><div><b>Presúvaš: ' + esc(S.moving.name) + '</b>' +
      'Otvor sklad alebo skupinu, kam to patrí, a ťukni <b>Vložiť sem</b>.</div></div>'
    );
  }

  function importBanner() {
    const n = S.data.items.filter((i) => i.importImage).length;
    if (!n) return '';
    return (
      '<div class="sk-moving"><span class="ms">photo_library</span><div><b>' + plural(n, 'fotka čaká', 'fotky čakajú', 'fotiek čaká') +
      ' na prenos</b>z mobilného Skládka.</div><button type="button" class="btn small" id="resumeImages">Preniesť</button></div>'
    );
  }

  function bindImportBanner() {
    const b = $('resumeImages');
    if (b) b.onclick = () => transferImages();
  }

  // ---- Domov: sklady ------------------------------------------------------------------------------

  function renderHome() {
    header('Skládko', false);
    const d = S.data;
    const cards = d.warehouses
      .map((w) => {
        const items = d.items.filter((i) => i.warehouseId === w.id);
        const warn = items.filter((i) => isLow(i) || (i.expirationDate && daysUntil(i.expirationDate) <= 7)).length;
        return (
          '<div class="sk-card place" data-w="' + esc(w.id) + '">' +
          '<button type="button" class="icon-btn small sk-more" data-wmenu="' + esc(w.id) + '" title="Možnosti"><span class="ms">more_vert</span></button>' +
          '<div class="sk-icon">' + ic(w.icon, 'location_on') + '</div>' +
          '<div class="sk-name">' + esc(w.name) + '</div>' +
          '<div class="sk-sub">' + plural(items.length, 'vec', 'veci', 'vecí') + '</div>' +
          (warn ? '<span class="sk-flag" title="Dochádza alebo končí trvanlivosť">' + warn + '</span>' : '') +
          '</div>'
        );
      })
      .join('');
    $('view').innerHTML =
      FG.householdPickerHtml() + movingBar() + importBanner() +
      '<div class="page-head"><h2>Moje sklady</h2><p>' +
      (d.warehouses.length ? plural(d.items.length, 'vec', 'veci', 'vecí') + ' v ' + plural(d.warehouses.length, 'sklade', 'skladoch', 'skladoch') : 'Začni pridaním skladu – špajza, chladnička, garáž…') +
      '</p></div>' +
      '<div class="sk-grid">' + cards +
      '<button type="button" class="sk-card add" id="addWarehouse"><span class="ms">add</span><div class="sk-name">Pridať sklad</div></button></div>' +
      (d.warehouses.length ? '' : '<div class="grid-note">Máš veci v mobilnom Skládku? Prenesieš ich v <b>Môj účet</b> → <b>Preniesť z mobilného Skládka</b>.</div>');
    FG.bindHouseholdPicker((id) => {
      S.hh = id;
      S.data = FG.readJson(snapKey());
      render();
      reload();
    });
    bindImportBanner();
    $('addWarehouse').onclick = () => warehouseForm();
    $('view').querySelectorAll('[data-w]').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('[data-wmenu]')) return;
        go({ name: 'place', warehouseId: el.dataset.w, groupId: '' });
      };
    });
    $('view').querySelectorAll('[data-wmenu]').forEach((b) => {
      b.onclick = () => warehouseMenu(warehouse(b.dataset.wmenu));
    });
    fab('');
  }

  function warehouseMenu(w) {
    openModal(
      '<h2>' + esc(w.name) + '</h2><div class="pick-list">' +
        '<button type="button" class="btn tonal" id="edit"><span class="ms">edit</span>Upraviť</button>' +
        '<button type="button" class="btn tonal danger-text" id="del"><span class="ms">delete</span>Vymazať sklad</button></div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zavrieť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#edit').onclick = () => warehouseForm(w);
        root.querySelector('#del').onclick = async () => {
          const n = S.data.items.filter((i) => i.warehouseId === w.id).length;
          if (!(await FG.confirmDialog('Vymazať sklad „' + w.name + '“?', 'Vymažú sa aj všetky jeho skupiny a ' + plural(n, 'vec', 'veci', 'vecí') + '. Nedá sa to vrátiť.', 'Vymazať', true))) return;
          act(() => api('skladko/deleteWarehouse', w.id), 'Sklad vymazaný');
        };
      },
      { focus: false }
    );
  }

  function iconGridHtml(icons, selected) {
    return (
      '<div class="icon-grid sk-icons">' +
      icons.map((n) => '<button type="button" data-icon="' + n + '" class="' + (n === selected ? 'selected' : '') + '" title="' + n + '"><span class="ms">' + n + '</span></button>').join('') +
      '</div>'
    );
  }

  function bindIconGrid(root, onPick) {
    root.querySelectorAll('[data-icon]').forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('selected', x === b));
        onPick(b.dataset.icon);
      };
    });
  }

  function warehouseForm(w) {
    let icon = w ? iconName(w.icon, 'inventory_2') : 'inventory_2';
    let locationId = w ? w.locationId : '';
    openModal(
      '<h2>' + (w ? 'Upraviť sklad' : 'Nový sklad') + '</h2>' +
        (w ? '' : '<div class="subtitle">Vyber hotový alebo zadaj vlastný názov.</div><div class="chips sk-presets">' +
          PRESETS.map(([id, name, ic2]) => '<button type="button" class="chip" data-preset="' + id + '"><span class="ms">' + ic2 + '</span>' + esc(name) + '</button>').join('') + '</div>') +
        '<form id="f"><div class="field"><label>Názov skladu</label><input name="name" required maxlength="80" value="' + esc(w ? w.name : '') + '" placeholder="napr. Špajza"></div>' +
        '<div class="field"><label>Ikona</label>' + iconGridHtml(WAREHOUSE_ICONS, icon) + '</div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">' + (w ? 'Uložiť' : 'Pridať') + '</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        bindIconGrid(root, (n) => (icon = n));
        root.querySelectorAll('[data-preset]').forEach((b) => {
          b.onclick = () => {
            const p = PRESETS.find((x) => x[0] === b.dataset.preset);
            root.querySelector('[name=name]').value = p[1];
            locationId = p[0];
            icon = p[2];
            root.querySelectorAll('[data-icon]').forEach((x) => x.classList.toggle('selected', x.dataset.icon === icon));
            root.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('active', x === b));
          };
        });
        root.querySelector('#f').onsubmit = async (e) => {
          e.preventDefault();
          const name = e.target.name.value;
          closeModal();
          await act(() => api('skladko/saveWarehouse', S.hh, { id: w && w.id, name, icon, locationId }), w ? 'Sklad uložený' : 'Sklad pridaný');
        };
      },
      { focus: w ? true : false }
    );
  }

  // ---- Sklad / skupina ------------------------------------------------------------------------------

  function itemCard(i, showPath) {
    const e = expiry(i);
    return (
      '<div class="sk-card item' + (i.quantity === 0 ? ' empty-qty' : '') + '" data-item="' + esc(i.id) + '">' +
      (e ? '<span class="sk-exp ' + e.cls + '">' + esc(e.text) + '</span>' : '') +
      '<span class="sk-qty' + (isLow(i) ? ' low' : '') + '">' + i.quantity + '</span>' +
      (i.image ? '<img class="sk-photo" src="' + esc(i.image) + '" alt="" loading="lazy">' : '<div class="sk-icon round">' + ic(i.icon) + '</div>') +
      '<div class="sk-name">' + esc(i.name) + '</div>' +
      (showPath ? '<div class="sk-sub">' + esc(pathText(i.warehouseId, i.groupId)) + '</div>' : i.description ? '<div class="sk-sub">' + esc(i.description) + '</div>' : '') +
      '<div class="sk-steps"><button type="button" class="sk-step" data-step="-1" ' + (i.quantity <= 0 ? 'disabled' : '') + ' title="Ubrať"><span class="ms">remove</span></button>' +
      '<button type="button" class="sk-step" data-step="1" title="Pridať"><span class="ms">add</span></button></div>' +
      '</div>'
    );
  }

  function groupCard(g) {
    const subs = S.data.groups.filter((x) => x.parentId === g.id).length;
    const items = S.data.items.filter((x) => x.groupId === g.id).length;
    return (
      '<div class="sk-card group" data-group="' + esc(g.id) + '">' +
      '<button type="button" class="icon-btn small sk-more" data-gmenu="' + esc(g.id) + '" title="Možnosti"><span class="ms">more_vert</span></button>' +
      '<div class="sk-icon">' + ic(g.icon, 'folder') + '</div>' +
      '<div class="sk-name">' + esc(g.name) + '</div>' +
      '<div class="sk-sub">' + [subs ? plural(subs, 'skupina', 'skupiny', 'skupín') : '', plural(items, 'vec', 'veci', 'vecí')].filter(Boolean).join(', ') + '</div></div>'
    );
  }

  function bindCards(root) {
    root.querySelectorAll('[data-item]').forEach((el) => {
      el.onclick = (e) => {
        const step = e.target.closest('[data-step]');
        const it = item(el.dataset.item);
        if (!it) return;
        if (step) return changeQty(it, Number(step.dataset.step));
        if (e.target.closest('.sk-photo')) return zoomImage(it.image);
        itemDetail(it);
      };
    });
    root.querySelectorAll('[data-group]').forEach((el) => {
      el.onclick = (e) => {
        const g = group(el.dataset.group);
        if (e.target.closest('[data-gmenu]')) return groupMenu(g);
        go({ name: 'place', warehouseId: g.warehouseId, groupId: g.id });
      };
    });
  }

  function renderPlace(warehouseId, groupId) {
    const path = pathOf(warehouseId, groupId);
    const here = path[path.length - 1];
    header(here.name, true);
    const groups = S.data.groups.filter((g) => g.warehouseId === warehouseId && g.parentId === groupId);
    const items = S.data.items.filter((i) => i.warehouseId === warehouseId && i.groupId === groupId);
    const crumbs = path
      .map((p, idx) =>
        idx === path.length - 1
          ? '<span>' + esc(p.name) + '</span>'
          : '<a href="#" data-crumb="' + idx + '">' + esc(p.name) + '</a>')
      .join('<span class="ms">chevron_right</span>');
    $('view').innerHTML =
      movingBar() +
      '<div class="sk-crumbs"><a href="#" data-crumb="home">Sklady</a><span class="ms">chevron_right</span>' + crumbs + '</div>' +
      (groups.length || items.length
        ? '<div class="sk-grid">' + groups.map(groupCard).join('') + items.map((i) => itemCard(i)).join('') + '</div>'
        : '<div class="empty"><span class="ms">inventory_2</span><h2>' + (groupId ? 'Skupina je prázdna' : 'Sklad je prázdny') + '</h2>' +
          '<div>Pridaj vec alebo skupinu (napr. „Konzervy“, „Horná polica“) tlačidlami dole.</div></div>');
    $('view').querySelectorAll('[data-crumb]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const c = a.dataset.crumb;
        if (c === 'home') return go({ name: 'home' });
        const p = path[Number(c)];
        go({ name: 'place', warehouseId, groupId: Number(c) === 0 ? '' : p.id });
      };
    });
    bindCards($('view'));
    fab(
      '<button type="button" class="btn tonal" id="addGroup"><span class="ms">create_new_folder</span>Skupina</button>' +
        '<button type="button" class="btn" id="addItem"><span class="ms">add</span>Vec</button>'
    );
    if (!S.moving) {
      $('addGroup').onclick = () => groupForm(null, warehouseId, groupId);
      $('addItem').onclick = () => itemForm(null, warehouseId, groupId);
    }
  }

  function groupMenu(g) {
    openModal(
      '<h2>' + esc(g.name) + '</h2><div class="subtitle">' + esc(pathText(g.warehouseId, g.parentId)) + '</div><div class="pick-list">' +
        '<button type="button" class="btn tonal" id="edit"><span class="ms">edit</span>Upraviť</button>' +
        '<button type="button" class="btn tonal" id="move"><span class="ms">content_cut</span>Presunúť</button>' +
        '<button type="button" class="btn tonal danger-text" id="del"><span class="ms">delete</span>Vymazať skupinu</button></div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zavrieť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#edit').onclick = () => groupForm(g);
        root.querySelector('#move').onclick = () => startMove('group', g);
        root.querySelector('#del').onclick = async () => {
          const ids = subtree(g.id);
          const n = S.data.items.filter((i) => ids.has(i.groupId)).length;
          const subs = ids.size - 1;
          const what = [subs ? plural(subs, 'podskupina', 'podskupiny', 'podskupín') : '', n ? plural(n, 'vec', 'veci', 'vecí') : ''].filter(Boolean).join(' a ');
          if (!(await FG.confirmDialog('Vymazať skupinu „' + g.name + '“?', what ? 'Vymaže sa aj všetko v nej: ' + what + '.' : 'Skupina je prázdna.', 'Vymazať', true))) return;
          act(() => api('skladko/deleteGroup', g.id), 'Skupina vymazaná');
        };
      },
      { focus: false }
    );
  }

  function groupForm(g, warehouseId, parentId) {
    let icon = g ? iconName(g.icon, 'folder') : 'folder';
    openModal(
      '<h2>' + (g ? 'Upraviť skupinu' : 'Nová skupina') + '</h2>' +
        '<form id="f"><div class="field"><label>Názov skupiny</label><input name="name" required maxlength="80" value="' + esc(g ? g.name : '') + '" placeholder="napr. Konzervy, Horná polica"></div>' +
        '<div class="field"><label>Ikona</label>' + iconPickerHtml(icon) + '</div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">' + (g ? 'Uložiť' : 'Vytvoriť') + '</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        bindIconPicker(root, (n) => (icon = n));
        root.querySelector('#f').onsubmit = (e) => {
          e.preventDefault();
          const name = e.target.name.value;
          closeModal();
          act(() => api('skladko/saveGroup', { id: g && g.id, warehouseId, parentId, name, icon }), g ? 'Skupina uložená' : 'Skupina vytvorená');
        };
      }
    );
  }

  /** Výber ikony po kategóriách (Jedlo, Nápoje, …). */
  function iconPickerHtml(selected) {
    const cats = Object.keys(ICON_CATS);
    const start = cats.find((c) => ICON_CATS[c].includes(selected)) || 'Uskladnenie';
    return (
      '<div class="chips sk-cats">' + cats.map((c) => '<button type="button" class="chip' + (c === start ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
      '<div id="iconGrid" data-selected="' + esc(selected) + '">' + iconGridHtml(ICON_CATS[start], selected) + '</div>'
    );
  }

  function bindIconPicker(root, onPick) {
    const box = root.querySelector('#iconGrid');
    const bind = () => bindIconGrid(box, (n) => {
      box.dataset.selected = n;
      onPick(n);
    });
    bind();
    root.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = () => {
        root.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('active', x === b));
        box.innerHTML = iconGridHtml(ICON_CATS[b.dataset.cat], box.dataset.selected);
        bind();
      };
    });
  }

  // ---- Položky ------------------------------------------------------------------------------

  const pendingQty = new Map(); // id → zmena, ktorá ešte nedorazila na server

  async function changeQty(it, delta) {
    if (it.quantity + delta < 0) return;
    it.quantity += delta; // hneď na obrazovke
    pendingQty.set(it.id, (pendingQty.get(it.id) || 0) + delta);
    render();
    try {
      const saved = await apiQuiet('skladko/changeQuantity', it.id, delta);
      pendingQty.set(it.id, pendingQty.get(it.id) - delta);
      if (!pendingQty.get(it.id)) {
        pendingQty.delete(it.id);
        Object.assign(it, saved);
        if (!modalOpen()) render();
      }
      if (delta < 0 && isLow(saved) && saved.quantity === saved.minQty) toast('„' + saved.name + '“ dochádza – pridaj do nákupu cez detail');
    } catch (err) {
      pendingQty.delete(it.id);
      showError(err);
      reload();
    }
  }

  function zoomImage(src) {
    const el = document.createElement('div');
    el.className = 'img-preview';
    el.innerHTML = '<img src="' + esc(src) + '" alt="">';
    el.onclick = () => el.remove();
    document.body.append(el);
  }

  function itemDetail(it) {
    const e = expiry(it);
    openModal(
      '<div class="sk-detail">' +
        (it.image ? '<img class="sk-detail-photo" src="' + esc(it.image) + '" alt="">' : '<div class="sk-icon big">' + ic(it.icon) + '</div>') +
        '<h2>' + esc(it.name) + '</h2><div class="subtitle">' + esc(pathText(it.warehouseId, it.groupId)) + '</div></div>' +
        '<div class="members">' +
        '<div><span class="ms">inventory_2</span>Množstvo: <b>' + it.quantity + '</b>' + (it.minQty ? ' · dochádza pri ' + it.minQty : '') + '</div>' +
        (e ? '<div><span class="ms">hourglass_bottom</span>Spotrebovať do: <b>' + esc(shortDate(it.expirationDate)) + '</b> (' + esc(e.text.toLowerCase()) + ')</div>' : '') +
        (it.description ? '<div><span class="ms">notes</span>' + esc(it.description) + '</div>' : '') +
        '</div>' +
        '<div class="pick-list">' +
        '<button type="button" class="btn tonal" id="shop"><span class="ms">add_shopping_cart</span>Do nákupu v Gazde</button>' +
        '<button type="button" class="btn tonal" id="move"><span class="ms">content_cut</span>Presunúť</button></div>' +
        '<div class="actions"><button type="button" class="btn text danger-text" id="del" style="margin-right:auto"><span class="ms">delete</span>Vymazať</button>' +
        '<button type="button" class="btn text" id="cancel">Zavrieť</button><button type="button" class="btn" id="edit"><span class="ms">edit</span>Upraviť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#edit').onclick = () => itemForm(it);
        root.querySelector('#move').onclick = () => startMove('item', it);
        root.querySelector('#shop').onclick = () => addToShopping(it);
        const photo = root.querySelector('.sk-detail-photo');
        if (photo) photo.onclick = () => zoomImage(it.image);
        root.querySelector('#del').onclick = async () => {
          if (!(await FG.confirmDialog('Vymazať „' + it.name + '“?', 'Nedá sa to vrátiť.', 'Vymazať', true))) return;
          act(() => api('skladko/deleteItem', it.id), 'Vymazané');
        };
      },
      { focus: false }
    );
  }

  async function addToShopping(it) {
    const lists = S.data.shopping;
    const send = async (cinnostId) => {
      closeModal();
      try {
        const res = await api('skladko/addToShopping', it.id, cinnostId || '');
        toast('Pridané do nákupu „' + res.name + '“ v Gazde');
        load(true).catch(() => {});
      } catch (err) {
        showError(err);
      }
    };
    if (lists.length < 2) return send(lists[0] && lists[0].id);
    openModal(
      '<h2>Do ktorého nákupu?</h2><div class="subtitle">' + esc(it.name) + ' pribudne do zoznamu v Gazde.</div><div class="pick-list">' +
        lists.map((l) => '<button type="button" class="btn tonal" data-list="' + esc(l.id) + '"><span class="ms">shopping_cart</span>' + esc(l.name + (l.store ? ' – ' + l.store : '')) + '</button>').join('') +
        '</div><div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelectorAll('[data-list]').forEach((b) => (b.onclick = () => send(b.dataset.list)));
      },
      { focus: false }
    );
  }

  /** Fotka z telefónu → JPEG najviac max px (aby sa zmestila do databázy). */
  async function resizeImage(blob, max = 1200) {
    let source;
    try {
      source = await createImageBitmap(blob);
    } catch (e) {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Obrázok sa nepodarilo načítať.'));
        img.src = URL.createObjectURL(blob);
      });
    }
    const scale = Math.min(1, max / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; // priehľadné PNG nech nemá v JPEG čierne pozadie
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(source, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let url = canvas.toDataURL('image/jpeg', quality);
    while (url.length > 780000 && quality > 0.4) {
      quality -= 0.12;
      url = canvas.toDataURL('image/jpeg', quality);
    }
    return url;
  }

  function itemForm(it, warehouseId, groupId) {
    let icon = it ? iconName(it.icon) : 'inventory_2';
    let image; // undefined = bez zmeny, null = zmazať, text = nová fotka
    const currentImage = it && it.image;
    openModal(
      '<h2>' + (it ? 'Upraviť vec' : 'Nová vec') + '</h2>' +
        (it ? '' : '<div class="subtitle">' + esc(pathText(warehouseId, groupId)) + '</div>') +
        '<form id="f"><div class="field"><label>Názov</label><input name="name" required maxlength="80" value="' + esc(it ? it.name : '') + '" placeholder="napr. Cestoviny"></div>' +
        '<div class="row"><div class="field"><label>Množstvo</label><div class="stepper"><button type="button" class="step" data-qs="-1"><span class="ms">remove</span></button>' +
        '<input name="quantity" inputmode="numeric" pattern="[0-9]*" value="' + (it ? it.quantity : 1) + '"><button type="button" class="step" data-qs="1"><span class="ms">add</span></button></div></div>' +
        '<div class="field"><label>Dochádza pri</label><input name="minQty" inputmode="numeric" pattern="[0-9]*" placeholder="nesledovať" value="' + (it && it.minQty ? it.minQty : '') + '"></div></div>' +
        '<div class="field"><label>Spotrebovať do (nepovinné)</label><div class="row"><input type="date" name="exp" value="' + esc(it ? it.expirationDate : '') + '">' +
        '<button type="button" class="btn text small" id="clearExp" style="flex:0 0 auto">Bez dátumu</button></div></div>' +
        '<div class="field"><label>Poznámka (nepovinné)</label><textarea name="description" rows="2" maxlength="500">' + esc(it ? it.description : '') + '</textarea></div>' +
        '<div class="field"><label>Fotka</label><div class="sk-photo-pick"><div id="photoPrev">' +
        (currentImage ? '<img src="' + esc(currentImage) + '" alt="">' : '') + '</div>' +
        '<label class="btn tonal small"><span class="ms">photo_camera</span>Odfotiť<input type="file" accept="image/*" capture="environment" hidden data-file></label>' +
        '<label class="btn tonal small"><span class="ms">photo_library</span>Z galérie<input type="file" accept="image/*" hidden data-file></label>' +
        '<button type="button" class="btn text small' + (currentImage ? '' : ' hidden') + '" id="noPhoto"><span class="ms">delete</span></button></div></div>' +
        '<div class="field"><label>Ikona (keď nie je fotka)</label>' + iconPickerHtml(icon) + '</div>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button class="btn">' + (it ? 'Uložiť' : 'Pridať') + '</button></div></form>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        bindIconPicker(root, (n) => (icon = n));
        const f = root.querySelector('#f');
        root.querySelectorAll('[data-qs]').forEach((b) => {
          b.onclick = () => {
            const n = Math.max(0, (parseInt(f.quantity.value, 10) || 0) + Number(b.dataset.qs));
            f.quantity.value = n;
          };
        });
        root.querySelector('#clearExp').onclick = () => (f.exp.value = '');
        const prev = root.querySelector('#photoPrev');
        const noPhoto = root.querySelector('#noPhoto');
        noPhoto.onclick = () => {
          image = null;
          prev.innerHTML = '';
          noPhoto.classList.add('hidden');
        };
        root.querySelectorAll('[data-file]').forEach((input) => {
          input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
              image = await resizeImage(file);
              prev.innerHTML = '<img src="' + image + '" alt="">';
              noPhoto.classList.remove('hidden');
            } catch (err) {
              showError(err);
            }
          };
        });
        f.onsubmit = async (e) => {
          e.preventDefault();
          const data = {
            id: it && it.id,
            warehouseId,
            groupId,
            name: f.name.value,
            quantity: parseInt(f.quantity.value, 10),
            minQty: parseInt(f.minQty.value, 10) || 0,
            expirationDate: f.exp.value,
            description: f.description.value,
            icon,
            ...(image !== undefined && { image }),
          };
          if (!Number.isInteger(data.quantity) || data.quantity < 0) {
            toast('Množstvo zadaj ako celé číslo (0 a viac).', true);
            return;
          }
          const button = f.querySelector('button:not([type])');
          button.disabled = true;
          try {
            await api('skladko/saveItem', data);
            closeModal();
            await load(true);
            render();
            toast(it ? 'Uložené' : '„' + data.name.trim() + '“ pridané');
          } catch (err) {
            button.disabled = false;
            showError(err);
          }
        };
      },
      { focus: it ? false : true }
    );
  }

  // ---- Presun (vystrihni → vlož) ---------------------------------------------------------------

  function startMove(kind, x) {
    closeModal();
    S.moving = { kind, id: x.id, name: x.name };
    toast('Otvor miesto, kam to patrí, a ťukni Vložiť sem');
    render();
  }

  async function pasteHere() {
    const m = S.moving;
    const { warehouseId, groupId = '' } = S.view;
    S.moving = null;
    if (m.kind === 'item') await act(() => api('skladko/moveItem', m.id, warehouseId, groupId), '„' + m.name + '“ presunuté');
    else await act(() => api('skladko/moveGroup', m.id, warehouseId, groupId), 'Skupina „' + m.name + '“ presunutá');
  }

  // ---- Hľadanie -------------------------------------------------------------------------------

  function renderSearch() {
    header('Hľadať', true);
    const q = S.view.q || '';
    $('view').innerHTML =
      '<div class="field sk-search"><input type="search" id="q" placeholder="Čo hľadáš? (napr. batérie)" value="' + esc(q) + '" autocomplete="off"></div>' +
      '<div id="results"></div>';
    const input = $('q');
    const show = () => {
      const f = fold(input.value.trim());
      S.view.q = input.value;
      history.replaceState(S.view, '');
      const box = $('results');
      if (f.length < 2) {
        box.innerHTML = '<div class="empty compact"><span class="ms">search</span><div>Napíš aspoň 2 písmená – hľadá sa v názvoch a poznámkach (aj bez diakritiky).</div></div>';
        return;
      }
      const groups = S.data.groups.filter((g) => fold(g.name).includes(f));
      const items = S.data.items.filter((i) => fold(i.name).includes(f) || fold(i.description).includes(f));
      if (!groups.length && !items.length) {
        box.innerHTML = '<div class="empty compact"><span class="ms">search_off</span><div>Nič sa nenašlo pre „' + esc(input.value.trim()) + '“.</div></div>';
        return;
      }
      box.innerHTML =
        '<div class="sk-grid">' +
        groups.map((g) => groupCard(g).replace('<div class="sk-sub">', '<div class="sk-sub">' + esc(pathText(g.warehouseId, g.parentId)) + ' · ')).join('') +
        items.map((i) => itemCard(i, true)).join('') + '</div>';
      bindCards(box);
    };
    input.oninput = show;
    show();
    setTimeout(() => input.focus(), 50);
    fab('');
  }

  // ---- Dochádza a trvanlivosť ---------------------------------------------------------------------

  function renderFilter() {
    header('Dochádza a trvanlivosť', true);
    const tab = S.view.tab || 'exp';
    let list;
    let controls;
    if (tab === 'exp') {
      list = S.data.items
        .filter((i) => i.expirationDate && daysUntil(i.expirationDate) <= S.expDays)
        .sort((a, b) => a.expirationDate.localeCompare(b.expirationDate));
      controls =
        '<div class="chips">' + [7, 14, 30].map((d) => '<button type="button" class="chip' + (S.expDays === d ? ' active' : '') + '" data-days="' + d + '">do ' + d + ' dní</button>').join('') + '</div>';
    } else {
      list = S.data.items
        .filter((i) => isLow(i) || i.quantity <= S.lowThreshold)
        .sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || a.quantity - b.quantity);
      controls =
        '<div class="field sk-slider"><label>Aj veci, ktorých je najviac <b id="thr">' + S.lowThreshold + '</b> ks</label>' +
        '<input type="range" id="threshold" min="0" max="50" value="' + S.lowThreshold + '"></div>';
    }
    $('view').innerHTML =
      '<div class="chips seg sk-tabs"><button type="button" class="chip' + (tab === 'exp' ? ' active' : '') + '" data-tab="exp"><span class="ms">hourglass_bottom</span>Končí trvanlivosť</button>' +
      '<button type="button" class="chip' + (tab === 'low' ? ' active' : '') + '" data-tab="low"><span class="ms">inventory_2</span>Dochádza</button></div>' +
      controls +
      (list.length
        ? '<div class="sk-grid">' + list.map((i) => itemCard(i, true)).join('') + '</div>'
        : '<div class="empty compact"><span class="ms">check</span><div>' + (tab === 'exp' ? 'Nič nekončí – všetko je v poriadku.' : 'Nič nedochádza.') + '</div></div>') +
      (tab === 'low' ? '<div class="grid-note">Pri veci si nastav „Dochádza pri“ – keď množstvo klesne na túto hranicu, Skládko pošle upozornenie a vec sa tu ukáže vždy.</div>' : '');
    $('view').querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go({ name: 'filter', tab: b.dataset.tab }, true)));
    $('view').querySelectorAll('[data-days]').forEach((b) => (b.onclick = () => {
      S.expDays = Number(b.dataset.days);
      render();
    }));
    const thr = $('threshold');
    if (thr) {
      thr.oninput = () => ($('thr').textContent = thr.value);
      thr.onchange = () => {
        S.lowThreshold = Number(thr.value);
        render();
      };
    }
    bindCards($('view'));
    fab('');
  }

  // ---- Prenos z mobilného Skládka (Firebase) ---------------------------------------------------------

  function importDialog() {
    const h = FG.currentHousehold();
    openModal(
      '<h2>Preniesť z mobilného Skládka</h2>' +
        '<div class="subtitle">Prenesie sklady, skupiny a veci (aj s fotkami) z aplikácie Skládko v telefóne do rodiny <b>' + esc(h ? h.name : '') + '</b>. ' +
        'Použije sa účet Skládka s tvojím e-mailom <b>' + esc(FG.state.email) + '</b>.</div>' +
        '<ol class="steps"><li>Dá sa zopakovať – nič sa nezdvojí (údaje z telefónu prepíšu tie isté veci tu).</li>' +
        '<li>Fotky sa prenesú cez tento prehliadač a zmenšia sa – nechaj okno otvorené, kým sa nedokončí.</li></ol>' +
        '<div class="actions"><button type="button" class="btn text" id="cancel">Zrušiť</button><button type="button" class="btn" id="go"><span class="ms">sync</span>Preniesť</button></div>',
      (root) => {
        root.querySelector('#cancel').onclick = closeModal;
        root.querySelector('#go').onclick = async () => {
          closeModal();
          try {
            const res = await api('skladko/importFirebase', S.hh);
            await load(true);
            render();
            if (!res.warehouses) {
              toast('V mobilnom Skládku nie sú žiadne sklady.');
              return;
            }
            toast('Prenesené: ' + plural(res.warehouses, 'sklad', 'sklady', 'skladov') + ', ' + plural(res.items, 'vec', 'veci', 'vecí') +
              (res.orphans ? ' (' + res.orphans + ' z vymazaných skupín je v „Nájdené pri prenose“)' : ''));
            if (res.images.length) transferImages(res.images);
          } catch (err) {
            showError(err);
          }
        };
      },
      { focus: false }
    );
  }

  async function transferImages(list) {
    if (!list) {
      try {
        list = await api('skladko/pendingImages', S.hh);
      } catch (err) {
        return showError(err);
      }
    }
    let done = 0;
    let failed = 0;
    let stop = false;
    openModal(
      '<h2>Prenos fotiek</h2><div class="subtitle" id="progress">0 / ' + list.length + '</div>' +
        '<div class="sk-bar"><span id="bar"></span></div>' +
        '<div class="actions"><button type="button" class="btn text" id="stop">Prerušiť</button></div>',
      (root) => {
        root.querySelector('#stop').onclick = () => {
          stop = true;
          closeModal(true);
        };
      },
      { focus: false, persistent: true }
    );
    for (const it of list) {
      if (stop) break;
      try {
        const res = await fetch('/api/skladko/import-image/' + encodeURIComponent(it.id));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const image = await resizeImage(await res.blob());
        await apiQuiet('skladko/setItemImage', it.id, image);
      } catch (e) {
        failed++;
        await apiQuiet('skladko/skipImportImage', it.id).catch(() => {});
      }
      done++;
      const p = $('progress');
      if (p) {
        p.textContent = done + ' / ' + list.length + (failed ? ' (nepodarilo sa: ' + failed + ')' : '') + ' – ' + it.name;
        $('bar').style.width = Math.round((done / list.length) * 100) + '%';
      }
    }
    if (!stop) closeModal(true);
    await load(true).catch(() => {});
    render();
    if (!stop) toast('Fotky prenesené: ' + (done - failed) + (failed ? ', bez fotky ostalo ' + failed : ''));
  }

  // ---- Štart -----------------------------------------------------------------------------------

  $('backBtn').onclick = back;
  $('searchBtn').onclick = () => go({ name: 'search', q: '' });
  $('filterBtn').onclick = () => go({ name: 'filter', tab: 'exp' });

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

  S.view = history.state && history.state.name ? history.state : { name: 'home' };
  history.replaceState(S.view, '');

  FG.start({
    onReady: () => start(),
    accountExtra: () => [
      '<button type="button" class="btn tonal small" id="skImport" style="margin:4px 0 12px"><span class="ms">sync</span>Preniesť z mobilného Skládka</button>',
      (root) => {
        root.querySelector('#skImport').onclick = () => {
          if (!S.hh) return toast('Najprv vytvor rodinu.', true);
          importDialog();
        };
      },
    ],
  });
})();
