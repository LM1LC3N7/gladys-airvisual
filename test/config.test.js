import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseCities, parseNodes, slug } from '../src/config.js';
import { effectiveInterval } from '../src/budget.js';

test('the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.apiKey, '');
  assert.equal(config.useHouses, true);
  assert.deepEqual(config.cities, []);
  assert.equal(config.pollMinutes, 30);
  assert.equal(config.nodePollMinutes, 10);
  assert.deepEqual(config.nodes, []);
});

test('numbers are bounded, flags read as Gladys stores them', () => {
  const config = normalizeConfig({
    api_key: '  KEY  ',
    use_houses: 'false',
    poll_interval: '1',
    node_poll_interval: 1000,
  });
  assert.equal(config.apiKey, 'KEY');
  assert.equal(config.useHouses, false);
  assert.equal(config.pollMinutes, 10);
  assert.equal(config.nodePollMinutes, 60);
  assert.equal(normalizeConfig({ poll_interval: 'abc' }).pollMinutes, 30);
});

test('the cities: "City, State, Country", separated by ; or a line break', () => {
  const { cities, invalid } = parseCities(
    'Paris, Ile-de-France, France; Saint-Étienne,Auvergne-Rhone-Alpes,France\nLyon, France;; paris , ile-de-france, FRANCE',
  );
  assert.deepEqual(
    cities.map((c) => c.id),
    ['france_ile-de-france_paris', 'france_auvergne-rhone-alpes_saint-etienne'],
  );
  assert.deepEqual(cities[1], {
    city: 'Saint-Étienne',
    state: 'Auvergne-Rhone-Alpes',
    country: 'France',
    id: 'france_auvergne-rhone-alpes_saint-etienne',
  });
  assert.deepEqual(invalid, ['Lyon, France']);
  assert.equal(slug('  Été / Hiver '), 'ete-hiver');
});

test('the node ids: bare, or the API link of a known host only', () => {
  const { nodes, invalid } = parseNodes(
    'abcdef123456, https://device.iqair.com/v2/5f3e2d1c0b9a8f7e6d5c4b3a ' +
      'https://www.airvisual.com/api/v2/node/ZZZZZZZZ; https://evil.example/v2/abcdef123456 ' +
      'http://device.iqair.com/v2/abcdef123456 bad! abcdef123456',
  );
  assert.deepEqual(
    nodes.map(({ id, host }) => [id, host]),
    [
      ['abcdef123456', 'airvisual'],
      ['5f3e2d1c0b9a8f7e6d5c4b3a', 'iqair'],
      ['ZZZZZZZZ', 'airvisual'],
    ],
  );
  assert.deepEqual(invalid, ['link', 'link', 'id']);
  // The external id is a hash: stable, and never the id itself.
  assert.match(nodes[0].hash, /^[0-9a-f]{16}$/);
  assert.equal(parseNodes('abcdef123456').nodes[0].hash, nodes[0].hash);
  assert.ok(!nodes[0].hash.includes('abcdef123456'));
});

test('five nodes at most', () => {
  const ids = Array.from({ length: 7 }, (_, i) => `node${i}abcdef`).join(',');
  const config = normalizeConfig({ node_ids: ids });
  assert.equal(config.nodes.length, 5);
  assert.equal(config.droppedNodes, 2);
});

test('the interval of the locations never drains the free plan', () => {
  assert.equal(effectiveInterval(30, 1), 30);
  assert.equal(effectiveInterval(10, 1), 10);
  // 5 locations every 10 minutes would be 720 calls a day: raised to 27 min.
  assert.equal(effectiveInterval(10, 5), 27);
  for (let n = 1; n <= 5; n += 1) {
    for (const minutes of [10, 15, 30, 60]) {
      const perDay = (n * 24 * 60) / effectiveInterval(minutes, n);
      assert.ok(perDay <= 270, `${n} locations every ${minutes} min: ${perDay} calls a day`);
      assert.ok(perDay * 31 <= 10_000 - 31 * 20, 'under the monthly quota with the reserve');
    }
  }
});
