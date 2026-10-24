# Gazda – verzia pre Cloudflare

Nová verzia Gazdy na **Cloudflare Workers** s databázou **D1**. Beží zadarmo
(bezplatný plán Cloudflare), bez platobnej karty. Upozornenia budú len ako
push notifikácie priamo z aplikácie.

> Stav: **fáza 5 – prenos dát.** Gazda na Cloudflare má všetky funkcie verzie Apps Script,
> upozornenia chodia ako **push notifikácie** priamo z aplikácie, dá sa nainštalovať na
> plochu a každý sa prihlasuje **svojím Google účtom** (žiadne osobné odkazy).
> Dáta zo starej Gazdy (Google tabuľka) sa prenesú tlačidlom – pozri *Prenos zo starej Gazdy*.

## Family Grid

Na tej istej adrese (`https://gazda.<subdoména>.workers.dev`) beží **Family Grid** – jedna
aplikácia s dlaždicami podaplikácií. Jedno prihlásenie, jedna databáza D1, jeden service
worker a jedny upozornenia (každá podaplikácia v nich má vlastnú ikonu).

| Adresa | Čo to je |
|---|---|
| `/` | rozcestník Family Grid (`public/index.html`, `public/grid.js`) |
| `/gazda/` | Gazda (`public/gazda/`) |
| `/zdravko/` | Zdravko – zdravie rodiny (`public/zdravko/`, `src/zdravko/`) – pozri nižšie |
| `/skladko/` | Skládko – čo máme doma a kde (`public/skladko/`, `src/skladko/`) – pozri nižšie |
| `/quickstash/` | QuickStash – texty, odkazy a heslá na skopírovanie (`public/quickstash/`, `src/quickstash/`) – pozri nižšie |
| `/financie/` | Financie – rodinný rozpočet podľa tabuľky Financie (`public/financie/`, `src/financie/`) – pozri nižšie |

- **Posledná podaplikácia:** Family Grid sa otvára rovno v naposledy otvorenej podaplikácii
  (`localStorage` `fg.lastApp`, na novom zariadení podľa `users.last_app` zo servera).
  Rozcestník sa ukáže tlačidlom dlaždíc vľavo hore (`/?grid=1`).
- **Inštalácia:** manifest má stále `id: "/"`, takže doteraz nainštalovaná Gazda sa sama
  zmení na Family Grid (nová ikona a meno). Staré skratky `/?akcia=…` presmerujú na `/gazda/`.
- **Prihlásenie a zdieľanie celého Family Grid:** prihlasuje sa raz Google účtom (platí pre
  všetky podaplikácie). Family Grid sa zdieľa ako **rodina** (`households`, `members` – tie isté
  ako domácnosti v Gazde): na rozcestníku ťukni na rodinu nad kartami (alebo *Môj účet →
  Rodina a zdieľanie*), zadaj Google e-mail a pošli pozvánku. Člen rodiny vidí a mení údaje
  Gazdy, Zdravka, Skládka, Financií aj spoločné položky QuickStashu tejto rodiny. Zakladateľ môže členov odobrať (`removeFamilyMember`),
  člen môže z rodiny odísť; rodinu sa dá premenovať (`renameFamily`) a vymazať (zmaže údaje
  všetkých podaplikácií).
- **Zvolená rodina** je spoločná pre všetky podaplikácie (`setCurrentFamily` →
  `users.last_household_id`, podľa nej sa otvorí aj Gazda); kto má viac rodín, prepne ich v
  dialógu rodiny alebo v Gazde.
- **Upozornenia:** správa má pole `app` (`gazda` | `zdravko` | `skladko` | `quickstash` | `financie` | `family`);
  service worker podľa neho zvolí ikonu `/icons/<app>/icon-192.png` a odznak `badge-96.png`
  a po ťuknutí otvorí `/<app>/`.
- **Spoločný kód v prehliadači:** `public/shared/app.css` (vzhľad), `public/shared/fg.css`
  (farby podaplikácií, dlaždice) a `public/shared/fg.js` (server, prihlásenie, okná,
  upozornenia, inštalácia, výber rodiny). Gazda má tie isté funkcie ešte vo vlastnom `app.js`.
- **Ikony:** `node scripts/render-icons.cjs public/icons` z kresieb v `scripts/icon-art.cjs`
  (priečinky `family`, `gazda`, `zdravko`, `skladko`, `quickstash`, `financie`).

## Kalendár na plochu (Google Kalendár / iPhone)

Webová aplikácia nemôže mať vlastný widget na ploche, preto Family Grid ponúka **súkromný
kalendár** (iCalendar): *Môj účet → Kalendár na plochu* (aj v Zdravkovi pod kalendárom a v Gazde
v *Môj účet*). Obsahuje udalosti Zdravka (lekár, vyšetrenia, očkovania – 60 dní dozadu a všetky
budúce) a úlohy Gazdy s termínom (moje a spoločné / všetky / žiadne – `?gazda=mine|all|none`;
opakované úlohy ako séria, s časom alebo celodenné) zo všetkých rodín používateľa.

- Adresa `GET /api/calendar/<token>.ics` bez prihlásenia; v D1 (`calendar_feeds`, migrácia 0015)
  je len SHA-256 tokenu, adresa sa ukáže len pri vytvorení (zariadenie si ju zapamätá).
  Nová adresa zruší starú.
- Pridanie: odkaz `calendar.google.com/calendar/r?cid=webcal://…` (Android – potom v aplikácii
  Kalendár Google zapnúť synchronizáciu kalendára „Family Grid“ a dať na plochu widget
  *Plán*), alebo `webcal://` (iPhone). Google si odoberané kalendáre obnovuje sám, zvyčajne
  raz za niekoľko hodín – widget preto nie je okamžitý (upozornenia z Family Grid áno).

## Skládko (`/skladko/`)

Čo máme doma a kde to je – webová verzia mobilného Skládka (Flutter + Firebase), teraz
ako podaplikácia Family Grid. Sklady (špajza, chladnička…) → skupiny (ľubovoľne vnorené)
→ veci s množstvom, dátumom spotreby, poznámkou a ikonou alebo fotkou.

- **Spoločné v rodine:** sklady patria rodine (domácnosti), vidia a menia ich všetci jej členovia
  (mobilný Skládko bol len pre jedného). Zmeny od ostatných sa ukážu samé (`skladko/getRev`).
- **Dochádza:** pri veci sa dá nastaviť hranica („dochádza pri 2“); keď množstvo klesne na ňu,
  príde upozornenie a vec je v *Dochádza a trvanlivosť* (filter 🔽). Tam je aj posuvník
  „aj veci, ktorých je najviac N ks“ ako v mobilnom Skládku.
- **Trvanlivosť:** farebný štítok na karte (zelená / o pár dní / dnes alebo prešla) a upozornenie
  3 dni pred dátumom (každý dátum raz, cez deň 8:00–20:59, cron každých 5 min).
- **Do nákupu v Gazde:** v detaile veci – pridá ju do nákupu rodiny v Gazde (keď žiadny nie je, vytvorí „Nákup“).
- **Presun:** vec aj celú skupinu (s obsahom) – *Presunúť* → otvor cieľ → *Vložiť sem*.
  (Mobilný Skládko pri presune v rámci jedného skladu vec omylom zmazal – tu je to jeden `UPDATE`.)
- **Mazanie skupiny** zmaže aj podskupiny a veci v nej (mobilný ich nechal „visieť“).
- **Hľadanie** v názvoch a poznámkach vecí aj v názvoch skupín, bez ohľadu na diakritiku.
- **Fotky** sa v prehliadači zmenšia (najviac 1200 px, JPEG) a uložia do D1 (`skladko_images`,
  do 600 kB); `GET /api/skladko/image/<id>?v=<verzia>` len pre členov rodiny.
- Tabuľky: `skladko_warehouses`, `skladko_groups`, `skladko_items`, `skladko_images`
  (migrácia 0013), funkcie `POST /api/skladko/<funkcia>` v `src/skladko/api.js`.

### Prenos z mobilného Skládka (Firebase)

V Skládku: **Môj účet → Preniesť z mobilného Skládka**. Server nájde vo Firebase projekte
`skladko-9469f` účet s rovnakým e-mailom, ako je prihlásený používateľ (Google prihlásenie
overí, že e-mail je jeho), a prenesie jeho sklady, skupiny a veci do zvolenej rodiny.
Fotky potom prenesie prehliadač (stiahne ich cez náš server, zmenší a uloží).
Prenos sa dá zopakovať – id z Firebase ostávajú (`fb-<id>`), nič sa nezdvojí.
Veci a skupiny, ktorých skupinu mobilný Skládko „zmazal“, sa objavia v skupine
*Nájdené pri prenose*; najstaršie veci z prvej verzie v sklade *Staré položky*.

**Nastavenie (raz):** server potrebuje servisný účet Firebase projektu Skládka:

1. [Firebase console](https://console.firebase.google.com/) → projekt **skladko-9469f** →
   ⚙️ *Nastavenia projektu* → *Servisné účty* → **Vygenerovať nový súkromný kľúč** (stiahne sa JSON).
2. GitHub → *Settings → Secrets and variables → Actions* → **New repository secret**
   `FIREBASE_SKLADKO_SA` = celý obsah JSON súboru. Pri ďalšom nasadení ho CI uloží do Workera
   (`wrangler secret bulk`). Alebo priamo: `npx wrangler secret put FIREBASE_SKLADKO_SA`.
3. Po prenose všetkých ľudí môžeš kľúč vo Firebase zmazať (a secret odstrániť).

## QuickStash (`/quickstash/`)

Texty, odkazy a heslá, ktoré často kopíruješ (Wi-Fi heslo, číslo účtu, adresa…) – webová verzia
desktopového QuickStashu (repozitár `quickstash`, PySide6 a Apps Script) ako podaplikácia Family Grid.

- **Typy:** text / odkaz a heslo. Ťuknutie na položku ju skopíruje, odkaz (`http(s)://`) otvorí;
  pri hesle sú bodky, ikona oka ho na 10 s ukáže (skryje sa aj pri odchode z aplikácie).
- **Hľadanie** podľa názvu (pri textoch aj obsahu), bez ohľadu na diakritiku, viac slov = všetky;
  Enter spustí prvú položku – ako v desktopovej verzii.
- **Spoločné a súkromné:** položka patrí rodine – spoločnú vidia a menia všetci jej členovia,
  súkromnú (*Len pre mňa*) len ten, kto ju vytvoril. Názov je jedinečný medzi položkami, ktoré
  človek vidí. Kto z rodiny odíde alebo je odobratý, jeho súkromné položky v nej sa zmažú.
- **Záloha:** *Môj účet → Import zálohy* načíta JSON z desktopového QuickStashu (`data.json`,
  aj starší formát `"password": true`) alebo zo zálohy webu; rovnaký názov sa prepíše, súbory a
  priečinky sa prenesú ako text (cesta). *Stiahnuť zálohu* uloží JSON v tom istom formáte.
- **Naživo:** zmeny od ostatných sa ukážu samé (`quickstash/getRev`, `households.quickstash_rev`).
- **Bezpečnosť:** heslá sú v D1 (šifrovaná na disku Cloudflare) a v pamäti telefónu (posledné
  údaje na otvorenie bez internetu) – pri odhlásení sa zmažú.
- Tabuľka `quickstash_entries` (migrácia 0016), funkcie `POST /api/quickstash/<funkcia>` v `src/quickstash/api.js`.

## Financie (`/financie/`)

Rodinný rozpočet – webová verzia tabuľky **Financie** (Excel) ako podaplikácia Family Grid.
Údaje patria rodine, vidia a menia ich všetci jej členovia, zmeny od ostatných sa ukážu samé
(`financie/getRev`, `households.financie_rev`).

- **Príjmy, mesačné výdavky** (s kategóriou) a **ročné výdavky** (so splatnosťou a „sporiť mesačne“ = suma / 12).
- **Prehľad** počíta to isté ako vzorce v tabuľke: príjem za mesiac a rok, výdavky spolu prepočítané
  na mesiac (mesačné + ročné / 12), koľko zostáva, % výdavkov z príjmu, výdavky podľa kategórií
  (ťuknutím detail) a najbližšie ročné platby.
- **Finančné zdravie:** bežné výdavky bez sporenia voči príjmu – do 50 % *Výborné*, do 70 % *Dobré*,
  do 90 % *Na hrane*, inak (alebo keď výdavky prevyšujú príjem) *Zlé*. Ktoré kategórie sú sporenie,
  sa nastaví pri kategórii (pri importe sa označí „Sporenie“, „Investície“…).
- **Núdzová rezerva:** aktuálna suma, cieľ N× mesačné výdavky (predvolene 6), na koľko mesiacov vydrží, naplnenie.
- **Import z Excelu:** *Môj účet → Import z Excelu* (alebo tlačidlo na prázdnom prehľade) načíta `.xlsx`
  priamo na serveri (`src/financie/xlsx.js` – ZIP + XML bez knižníc, `src/financie/excel.js`): na liste nájde
  nadpisy *Príjmy*, *Mesačné výdavky*, *Ročné výdavky*, *Kategórie výdavkov*, pod nimi hlavičku („Názov“,
  „Suma (€)“, „Kategória“, „Splatnosť“) a riadky po „Spolu“; zo súhrnu *Aktuálna rezerva*. Na presnej polohe
  tabuliek nezáleží. Import nahradí doterajšie položky a kategórie rodiny.
- **Dlaždica** na rozcestníku: koľko mesačne zostáva (zvolená rodina).
- Sumy sú v centoch. Tabuľky `financie_items`, `financie_categories` a stĺpce `households.financie_*`
  (migrácia 0017), funkcie `POST /api/financie/<funkcia>` v `src/financie/api.js`.

## Zdravko (`/zdravko/`)

Zdravie rodiny – webová verzia mobilného Zdravka (Flutter + Firebase) ako podaplikácia
Family Grid. Údaje patria rodine, vidia ich oba rodičia (mobilný Zdravko bol len pre jeden
Google účet) a zmeny od druhého sa ukážu samé (`zdravko/getRev`).

- **Členovia:** meno, dátum narodenia (vek „2 roky, 3 mesiace a 5 dní“), váha, výška, krvná
  skupina, pohlavie, e-mail, dieťa. Na karte posledná teplota a liek (48 h) a najbližšia udalosť.
- **Choroba:** obdobie (deň, 3 dni, týždeň, mesiac, 3 mesiace) a deň; graf teploty s pásmami
  (do 37,2 zelená, do 38 oranžová, nad 38 červená) alebo tabuľka; lieky za 3 dni a kedy sa
  ibuprofen/paracetamol smie podať znova (8 h); časová os záznamov. Jeden záznam = teplota,
  liek a fyzikálna metóda naraz (ako v mobilnom), čas sa dá posunúť (−10 / −30 min).
- **Kalendár:** návštevy lekára, vyšetrenia a očkovania (podtypy z mobilného Zdravka),
  pripomienky týždeň / deň / hodinu pred **všetkým v rodine**, cena, poznámky. Do kalendára
  v telefóne cez *Pridať do Google Kalendára* (odkaz) alebo súbor `.ics` – bez ďalšieho
  prihlasovania a bez duplikátov ako v mobilnom.
- **Dávkovanie:** kalkulačka ibuprofen/paracetamol podľa váhy (sirup, čípky, tablety) –
  rovnaký výpočet ako v mobilnom Zdravkovi (`public/zdravko/data.js` z `assets/*.json`).
- **Miery dieťaťa:** váha (g), výška, obvod hlavičky, vek v čase merania, grafy váhy a výšky,
  *Nastaviť ako aktuálne*.
- **Upozornenia (ikona Zdravka):** nová udalosť, podaný liek a nameraná teplota (🌡️ / 🟠 nad 37,2 / 🔴 nad 38 °C; s liekom v jednej správe) hneď ostatným v rodine;
  pripomienky udalostí; pri ibuprofene/paracetamole o 4 h „môžeš podať ten druhý“ a o 8 h
  „znova ten istý“ (ďalšia dávka staré pripomienky nahradí). Posiela ich cron každých 5 minút
  (`zdravko_reminders`; zmeškané o viac ako 6 h sa už neposielajú).
- Tabuľky `zdravko_members`, `zdravko_records`, `zdravko_measurements`, `zdravko_reminders`
  (migrácia 0014), funkcie `POST /api/zdravko/<funkcia>` v `src/zdravko/api.js`.

### Prenos z mobilného Zdravka (Firebase)

V Zdravkovi: **Môj účet → Preniesť z mobilného Zdravka**. Server nájde vo Firebase projekte
`zdravko-f4ac5` účet s rovnakým e-mailom a prenesie členov, záznamy, udalosti (aj
s pripomienkami do budúcnosti) a miery do zvolenej rodiny. Časy z mobilnej aplikácie
(miestny čas bez pásma aj UTC) sa prevedú správne. Záznamy vymazaných členov sa
nepreniesú; najstaršie záznamy bez člena dostane člen, ak je v rodine jediný.
Opakovaný prenos nič nezdvojí (`fb-<id>`).

**Nastavenie (raz):** rovnako ako pri Skládku – GitHub secret **`FIREBASE_ZDRAVKO_SA`** = JSON
servisného účtu projektu `zdravko-f4ac5` (Firebase → Nastavenia projektu → Servisné účty →
Vygenerovať nový súkromný kľúč).

> ⚠️ **Bezpečnosť:** mobilný Zdravko má súkromný kľúč servisného účtu priamo v repozitári
> (`family_mobile_app/assets/service-account.json`) a v každej nainštalovanej aplikácii – kto má
> APK, má plný prístup k Firebase projektu. Na prenos ho nepoužívaj: vygeneruj nový kľúč, ulož ho
> len ako GitHub secret a starý kľúč vo Google Cloud (IAM → Servisné účty → Kľúče) **zruš**.
> Po zrušení prestanú fungovať push správy mobilného Zdravka – čo nevadí, keď ho nahradí web.

## Súbory

| Súbor / priečinok | Obsah |
|---|---|
| `src/index.js` | Server (Worker): smerovanie `/api/*`, ostatné sú statické súbory |
| `src/api.js` | Funkcie API (rovnaké ako vo verzii Apps Script) |
| `src/domain.js` | Doménová logika: opakovanie, počet pri položkách, validácie |
| `src/auth.js` | Prihlásenie: relácia v cookie (v databáze len SHA-256 odtlačok) |
| `src/google.js` | Overenie Google ID tokenu (podpis RS256, Client ID, platnosť, overený e-mail) |
| `src/notifications.js` | Upozornenia: nová pridelená úloha, ranný prehľad (cron), odbery |
| `src/import.js` | Prenos dát zo starej Gazdy (jednorazový kód, čistenie, hromadný zápis) |
| `src/leaflets.js` | Letáky Lidl: zoznam a stránky letákov (pamäť v D1), obrázky cez náš server |
| `src/webpush.js` | Web Push bez knižníc: šifrovanie RFC 8291 (aes128gcm) a VAPID (RFC 8292) |
| `public/index.html`, `app.js`, `app.css`, `produkty.js` | Aplikácia (prevzatá z `apps_script/`, volá `/api/*` cez `fetch`) |
| `public/letaky.js` | Prehliadač letákov: listovanie, priblíženie, krúžkovanie → miniatúra do nákupu |
| `public/sw.js` | Service worker: otvorenie bez internetu, zobrazenie push notifikácií |
| `public/icons/` | Ikony aplikácie na plochu |
| `migrations/` | Štruktúra databázy D1 (SQL), aplikuje sa pri každom nasadení |
| `wrangler.json` | Nastavenie Workera; `database_id` doplní CI automaticky |
| `scripts/ensure-d1.mjs` | Nájde alebo pri prvom nasadení vytvorí databázu D1 |
| `test/` | Testy (lokálna D1, `npm test`) |

## API

`POST /api/<funkcia>` s telom `{"args": [...]}` (`Content-Type: application/json`)
a cookie relácie. Odpoveď je `{"result": …}`, pri chybe `{"error": "text pre
používateľa"}` (neprihlásený: HTTP 401 a `"code": "LOGIN_REQUIRED"`).

Funkcie: `getHouseholds`, `getStartData`, `createHousehold`, `shareHousehold`,
`deleteHousehold`, `getHouseholdData`, `setNickname`, `addPriestor`, `addCinnost`, `updateCinnost`,
`addItem`, `toggleItem`, `deleteCinnost`, `completeCinnost`, `getPushKey`,
`subscribePush`, `unsubscribePush`, `testPush`, `getLeaflets(store)`, `getLeaflet`, `analyzeLeafletPage`,
`identifyLeafletProduct`, `setItemMissing`, `getHistory`.
`GET /api/health` overí databázu.

`addItem(cinnostId, text, qty, image, price)` – voliteľná cena („2,49“) a miniatúra ako `data:image/jpeg;base64,…`
(najviac 200 kB); položka ju potom má v `image` (`/api/item-image/<id>`, len pre členov).

Prenos: `createImportCode` (prihlásený) a `POST /api/import` `{"code", "data"}`
(volá stará Gazda, overí sa kódom; telo do 5 MB).

Prihlásenie: `GET /api/auth/config` (Client ID pre tlačidlo Google),
`POST /api/auth/google` `{"credential": "<ID token>"}` – server overí token
a nastaví cookie `gazda_session` (HttpOnly, Secure, SameSite=Lax, 1 rok),
`POST /api/auth/logout` odhlási zariadenie. Do API sa dá poslať len JSON, takže
cudzia stránka nemôže zneužiť prihlásenie (CSRF).

Zápisy, ktoré patria k sebe (napr. činnosť s checklistom a našepkávaním), idú
jedným `batch` – D1 ich vykoná ako jednu transakciu.

## Aplikácia v telefóne

- **Prihlásenie Google účtom** na adrese `https://gazda.<subdoména>.workers.dev`;
  na zariadení ostáva rok (alebo do odhlásenia v *Môj účet*). Kto sa už prihlásil,
  Google ho pri ďalšom otvorení prihlási sám.
- **Prezývka:** po prvom prihlásení si každý zvolí prezývku (predvyplnené krstné
  meno z Google účtu); v aplikácii sa ostatným zobrazujú len prezývky. Zmeniť sa dá
  v *Môj účet*. Kto sa ešte neprihlásil, ukazuje sa e-mailom.
- **Zdieľanie:** domácnosť sa zdieľa na Google e-mail; ten človek sa prihlási
  a domácnosť hneď vidí. V okne *Zdieľať* je vidieť, kto sa ešte neprihlásil.
- **Posledná domácnosť:** pri otvorení Gazdy (aj na novom zariadení po prihlásení)
  sa rovno otvorí naposledy otvorená domácnosť.
- **Inštalácia ako aplikácia:** Gazda sama ponúkne **Nainštalovať Gazdu** (lišta hore
  a tlačidlo v *Môj účet*). Na Androide Chrome vytvorí skutočnú aplikáciu s ikonou
  Gazdy – v zozname aplikácií aj v nastaveniach a **notifikácie chodia pod menom
  a ikonou Gazdy** (nie Chrome). Upozornenia treba zapnúť v nainštalovanej aplikácii.
  Na iPhone Gazda ukáže návod *Zdieľať* → *Pridať na plochu* (v aplikácii z plochy
  sa treba raz prihlásiť znova).
- **Ikona:** `public/icons/` (SVG + PNG 192/512, maskable, apple-touch, favicon,
  jednofarebný badge do stavového riadku Androidu). Vyrába ich
  `node scripts/render-icons.cjs public/icons` z kresby v `scripts/icon-art.cjs`.
- **Automatická obnova:** otvorená domácnosť sa každých 20 s (a po návrate do
  aplikácie) potichu obnoví, takže zmeny od ostatných sa ukážu samé.
- **Bez internetu** sa Gazda otvorí z pamäte telefónu s poslednými údajmi.

## Letáky (Lidl, Tesco, Kaufland, Billa, Coop Jednota, Terno, Fresh, Kraj, Metro)

Lidl sa číta priamo (nižšie). Ostatné obchody z agregátora **kimbino.sk**: stránka
obchodu (`/tesco/`) → odkazy na aktuálne letáky, stránka letáka → adresy obrázkov
strán z dát Nuxt (`__NUXT_DATA__`, server `eu.kimbicdn.com`) a platnosť. Zoznam
obchodu je v `config` pod `kstore:<obchod>`, letáky pod `leaflet:k-<obchod>-<id>`.
Obrázky idú tiež cez `/api/leaflets/image` (povolené len `imgproxy.leaflets.schwarz`
a `eu.kimbicdn.com`). V prehliadači letákov sa obchod vyberá hore; pri nákupe do
konkrétneho obchodu sa otvoria rovno jeho letáky. Weby Kauflandu a Tesca roboty
z Cloudflare blokujú, preto Kimbino. Rozpoznanie produktov a „+“ fungujú rovnako.

### Lidl

Po vytvorení nákupu sa aplikácia spýta, či otvoriť letáky; inak tlačidlo **Leták**
v detaile nákupu. Strany sa listujú prstom; **Krúžkovať** otvorí stranu, na ktorej sa
prstom zakrúžkuje tovar. Zakrúžkované miesto sa vystrihne ako malý obrázok (JPEG,
~10–20 kB) a po potvrdení (názov, počet, ktorý nákup – alebo nový „Nákup Lidl“)
pribudne položka s miniatúrou. Miniatúra sa ťuknutím zväčší.

**Výber tovaru:** leták sa otvorí rovno na strane; strany sa listujú ťahom do strany.
**Ťuknutie na produkt:** aplikácia vystrihne okolie prsta (≈ 45 % šírky strany) a pošle ho
`identifyLeafletProduct` – AI (Workers AI, `@cf/meta/llama-4-scout-17b-16e-instruct`)
povie, aký produkt je v strede výrezu, s cenou a presným ohraničením; otvorí sa okno
s predvyplneným názvom, počtom a cenou. Stojí ≈ 40 „neurónov“ z bezplatných 10 000 denne
(súčet v `config` pod `ai_neurons`, nad limit Workers Free nič neúčtuje, len odmietne).
Uzavretým ťahom sa dá tovar aj zakrúžkovať. Rozpoznanie celých strán vopred
(`analyzeLeafletPage`, `preanalyzeLeaflets`) ostalo na serveri, ale aplikácia ani cron
ho už nepoužívajú – polohy z celej strany boli príliš nepresné.

Prst na celej strane ťuká (výber produktu), krúžkuje (uzavretý ťah) alebo listuje
(vodorovný ťah do strany); po priblížení sa prepína medzi posúvaním a krúžkovaním. Položky majú cenu
(`price`, migrácia 0006) a v detaile nákupu sa ukáže odhad sumy.

Zdroj nie je oficiálne API: server prečíta zoznam letákov z lidl.sk a stránky
z `endpoints.leaflets.schwarz` (rovnako ako web Lidlu), výsledok drží v tabuľke
`config` a obnoví ho najviac raz za 6 hodín (pri výpadku ukáže posledný známy).
Obrázky strán idú cez `GET /api/leaflets/image?p=…` (len z `imgproxy.leaflets.schwarz`,
len pre prihlásených), aby sa z nich v prehliadači dalo strihať. Ak Lidl zmení
svoj web, prestane fungovať len táto časť.

## Nákup: „Nemali“ a história

Pri položke nákupu je tlačidlo **Nemali** (oranžová, počíta sa ako vybavená).
**Hotové** zapíše činnosť do tabuľky `historia` – kto a kedy, a každú položku so
stavom (kúpené / nemali / nekúpené), cenou a obrázkom (obrázky v histórii sa nemažú).
Pri opakovanom nákupe kúpené položky zmiznú a čo nemali, ostane na budúce.
Karta **História** ich ukazuje po dňoch.
Tlačidlo **Vrátiť** pri zázname vráti činnosť späť (`restoreHistory`): jednorazová
sa znova vytvorí z uloženej kópie (stĺpec `task`), opakovanej sa vráti termín;
položky dostanú stav z dokončenia. Pri opakovanej činnosti treba vracať od najnovšieho.

## Nákup: oddelenia, akcie, naživo

- **Oddelenia:** položky nákupu sa zoskupujú podľa oddelení obchodu (`PRODUKTY_ODDELENIA`
  v `public/produkty.js` + začiatky slov v `app.js`); čip prepne na poradie pridania.
- **Akcie a ceny:** `getOffers(text)` číta stránku produktu na kimbino.sk (`/hladat/?q=` →
  `/produkty/…/`, dáta Nuxt) – ponuky v platných letákoch všetkých obchodov, v `config`
  (`offers:<výraz>`) na 6 h. Pri položke nákupu sa ukáže najlacnejšia, ťuknutím všetky
  (otvoriť leták na strane, použiť cenu – `setItemPrice`). Raz denne po 9:00 (`src/deals.js`)
  dostanú členovia upozornenie na akcie často kupovaných produktov (každú akciu raz).
- **Nákup naživo:** každá zmena zvýši `households.rev` (triggery, migrácia 0009); appka sa
  každé 4 s pýta `getRev` a údaje načíta len pri zmene (aj v otvorenom detaile).
- **Znova:** v Histórii pri nákupe – nový nákup s tými istými položkami.

## Pripomienky, šablóny, vzhľad, skratky

- Činnosť môže mať čas (`due_time`, migrácia 0010); cron každých 5 min pošle pripomienku
  v ten čas (raz pre daný termín a čas).
- Sprievodca novou činnosťou ponúka šablóny (`SABLONY` v `app.js`).
- Vzhľad v účte: podľa telefónu / svetlý / tmavý (`data-theme` na `<html>`).
- Skratky ikony (manifest `shortcuts`): `/?akcia=nakup` (pridávanie do nákupu), `/?akcia=nova`.
- Hlasové pridávanie: mikrofón pri poli na pridanie (Web Speech API telefónu, nie Workers AI);
  „mlieko, dva chleby a maslo“ sa rozdelí na položky aj s počtom.
- Činnosť bez termínu (`due_date` prázdny, len bez opakovania) – sekcia „Bez termínu“.
- Komentáre pri činnosti (tabuľka `komentare`, migrácia 0011) – upozornenie riešiteľovi, naživo.

## Upozornenia (push notifikácie)

Zapínajú sa v aplikácii ťuknutím na 🔔 (po prvej prezývke ich Gazda ponúkne sama),
pre každé zariadenie zvlášť. Chodia, aj keď Gazda nie je otvorená:

| Upozornenie | Kedy |
|---|---|
| 🏠 **Dnes ťa čaká X úloh** | ráno o 8:00 (najneskôr do 11:59, ak by Cloudflare meškal) |
| ⚠️ **Po termíne: X úloh** | ráno spolu s prehľadom |
| 📝 **Prezývka: názov úlohy** | hneď, keď ti niekto iný pridelí činnosť – s obchodom, termínom a checklistom |

- **Android (Chrome):** funguje priamo v prehliadači aj v aplikácii z plochy.
- **iPhone (iOS 16.4+):** len v Gazdovi pridanom na plochu (*Zdieľať* → *Pridať na plochu*);
  v aplikácii z plochy ťukni na 🔔 a povoľ upozornenia.
- Kľúče VAPID si server vytvorí sám pri prvom použití (tabuľka `config`); súkromný
  kľúč neopustí Cloudflare, nič netreba nastavovať. Neplatné odbery (zariadenie
  odinštalované, upozornenia vypnuté) sa pri odoslaní automaticky zmažú.
- Ranný prehľad spúšťa **cron** Cloudflare každých 5 minút (`wrangler.json` → `triggers`);
  pošle sa raz denne (dátum posledného je v tabuľke `config`).
- Pri odhlásení sa upozornenia na danom zariadení vypnú.

## Prenos zo starej Gazdy (Google tabuľka)

1. V **novej Gazde** (prihlásený tým istým Google účtom, s ktorým používaš starú) ťukni na
   svoj krúžok → **Preniesť zo starej Gazdy**. Zobrazí sa jednorazový kód (platí 30 minút).
2. V **starej Gazde** ťukni na krúžok → **Preniesť do novej Gazdy**, skontroluj adresu
   (`https://gazda.<subdoména>.workers.dev`) a zadaj kód. Spustiť to smie len vlastník
   starej Gazdy (účet, pod ktorým beží Apps Script).
3. Stará Gazda pošle všetky listy na `POST /api/import`; nová ich skontroluje a uloží
   jednou transakciou. V novej Gazde ťukni **Hotovo – načítať**.

Prenesú sa domácnosti, členovia, priestory, úlohy (s opakovaním), checklisty s počtom
a stavom, obchody, produkty a naposledy otvorená domácnosť každého člena. Ostatní sa
potom len prihlásia svojím Google účtom (tým e-mailom, ktorý mali v starej Gazde)
a zvolia si prezývku. Prenos sa dá zopakovať – podľa id sa záznamy aktualizujú, nič
sa nezdvojí ani nezmaže (úlohy pridané medzitým v novej Gazde ostanú). Po 10
nesprávnych kódoch kód prestane platiť.

## Databáza

Tabuľky zodpovedajú listom Google tabuľky: `households`, `members`, `priestory`,
`cinnosti`, `polozky`, `obchody`, `produkty`, `users`, `sessions` (prihlásené
zariadenia), `push_subscriptions` (zariadenia s upozorneniami) a `config`. Databáza sa vytvorí
v západnej Európe. Obchody a produkty sa porovnávajú podľa `name_key` (názov
malými písmenami aj s diakritikou), aby „Šunka“ a „šunka“ boli jeden produkt.

## Automatické nasadenie (GitHub Actions)

Workflow `.github/workflows/deploy-cloudflare.yml`:

- **Pull request** → testy a nasadenie na **náhľad** – samostatný worker
  `gazda-preview` s vlastnou databázou, takže skúšanie nezasiahne ostré údaje.
  Adresa náhľadu je v súhrne behu (Actions → beh → Summary).
- **Push do `main`** → testy, migrácie databázy a nasadenie na `gazda`.
- Kým nie sú nastavené secrets, nasadenie sa len preskočí (s upozornením).

### Jednorazové nastavenie

1. **Účet Cloudflare** – zaregistruj sa zadarmo na <https://dash.cloudflare.com/sign-up>.
2. **Subdoména workers.dev** – Cloudflare ju novým účtom pridelí sám (nič netreba
   nastavovať). Nájdeš ju v **Workers & Pages** vpravo v časti **Account details →
   Subdomain** (tlačidlom *Change* sa dá premenovať). Gazda pobeží na
   `https://gazda.<subdoména>.workers.dev`.
3. **ID účtu** – v tej istej časti **Account details** (alebo v URL po
   `dash.cloudflare.com/`) je **Account ID**. Skopíruj ho.
4. **API token** – vpravo hore ikona profilu → **Profile → API Tokens → Create Token**:
   - šablóna **Edit Cloudflare Workers** → *Use template*
   - pridaj riadok oprávnení: **Account → D1 → Edit**
   - *Account Resources*: tvoj účet; *Zone Resources*: **All zones** (alebo nechaj predvolené)
   - **Continue to summary → Create Token** a token skopíruj (zobrazí sa len raz).
5. **GitHub secrets** – v repozitári **Settings → Secrets and variables → Actions →
   New repository secret**:
   - `CLOUDFLARE_API_TOKEN` = token z kroku 4
   - `CLOUDFLARE_ACCOUNT_ID` = ID z kroku 3
6. Spusti nasadenie: **Actions → Nasadenie Cloudflare → Run workflow** (vetva `main`).
   Adresa Gazdy je v súhrne behu.

API token je ako heslo – vkladaj ho len do GitHub secrets, nikomu ho neposielaj.

### Prihlásenie Google účtom (Google Cloud, zadarmo)

1. Otvor <https://console.cloud.google.com/> a vytvor projekt (napr. **Gazda**).
2. **Google Auth Platform** (predtým *OAuth consent screen*) → **Get started**:
   názov aplikácie **Gazda**, e-mail podpory, publikum **External**, kontaktný e-mail.
3. **Audience** → **Publish app** (*In production*), aby sa mohol prihlásiť hocikto
   s Google účtom. Gazda žiada len e-mail a meno, takže overenie aplikácie Googlom
   netreba. (Alternatíva: nechať *Testing* a pridať členov domácnosti ako *Test users*.)
4. **Clients** → **Create client** → typ **Web application**, v časti
   **Authorized JavaScript origins** pridaj:
   - `https://gazda.<subdoména>.workers.dev`
   - `https://gazda-preview.<subdoména>.workers.dev`
5. Skopíruj **Client ID** (končí na `.apps.googleusercontent.com`; nie je tajný).
6. V GitHub repozitári **Settings → Secrets and variables → Actions → záložka
   Variables → New repository variable**: `GOOGLE_CLIENT_ID` = Client ID.
7. Pri ďalšom nasadení sa Client ID dostane do aplikácie a objaví sa tlačidlo
   *Prihlásiť sa cez Google*.

## Lokálne

```sh
cd cloudflare
npm install
npm test          # testy na lokálnej databáze
npm run dev       # lokálny server na http://localhost:8787
```

Pred `npm run dev` treba lokálne aplikovať migrácie:
`npx wrangler d1 migrations apply DB --local --env=""` a do súboru `.dev.vars`
dať `GOOGLE_CLIENT_ID="…"` (a do Google Cloud pridať origin `http://localhost:8787`).
Lokálne beží bez Workers AI (`--local`), rozpoznávanie produktov v letákoch tam nefunguje.
