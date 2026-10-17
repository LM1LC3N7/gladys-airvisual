// -----------------------------------------------------------------------------
// The AirVisual client: the answers and errors of the API (pyairvisual's
// fixtures), the pace, the budget, the pauses, the bounded bodies.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { AirVisualClient, checkAnswer, keyHash } from '../src/airvisual.js';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Budget, fileStorage, memoryStorage } from '../src/budget.js';
import { DAILY_CALLS, LIMITED_MAX } from '../src/constants.js';
import { getJson } from '../src/http.js';
import { FIXTURE_NOW, fail, fixture, installFetch, json } from './helpers/fakes.js';

let fake;
afterEach(() => fake?.restore());

const KEY = { apiKey: 'SECRET-KEY-1' };

function clientWith(routes, { storage } = {}) {
  fake = installFetch(routes);
  const clock = { now: FIXTURE_NOW };
  const sleeps = [];
  const client = new AirVisualClient({
    now: () => clock.now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    storage,
  });
  return { client, clock, sleeps };
}

const kindOf = (answer) => checkAnswer(answer).kind;

test('the errors of the API are classified as pyairvisual does', () => {
  const body = (message) => ({ status: 'fail', data: { message } });
  assert.equal(kindOf({ status: 400, body: body('incorrect_api_key') }), 'refused');
  assert.equal(kindOf({ status: 400, body: body('api_key_expired') }), 'refused');
  assert.equal(kindOf({ status: 402, body: body('Payment Required') }), 'refused');
  assert.equal(kindOf({ status: 403, body: body('permission_denied') }), 'refused');
  assert.equal(kindOf({ status: 403, body: body('Forbidden') }), 'refused');
  assert.equal(kindOf({ status: 401, body: 'nope' }), 'refused');
  assert.equal(kindOf({ status: 429, body: body('call_limit_reached') }), 'limited');
  assert.equal(checkAnswer({ status: 429, body: body('call_limit_reached') }).quota, true);
  assert.equal(kindOf({ status: 429, body: body('too_many_requests') }), 'limited');
  assert.equal(kindOf({ status: 429, body: '<html>' }), 'limited');
  assert.equal(kindOf({ status: 400, body: body('city_not_found') }), 'not_found');
  assert.equal(kindOf({ status: 404, body: '"node not found"' }), 'not_found');
  assert.equal(kindOf({ status: 400, body: body('no_nearest_station') }), 'no_station');
  assert.equal(kindOf({ status: 400, body: body('unknown_key') }), 'failed');
  // A bare 403 (a proxy, a CDN page) is not the key.
  assert.equal(kindOf({ status: 403, body: '<html>Forbidden</html>' }), 'failed');
  assert.equal(kindOf({ status: 502, body: '' }), 'failed');
  assert.equal(kindOf({ status: 200, body: { status: 'weird' } }), 'failed');
  assert.deepEqual(checkAnswer({ status: 200, body: { status: 'success', data: { a: 1 } } }), {
    a: 1,
  });
});

test('nearest_city: the rounded position and the key, 13 s between calls', async () => {
  const { client, sleeps } = clientWith([
    [/\/v2\/nearest_city\?/, () => json(fixture('nearest_city.json'))],
  ]);
  const data = await client.nearestCity(48.856614, 2.3522219, KEY);
  assert.equal(data.city, 'Paris');
  await client.nearestCity(48.85, 2.35, KEY);
  const [first] = fake.calls;
  assert.equal(first.params.lat, '48.86');
  assert.equal(first.params.lon, '2.35');
  assert.equal(first.params.key, 'SECRET-KEY-1');
  assert.ok(first.url.startsWith('https://api.airvisual.com/v2/nearest_city?'));
  assert.deepEqual(sleeps, [13_000]);
  assert.equal(client.budget.used(), 2);
});

test('a refused key stops every call for 6 hours; only the test button may try again', async () => {
  const { client, clock } = clientWith([[/\/v2\/city\?/, () => fail('incorrect_api_key')]]);
  const where = { city: 'Lyon', state: 'Auvergne-Rhone-Alpes', country: 'France' };
  await assert.rejects(client.city(where, KEY), { kind: 'refused' });
  assert.equal(client.keyState, 'refused');
  await assert.rejects(client.city(where, KEY), { kind: 'refused' });
  await assert.rejects(client.nearestCity(1, 2, KEY), { kind: 'refused' });
  assert.equal(fake.calls.length, 1, 'no second call with a refused key');
  await assert.rejects(client.city(where, { ...KEY, force: true }), { kind: 'refused' });
  assert.equal(fake.calls.length, 2, 'the test button tried once');
  clock.now += 6 * 60 * 60_000 + 1;
  await assert.rejects(client.city(where, KEY), { kind: 'refused' });
  assert.equal(fake.calls.length, 3, 'one new try after 6 hours');
  client.reset();
  assert.equal(client.keyState, 'ok');
});

test('a 429 pauses every path, bounded between 1 minute and 6 hours', async () => {
  let answer = () => fail('call_limit_reached', 429);
  const { client, clock } = clientWith([[/\/v2\//, () => answer()]]);
  await assert.rejects(client.nearestCity(1, 2, KEY), { kind: 'limited' });
  // call_limit_reached without Retry-After: 1 hour.
  assert.equal(client.keyPausedUntil - clock.now, 60 * 60_000);
  // Every path holds, the test button too.
  await assert.rejects(client.city({ city: 'a', state: 'b', country: 'c' }, KEY), {
    kind: 'limited',
  });
  await assert.rejects(client.nearestCity(1, 2, { ...KEY, force: true }), { kind: 'limited' });
  assert.equal(fake.calls.length, 1);
  // A second one doubles, a huge Retry-After is capped at 6 hours.
  clock.now = client.keyPausedUntil;
  await assert.rejects(client.nearestCity(1, 2, KEY));
  assert.equal(client.keyPausedUntil - clock.now, 2 * 60 * 60_000);
  clock.now = client.keyPausedUntil;
  answer = () => fail('too_many_requests', 429, { 'retry-after': '999999' });
  await assert.rejects(client.nearestCity(1, 2, KEY));
  assert.equal(client.keyPausedUntil - clock.now, LIMITED_MAX);
  clock.now = client.keyPausedUntil;
  answer = () => fail('too_many_requests', 429, { 'retry-after': '1' });
  await assert.rejects(client.nearestCity(1, 2, KEY));
  assert.equal(client.keyPausedUntil - clock.now, 60_000, 'never under a minute');
  clock.now = client.keyPausedUntil;
  answer = () => json(fixture('nearest_city.json'));
  await client.nearestCity(1, 2, KEY);
  assert.equal(client.keyState, 'ok');
  assert.equal(client.limitedStreak, 0);
});

test('the daily budget: periodic reads keep a reserve, the count survives a restart', async () => {
  const storage = memoryStorage({ day: '2026-10-17', count: DAILY_CALLS - 21 });
  const { client, clock } = clientWith(
    [[/\/v2\/nearest_city/, () => json(fixture('nearest_city.json'))]],
    { storage },
  );
  await client.nearestCity(1, 2, KEY);
  await assert.rejects(client.nearestCity(1, 2, KEY), { kind: 'budget' });
  // The test button may use the reserve.
  await client.nearestCity(1, 2, { ...KEY, reserve: false });
  assert.equal(fake.calls.length, 2);
  const saved = storage.load();
  assert.deepEqual([saved.day, saved.count], ['2026-10-17', DAILY_CALLS - 19]);
  assert.ok(!JSON.stringify(saved).includes('SECRET-KEY-1'), 'the key itself is never saved');
  const again = new Budget({ storage, now: () => clock.now });
  assert.equal(again.used(), DAILY_CALLS - 19);
  // A new UTC day opens it again.
  assert.equal(again.resetsAt(), Date.parse('2026-10-18T00:00:00Z'));
  clock.now = again.resetsAt();
  assert.equal(again.used(), 0);
  assert.ok(again.allows());
});

test('the nodes: no API key sent, both answer shapes, their own 429 pause', async () => {
  let answer = () => json(fixture('node.json'));
  const { client, clock } = clientWith([
    [/^https:\/\/www\.airvisual\.com\/api\/v2\/node\/abcdef123456$/, () => answer()],
    [/^https:\/\/device\.iqair\.com\/v2\/5f3e2d1c0b9a$/, () => json(fixture('node_iqair.json'))],
  ]);
  const node = { id: 'abcdef123456', host: 'airvisual', hash: 'h1' };
  const doc = await client.node(node);
  assert.equal(doc.current.co, 612);
  assert.equal(
    (await client.node({ id: '5f3e2d1c0b9a', host: 'iqair', hash: 'h2' })).name,
    'Bedroom',
  );
  assert.ok(fake.calls.every((c) => !('key' in c.params)));
  assert.equal(client.budget.used(), 0, 'the nodes do not count against the key');
  answer = () => json('node not found', 404);
  await assert.rejects(client.node(node), { kind: 'not_found' });
  answer = () => fail('too_many_requests', 429);
  await assert.rejects(client.node(node), { kind: 'limited' });
  const calls = fake.calls.length;
  await assert.rejects(client.node(node), { kind: 'limited' });
  assert.equal(fake.calls.length, calls, 'paused');
  clock.now += 60_000;
  answer = () => json(fixture('node.json'));
  await client.node(node);
});

test('bodies are bounded, errors carry the host only', async () => {
  fake = installFetch([
    [/big/, () => new Response('x'.repeat(70 * 1024))],
    [/down/, () => Promise.reject(Object.assign(new Error('x'), { cause: { code: 'ENOTFOUND' } }))],
  ]);
  await assert.rejects(
    getJson('https://api.airvisual.com/v2/big?key=SECRET', { maxBytes: 65536 }),
    {
      message: 'network answer too large on api.airvisual.com',
    },
  );
  await assert.rejects(getJson('https://api.airvisual.com/v2/down?key=SECRET'), (err) => {
    assert.equal(err.message, 'network ENOTFOUND on api.airvisual.com');
    return true;
  });
});

test('no redirection is followed for the API; a node one only to the known hosts', async () => {
  let target = 'https://evil.example/steal';
  const { client } = clientWith([
    [
      /\/v2\/nearest_city/,
      (c) => {
        assert.equal(c.init.redirect, 'error');
        return json(fixture('nearest_city.json'));
      },
    ],
    [
      /^https:\/\/www\.airvisual\.com\/api\/v2\/node\/abcdef123456$/,
      (c) => {
        assert.equal(c.init.redirect, 'manual');
        return new Response('', { status: 302, headers: { location: target } });
      },
    ],
    [/^https:\/\/device\.iqair\.com\/v2\/abcdef123456$/, () => json(fixture('node_iqair.json'))],
  ]);
  await client.nearestCity(1, 2, KEY);
  const node = { id: 'abcdef123456', host: 'airvisual', hash: 'h1' };
  await assert.rejects(client.node(node), { kind: 'failed', detail: 'redirection refused' });
  target = 'http://device.iqair.com/v2/abcdef123456';
  await assert.rejects(client.node(node), { detail: 'redirection refused' });
  target = 'https://device.iqair.com/v2/abcdef123456';
  assert.equal((await client.node(node)).name, 'Bedroom');
});

test('only known AirVisual codes reach a message', () => {
  const echo = checkAnswer({
    status: 400,
    body: { status: 'fail', data: { message: 'bad key ABC123xyz' } },
  });
  assert.equal(echo.kind, 'failed');
  assert.equal(echo.detail, 'api error');
  assert.ok(!echo.message.toLowerCase().includes('abc123xyz'));
  const refused = checkAnswer({ status: 401, body: 'Unauthorized ABC123xyz' });
  assert.equal(refused.kind, 'refused');
  assert.equal(refused.detail, 'http 401');
});

test('the budget file: atomic writes, a corrupt file assumed half spent, one warning', () => {
  const dir = fileURLToPath(new URL('../data/test-budget/', import.meta.url));
  rmSync(dir, { recursive: true, force: true });
  const path = `${dir}budget.json`;
  const warnings = [];
  const logger = { warn: (m) => warnings.push(m) };
  try {
    const now = () => FIXTURE_NOW;
    // A first start: no file, nothing spent.
    assert.equal(new Budget({ storage: fileStorage(path, { logger }), now }).used(), 0);
    const budget = new Budget({ storage: fileStorage(path, { logger }), now });
    budget.take();
    assert.deepEqual(readdirSync(dir), ['budget.json'], 'no .tmp file left behind');
    assert.equal(new Budget({ storage: fileStorage(path, { logger }), now }).used(), 1);
    writeFileSync(path, '{ not json SECRET');
    const storage = fileStorage(path, { logger });
    const prudent = new Budget({ storage, now });
    assert.equal(prudent.used(), Math.floor(DAILY_CALLS / 2));
    storage.load();
    assert.equal(warnings.length, 1, 'warned once');
    assert.ok(!warnings[0].includes('SECRET'), 'never the content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pause read back from /data is never longer than a fresh one', () => {
  const far = FIXTURE_NOW + 365 * 24 * 60 * 60_000;
  for (const [state, longest] of [
    ['limited', LIMITED_MAX],
    ['refused', 6 * 60 * 60_000],
  ]) {
    const storage = memoryStorage({
      day: '2026-10-17',
      count: 3,
      key: { hash: keyHash('SECRET-KEY-1'), state, pausedUntil: far, streak: 2 },
    });
    const client = new AirVisualClient({ now: () => FIXTURE_NOW, storage });
    client.useKey('SECRET-KEY-1');
    assert.equal(client.keyState, state);
    assert.equal(client.keyPausedUntil, FIXTURE_NOW + longest);
  }
});
