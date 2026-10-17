// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. They also guard
// the text files against mojibake and a BOM (a manifest once shipped broken).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS, DEVICE_TYPES } from '../src/constants.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { deviceOf } from '../src/readings.js';

const readBuffer = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const read = (path) => readBuffer(path).toString('utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('no mojibake and no BOM in the manifest and the docs', () => {
  const files = [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'THIRD_PARTY_NOTICES.md',
    'index.js',
    ...readdirSync(new URL('../src/', import.meta.url))
      .filter((name) => name.endsWith('.js'))
      .map((name) => `src/${name}`),
  ];
  assert.ok(files.length > 15, 'every source file is checked');
  for (const file of files) {
    const buffer = readBuffer(file);
    assert.ok(
      !(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf),
      `${file} starts with a BOM`,
    );
    const text = buffer.toString('utf8');
    assert.ok(!text.includes('�'), `${file} holds an invalid UTF-8 sequence`);
    for (const bad of ['Ã', 'Â', 'â€']) {
      assert.ok(!text.includes(bad), `${file} holds mojibake (${bad})`);
    }
    // Combining marks only as \u escapes (a regex class of them is invisible).
    assert.doesNotMatch(text, /[\u0300-\u036f]/, `${file} holds a bare combining mark`);
  }
  // The French texts really hold their accents.
  assert.match(read('docs/fr.md'), /é/);
  assert.match(manifest.config_schema[0].description.fr, /qualité/);
});

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.location, true, 'the houses are read by their position');
  assert.match(manifest.gladys_version, />=5\.1\.0/);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(docs, /pyairvisual/, `docs/${lang}.md credits pyairvisual`);
  }
  assert.match(read('docs/en.md'), /never been tested with a real/i);
  assert.match(read('docs/fr.md'), /jamais été testée avec une vraie/i);
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /non officiel/);
  assert.match(manifest.config_schema[0].description.en, /not affiliated with IQAir/);
});

test('version 0.1.0 everywhere, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-airvisual:${manifest.version}`);
});

test('the license and the notices ship with the image', () => {
  assert.match(read('LICENSE'), /Apache License/);
  assert.equal(pkg.license, 'Apache-2.0');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /pyairvisual/);
  assert.match(notices, /Copyright \(c\) 2017-2024 Aaron Bach/);
  assert.match(notices, /Permission is hereby granted/);
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY .*LICENSE/);
  assert.match(dockerfile, /COPY .*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('sections are purely presentational, with https links', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang} is too long`);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.equal(fields[key]?.default, value, key);
  }
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, field.key);
    }
  }
  // The key and the node ids are secrets: masked, never shown again.
  assert.equal(fields.api_key.type, 'secret');
  assert.equal(fields.node_ids.type, 'secret');
  // Never "encrypted": Gladys keeps a secret in clear in its database.
  for (const [, text] of texts(manifest)) {
    assert.doesNotMatch(`${text.en} ${text.fr}`, /encrypt|chiffr/i);
  }
  assert.match(fields.api_key.description.en, /sent only to api\.airvisual\.com/);
  assert.match(fields.api_key.description.fr, /envoyée seulement à api\.airvisual\.com/);
  // The free plan: 30 minutes by default, never under 10.
  assert.equal(fields.poll_interval.default, 30);
  assert.equal(fields.poll_interval.min, 10);
  assert.equal(fields.node_poll_interval.min, 5);
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.ok(manifest.actions[0].timeout_seconds <= 120);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

// DEVICE_FEATURE_UNITS_BY_CATEGORY of server/utils/constants.js (Gladys core),
// for the categories this integration uses; `text` has no unit.
const CORE_UNITS = {
  'airquality-sensor': ['aqi'],
  'pm25-sensor': [
    'milligram-per-cubic-meter',
    'microgram-per-cubic-meter',
    'nanogram-per-cubic-meter',
  ],
  'pm10-sensor': ['microgram-per-cubic-meter', 'nanogram-per-cubic-meter'],
  'co2-sensor': ['ppm'],
  'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
  'humidity-sensor': ['percent'],
  text: [],
};

test('every feature uses a unit the core lists for its category', () => {
  const gladys = createFakeGladys({ selector: 'airvisual' });
  const full = {
    aqius: 10,
    aqicn: 10,
    mainus: 'PM2.5',
    maincn: 'PM10',
    p2: 1,
    p1: 1,
    co: 400,
    tp: 20,
    hm: 50,
  };
  for (const type of Object.values(DEVICE_TYPES)) {
    const device = deviceOf(gladys, {
      source: { type, key: 'x', name: 'X' },
      values: full,
      ts: 0,
    });
    assert.ok(device.features.length > 0);
    for (const feature of device.features) {
      assert.ok(feature.category in CORE_UNITS, `${feature.category} is not checked`);
      const allowed = CORE_UNITS[feature.category];
      if (allowed.length === 0) {
        assert.equal(feature.unit, undefined, feature.external_id);
      } else {
        assert.ok(allowed.includes(feature.unit), `${feature.external_id}: ${feature.unit}`);
      }
    }
  }
});
