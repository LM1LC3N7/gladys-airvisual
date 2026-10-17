// -----------------------------------------------------------------------------
// The daily call budget of the API key. The count survives a restart (a file
// under /data), so a container restarting in a loop cannot drain the monthly
// quota: each start reads every location once, and those reads count too.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DAILY_CALLS, DAILY_RESERVE } from './constants.js';

/** The UTC day of an instant: "2026-10-17". */
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A storage in memory (tests, and the fallback). */
export function memoryStorage(initial) {
  let value = initial;
  return {
    load: () => value,
    save: (next) => {
      value = next;
    },
  };
}

/** A JSON file; any failure (read-only, missing) is ignored: memory only then. */
export function fileStorage(path, { logger } = {}) {
  return {
    load() {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        return undefined;
      }
    },
    save(value) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(value));
      } catch (err) {
        logger?.warn?.(`Budget file not writable (${err.code ?? 'error'}): kept in memory`);
      }
    },
  };
}

export class Budget {
  constructor({ storage = memoryStorage(), now = Date.now } = {}) {
    this.storage = storage;
    this.now = now;
    const saved = storage.load();
    this.day = typeof saved?.day === 'string' ? saved.day : dayOf(now());
    this.count = Number.isInteger(saved?.count) && saved.count >= 0 ? saved.count : 0;
  }

  roll() {
    const today = dayOf(this.now());
    if (today !== this.day) {
      this.day = today;
      this.count = 0;
    }
  }

  /** Calls made today with the key. */
  used() {
    this.roll();
    return this.count;
  }

  /** Room for one more call: periodic reads leave the reserve untouched. */
  allows({ reserve = true } = {}) {
    return this.used() < DAILY_CALLS - (reserve ? DAILY_RESERVE : 0);
  }

  take() {
    this.roll();
    this.count += 1;
    this.storage.save({ day: this.day, count: this.count });
  }

  /** The next UTC midnight (ms): when the budget opens again. */
  resetsAt() {
    const d = new Date(this.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }
}

/**
 * The read interval of each location (minutes): the user's choice, but never
 * below what keeps every location within the daily budget of the periodic
 * reads (290 - 20 calls a day).
 */
export function effectiveInterval(configuredMinutes, locations) {
  if (locations <= 0) {
    return configuredMinutes;
  }
  const floor = Math.ceil((locations * 24 * 60) / (DAILY_CALLS - DAILY_RESERVE));
  return Math.max(configuredMinutes, floor);
}
