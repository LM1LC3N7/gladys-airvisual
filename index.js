// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the AirVisualApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { AirVisualClient } from './src/airvisual.js';
import { AirVisualApp } from './src/app.js';
import { fileStorage } from './src/budget.js';
import { ACTIONS } from './src/constants.js';

const gladys = new GladysIntegration();
// The daily call count is kept in /data, the one writable volume, so that a
// restart loop cannot drain the monthly quota of the free plan.
const client = new AirVisualClient({
  storage: fileStorage('/data/airvisual-budget.json', { logger }),
});
const app = new AirVisualApp({ gladys, client });

// --- Discovery: the places already read (no extra call to the quota) --------
gladys.onScanRequest(() => app.publishDiscovered({ force: true }));

// --- A device was created: send its values now, not at the next reading ------
gladys.onDeviceCreated(() => app.publishStates());

// --- Configuration screen button -----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user -----------------------------------------
gladys.onConfigUpdated(async (config) => {
  logger.info('Configuration updated: restarting');
  await app.start(config);
});

// --- Connection lifecycle -------------------------------------------------------
// A reconnection keeps the pauses, the refused key and the due times: start()
// only resets them when the API key changes.
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => app.stop());
gladys.handleShutdown(() => app.stop());

logger.info('Starting the AirVisual integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
