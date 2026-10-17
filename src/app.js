// -----------------------------------------------------------------------------
// The integration itself: the places to read (the located houses, the cities
// of the configuration, the AirVisual Pro / Node ids), when each is due, the
// Gladys devices and states built from their readings, the connection status
// and the test button. index.js only wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AirVisualClient, AirVisualError } from './airvisual.js';
import { effectiveInterval } from './budget.js';
import { normalizeConfig, slug } from './config.js';
import {
  DAILY_CALLS,
  DEVICE_TYPES,
  FAILED_RETRY,
  HEARTBEAT,
  MAX_LOCATIONS,
  NOT_FOUND_RETRY,
  TEST_DEADLINE,
  TICK,
} from './constants.js';
import { T, reason } from './i18n.js';
import { cityReading, deviceOf, isFresh, nodeReading, statesOf } from './readings.js';

const defaultTimers = { setInterval, clearInterval, setTimeout, clearTimeout };

const coordinate = (value) => (value === null || value === undefined ? NaN : Number(value));

const keyOf = (source) => `${source.type}:${source.key}`;

/** 12.54 -> "12.5", "12,5" in French. */
const numberText = (value, lang) => {
  const text = String(Math.round(value * 10) / 10);
  return lang === 'fr' ? text.replace('.', ',') : text;
};

export class AirVisualApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'airvisual' }),
    now = Date.now,
    timers = defaultTimers,
    client,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    // The client keeps the pace, the budget and the pauses: it lives as long
    // as the process, across restarts of the app and reconnections to Gladys.
    this.client = client ?? new AirVisualClient({ now });
    /** The places to read: [{ type, key, name, ... }]. */
    this.sources = [];
    /** source key -> { reading, nextDue, error } (kept across start()). */
    this.track = new Map();
    this.skippedLocations = 0;
    this.interval = undefined;
    this.ticking = undefined;
    this.lastDiscovered = undefined;
    this.lastStatus = undefined;
    this.generation = 0;
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = ++this.generation;
    const previous = this.started ? this.config : undefined;
    this.config = normalizeConfig(raw);
    this.started = true;
    // A reconnection to Gladys gives the same configuration: the pauses (429),
    // the refusal of the key and the due times stay. A new key starts afresh.
    // The client keeps the state of the same key (also across a restart of
    // the container, from /data) and starts afresh for another one.
    const newKey = previous && previous.apiKey !== this.config.apiKey;
    this.client.useKey(this.config.apiKey);
    if (newKey || (previous && previous.pollMinutes !== this.config.pollMinutes)) {
      for (const [key, entry] of this.track) {
        if (!key.startsWith(`${DEVICE_TYPES.NODE}:`)) {
          entry.nextDue = Math.min(entry.nextDue, this.now());
          entry.error = undefined;
        }
      }
    }
    this.lastStatus = undefined;
    this.lastDiscovered = undefined;
    await this.loadSources();
    if (generation !== this.generation) {
      return;
    }
    await this.tick();
    if (generation !== this.generation) {
      return;
    }
    this.interval = this.timers.setInterval(
      () => this.tick().catch((err) => this.logger.warn(`Refresh failed: ${this.scrub(err)}`)),
      TICK,
    );
    await this.refreshStatus();
  }

  stop() {
    this.generation += 1;
    if (this.interval !== undefined) {
      this.timers.clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /** An error message without the key nor the node ids. */
  scrub(err) {
    let message = String(err?.message ?? err);
    const secrets = [this.config.apiKey, ...this.config.nodes.map((n) => n.id)];
    for (const secret of secrets) {
      if (secret) {
        // Without regard to case: an echo may come back lower-cased.
        const pattern = new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        message = message.replace(pattern, '***');
      }
    }
    return message;
  }

  // --- The places to read --------------------------------------------------------

  /** The located houses; a house without coordinates is skipped. */
  async loadHouses() {
    if (!this.config.useHouses || !this.config.apiKey) {
      return [];
    }
    let houses = [];
    try {
      houses = (await this.gladys.getHouses()) ?? [];
    } catch (err) {
      this.logger.warn(`Houses unavailable (location not granted?): ${err.message}`);
    }
    return houses
      .map((h) => ({
        name: String(h.name ?? h.selector ?? '?').slice(0, 60),
        key: slug(h.selector ?? h.name ?? ''),
        latitude: coordinate(h.latitude),
        longitude: coordinate(h.longitude),
      }))
      .filter((h) => h.key && Number.isFinite(h.latitude) && Number.isFinite(h.longitude));
  }

  async loadSources() {
    const { config } = this;
    const locations = [];
    for (const house of await this.loadHouses()) {
      locations.push({ type: DEVICE_TYPES.HOUSE, ...house, name: `AirVisual ${house.name}` });
    }
    if (config.apiKey) {
      for (const city of config.cities) {
        locations.push({
          type: DEVICE_TYPES.CITY,
          key: city.id,
          name: `AirVisual ${city.city}`,
          query: { city: city.city, state: city.state, country: city.country },
        });
      }
    }
    this.skippedLocations = Math.max(0, locations.length - MAX_LOCATIONS);
    const nodes = config.nodes.map((node) => ({
      type: DEVICE_TYPES.NODE,
      key: node.hash,
      name: `AirVisual Pro ${node.hash.slice(0, 6)}`,
      node,
    }));
    this.sources = [...locations.slice(0, MAX_LOCATIONS), ...nodes];
    // Forget the places no longer configured.
    const keys = new Set(this.sources.map(keyOf));
    for (const key of this.track.keys()) {
      if (!keys.has(key)) {
        this.track.delete(key);
      }
    }
    for (const source of this.sources) {
      if (!this.track.has(keyOf(source))) {
        this.track.set(keyOf(source), { reading: undefined, nextDue: 0, error: undefined });
      }
    }
  }

  locations() {
    return this.sources.filter((s) => s.type !== DEVICE_TYPES.NODE);
  }

  nodes() {
    return this.sources.filter((s) => s.type === DEVICE_TYPES.NODE);
  }

  /** The read interval of the locations (minutes), within the budget. */
  locationInterval() {
    return effectiveInterval(this.config.pollMinutes, this.locations().length);
  }

  // --- Reading -----------------------------------------------------------------------

  /** Read what is due, one source at a time (a tick never overlaps another). */
  tick() {
    if (this.ticking && this.tickGeneration === this.generation) {
      return this.ticking;
    }
    // A tick of a previous configuration still running: this one follows it
    // (it stops at its next source), never runs alongside.
    const previous = this.ticking ?? Promise.resolve();
    const generation = this.generation;
    const run = previous
      .catch(() => {})
      .then(() => this.readDue())
      .finally(() => {
        if (this.ticking === run) {
          this.ticking = undefined;
        }
      });
    this.ticking = run;
    this.tickGeneration = generation;
    return run;
  }

  async readDue() {
    const generation = this.generation;
    let changed = false;
    for (const source of this.sources) {
      if (generation !== this.generation) {
        return;
      }
      const entry = this.track.get(keyOf(source));
      if (entry && this.now() >= entry.nextDue) {
        await this.read(source);
        changed = true;
      }
    }
    if (changed && generation === this.generation) {
      await this.publish();
      await this.refreshStatus();
    }
  }

  /** When a source that failed with `err` is tried again. */
  retryAt(source, err) {
    const now = this.now();
    if (err instanceof AirVisualError) {
      if (source.type !== DEVICE_TYPES.NODE && (err.kind === 'limited' || err.kind === 'refused')) {
        return Math.max(now + 60_000, this.client.keyPausedUntil);
      }
      if (err.kind === 'budget') {
        return this.client.budget.resetsAt();
      }
      if (err.kind === 'not_found' || err.kind === 'no_station' || err.kind === 'denied') {
        return now + NOT_FOUND_RETRY;
      }
      if (source.type === DEVICE_TYPES.NODE && err.kind === 'limited') {
        return Math.max(now + 60_000, this.client.nodePausedUntil.get(source.key)?.until ?? 0);
      }
    }
    const interval =
      (source.type === DEVICE_TYPES.NODE ? this.config.nodePollMinutes : this.locationInterval()) *
      60_000;
    // A passing failure (network, 5xx) never makes a source read faster than
    // its interval: a long outage must not drain the daily budget.
    return now + Math.max(interval, FAILED_RETRY);
  }

  async fetch(source, { force = false, reserve = true } = {}) {
    const apiKey = this.config.apiKey;
    if (source.type === DEVICE_TYPES.NODE) {
      return nodeReading(await this.client.node(source.node));
    }
    if (source.type === DEVICE_TYPES.HOUSE) {
      return cityReading(
        await this.client.nearestCity(source.latitude, source.longitude, {
          apiKey,
          force,
          reserve,
        }),
      );
    }
    return cityReading(await this.client.city(source.query, { apiKey, force, reserve }));
  }

  /** Read one source now; never throws. */
  async read(source, options) {
    const generation = this.generation;
    const entry = this.track.get(keyOf(source));
    try {
      const reading = await this.fetch(source, options);
      if (generation !== this.generation || !entry) {
        return;
      }
      if (source.type === DEVICE_TYPES.NODE && reading.name) {
        source.name = `${reading.name} (AirVisual Pro)`;
      }
      entry.reading = { ...reading, source };
      entry.error = undefined;
      // The key works again (after a refusal or a 429): the locations that
      // waited for it are due now, not hours later.
      if (source.type !== DEVICE_TYPES.NODE) {
        for (const other of this.locations()) {
          const waiting = this.track.get(keyOf(other));
          if (other !== source && ['refused', 'limited'].includes(waiting?.error?.kind)) {
            waiting.nextDue = Math.min(waiting.nextDue, this.now());
          }
        }
      }
      const minutes =
        source.type === DEVICE_TYPES.NODE ? this.config.nodePollMinutes : this.locationInterval();
      entry.nextDue = this.now() + minutes * 60_000;
    } catch (err) {
      if (generation !== this.generation || !entry) {
        return;
      }
      entry.error = err instanceof AirVisualError ? err : new AirVisualError('failed', 'network');
      entry.nextDue = this.retryAt(source, err);
      this.logger.warn(`AirVisual read of ${source.name} failed: ${this.scrub(err)}`);
    }
  }

  // --- Gladys devices and states --------------------------------------------------

  readings() {
    return this.sources
      .map((source) => this.track.get(keyOf(source))?.reading)
      .filter((reading) => reading && deviceOf(this.gladys, reading).features.length > 0);
  }

  async publish() {
    await this.publishDiscovered();
    await this.publishStates();
  }

  /** The Discovery tab, published again only when it changed. */
  async publishDiscovered({ force = false } = {}) {
    const devices = this.readings().map((reading) => deviceOf(this.gladys, reading));
    const key = JSON.stringify(devices);
    if (!force && key === this.lastDiscovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.lastDiscovered = key;
    } catch (err) {
      this.logger.warn(`publishDiscoveredDevices failed: ${err.message}`);
    }
  }

  /** The external ids of the features the user created. */
  createdFeatures() {
    const ids = new Set();
    for (const device of this.gladys.devices ?? []) {
      for (const feature of device.features ?? []) {
        ids.add(feature.external_id);
      }
    }
    return ids;
  }

  /** The fresh values of the created features, only what changed (plus a heartbeat). */
  async publishStates() {
    const created = this.createdFeatures();
    if (created.size === 0) {
      return;
    }
    const now = this.now();
    const states = this.readings()
      .filter((reading) => isFresh(reading, now))
      .flatMap((reading) => statesOf(this.gladys, reading))
      .filter((state) => created.has(state.device_feature_external_id));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: HEARTBEAT });
    } catch (err) {
      this.logger.warn(`Publishing the states failed: ${err.message}`);
    }
  }

  // --- Status ------------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The status of the key, when it stops every location: undefined if none. */
  keyIssue() {
    const { client } = this;
    if (this.locations().length === 0) {
      return undefined;
    }
    const paused = this.now() < client.keyPausedUntil;
    if (client.keyState === 'refused' && paused) {
      return T.keyRefused;
    }
    if (client.keyState === 'limited' && paused) {
      return T.rateLimited(client.keyPausedUntil);
    }
    if (!client.budget.allows()) {
      return T.budgetSpent(client.budget.resetsAt());
    }
    return undefined;
  }

  withNotes(text) {
    const { config } = this;
    const notes = [];
    const invalid = T.invalidEntries(
      config.invalidCities.length,
      config.invalidNodes.length + config.droppedNodes,
    );
    if (invalid.en) {
      notes.push(invalid);
    }
    if (this.skippedLocations > 0) {
      notes.push({
        en: `${this.skippedLocations} more location(s) ignored: ${MAX_LOCATIONS} at most`,
        fr: `${this.skippedLocations} lieu(x) de plus ignoré(s) : ${MAX_LOCATIONS} au maximum`,
      });
    }
    if (notes.length === 0) {
      return text;
    }
    return {
      en: `${text.en} ${notes.map((n) => `${n.en}.`).join(' ')}`,
      fr: `${text.fr} ${notes.map((n) => `${n.fr}.`).join(' ')}`,
    };
  }

  async refreshStatus() {
    const { config } = this;
    if (!config.apiKey && config.nodes.length === 0) {
      return this.setStatus(false, this.withNotes(T.notConfigured));
    }
    if (this.sources.length === 0) {
      return this.setStatus(false, this.withNotes(T.noLocation));
    }
    const issue = this.keyIssue();
    if (issue && this.nodes().length === 0) {
      return this.setStatus(false, this.withNotes(issue));
    }
    const failing = this.sources
      .map((source) => ({ source, entry: this.track.get(keyOf(source)) }))
      .filter(({ entry }) => entry?.error)
      .map(({ source, entry }) => ({ name: source.name, kind: entry.error.kind }));
    const ok = T.ok({
      locations: this.locations().length,
      nodes: this.nodes().length,
      interval: this.locationInterval(),
      failing: issue
        ? failing.filter((f) => f.kind !== 'refused' && f.kind !== 'limited')
        : failing,
    });
    const text = issue ? { en: `${issue.en} ${ok.en}`, fr: `${issue.fr} ${ok.fr}` } : ok;
    const anyValue = this.readings().length > 0;
    return this.setStatus(anyValue || failing.length === 0, this.withNotes(text));
  }

  // --- Configuration screen button -------------------------------------------------

  line(source, lang) {
    const entry = this.track.get(keyOf(source));
    const colon = lang === 'fr' ? ' :' : ':';
    const reading = entry?.reading;
    if (!reading) {
      const why = entry?.error
        ? reason(entry.error.kind)[lang]
        : lang === 'fr'
          ? 'pas encore lu'
          : 'not read yet';
      return `- ${source.name}${colon} ${why}`;
    }
    const v = reading.values;
    const parts = [];
    if (v.aqius !== null && v.aqius !== undefined) {
      parts.push(`AQI US ${Math.round(v.aqius)}`);
    }
    if (v.aqicn !== null && v.aqicn !== undefined) {
      parts.push(`AQI CN ${Math.round(v.aqicn)}`);
    }
    if (v.mainus) {
      parts.push(`${lang === 'fr' ? 'polluant principal' : 'main pollutant'} ${v.mainus}`);
    }
    if (v.p2 !== null && v.p2 !== undefined) {
      parts.push(`PM2.5 ${numberText(v.p2, lang)} µg/m³`);
    }
    if (v.co !== null && v.co !== undefined) {
      parts.push(`CO2 ${Math.round(v.co)} ppm`);
    }
    if (v.tp !== null && v.tp !== undefined) {
      parts.push(`${numberText(v.tp, lang)} °C`);
    }
    if (reading.city) {
      parts.push(reading.city);
    }
    if (Number.isFinite(reading.ts)) {
      const minutes = Math.max(0, Math.round((this.now() - reading.ts) / 60_000));
      parts.push(lang === 'fr' ? `mesure d'il y a ${minutes} min` : `read ${minutes} min ago`);
    }
    if (entry.error) {
      parts.push(`(${reason(entry.error.kind)[lang]})`);
    }
    return `- ${source.name}${colon} ${parts.join(', ')}`;
  }

  /** Read a source, but stop waiting at `deadline`. */
  async readBefore(source, deadline, options) {
    const left = deadline - this.now();
    if (left <= 0) {
      return;
    }
    let timer;
    const timeout = new Promise((resolve) => {
      timer = this.timers.setTimeout(resolve, left);
    });
    try {
      await Promise.race([this.read(source, options), timeout]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  async testConnection() {
    const { config } = this;
    if (!config.apiKey && config.nodes.length === 0) {
      return this.withNotes(T.notConfigured);
    }
    // Gladys waits 120 s for the answer: past ~100 s, the last values are
    // shown (a read still running finishes in the background).
    const deadline = this.now() + TEST_DEADLINE;
    const en = [];
    const fr = [];
    const locations = this.locations();
    if (config.apiKey && locations.length === 0) {
      en.push(T.noLocation.en);
      fr.push(T.noLocation.fr);
    }
    if (locations.length > 0) {
      // One call checks the key: the other locations show their last reading,
      // the quota is too small to read them all on every click.
      const [first] = locations;
      await this.readBefore(first, deadline, { force: true, reserve: false });
      const issue = this.keyIssue();
      if (issue) {
        en.push(issue.en);
        fr.push(issue.fr);
      }
      const used = this.client.budget.used();
      const interval = this.locationInterval();
      en.push(`Locations, read every ${interval} min (${used}/${DAILY_CALLS} calls today, UTC):`);
      fr.push(
        `Lieux, lus toutes les ${interval} min (${used}/${DAILY_CALLS} appels aujourd'hui, UTC) :`,
      );
      for (const source of locations) {
        en.push(this.line(source, 'en'));
        fr.push(this.line(source, 'fr'));
      }
    }
    const nodes = this.nodes();
    if (nodes.length > 0) {
      en.push('AirVisual Pro:');
      fr.push('AirVisual Pro :');
      for (const source of nodes) {
        await this.readBefore(source, deadline);
        en.push(this.line(source, 'en'));
        fr.push(this.line(source, 'fr'));
      }
    }
    await this.publish();
    await this.refreshStatus();
    return this.withNotes({ en: en.join('\n'), fr: fr.join('\n') });
  }
}
