import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';
import { dartToUtc, dartToYmd, mapZdravko } from '../src/zdravko/import.js';
import { sendZdravkoReminders } from '../src/zdravko/notifications.js';

let t;
before(async () => {
  t = await setup();
});
after(() => t.dispose());

const zd = (u) => new Proxy({}, { get: (_, name) => (...args) => t.call(u.cookie, 'zdravko/' + name, ...args) });

async function family(email, share = '') {
  const u = await t.user(email);
  const { households } = await u.api.createHousehold('Rodina', share);
  return { u, householdId: households[households.length - 1].id, api: zd(u) };
}

const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

test('členovia rodiny – zdieľaní, kontrola údajov', async () => {
  const { householdId, api } = await family('mama@example.com', 'otec@example.com');
  const janko = await api.saveMember(householdId, { name: 'Janko', birthDate: '2021-05-02', weight: '14,5', isChild: true, gender: 'Muž' });
  assert.equal(janko.weight, 14.5);
  assert.equal(janko.isChild, true);
  await assert.rejects(api.saveMember(householdId, { name: '' , birthDate: '2021-05-02' }), /meno/);
  await assert.rejects(api.saveMember(householdId, { name: 'X' }), /dátum narodenia/);
  await assert.rejects(api.saveMember(householdId, { name: 'X', birthDate: '2000-01-01', email: 'zle' }), /e-mail/);
  const otec = await t.user('otec@example.com');
  assert.deepEqual((await zd(otec).getData(householdId)).members.map((m) => m.name), ['Janko']);
  const cudzi = await t.user('cudzi@example.com');
  await assert.rejects(zd(cudzi).getData(householdId), /nemáš prístup/);
  await assert.rejects(zd(cudzi).addRecords(janko.id, { recordedAt: new Date().toISOString(), temperature: 38 }), /nemáš prístup/);
});

test('záznamy choroby: teplota + liek + metóda naraz, striedanie liekov', async () => {
  const { householdId, api } = await family('z1@example.com');
  const m = await api.saveMember(householdId, { name: 'Anička', birthDate: '2020-01-10' });
  const given = new Date(Date.now() - 3600000).toISOString(); // pred hodinou
  const recs = await api.addRecords(m.id, {
    recordedAt: given,
    temperature: '38,6',
    medicine: { name: 'Ibuprofen', dosage: '5 ml', substanceId: 'ibuprofen' },
    rest: { method: 'rest_otieranie', durationHours: 0.5 },
  });
  assert.deepEqual(recs.map((r) => r.type), ['temperature', 'medicine', 'rest']);
  assert.equal(recs[0].temperature, 38.6);
  const rem = (await t.env.DB.prepare('SELECT kind, title FROM zdravko_reminders ORDER BY fire_at').all()).results;
  assert.deepEqual(rem.map((r) => r.kind), ['alt_4h', 'alt_8h']);
  assert.match(rem[0].title, /Anička: môžeš podať Paracetamol/);

  // ďalší liek nahradí čakajúce pripomienky
  await api.addRecords(m.id, { recordedAt: new Date().toISOString(), medicine: { name: 'Paracetamol', substanceId: 'paracetamol' } });
  const rem2 = (await t.env.DB.prepare('SELECT title FROM zdravko_reminders ORDER BY fire_at').all()).results;
  assert.equal(rem2.length, 2);
  assert.match(rem2[0].title, /môžeš podať Ibuprofen/);

  await assert.rejects(api.addRecords(m.id, { recordedAt: given }), /Zadaj teplotu/);
  await assert.rejects(api.addRecords(m.id, { recordedAt: given, temperature: 50 }), /30 a 45/);
  await assert.rejects(api.addRecords(m.id, { recordedAt: inHours(48), temperature: 37 }), /budúcnosti/);

  const data = await api.getData(householdId);
  assert.equal(data.records.length, 4);
  await api.deleteRecord(recs[1].id);
  assert.equal((await api.getData(householdId)).records.length, 3);
});

test('udalosti u lekára: pripomienky, úprava a presun ich prepočíta', async () => {
  const { householdId, api, u } = await family('z2@example.com');
  const m = await api.saveMember(householdId, { name: 'Peťko', birthDate: '2019-03-03' });
  const at = inHours(30);
  const ev = await api.saveEvent(m.id, { eventType: 'doctor_visit', subtype: 'Pediatrička / pediater', eventAt: at, reminders: ['day_before', 'hour_before', 'week_before', 'nieco'], cost: '12,50' });
  assert.deepEqual(ev.reminders, ['day_before', 'hour_before', 'week_before']);
  assert.equal(ev.cost, 12.5);
  let rem = (await t.env.DB.prepare('SELECT kind, body FROM zdravko_reminders WHERE record_id = ? ORDER BY fire_at').bind(ev.id).all()).results;
  // týždeň pred je už v minulosti
  assert.deepEqual(rem.map((r) => r.kind), ['day_before', 'hour_before']);
  assert.match(rem[0].body, /^Pediatrička \/ pediater – zajtra o \d\d:\d\d$/);

  // presun o týždeň neskôr
  await api.saveEvent(m.id, { ...ev, eventAt: inHours(30 + 24 * 7) });
  rem = (await t.env.DB.prepare('SELECT kind FROM zdravko_reminders WHERE record_id = ? ORDER BY fire_at').bind(ev.id).all()).results;
  assert.deepEqual(rem.map((r) => r.kind), ['week_before', 'day_before', 'hour_before']);
  await assert.rejects(api.saveEvent(m.id, { eventType: 'doctor_visit', eventAt: at }), /podtyp/);

  const overview = (await u.api.getFamily()).overview.zdravko;
  assert.equal(overview.upcoming, 1);

  // cron pošle pripomienku, keď nastane čas (a len raz)
  await t.env.DB.prepare("INSERT INTO push_subscriptions (endpoint, email, p256dh, auth, created_at) VALUES ('https://push.example/z2', 'z2@example.com', 'x', 'y', '')").run();
  const later = new Date(Date.now() + (30 + 24 * 7 - 23) * 3600000); // po pripomienke „deň pred“
  await sendZdravkoReminders(t.env.DB, later);
  const sent = (await t.env.DB.prepare("SELECT kind, sent_at FROM zdravko_reminders WHERE record_id = ? ORDER BY fire_at").bind(ev.id).all()).results;
  assert.equal(sent[0].sent_at, 'missed'); // týždeň pred – zmeškaná o viac ako 6 h
  assert.notEqual(sent[1].sent_at, '');
  assert.equal(sent[2].sent_at, '');

  // vymazanie člena zmaže aj jeho záznamy a pripomienky
  await api.deleteMember(m.id);
  assert.equal((await t.env.DB.prepare('SELECT COUNT(*) AS n FROM zdravko_reminders WHERE record_id = ?').bind(ev.id).first()).n, 0);
});

test('miery dieťaťa a „nastaviť ako aktuálne“', async () => {
  const { householdId, api } = await family('z3@example.com');
  const m = await api.saveMember(householdId, { name: 'Bábo', birthDate: '2026-01-01', isChild: true });
  const x = await api.saveMeasurement(m.id, { measuredAt: '2026-10-01', weight: 7.85, height: 68, head: 43 });
  await assert.rejects(api.saveMeasurement(m.id, { measuredAt: '2026-10-01' }), /aspoň jednu/);
  const updated = await api.setCurrentMeasurement(x.id);
  assert.equal(updated.weight, 7.85);
  assert.equal(updated.height, 68);
  await api.saveMeasurement(m.id, { id: x.id, measuredAt: '2026-10-02', weight: 8 });
  const data = await api.getData(householdId);
  assert.deepEqual(data.measurements.map((y) => [y.measuredAt, y.weight, y.height]), [['2026-10-02', 8, null]]);
  await api.deleteMeasurement(x.id);
  assert.equal((await api.getData(householdId)).measurements.length, 0);
});

test('časy zo starého Zdravka (miestny čas aj UTC)', () => {
  assert.equal(dartToUtc('2025-12-28T14:30:00.000'), '2025-12-28T13:30:00.000Z'); // zima +1
  assert.equal(dartToUtc('2025-07-01T08:00:00.123456'), '2025-07-01T06:00:00.123Z'); // leto +2
  assert.equal(dartToUtc('2025-07-01T00:00:00.000Z'), '2025-07-01T00:00:00.000Z');
  assert.equal(dartToUtc('nie'), '');
  assert.equal(dartToYmd('2019-04-03T00:00:00.000'), '2019-04-03');
  assert.equal(dartToYmd('2025-07-01T23:30:00.000Z'), '2025-07-02');
});

test('mapovanie Firestore: záznamy bez člena a vymazaných členov', () => {
  const doc = (id, data) => ({ id, path: ['x', id], data });
  const one = mapZdravko('H', 'a@b.c', {
    members: [doc('1', { name: 'Janko', dateOfBirth: '2020-02-02T00:00:00.000', isChild: true, weight: 15 })],
    records: [
      doc('100_temp', { type: 'temperature', timestamp: '2025-12-28T14:30:00.000', temperature: 38.2 }), // bez memberId
      doc('101_med', { type: 'medicine', memberId: '1', timestamp: '2025-12-28T14:31:00.000', medicineName: 'Ibuprofen', dosage: '5 ml', substanceId: 'ibuprofen' }),
      doc('102_rest', { type: 'rest', memberId: '1', timestamp: '2025-12-28T14:32:00.000', method: 'rest_sprcha', durationMinutes: 30 }),
      doc('103', { type: 'calendar_event', memberId: '1', timestamp: '2025-12-29T00:00:00.000Z', eventType: 'vaccination', subtype: 'Ovčie kiahne', appointmentTime: '2026-01-05T09:15:00.000', reminders: ['day_before'], cost: 20 }),
      doc('104', { type: 'temperature', memberId: 'vymazany', timestamp: '2025-12-28T10:00:00.000', temperature: 37 }),
    ],
    measurements: [doc('200', { memberId: '1', date: '2025-03-01T14:22:10.123456', weight: 12.5, height: 90 })],
  });
  assert.equal(one.members[0].birth_date, '2020-02-02');
  assert.equal(one.records.length, 4);
  assert.equal(one.records[0].member_id, 'fb-1'); // jediný člen dostane aj záznamy bez memberId
  assert.equal(one.records[2].duration_hours, 0.5);
  assert.equal(one.records[3].event_at, '2026-01-05T08:15:00.000Z');
  assert.equal(one.records[3].reminders, '["day_before"]');
  assert.equal(one.measurements[0].measured_at, '2025-03-01');
  assert.equal(one.skipped, 1);
});

test('prenos z Firebase do rodiny', async () => {
  const { householdId, api } = await family('fbz@example.com');
  const keys = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
  t.env.FIREBASE_ZDRAVKO_SA = JSON.stringify({
    project_id: 'zdravko-test',
    client_email: 'x@zdravko-test.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\n' + pkcs8 + '\n-----END PRIVATE KEY-----\n',
  });
  const S = (v) => ({ stringValue: v });
  const doc = (path, fields) => ({ name: 'projects/zdravko-test/databases/(default)/documents/' + path, fields });
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  t.env.TEST_FETCH = async (url, init = {}) => {
    url = String(url);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'T' });
    if (url.includes('accounts:lookup')) return Response.json({ users: [{ localId: 'UID' }] });
    if (url.includes('/users/UID/family_members?')) {
      return Response.json({ documents: [doc('users/UID/family_members/1', { name: S('Janko'), dateOfBirth: S('2020-02-02T00:00:00.000'), isChild: { booleanValue: true } })] });
    }
    if (url.includes('/users/UID/medical_records?')) {
      if (!url.includes('pageToken')) {
        return Response.json({
          documents: [doc('users/UID/medical_records/1_temp', { type: S('temperature'), memberId: S('1'), timestamp: S('2025-12-28T14:30:00.000'), temperature: { doubleValue: 38.5 } })],
          nextPageToken: 'P2',
        });
      }
      return Response.json({
        documents: [doc('users/UID/medical_records/2', { type: S('calendar_event'), memberId: S('1'), timestamp: S(future), eventType: S('doctor_visit'), subtype: S('Zubár'), appointmentTime: S(future), reminders: { arrayValue: { values: [S('day_before')] } } })],
      });
    }
    if (url.includes('/users/UID/child_measurements?')) return Response.json({});
    throw new Error('neočakávané ' + url);
  };
  try {
    const res = await api.importFirebase(householdId);
    assert.deepEqual([res.members, res.records, res.measurements, res.skipped], [1, 2, 0, 0]);
    const again = await api.importFirebase(householdId);
    assert.equal(again.records, 2);
    const data = await api.getData(householdId);
    assert.equal(data.members.length, 1);
    assert.equal(data.records.length, 2);
    const rem = (await t.env.DB.prepare("SELECT kind FROM zdravko_reminders WHERE record_id = 'fb-2' AND sent_at = ''").all()).results;
    assert.deepEqual(rem.map((r) => r.kind), ['day_before']); // nezdvojí sa
  } finally {
    delete t.env.TEST_FETCH;
    delete t.env.FIREBASE_ZDRAVKO_SA;
  }
});
