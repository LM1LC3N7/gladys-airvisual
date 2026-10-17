// -----------------------------------------------------------------------------
// The daily call budget of the API key, and the state of the key that must
// survive a restart (a file under /data): the count, the instant of the last
// call (the 13 s spacing), the 429 pause and the refusal. So a container
// restarting in a loop cannot drain the monthly quota nor hammer a refused
// key. The key itself is never written: only a truncated SHA-256 of it.
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DAILY_CALLS, DAILY_RESERVE } from './constants.js';

/** The UTC day of an instant: "2026-10-17". */
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Returned by a storage whose file exists but cannot be read as JSON. */
export const UNREADABLE = Object.freeze({ unreadable: true });

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

/**
 * A JSON file, written atomically (a .tmp file, then a rename). A missing
 * file is a first start; an unreadable one is reported (once, without its
 * content) as UNREADABLE. A write failure is warned once: memory only then.
 */
export function fileStorage(path, { logger } = {}) {
  // One warning per kind (read, write): a read problem never hides a write one.
  const warned = new Set();
  const warnOnce = (kind, text) => {
    if (!warned.has(kind)) {
      warned.add(kind);
      logger?.warn?.(text);
    }
  };
  return {
    load() {
      let text;
      try {
        text = readFileSync(path, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') {
          warnOnce(
            'read',
            `Budget file unreadable (${err.code ?? 'error'}): half of today's budget assumed spent`,
          );
          return UNREADABLE;
        }
        return undefined;
      }
      try {
        const value = JSON.parse(text);
        if (value && typeof value === 'object') {
          return value;
        }
      } catch {
        // Fall through: a corrupt file.
      }
      warnOnce('read', "Budget file corrupt: half of today's budget assumed spent");
      return UNREADABLE;
    },
    save(value) {
      try {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, JSON.stringify(value));
        renameSync(tmp, path);
      } catch (err) {
        warnOnce('write', `Budget file not writable (${err.code ?? 'error'}): kept in memory`);
      }
    },
  };
}

export class Budget {
  constructor({ storage = memoryStorage(), now = Date.now } = {}) {
    this.storage = storage;
    this.now = now;
    const saved = storage.load();
    if (saved === UNREADABLE || saved?.unreadable) {
      // Prudent: a file we cannot read may have held a busy day.
      this.day = dayOf(now());
      this.count = Math.floor(DAILY_CALLS / 2);
      this.saved = {};
    } else {
      this.day = typeof saved?.day === 'string' ? saved.day : dayOf(now());
      this.count = Number.isInteger(saved?.count) && saved.count >= 0 ? saved.count : 0;
      this.saved = saved && typeof saved === 'object' ? saved : {};
    }
    /** The other persisted fields (the state of the key), set by the client. */
    this.extra = {};
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
    this.save();
  }

  save() {
    this.storage.save({ ...this.extra, day: this.day, count: this.count });
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
 * reads (290 - 20 calls a day), counting the first read of each location at
 * midnight UTC.
 */
export function effectiveInterval(configuredMinutes, locations) {
  if (locations <= 0) {
    return configuredMinutes;
  }
  const floor = Math.ceil((locations * 24 * 60) / (DAILY_CALLS - DAILY_RESERVE - locations));
  return Math.max(configuredMinutes, floor);
}
