# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.3] - 2026-10-23

## [0.1.2] - 2026-10-17

### Fixed

- Status and Discovery republished after Gladys restarts.

## [0.1.1] - 2026-10-17

### Added

- The air quality of your houses in Gladys, through the official IQAir
  AirVisual API and a free API key: US AQI, China AQI and main pollutant (US
  and China) of the nearest city of each located house.
- The same values for up to five locations in all (houses and cities written
  "City, State, Country").
- Your AirVisual Pro monitors through their cloud link, without API key: US
  and China AQI when the monitor sends them, PM2.5, PM10, CO2, temperature
  and humidity.
- Kept under the free "Community" plan: each location read every 30 minutes
  by default, the interval raised when the locations would not fit, never two
  calls less than 13 seconds apart, at most 290 calls per UTC day; a failed
  read never retried faster than its interval (a city not found: every 6
  hours). The count, the spacing, the 429 pause and the refusal of the key
  survive a restart (kept under `/data` with a hash of the key, never the
  key).
- A 429 from AirVisual pauses every call with the key, the test button
  included (Retry-After, else 1 minute or 1 hour doubling, between 1 minute
  and 6 hours); a refused key stops the reads and says so, with one new try
  every 6 hours until the key changes.
- A connection status that names the locations without value and why.
- "Test AirVisual" button: one call to check the key, the last values of
  every location and of the monitors.

[Unreleased]: https://github.com/LM1LC3N7/gladys-airvisual/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/LM1LC3N7/gladys-airvisual/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-airvisual/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-airvisual/releases/tag/v0.1.1
