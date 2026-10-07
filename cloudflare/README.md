# Gazda – verzia pre Cloudflare

Nová verzia Gazdy na **Cloudflare Workers** s databázou **D1**. Beží zadarmo
(bezplatný plán Cloudflare), bez platobnej karty. Upozornenia budú len ako
push notifikácie priamo z aplikácie.

> Stav: **fáza 5 – prenos dát.** Gazda na Cloudflare má všetky funkcie verzie Apps Script,
> upozornenia chodia ako **push notifikácie** priamo z aplikácie, dá sa nainštalovať na
> plochu a každý sa prihlasuje **svojím Google účtom** (žiadne osobné odkazy).
> Dáta zo starej Gazdy (Google tabuľka) sa prenesú tlačidlom – pozri *Prenos zo starej Gazdy*.

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

**Rozpoznanie produktov:** pri otvorení strany server pošle obrázok strany do
Workers AI (model `@cf/meta/llama-4-scout-17b-16e-instruct`, binding `AI`), ktorý
vráti produkty s názvom, cenou a ohraničením. Na každom produkte je tlačidlo **+**:
označí celý produkt, vystrihne ho a ponúkne pridať s predvyplneným názvom a cenou.
Každá strana sa rozpoznáva len raz (výsledok je v `config` pod `products:<leták>:<strana>`
pre všetkých). Cron (každých 15 min) rozpozná vopred po 4 strany aktuálnych letákov
a aplikácia pri prezeraní pripraví ďalšie 3 strany, takže „+“ sú väčšinou hneď.

Je to zadarmo: Workers AI na pláne Workers Free dáva 10 000 „neurónov“ denne a nad
limit nič neúčtuje (len odmietne). Strana stojí ~80, celý leták so 100 stranami
~8 000 – a to len raz za jeho platnosť. Príprava vopred si berie najviac 7 000 denne
(súčet v `config` pod `ai_neurons`), zvyšok ostáva na strany otvorené hneď; čo sa
nestihne, dorobí sa ďalší deň. Po vyčerpaní limitu ostáva krúžkovanie.

**Ťuknutie na produkt** (alebo na „+“): ohraničenia z rozpoznania celej strany sú len
odhad modelu (bývajú posunuté), preto aplikácia vystrihne okolie prsta (≈ 45 % šírky
strany) a pošle ho `identifyLeafletProduct` – AI povie, aký produkt je v strede výrezu,
s cenou a presným ohraničením (≈ 40 neurónov, počíta sa do denného limitu).

V režime výberu tovaru prst na celej strane krúžkuje (uzavretý ťah) alebo listuje
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
- Ranný prehľad spúšťa **cron** Cloudflare každých 15 minút (`wrangler.json` → `triggers`);
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
