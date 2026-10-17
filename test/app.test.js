// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake AirVisual.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AirVisualClient } from '../src/airvisual.js';
import { AirVisualApp } from '../src/app.js';
import { memoryStorage } from '../src/budget.js';
import { ACTIONS, TICK } from '../src/constants.js';
import { T } from '../src/i18n.js';
import {
  FIXTURE_NOW,
  createFakeTimers,
  fail,
  fixture,
  flush,
  installFetch,
  json,
  quiet,
} from './helpers/fakes.js';

const HOME = { id: 1, name: 'Home', selector: 'home', latitude: 48.8566, longitude: 2.3522 };
const BOAT = { id: 2, name: 'Boat', selector: 'boat', latitude: null, longitude: null };
const KEY = 'SECRET-KEY-1';
const NODE_ID = 'abcdef123456';
const HOUSE = 'ext:airvisual:house:home';
const CITY = 'ext:airvisual:city:france_auvergne-rhone-alpes_lyon';

let fake;
afterEach(() => fake?.restore());

async function setup({
  config = { api_key: KEY },
  houses = [HOME, BOAT],
  start = true,
  storage = memoryStorage(),
  now = FIXTURE_NOW,
} = {}) {
  const answers = {
    nearest: () => json(fixture('nearest_city.json')),
    city: () => json(fixture('city.json')),
    node: () => json(fixture('node.json')),
  };
  fake = installFetch([
    [/^https:\/\/api\.airvisual\.com\/v2\/nearest_city\?/, (c) => answers.nearest(c)],
    [/^https:\/\/api\.airvisual\.com\/v2\/city\?/, (c) => answers.city(c)],
    [/^https:\/\/www\.airvisual\.com\/api\/v2\/node\//, (c) => answers.node(c)],
  ]);
  const gladys = createFakeGladys({ selector: 'airvisual', config, houses });
  const timers = createFakeTimers();
  const clock = { now };
  const client = new AirVisualClient({
    now: () => clock.now,
    sleep: async (ms) => {
      clock.now += ms;
    },
    storage,
  });
  const app = new AirVisualApp({ gladys, logger: quiet, now: () => clock.now, timers, client });
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onDeviceCreated(() => app.publishStates());
  await gladys.connect();
  if (start) {
    await app.start(config);
  }
  return { app, gladys, timers, clock, answers, client };
}

const calls = (pattern) => fake.calls.filter((c) => pattern.test(c.url));
const API = /api\.airvisual\.com/;

/** The user creates every discovered device (as the Discovery tab does). */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

/** Let the clock run `minutes`, ticking every minute as the timer would. */
async function runMinutes(timers, clock, minutes) {
  for (let i = 0; i < minutes; i += 1) {
    clock.now += TICK;
    await timers.runIntervals();
  }
}

test('a located house: one nearest_city call, its device, the status', async () => {
  const { gladys, timers } = await setup();
  assert.equal(calls(API).length, 1, 'the house without a position is skipped');
  assert.equal(calls(API)[0].params.lat, '48.86');
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'AirVisual Home');
  assert.equal(device.external_id, HOUSE);
  assert.deepEqual(
    device.features.map((f) => [f.external_id.slice(HOUSE.length + 1), f.category, f.unit]),
    [
      ['aqius', 'airquality-sensor', 'aqi'],
      ['aqicn', 'airquality-sensor', 'aqi'],
      ['mainus', 'text', undefined],
      ['maincn', 'text', undefined],
    ],
  );
  assert.equal(gladys.fake.states.length, 0, 'nothing created: nothing published');
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: T.ok({ locations: 1, nodes: 0, interval: 30 }),
  });
  assert.deepEqual(
    timers.intervals().map((t) => t.ms),
    [TICK],
  );
});

test('a created device gets its values at once; text for the main pollutant', async () => {
  const { gladys } = await setup();
  await createAll(gladys);
  assert.equal(gladys.fake.lastState(`${HOUSE}:aqius`), 42);
  assert.equal(gladys.fake.lastState(`${HOUSE}:aqicn`), 15);
  assert.equal(gladys.fake.lastState(`${HOUSE}:mainus`), 'PM2.5');
  assert.equal(gladys.fake.lastState(`${HOUSE}:maincn`), 'PM10');
});

test('each location is read every 30 minutes, not more', async () => {
  const { gladys, timers, clock } = await setup();
  await createAll(gladys);
  await runMinutes(timers, clock, 29);
  assert.equal(calls(API).length, 1);
  await runMinutes(timers, clock, 1);
  assert.equal(calls(API).length, 2);
  // Over a day: 48 reads of the one location.
  await runMinutes(timers, clock, 24 * 60 - 30);
  assert.equal(calls(API).length, 49);
});

test('five locations: the interval is raised so the free plan holds', async () => {
  const cities = [
    'Lyon, Auvergne-Rhone-Alpes, France',
    'Paris, Ile-de-France, France',
    'Nice, Provence-Alpes-Cote d Azur, France',
    'Lille, Hauts-de-France, France',
    'Brest, Brittany, France',
  ].join('; ');
  const config = { api_key: KEY, cities, poll_interval: 10 };
  const { gladys, timers, clock, app } = await setup({ config });
  // The house and four cities: five locations at most.
  assert.equal(app.locations().length, 5);
  assert.equal(app.locationInterval(), 28);
  assert.match(gladys.fake.connectionStatus.message.en, /1 more location\(s\) ignored/);
  const start = clock.now;
  await runMinutes(timers, clock, 24 * 60 - Math.round((clock.now - start) / 60_000));
  const perDay = calls(API).length;
  assert.ok(perDay <= 270, `${perDay} calls in a day`);
  assert.ok(perDay >= 5 * 50, `${perDay} calls in a day`);
});

test('cities: the device, an unknown one does not stop the others, the invalid entries', async () => {
  const config = {
    api_key: KEY,
    use_houses: false,
    cities: 'Lyon, Auvergne-Rhone-Alpes, France; Nowhere, Void, Atlantis; Lyon only',
  };
  const ctx = await setup({ config, start: false });
  ctx.answers.city = (c) =>
    c.params.city === 'Nowhere' ? fail('city_not_found') : json(fixture('city.json'));
  await ctx.app.start(config);
  const lyon = calls(API).find((c) => c.params.city === 'Lyon');
  assert.deepEqual(
    { city: lyon.params.city, state: lyon.params.state, country: lyon.params.country },
    { city: 'Lyon', state: 'Auvergne-Rhone-Alpes', country: 'France' },
  );
  assert.deepEqual(
    ctx.gladys.fake.discoveredDevices.map((d) => [d.name, d.external_id]),
    [['AirVisual Lyon', CITY]],
  );
  const status = ctx.gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.en, /AirVisual Nowhere \(not found\)/);
  assert.match(status.message.en, /1 city entry ignored/);
  assert.match(status.message.fr, /AirVisual Nowhere \(introuvable\)/);
});

test('a refused key: the reads stop, the status says it, one try every 6 hours', async () => {
  const ctx = await setup({ start: false });
  ctx.answers.nearest = () => fail('incorrect_api_key', 400);
  await ctx.app.start({ api_key: KEY });
  assert.deepEqual(ctx.gladys.fake.connectionStatus, {
    connected: false,
    message: T.keyRefused,
  });
  await runMinutes(ctx.timers, ctx.clock, 5 * 60);
  assert.equal(calls(API).length, 1, 'no call for 6 hours');
  await runMinutes(ctx.timers, ctx.clock, 61);
  assert.equal(calls(API).length, 2, 'never dead: one new try after 6 hours');
  // A reconnection to Gladys keeps the block.
  await ctx.gladys.disconnect();
  ctx.app.stop();
  await ctx.app.start({ api_key: KEY });
  assert.equal(calls(API).length, 2);
  // A new key starts afresh.
  ctx.answers.nearest = () => json(fixture('nearest_city.json'));
  await ctx.app.start({ api_key: 'OTHER-KEY' });
  assert.equal(calls(API).length, 3);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});

test('a 429: a bounded pause for every path, kept across a reconnection', async () => {
  const ctx = await setup({ start: false });
  ctx.answers.nearest = () => fail('call_limit_reached', 429);
  await ctx.app.start({ api_key: KEY });
  const status = ctx.gladys.fake.connectionStatus;
  assert.equal(status.connected, false);
  assert.match(status.message.en, /call limit reached\): no call before 11:30 UTC/);
  // The test button does not call either.
  const ack = await ctx.gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /no call before/);
  ctx.app.stop();
  await ctx.app.start({ api_key: KEY });
  assert.equal(calls(API).length, 1);
  ctx.answers.nearest = () => json(fixture('nearest_city.json'));
  await runMinutes(ctx.timers, ctx.clock, 61);
  assert.equal(calls(API).length, 2);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});

test('the daily budget spent: no periodic read until the next UTC day', async () => {
  const storage = memoryStorage({ day: '2026-10-17', count: 270 });
  const ctx = await setup({ storage });
  assert.equal(calls(API).length, 0);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /resume at 00:00 UTC/);
  await runMinutes(ctx.timers, ctx.clock, 13 * 60 + 31);
  assert.equal(calls(API).length, 1, 'read again after midnight UTC');
});

test('AirVisual Pro: PM2.5, PM10, CO2, temperature, humidity; no API key needed', async () => {
  const config = { node_ids: NODE_ID };
  const ctx = await setup({ config });
  assert.equal(calls(API).length, 0);
  const [call] = fake.calls;
  assert.equal(call.url, `https://www.airvisual.com/api/v2/node/${NODE_ID}`);
  const [device] = ctx.gladys.fake.discoveredDevices;
  assert.equal(device.name, 'Living room (AirVisual Pro)');
  assert.match(device.external_id, /^ext:airvisual:node:[0-9a-f]{16}$/);
  assert.ok(!device.external_id.includes(NODE_ID), 'the node id stays a secret');
  assert.deepEqual(
    device.features.map((f) => [f.name, f.category, f.unit]),
    [
      ['PM2.5', 'pm25-sensor', 'microgram-per-cubic-meter'],
      ['PM10', 'pm10-sensor', 'microgram-per-cubic-meter'],
      ['CO2', 'co2-sensor', 'ppm'],
      ['Temperature', 'temperature-sensor', 'celsius'],
      ['Humidity', 'humidity-sensor', 'percent'],
    ],
  );
  await createAll(ctx.gladys);
  assert.equal(ctx.gladys.fake.lastState(`${device.external_id}:p2`), 8.3);
  assert.equal(ctx.gladys.fake.lastState(`${device.external_id}:co`), 612);
  assert.equal(ctx.gladys.fake.lastState(`${device.external_id}:tp`), 21.4);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  // Every 10 minutes by default.
  await runMinutes(ctx.timers, ctx.clock, 10);
  assert.equal(fake.calls.length, 2);
});

test('a node down never blocks the locations, and the reverse', async () => {
  const ctx = await setup({ start: false });
  ctx.answers.node = () => json({}, 503);
  ctx.answers.nearest = () => fail('incorrect_api_key');
  await ctx.app.start({ api_key: KEY, node_ids: NODE_ID });
  assert.equal(ctx.gladys.fake.discoveredDevices.length, 0);
  ctx.answers.node = () => json(fixture('node.json'));
  await runMinutes(ctx.timers, ctx.clock, 10);
  assert.equal(ctx.gladys.fake.discoveredDevices.length, 1);
  const status = ctx.gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(status.message.en, /^AirVisual refused the API key/);
});

test('a stale reading is never published as current', async () => {
  const ctx = await setup({ start: false });
  const old = fixture('nearest_city.json');
  old.data.current.pollution.ts = '2026-10-17T05:00:00.000Z';
  ctx.answers.nearest = () => json(old);
  await ctx.app.start({ api_key: KEY });
  await createAll(ctx.gladys);
  assert.equal(ctx.gladys.fake.lastState(`${HOUSE}:aqius`), undefined);
});

test('the test button: one call for the key, the last values of every location', async () => {
  const config = { api_key: KEY, cities: 'Lyon, Auvergne-Rhone-Alpes, France', node_ids: NODE_ID };
  const ctx = await setup({ config });
  const before = calls(API).length;
  const ack = await ctx.gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(calls(API).length, before + 1);
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /Locations, read every 30 min \(3\/290 calls today, UTC\):/);
  assert.match(
    ack.data.message.en,
    /- AirVisual Home: AQI US 42, AQI CN 15, main pollutant PM2.5, Paris/,
  );
  assert.match(ack.data.message.en, /- AirVisual Lyon: AQI US 61/);
  assert.match(ack.data.message.fr, /polluant principal PM2.5/);
  assert.match(
    ack.data.message.en,
    /Living room \(AirVisual Pro\): PM2.5 8.3 µg\/m³, CO2 612 ppm, 21.4 °C/,
  );
  assert.match(ack.data.message.fr, /21,4 °C/);
  for (const text of [ack.data.message.en, ack.data.message.fr]) {
    assert.ok(!text.includes(KEY) && !text.includes(NODE_ID));
  }
});

test('nothing configured', async () => {
  const ctx = await setup({ config: {} });
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(ctx.gladys.fake.connectionStatus, {
    connected: false,
    message: T.notConfigured,
  });
  const ack = await ctx.gladys.fake.action(ACTIONS.TEST, {});
  assert.deepEqual(ack.data.message, T.notConfigured);
});

test('a key but no location', async () => {
  const ctx = await setup({ houses: [BOAT] });
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(ctx.gladys.fake.connectionStatus, {
    connected: false,
    message: T.noLocation,
  });
});

test('no secret in the logs', async () => {
  const lines = [];
  const logger = { ...quiet, warn: (m) => lines.push(String(m)) };
  const ctx = await setup({ start: false });
  ctx.answers.nearest = () => Promise.reject(new Error(`boom ${KEY}`));
  ctx.answers.node = () => Promise.reject(new Error(`boom ${NODE_ID}`));
  const app = new AirVisualApp({
    gladys: ctx.gladys,
    logger,
    now: () => ctx.clock.now,
    timers: createFakeTimers(),
    client: ctx.client,
  });
  await app.start({ api_key: KEY, node_ids: NODE_ID });
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.ok(!line.includes(KEY) && !line.includes(NODE_ID), line);
  }
});

// --- Review fixes --------------------------------------------------------------------

const MIDNIGHT = Date.parse('2026-10-17T00:00:00Z');
const FIVE_CITIES = [
  'Lyon, Auvergne-Rhone-Alpes, France',
  'Nowhere, Void, Atlantis',
  'Paris, Ile-de-France, France',
  'Nice, Provence-Alpes-Cote d Azur, France',
  'Brest, Brittany, France',
].join('; ');

/** A whole UTC day: the calls per city, and the last call of each. */
async function simulateDay(answer) {
  const config = { api_key: KEY, use_houses: false, cities: FIVE_CITIES, poll_interval: 10 };
  const ctx = await setup({ config, start: false, now: MIDNIGHT });
  ctx.answers.city = (c) => answer(c, ctx.clock.now);
  await ctx.app.start(config);
  while (ctx.clock.now < MIDNIGHT + 24 * 60 * 60_000 - TICK) {
    ctx.clock.now += TICK;
    await ctx.timers.runIntervals();
  }
  const today = calls(API).filter((c) => c.at < MIDNIGHT + 24 * 60 * 60_000);
  const last = {};
  for (const c of today) {
    last[c.params.city] = c.at;
  }
  return { ctx, today, last };
}

test('a misspelt city among four good ones never drains the day', async () => {
  const stamp = (c, now) => {
    c.at = now;
    return c.params.city === 'Nowhere' ? fail('city_not_found') : json(fixture('city.json'));
  };
  const { today, last } = await simulateDay(stamp);
  assert.ok(today.length <= 270, `${today.length} calls in the UTC day`);
  // The wrong city: tried at most every 6 hours.
  assert.ok(today.filter((c) => c.params.city === 'Nowhere').length <= 4);
  for (const city of ['Lyon', 'Paris', 'Nice', 'Brest']) {
    assert.ok(last[city] >= MIDNIGHT + 23 * 60 * 60_000, `${city} still read before midnight`);
  }
});

test('a 12-hour outage (5xx) never drains the day either', async () => {
  const stamp = (c, now) => {
    c.at = now;
    if (now < MIDNIGHT + 12 * 60 * 60_000) {
      return json({}, 503);
    }
    return c.params.city === 'Nowhere' ? fail('city_not_found') : json(fixture('city.json'));
  };
  const { today, last } = await simulateDay(stamp);
  assert.ok(today.length <= 270, `${today.length} calls in the UTC day`);
  for (const city of ['Lyon', 'Paris', 'Nice', 'Brest']) {
    assert.ok(last[city] >= MIDNIGHT + 23 * 60 * 60_000, `${city} still read before midnight`);
  }
});

test('the key works again: the locations that waited are read at the next tick', async () => {
  const config = {
    api_key: KEY,
    use_houses: false,
    cities: 'Lyon, Auvergne-Rhone-Alpes, France; Paris, Ile-de-France, France',
  };
  const ctx = await setup({ config, start: false });
  ctx.answers.city = () => fail('incorrect_api_key');
  await ctx.app.start(config);
  assert.equal(calls(API).length, 1, 'the second city never went');
  ctx.answers.city = () => json(fixture('city.json'));
  // The test button may try the refused key, and it works now.
  await ctx.gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(calls(API).length, 2);
  await runMinutes(ctx.timers, ctx.clock, 1);
  assert.equal(calls(API).length, 3, 'Paris read at once, not 6 hours later');
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
});

test('a restart keeps the 429 pause, the refusal and the 13 s spacing (not the key)', async () => {
  const storage = memoryStorage();
  const ctx = await setup({ start: false, storage });
  ctx.answers.nearest = () => fail('call_limit_reached', 429);
  await ctx.app.start({ api_key: KEY });
  assert.equal(calls(API).length, 1);
  assert.ok(!JSON.stringify(storage.load()).includes(KEY), 'only a hash of the key is saved');
  // A new container: a new client and app on the same /data.
  ctx.answers.nearest = () => json(fixture('nearest_city.json'));
  const restarted = new AirVisualApp({
    gladys: ctx.gladys,
    logger: quiet,
    now: () => ctx.clock.now,
    timers: createFakeTimers(),
    client: new AirVisualClient({ now: () => ctx.clock.now, storage, sleep: async () => {} }),
  });
  await restarted.start({ api_key: KEY });
  assert.equal(calls(API).length, 1, 'the pause survived the restart');
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /no call before/);
  // Another key starts afresh.
  await restarted.start({ api_key: 'OTHER-KEY' });
  assert.equal(calls(API).length, 2);
});

test('the spacing survives a restart', async () => {
  const storage = memoryStorage();
  const ctx = await setup({ storage });
  assert.equal(calls(API).length, 1);
  const sleeps = [];
  const client = new AirVisualClient({
    now: () => ctx.clock.now,
    storage,
    sleep: async (ms) => {
      sleeps.push(ms);
      ctx.clock.now += ms;
    },
  });
  ctx.clock.now += 3_000;
  await client.nearestCity(1, 2, { apiKey: KEY });
  assert.deepEqual(sleeps, [10_000], 'waits the rest of the 13 s after the last call');
});

test('a call in flight when the key changes never blocks the new key', async () => {
  const config = { api_key: KEY };
  const ctx = await setup({ config, start: false });
  let release;
  ctx.answers.nearest = () =>
    new Promise((resolve) => {
      release = () => resolve(fail('incorrect_api_key'));
    });
  const first = ctx.app.start(config);
  await flush();
  // The user saves a new key while the first call is in flight.
  ctx.answers.nearest = () => json(fixture('nearest_city.json'));
  const second = ctx.app.start({ api_key: 'NEW-KEY' });
  release();
  await first;
  await second;
  assert.equal(ctx.client.keyState, 'ok');
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  assert.equal(calls(API).at(-1).params.key, 'NEW-KEY');
  // A call queued with the old key never goes.
  await assert.rejects(ctx.client.nearestCity(1, 2, { apiKey: KEY }), {
    detail: 'configuration changed',
  });
});

test('the test button answers within its deadline, with the last values', async () => {
  const ctx = await setup();
  const before = calls(API).length;
  // AirVisual never answers this time.
  ctx.answers.nearest = () => new Promise(() => {});
  const pending = ctx.app.testConnection();
  await flush();
  assert.equal(calls(API).length, before + 1);
  const [deadline] = [...ctx.timers.pending.values()].filter((t) => t.kind === 'timeout');
  assert.equal(deadline.ms, 100_000, 'answered before the 120 s Gladys waits');
  await ctx.timers.runTimeouts();
  const answer = await pending;
  assert.match(answer.en, /- AirVisual Home: AQI US 42/);
});

test('secrets are scrubbed whatever their case; a refused node link says so', async () => {
  const ctx = await setup({ start: false });
  ctx.answers.node = () => json({ status: 'fail', data: { message: 'Forbidden' } }, 401);
  await ctx.app.start({ api_key: KEY, node_ids: NODE_ID });
  assert.equal(
    ctx.app.scrub(new Error(`echo ${KEY.toLowerCase()} ${NODE_ID.toUpperCase()}`)),
    'echo *** ***',
  );
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /link refused \(check the id\)/);
  assert.equal(ctx.client.keyState, 'ok', 'a node refusal is not the key');
});

test('12 hours of bare 429s never drain the day either', async () => {
  const stamp = (c, now) => {
    c.at = now;
    if (now < MIDNIGHT + 12 * 60 * 60_000) {
      return new Response('', { status: 429 });
    }
    return c.params.city === 'Nowhere' ? fail('city_not_found') : json(fixture('city.json'));
  };
  const { today, last } = await simulateDay(stamp);
  assert.ok(today.length <= 270, `${today.length} calls in the UTC day`);
  for (const city of ['Lyon', 'Paris', 'Nice', 'Brest']) {
    assert.ok(last[city] >= MIDNIGHT + 23 * 60 * 60_000, `${city} still read before midnight`);
  }
});

test('an AirVisual Pro in 429 is read at most once per interval', async () => {
  const ctx = await setup({ config: { node_ids: NODE_ID }, start: false });
  ctx.answers.node = () => new Response('', { status: 429 });
  await ctx.app.start({ node_ids: NODE_ID });
  await runMinutes(ctx.timers, ctx.clock, 60);
  assert.ok(fake.calls.length <= 7, `${fake.calls.length} calls in an hour (every 10 min)`);
});
