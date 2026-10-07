# Gazda – verzia pre Cloudflare

Nová verzia Gazdy na **Cloudflare Workers** s databázou **D1**. Beží zadarmo
(bezplatný plán Cloudflare), bez platobnej karty. Upozornenia budú len ako
push notifikácie priamo z aplikácie.

> Stav: **fáza 3 – aplikácia.** Gazda na Cloudflare má všetky funkcie verzie Apps Script
> okrem upozornení (push notifikácie pribudnú vo fáze 4), dá sa nainštalovať na plochu
> a každý sa prihlasuje **svojím Google účtom** (žiadne osobné odkazy).
> Dáta sa z Google tabuľky prenesú vo fáze 5; dovtedy Gazda beží aj na Apps Script.

## Súbory

| Súbor / priečinok | Obsah |
|---|---|
| `src/index.js` | Server (Worker): smerovanie `/api/*`, ostatné sú statické súbory |
| `src/api.js` | Funkcie API (rovnaké ako vo verzii Apps Script) |
| `src/domain.js` | Doménová logika: opakovanie, počet pri položkách, validácie |
| `src/auth.js` | Prihlásenie: relácia v cookie (v databáze len SHA-256 odtlačok) |
| `src/google.js` | Overenie Google ID tokenu (podpis RS256, Client ID, platnosť, overený e-mail) |
| `src/notifications.js` | Push notifikácie (fáza 4) |
| `public/index.html`, `app.js`, `app.css`, `produkty.js` | Aplikácia (prevzatá z `apps_script/`, volá `/api/*` cez `fetch`) |
| `public/sw.js` | Service worker: otvorenie bez internetu (neskôr push) |
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
`deleteHousehold`, `getHouseholdData`, `addPriestor`, `addCinnost`, `updateCinnost`,
`addItem`, `toggleItem`, `deleteCinnost`, `completeCinnost`. `GET /api/health`
overí databázu.

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
- **Zdieľanie:** domácnosť sa zdieľa na Google e-mail; ten človek sa prihlási
  a domácnosť hneď vidí. V okne *Zdieľať* je vidieť, kto sa ešte neprihlásil.
- **Inštalácia na plochu:** Android/Chrome – menu ⋮ → *Pridať na plochu* (alebo
  *Inštalovať aplikáciu*); iPhone/Safari – *Zdieľať* → *Pridať na plochu*
  (na iPhone sa v aplikácii z plochy treba raz prihlásiť znova).
- **Automatická obnova:** otvorená domácnosť sa každých 20 s (a po návrate do
  aplikácie) potichu obnoví, takže zmeny od ostatných sa ukážu samé.
- **Bez internetu** sa Gazda otvorí z pamäte telefónu s poslednými údajmi.

## Databáza

Tabuľky zodpovedajú listom Google tabuľky: `households`, `members`, `priestory`,
`cinnosti`, `polozky`, `obchody`, `produkty`, `users` a `sessions` (prihlásené
zariadenia). Databáza sa vytvorí
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
