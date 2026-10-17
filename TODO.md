# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real AirVisual Community key: the
      devices of the Discovery tab, their values, the status, the test
      button. Never done yet.
- [ ] Test with a real AirVisual Pro (both link shapes).
- [ ] Check the CI (Docker build, Node 22 and 24), then run the store
      validator once the image is published (at milestone 1 its only error
      is `docker_image` not yet pullable from GHCR). The Docker image was
      never built locally (no Docker on the development PC).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store.

## To confirm

- [ ] The HTTP status of the API errors: pyairvisual reads the message of the
      body whatever the status; `call_limit_reached` is expected with a 429,
      `incorrect_api_key` with a 400 or 401. Both are handled.
- [ ] Whether `call_limit_reached` means the minute, the day or the month
      limit: a 1-hour pause, doubling up to 6 hours, is the prudent choice.
      Whether AirVisual sends `Retry-After` (used when it does).
- [ ] The cloud link of an AirVisual Pro: `www.airvisual.com/api/v2/node/<id>`
      (pyairvisual) and `device.iqair.com/v2/<id>` (the link the IQAir
      dashboard shares). Both are read; whether the first one still answers,
      and the exact shape of the second (`p2` as a number or as
      `{ conc, aqius, aqicn }`), are not verified.
- [ ] Whether a node link needs the API key: pyairvisual sends `key=` on
      `/node/<id>` too; this integration does not (the key goes only to
      api.airvisual.com). A refusal on a node link shows "link refused" and
      never touches the state of the key. If real links need it, decide then
      (sending it to www.airvisual.com would widen where the key goes).
- [ ] Whether the node calls count against the key quota: they do not send
      the key, so they should not.
- [ ] The answer to an expired Community key (`api_key_expired`).
- [x] The core lists the PM2.5 / PM10 units as nested arrays
      (`[[MICROGRAM_PER_CUBIC_METER]]`) in `DEVICE_FEATURE_UNITS_BY_CATEGORY`:
      closed, no effect on this module (it publishes the plain
      `microgram-per-cubic-meter` string). The duplicated
      `MICROGRAM_PER_CUBIC_METER` in the core's PM10 list is noted apart for
      Louis.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-airvisual:0.1.0`); the first patch release gives
  0.1.1.
- **pyairvisual (MIT) as the reference**, not copied: Python, so the same
  endpoints and error handling are re-implemented in JavaScript, credited in
  the docs and in `THIRD_PARTY_NOTICES.md` (copied into the image with
  `LICENSE`).
- **No runtime dependency** besides the Gladys SDK (Node's `fetch`).
- **Device type, one device per location or monitor**, so each can sit in its
  own room. External ids: `house:<house selector>`, `city:<country>_<state>_<city>`
  (slugs), `node:<sha256(id)[0..16]>`, then the AirVisual field name
  (`aqius`, `aqicn`, `mainus`, `maincn`, `p2`, `p1`, `co`, `tp`, `hm`).
  The node id is a credential: never in an external id, a log or a message.
- **Categories and units of the core only**: `airquality-sensor`/`aqi` (unit
  `aqi`), `pm25-sensor` and `pm10-sensor` in `microgram-per-cubic-meter`,
  `co2-sensor` in `ppm`, `temperature-sensor` in `celsius`,
  `humidity-sensor` in `percent`, all from `DEVICE_FEATURE_UNITS_BY_CATEGORY`
  of `server/utils/constants.js` (checked by `test/manifest.test.js`). The
  main pollutant is a `text`/`text` feature (a string state, no history), with
  the AirVisual code shown as PM2.5, PM10, O3, NO2, SO2, CO.
- **No weather values of the cities** (temperature, humidity, wind of
  `current.weather`): a weather integration's job, and city temperatures
  would skew the room temperature of Gladys. The node temperature is indoor,
  where the monitor stands: kept.
- **Quota guard** (free plan: 10,000 calls a month, 500 a day, 5 a minute):
  default 30 minutes per location; the interval is raised to
  `ceil(locations × 1440 / (270 − locations))` minutes when needed (the first
  read of each location at 00:00 UTC counted: 28 min for five); five
  locations at most; 13 s between calls; a daily cap of 290 calls (8,990 a
  month) of which 20 are kept for the test button.
- **Retries (review)**: a passing failure (network, 5xx, unexpected answer)
  is retried at the usual interval, never sooner
  (`max(interval, 10 min)`); a 429 (location or node) at the later of that
  and the end of its pause, so a run of short 60 s pauses never means a read
  a minute; a refused key at the end of its pause (6 h); `city_not_found`,
  `no_nearest_station` and a refused node link every 6 hours. A pause read
  back from `/data` is capped at a fresh one (6 h). Simulated over 24 h:
  one misspelt city and four good ones, a 12-hour 5xx outage or 12 hours of
  bare 429s, stay ≤ 270 calls and the good
  cities are read until midnight.
- **Persisted state (review)**: `/data/airvisual-budget.json` holds the day,
  the count, `lastCallAt` (the 13 s spacing), and the key state (state,
  pause end, 429 streak) with a truncated SHA-256 of the key, never the key.
  A restart with the same key restores them; another key starts afresh.
  Written atomically (`.tmp` then rename); an unreadable or corrupt file is
  warned once (without its content) and taken as half of the day's budget
  spent; a write failure is warned once, then memory only.
- **Recovery (review)**: when a call with the key works again after a
  refusal or a 429, the locations that waited for it are due at once.
- **Key epoch (review)**: a new key bumps an epoch; a call queued with the
  old key never goes, and the outcome of a call in flight with it never
  touches the new key's state. A tick of the previous configuration still
  running is followed, never run alongside.
- **The test button reads one location only** (the key check) and shows the
  last values of the others; it may use the reserve, and may retry a refused
  key at once, never during a 429 pause. Gladys waits 120 s: past 100 s the
  button answers with the last values (a read still running finishes in the
  background).
- **Redirections (review)**: none followed for api.airvisual.com
  (`redirect: 'error'`); for a node link, followed manually (3 at most) and
  only to `https://www.airvisual.com` or `https://device.iqair.com`.
- **Messages (review)**: an error detail shows only a known AirVisual code
  (or `http <status>`), never the raw message; the secrets are scrubbed from
  logs without regard to case.
- **The Discovery tab never calls AirVisual**: it shows the places already
  read, to keep the quota.
- **429**: `Retry-After` when given, else 1 minute (`too_many_requests`) or
  1 hour doubling (`call_limit_reached`), always clamped to 1 minute – 6
  hours, checked inside the pacer for every call with the key (polls, test
  button, starts).
- **Refused key** (`incorrect_api_key`, `api_key_expired`,
  `Payment Required`, `permission_denied`, an AirVisual `Forbidden` /
  `feature_not_available`, any 401): the key reads stop and the status says
  it; one new try every 6 hours (never a dead integration), reset when the
  key changes. A bare 403 without the AirVisual error body counts as a
  passing failure, not a refusal.
- **A reconnection to Gladys** (`connected` event) keeps the client, the
  pauses, the refusal and the due times; only a new key (or a new interval)
  makes the locations due again. The house positions are read again only
  then (start, reconnection, configuration saved); AirVisual's nearest city
  may change under the same device.
- **Nodes are independent**: no key sent, their own pace (2 s) and 429
  pause; a node down never blocks the locations and the reverse.
- **Node links**: a bare id, or a whole link of the two known hosts only
  (https, `device.iqair.com/v2/<id>` or `www.airvisual.com/api/v2/node/<id>`),
  so no other address can be called. The node ids field is a `secret`: the
  list must be entered whole to be changed.
- **The houses' positions** are rounded to 2 decimals (about 1 km) before
  they reach AirVisual.
- **Bounded answers**: 64 KB for the API, 1 MB for a node (its history comes
  with it); error messages keep the host only.
- **Freshness**: a city value older than 3 hours, a node value older than 1
  hour, is not published; an unchanged value is re-sent every 30 minutes.
- **The secret is not encrypted by Gladys**: the docs say "kept by Gladys in
  its database, never shown again, sent only to api.airvisual.com".

## Ideas

- Compute the US AQI from PM2.5 for a monitor that does not send it.
- The weather of the cities as an option.
- VOC and PM1 of the AirVisual Pro (`voc`, `p01`) once proven.
- The local Samba access of the AirVisual Pro (pyairvisual's `NodeSamba`),
  without cloud.
