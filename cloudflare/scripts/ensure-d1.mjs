// Pred nasadením: nájde databázu D1 podľa názvu vo wrangler.json (pri prvom
// nasadení ju vytvorí) a doplní jej ID do wrangler.json. Spúšťa sa v CI.
//
//   node scripts/ensure-d1.mjs            # produkcia (databáza „gazda“)
//   node scripts/ensure-d1.mjs preview    # náhľad (databáza „gazda-preview“)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const envName = process.argv[2] || '';
const configPath = new URL('../wrangler.json', import.meta.url);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const target = envName ? config.env?.[envName] : config;
if (!target) throw new Error(`Prostredie „${envName}“ nie je vo wrangler.json.`);
const binding = target.d1_databases.find((d) => d.binding === 'DB');

// WRANGLER sa dá prepísať (testy); inak lokálne nainštalovaný wrangler.
const [cmd, ...baseArgs] = (process.env.WRANGLER || 'npx wrangler').split(' ');
const wrangler = (...args) => execFileSync(cmd, [...baseArgs, ...args], { encoding: 'utf8' });

const find = () =>
  JSON.parse(wrangler('d1', 'list', '--json')).find((d) => d.name === binding.database_name);

let db = find();
if (!db) {
  console.log(`Vytváram databázu D1 „${binding.database_name}“…`);
  wrangler('d1', 'create', binding.database_name, '--location', 'weur');
  db = find();
}
if (!db) throw new Error(`Databázu „${binding.database_name}“ sa nepodarilo nájsť ani vytvoriť.`);

binding.database_id = db.uuid;
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
console.log(`Databáza „${binding.database_name}“: ${db.uuid}`);
