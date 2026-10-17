// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized so
// the rest of the code never deals with strings or `undefined`.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { MAX_NODES } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  use_houses: true,
  cities: '',
  poll_interval: 30,
  node_poll_interval: 10,
};

const number = (value, fallback, min, max) => {
  const n = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
};

const flag = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

const clean = (value) => String(value ?? '').trim();

/** "Saint-Étienne" -> "saint-etienne": a stable id piece, ASCII only. */
export function slug(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * "Paris, Ile-de-France, France; Lyon, Auvergne-Rhone-Alpes, France" -> the
 * cities, in the spelling AirVisual uses (city, state, country). Separated by
 * `;` or a line break; an entry without its three parts is reported.
 */
export function parseCities(text) {
  const cities = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of clean(text).split(/[;\n]+/)) {
    const value = entry.trim();
    if (!value) {
      continue;
    }
    const parts = value.split(',').map((p) => p.trim());
    if (parts.length !== 3 || parts.some((p) => !p || p.length > 80)) {
      invalid.push(value.slice(0, 80));
      continue;
    }
    const [city, state, country] = parts;
    const id = [country, state, city].map(slug).join('_');
    if (!seen.has(id)) {
      seen.add(id);
      cities.push({ city, state, country, id });
    }
  }
  return { cities, invalid };
}

/**
 * The AirVisual Pro / Node ids: the bare id the IQAir dashboard shows, or the
 * whole API link it shares (only its two known hosts). The external id of a
 * node is a hash of its id: the id itself is a credential, never shown.
 */
export function parseNodes(text) {
  const nodes = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of clean(text).split(/[\s,;]+/)) {
    if (!entry) {
      continue;
    }
    let host = 'airvisual';
    let id = entry;
    if (/^https?:\/\//i.test(entry)) {
      let url;
      try {
        url = new URL(entry);
      } catch {
        url = undefined;
      }
      const iqair = url?.hostname === 'device.iqair.com' && /^\/v2\/[^/]+\/?$/.test(url.pathname);
      const airvisual =
        url?.hostname === 'www.airvisual.com' && /^\/api\/v2\/node\/[^/]+\/?$/.test(url.pathname);
      if (url?.protocol !== 'https:' || !(iqair || airvisual)) {
        invalid.push('link');
        continue;
      }
      host = iqair ? 'iqair' : 'airvisual';
      id = url.pathname.replace(/\/$/, '').split('/').pop();
    }
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) {
      invalid.push('id');
      continue;
    }
    const hash = createHash('sha256').update(id).digest('hex').slice(0, 16);
    if (!seen.has(hash)) {
      seen.add(hash);
      nodes.push({ id, host, hash });
    }
  }
  return { nodes, invalid };
}

export function normalizeConfig(raw = {}) {
  const { cities, invalid: invalidCities } = parseCities(raw.cities ?? DEFAULT_CONFIG.cities);
  const { nodes, invalid: invalidNodes } = parseNodes(raw.node_ids);
  return {
    apiKey: clean(raw.api_key),
    useHouses: flag(raw.use_houses, DEFAULT_CONFIG.use_houses),
    cities,
    invalidCities,
    // 10 minutes at least: a city is updated once an hour by AirVisual.
    pollMinutes: number(raw.poll_interval, DEFAULT_CONFIG.poll_interval, 10, 360),
    nodes: nodes.slice(0, MAX_NODES),
    invalidNodes,
    droppedNodes: Math.max(0, nodes.length - MAX_NODES),
    nodePollMinutes: number(raw.node_poll_interval, DEFAULT_CONFIG.node_poll_interval, 5, 60),
  };
}
