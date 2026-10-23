import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { fold } from '../src/calendar.js';

let t;
before(async () => {
  t = await setup();
  t.env.TODAY = '2026-10-23';
});
after(() => t.dispose());

const unfold = (ics) => ics.replace(/\r\n /g, '');

test('kalendár Family Grid: udalosti Zdravka a úlohy Gazdy, súkromná adresa', async () => {
  const eva = await t.user('eva@example.com');
  const { households } = await eva.api.createHousehold('Novákovci', 'adam@example.com');
  const id = households[0].id;
  const adam = await t.user('adam@example.com');
  await adam.api.setNickname('Adam');
  const janko = await t.call(eva.cookie, 'zdravko/saveMember', id, { name: 'Janko', birthDate: '2020-01-01' });
  await t.call(eva.cookie, 'zdravko/saveEvent', janko.id, {
    eventType: 'vaccination', subtype: 'MMR (osýpky, príušnice, ružienka)', eventAt: '2026-11-05T08:30:00.000Z', notes: 'kartička; poistenec', cost: '12.5',
  });
  const { id: kuchyna } = await eva.api.addPriestor(id, 'Kuchyňa');
  await eva.api.addCinnost(id, { name: 'Smeti', priestorId: kuchyna, dueDate: '2026-10-24', dueTime: '18:30', assignedTo: 'eva@example.com', periodicity: 'weekly', repeatInterval: 2 });
  await eva.api.addCinnost(id, { name: 'Adamova', priestorId: kuchyna, dueDate: '2026-10-25', assignedTo: 'adam@example.com', periodicity: 'none' });
  await eva.api.addCinnost(id, { name: 'Nákup', kind: 'nakup', store: 'Lidl', dueDate: '2026-10-26', assignedTo: '*', periodicity: 'none' });
  await eva.api.addCinnost(id, { name: 'Bez termínu', priestorId: kuchyna, dueDate: '', assignedTo: '*', periodicity: 'none' });

  assert.deepEqual(await eva.api.getCalendarFeed(), { active: false });
  const { url } = await eva.api.createCalendarFeed();
  assert.match(url, /^https:\/\/gazda\.test\/api\/calendar\/[0-9a-f]{48}\.ics$/);
  const path = new URL(url).pathname;

  const res = await t.fetch(path);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/calendar; charset=utf-8');
  const raw = await res.text();
  assert.ok(raw.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  const ics = unfold(raw);
  assert.match(ics, /X-WR-CALNAME:Family Grid/);
  assert.match(ics, /SUMMARY:💉 Janko: MMR \(osýpky\\, príušnice\\, ružienka\)/);
  assert.match(ics, /DTSTART:20261105T083000Z\r\nDTEND:20261105T093000Z/);
  assert.ok(ics.includes('kartička\\; poistenec'));
  assert.match(ics, /DTSTART;TZID=Europe\/Bratislava:20261024T183000\r\nDTEND;TZID=Europe\/Bratislava:20261024T190000\r\nRRULE:FREQ=WEEKLY;INTERVAL=2/);
  assert.match(ics, /SUMMARY:🛒 Nákup: Lidl/);
  assert.doesNotMatch(ics, /Adamova/); // predvolene len moje a spoločné
  assert.doesNotMatch(ics, /Bez termínu/);

  const all = unfold(await (await t.fetch(path + '?gazda=all')).text());
  assert.match(all, /SUMMARY:🏠 Adamova/);
  assert.match(all, /Kto: Adam/);
  const none = unfold(await (await t.fetch(path + '?gazda=none')).text());
  assert.doesNotMatch(none, /CATEGORIES:Gazda/);
  assert.match(none, /CATEGORIES:Zdravko/);

  assert.equal((await eva.api.getCalendarFeed()).active, true);
  // nová adresa zruší starú
  const second = await eva.api.createCalendarFeed();
  assert.equal((await t.fetch(path)).status, 404);
  assert.equal((await t.fetch(new URL(second.url).pathname)).status, 200);
  await eva.api.deleteCalendarFeed();
  assert.equal((await t.fetch(new URL(second.url).pathname)).status, 404);
  assert.equal((await t.fetch('/api/calendar/zle.ics')).status, 404);
});

test('zalamovanie riadkov nerozdelí znak', () => {
  const line = 'SUMMARY:' + 'ž'.repeat(60);
  const out = fold(line);
  assert.ok(out.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75));
  assert.equal(out.replace(/\r\n /g, ''), line);
});
