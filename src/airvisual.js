// -----------------------------------------------------------------------------
// The AirVisual client: the air quality of a place (`nearest_city` by
// coordinates, `city` by name) with the API key, and an AirVisual Pro / Node
// by its id. Endpoints, parameters and error messages follow the official
// AirVisual API v2 documentation and pyairvisual (MIT, Aaron Bach).
//
// Every guard of the API key lives here, so no path can skip one: the pace
// (13 s between calls), the daily budget, the pause after a 429 and the stop
// after a refused key. They are persisted with the budget, so a restart
// keeps them.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  API_MIN_GAP,
  API_URL,
  LIMITED_MAX,
  LIMITED_MIN,
  LIMITED_QUOTA_BASE,
  MAX_API_BODY,
  MAX_NODE_BODY,
  MAX_REDIRECTS,
  NODE_HOSTNAMES,
  NODE_HOSTS,
  NODE_MIN_GAP,
  REFUSED_BACKOFF,
} from './constants.js';
import { Budget } from './budget.js';
import { getJson } from './http.js';
import { createPacer } from './pacer.js';

/**
 * kind: refused (the key), denied (a node link refused), limited (429),
 * budget (the daily budget is spent), not_found (city or node), no_station
 * (no city near the coordinates), failed (anything else). `detail` is one
 * of the known AirVisual codes or a fixed text: safe to show.
 */
export class AirVisualError extends Error {
  constructor(kind, detail = kind, { retryAfterMs, quota = false } = {}) {
    super(`AirVisual ${kind}${detail && detail !== kind ? ` (${detail})` : ''}`);
    this.name = 'AirVisualError';
    this.kind = kind;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
    /** A 429 for the monthly or daily quota (`call_limit_reached`). */
    this.quota = quota;
  }
}

const REFUSED = ['incorrect_api_key', 'api_key_expired', 'payment required', 'permission_denied'];
const REFUSED_403 = ['forbidden', 'feature_not_available'];
const KNOWN = [
  ...REFUSED,
  ...REFUSED_403,
  'call_limit_reached',
  'too_many_requests',
  'city_not_found',
  'node not found',
  'no_nearest_station',
];

/** The error message of an AirVisual answer, lower case, or ''. */
export function messageOf(body) {
  const raw =
    typeof body === 'string' ? body : (body?.data?.message ?? body?.message ?? body?.data ?? '');
  return typeof raw === 'string' ? raw.replace(/"/g, '').trim().toLowerCase().slice(0, 200) : '';
}

/** Only a known AirVisual code is shown; anything else (an echo...) is not. */
const safe = (message, fallback = 'api error') =>
  KNOWN.find((code) => message.includes(code)) ?? fallback;

/** An AirVisual answer -> its data, or the AirVisualError it means. */
export function checkAnswer({ status, body, retryAfterMs }) {
  const message = messageOf(body);
  const isFail = body && typeof body === 'object' && body.status === 'fail';
  if (status >= 200 && status < 300 && body?.status === 'success') {
    return body.data;
  }
  if (message.includes('call_limit_reached')) {
    return new AirVisualError('limited', 'call_limit_reached', { retryAfterMs, quota: true });
  }
  if (status === 429 || message.includes('too_many_requests')) {
    return new AirVisualError('limited', 'too_many_requests', { retryAfterMs });
  }
  if (REFUSED.some((m) => message.includes(m)) || status === 401) {
    return new AirVisualError('refused', safe(message, `http ${status}`));
  }
  // A 403 is the key only when AirVisual says so; a bare 403 (a proxy, a CDN)
  // is a passing failure.
  if (isFail && REFUSED_403.some((m) => message.includes(m))) {
    return new AirVisualError('refused', safe(message));
  }
  if (message.includes('city_not_found') || message.includes('node not found')) {
    return new AirVisualError('not_found', safe(message));
  }
  if (message.includes('no_nearest_station')) {
    return new AirVisualError('no_station', safe(message));
  }
  if (status >= 200 && status < 300 && !isFail) {
    return new AirVisualError('failed', 'unexpected answer');
  }
  return new AirVisualError('failed', isFail ? safe(message) : `http ${Number(status) || 0}`);
}

const clamp = (ms, min, max) => Math.min(max, Math.max(min, ms));

/** A truncated SHA-256 of the key: what is persisted, never the key. */
export const keyHash = (apiKey) =>
  apiKey ? createHash('sha256').update(apiKey).digest('hex').slice(0, 16) : '';

/** A node link or redirection target: https, one of the two known hosts. */
const allowedNodeUrl = (url) => url.protocol === 'https:' && NODE_HOSTNAMES.includes(url.hostname);

export class AirVisualClient {
  constructor({ now = Date.now, sleep, storage } = {}) {
    this.now = now;
    this.budget = new Budget({ storage, now });
    const saved = this.budget.saved;
    this.lastCallAt = Number.isFinite(saved.lastCallAt) ? saved.lastCallAt : undefined;
    this.paceApi = createPacer(API_MIN_GAP, { now, sleep, last: this.lastCallAt });
    this.paceNode = createPacer(NODE_MIN_GAP, { now, sleep });
    /** The key state saved before a restart, applied by useKey() if the key matches. */
    this.savedKey = saved.key && typeof saved.key === 'object' ? saved.key : undefined;
    this.keyEpoch = 0;
    this.currentKeyHash = undefined;
    this.clearKeyState();
    /** node hash -> { until, error }: the 429 pause of a node. */
    this.nodePausedUntil = new Map();
  }

  clearKeyState() {
    /** ok | refused | limited, for the API key. */
    this.keyState = 'ok';
    this.keyPausedUntil = 0;
    this.keyError = undefined;
    this.limitedStreak = 0;
  }

  /** A new key: no refusal, no pause carried over (the budget stays). */
  reset() {
    this.keyEpoch += 1;
    this.clearKeyState();
    this.persist();
  }

  /**
   * The key of the configuration. The same key keeps its state (and, after
   * a restart, gets back the state saved for it); another key starts afresh.
   */
  useKey(apiKey) {
    const hash = keyHash(apiKey);
    if (hash === this.currentKeyHash) {
      return;
    }
    const firstUse = this.currentKeyHash === undefined;
    this.currentKeyHash = hash;
    const saved = this.savedKey;
    this.savedKey = undefined;
    this.keyEpoch += 1;
    this.clearKeyState();
    if (firstUse && saved?.hash && saved.hash === hash && this.now() < saved.pausedUntil) {
      if (saved.state === 'refused') {
        this.keyState = 'refused';
        this.keyError = new AirVisualError('refused', 'refused before a restart');
      } else if (saved.state === 'limited') {
        this.keyState = 'limited';
        this.keyError = new AirVisualError('limited', 'call_limit_reached', { quota: true });
      }
      if (this.keyError) {
        // Never longer than a fresh pause would be (a clock jump, a bad file).
        const longest = this.keyState === 'refused' ? REFUSED_BACKOFF : LIMITED_MAX;
        this.keyPausedUntil = Math.min(Number(saved.pausedUntil), this.now() + longest);
        this.limitedStreak = Number.isInteger(saved.streak) ? saved.streak : 0;
      }
    }
    this.persist();
  }

  persist() {
    this.syncExtra();
    this.budget.save();
  }

  /** The state of the key, as the budget file keeps it next to the count. */
  syncExtra() {
    this.budget.extra = {
      lastCallAt: this.lastCallAt,
      key: {
        hash: this.currentKeyHash ?? this.savedKey?.hash ?? '',
        state: this.keyState,
        pausedUntil: this.keyPausedUntil,
        streak: this.limitedStreak,
      },
    };
  }

  /** How long the next 429 pauses: Retry-After, else 60 s or 1 h doubling. */
  pauseFor(err) {
    this.limitedStreak += 1;
    const fallback = err.quota
      ? LIMITED_QUOTA_BASE * 2 ** Math.min(8, this.limitedStreak - 1)
      : LIMITED_MIN;
    return clamp(err.retryAfterMs ?? fallback, LIMITED_MIN, LIMITED_MAX);
  }

  /** Why no call with the key may go now, or undefined. */
  keyBlocked({ force = false, reserve = true } = {}) {
    if (this.now() < this.keyPausedUntil) {
      // The test button may try a refused key again; a 429 always holds.
      if (!(force && this.keyState === 'refused')) {
        return this.keyError;
      }
    }
    if (!this.budget.allows({ reserve })) {
      return new AirVisualError('budget', 'daily budget spent');
    }
    return undefined;
  }

  async callApi(endpoint, params, { apiKey, force = false, reserve = true }) {
    if (this.currentKeyHash === undefined) {
      this.useKey(apiKey);
    }
    const epoch = this.keyEpoch;
    const stale = () => new AirVisualError('failed', 'configuration changed');
    return this.paceApi(async (sent) => {
      // A call queued with a key the configuration no longer holds never goes.
      if (epoch !== this.keyEpoch || keyHash(apiKey) !== this.currentKeyHash) {
        throw stale();
      }
      // Checked when the turn comes, not when queued: a 429 met by the
      // previous call stops this one before the network.
      const blocked = this.keyBlocked({ force, reserve });
      if (blocked) {
        throw blocked;
      }
      const url = new URL(`${API_URL}/${endpoint}`);
      for (const [name, value] of Object.entries(params)) {
        url.searchParams.set(name, String(value));
      }
      url.searchParams.set('key', apiKey);
      this.lastCallAt = this.now();
      this.syncExtra();
      this.budget.take();
      sent();
      const answer = await getJson(url.href, { maxBytes: MAX_API_BODY, redirect: 'error' });
      // The key changed while the call was in flight: its outcome is not the
      // new key's.
      if (epoch !== this.keyEpoch) {
        throw stale();
      }
      const result = checkAnswer(answer);
      if (!(result instanceof AirVisualError)) {
        if (this.keyState !== 'ok' || this.limitedStreak !== 0) {
          this.clearKeyState();
          this.persist();
        }
        return result;
      }
      if (result.kind === 'limited') {
        this.keyState = 'limited';
        this.keyPausedUntil = this.now() + this.pauseFor(result);
        this.keyError = result;
      } else if (result.kind === 'refused') {
        this.keyState = 'refused';
        this.keyPausedUntil = this.now() + REFUSED_BACKOFF;
        this.keyError = result;
      }
      this.persist();
      throw result;
    });
  }

  /**
   * The nearest city of a point. The point is rounded to 2 decimals (about
   * 1 km) before it leaves Gladys.
   */
  nearestCity(latitude, longitude, { apiKey, force, reserve }) {
    const round = (v) => (Math.round(v * 100) / 100).toFixed(2);
    return this.callApi(
      'nearest_city',
      { lat: round(latitude), lon: round(longitude) },
      { apiKey, force, reserve },
    );
  }

  /** A city by name, spelled as AirVisual spells it. */
  city({ city, state, country }, { apiKey, force, reserve }) {
    return this.callApi('city', { city, state, country }, { apiKey, force, reserve });
  }

  /** GET a node link, following a redirection only to the known https hosts. */
  async getNode(href) {
    let url = new URL(href);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const answer = await getJson(url.href, { maxBytes: MAX_NODE_BODY, redirect: 'manual' });
      if (answer.status < 300 || answer.status >= 400) {
        return answer;
      }
      let next;
      try {
        next = answer.location ? new URL(answer.location, url) : undefined;
      } catch {
        next = undefined;
      }
      if (!next || !allowedNodeUrl(next)) {
        throw new AirVisualError('failed', 'redirection refused');
      }
      url = next;
    }
    throw new AirVisualError('failed', 'too many redirections');
  }

  /** An AirVisual Pro / Node by its id (no API key sent: the id is the credential). */
  node({ id, host, hash }) {
    return this.paceNode(async (sent) => {
      const paused = this.nodePausedUntil.get(hash);
      if (paused !== undefined && this.now() < paused.until) {
        throw paused.error;
      }
      const url = (NODE_HOSTS[host] ?? NODE_HOSTS.airvisual)(encodeURIComponent(id));
      sent();
      const answer = await this.getNode(url);
      // A node answer is the bare document (pyairvisual's fixture); the
      // `{ status, data }` envelope of the API is read too.
      const body = answer.body && typeof answer.body === 'object' ? answer.body : undefined;
      const doc = body?.current
        ? body
        : body?.status === 'success' && body.data?.current
          ? body.data
          : undefined;
      if (answer.status >= 200 && answer.status < 300 && doc) {
        this.nodePausedUntil.delete(hash);
        return doc;
      }
      const error = checkAnswer(answer);
      if (error.kind === 'limited') {
        const until =
          this.now() + clamp(error.retryAfterMs ?? LIMITED_MIN, LIMITED_MIN, LIMITED_MAX);
        this.nodePausedUntil.set(hash, { until, error });
      }
      // A refusal on a node link is about that link (a wrong id, or a key
      // the node endpoint would want after all), never about the API key.
      throw error.kind === 'refused' ? new AirVisualError('denied', error.detail) : error;
    });
  }
}
