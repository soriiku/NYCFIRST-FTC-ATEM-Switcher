// FTC ATEM Auto-Switcher — Main Entry Point
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const FtcApi = require('./ftcApi');
const AtemController = require('./atemController');
const MatchTracker = require('./matchTracker');
const Dashboard = require('./dashboard');

// Parse args
const dryRun = process.argv.includes('--dry-run');

// Validate config
const requiredEnv = ['FTC_USERNAME', 'FTC_AUTH_KEY', 'FTC_EVENT_CODE', 'ATEM_IP'];
for (const key of requiredEnv) {
    if (!process.env[key]) {
        if (key === 'ATEM_IP' && dryRun) continue; // ATEM IP not needed in dry-run
        console.error(`Missing required config: ${key}`);
        console.error('Make sure your .env file is set up correctly.');
        process.exit(1);
    }
}

// Config
const config = {
    ftcUsername: process.env.FTC_USERNAME,
    ftcAuthKey: process.env.FTC_AUTH_KEY,
    season: parseInt(process.env.FTC_SEASON || '2025', 10),
    eventCode: process.env.FTC_EVENT_CODE,
    tournamentLevel: process.env.FTC_TOURNAMENT_LEVEL || 'qual',
    atemIp: process.env.ATEM_IP || '192.168.10.240',
    field1Input: parseInt(process.env.FIELD1_INPUT || '1', 10),
    field2Input: parseInt(process.env.FIELD2_INPUT || '3', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
};

console.log('');
console.log('╔══════════════════════════════════════════╗');
console.log('║      ⚡ FTC ATEM Auto-Switcher ⚡       ║');
console.log('╚══════════════════════════════════════════╝');
console.log('');
console.log(`  Event:    ${config.eventCode} (${config.season})`);
console.log(`  Level:    ${config.tournamentLevel}`);
console.log(`  ATEM IP:  ${config.atemIp}`);
console.log(`  Field 1:  HDMI Input ${config.field1Input}`);
console.log(`  Field 2:  HDMI Input ${config.field2Input}`);
console.log(`  Polling:  Every ${config.pollIntervalMs / 1000}s`);
console.log(`  Mode:     ${dryRun ? 'DRY RUN (no ATEM commands)' : 'LIVE'}`);
console.log('');

async function main() {
    // 1. Initialize FTC API client
    const ftcApi = new FtcApi(config.ftcUsername, config.ftcAuthKey);
    console.log('[INIT] Testing FTC API connection...');
    try {
        const apiInfo = await ftcApi.testConnection(config.season);
        console.log(`[INIT] API OK — Season: ${config.season}, Status: ${apiInfo.status || 'active'}`);
    } catch (err) {
        console.error(`[INIT] FTC API connection failed: ${err.message}`);
        process.exit(1);
    }

    // 2. Initialize ATEM controller
    const atemController = new AtemController(
        config.atemIp,
        { 1: config.field1Input, 2: config.field2Input },
        dryRun
    );

    if (!dryRun) {
        console.log('[INIT] Connecting to ATEM...');
        try {
            await atemController.connect();
        } catch (err) {
            console.error(`[INIT] ATEM connection failed: ${err.message}`);
            console.error('[INIT] Tip: Run with --dry-run to test without ATEM');
            process.exit(1);
        }
    } else {
        await atemController.connect(); // Sets up dry-run mode
    }

    // 3. Initialize match tracker
    const matchTracker = new MatchTracker(ftcApi, {
        season: config.season,
        eventCode: config.eventCode,
        tournamentLevel: config.tournamentLevel,
    });

    // Wire up: when tracker says to switch fields, tell ATEM
    matchTracker.on('fieldSwitch', async (data) => {
        console.log(`[MAIN] Switching to Field ${data.fieldNumber} for ${data.description}`);
        await atemController.switchToField(data.fieldNumber);
    });

    // Load initial data
    console.log('[INIT] Loading match schedule...');
    try {
        await matchTracker.initialize();
    } catch (err) {
        console.error(`[INIT] Failed to load schedule: ${err.message}`);
        process.exit(1);
    }

    // 4. Start dashboard
    const dashboard = new Dashboard(matchTracker, atemController, config.dashboardPort);
    await dashboard.start();

    // 5. Start polling
    matchTracker.startPolling(config.pollIntervalMs);

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`  Dashboard: http://localhost:${config.dashboardPort}`);
    console.log('  Press Ctrl+C to stop');
    console.log('═══════════════════════════════════════════');
    console.log('');

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n[MAIN] Shutting down...');
        matchTracker.stopPolling();
        dashboard.stop();
        await atemController.disconnect();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});
