// FTC ATEM Auto-Switcher — Main Entry Point
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const envPath = path.join(__dirname, '..', '.env');

// --- Interactive Setup Wizard ---
function ask(rl, question, defaultVal) {
    const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            resolve(answer.trim() || defaultVal || '');
        });
    });
}

async function runSetupWizard() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║    ⚡ FTC ATEM Auto-Switcher Setup ⚡   ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
    console.log('  No configuration found. Let\'s set things up!');
    console.log('  (You can change all of this later from the dashboard)');
    console.log('');
    console.log('  ── FTC API Credentials ──');
    console.log('  Register at: https://ftc-events.firstinspires.org/services/API');
    console.log('');

    const username = await ask(rl, '  FTC API Username');
    const authKey = await ask(rl, '  FTC API Auth Key');

    console.log('');
    console.log('  ── Event Details ──');
    console.log('');

    const eventCode = await ask(rl, '  Event Code (e.g. USNYNYBRSQ2)');
    const season = await ask(rl, '  Season', '2025');
    const tournamentLevel = await ask(rl, '  Tournament Level (qual/playoff)', 'qual');

    console.log('');
    console.log('  ── ATEM Switcher ──');
    console.log('');

    const atemIp = await ask(rl, '  ATEM IP Address', '192.168.10.240');
    const field1Input = await ask(rl, '  HDMI Input for Field 1 (1-8)', '1');
    const field2Input = await ask(rl, '  HDMI Input for Field 2 (1-8)', '3');

    rl.close();

    // Build .env content
    const envContent = [
        `# FTC ATEM Auto-Switcher Configuration`,
        `# Generated on ${new Date().toLocaleDateString()}`,
        ``,
        `# FTC Events API Credentials`,
        `FTC_USERNAME=${username}`,
        `FTC_AUTH_KEY=${authKey}`,
        ``,
        `# Event Configuration`,
        `FTC_SEASON=${season}`,
        `FTC_EVENT_CODE=${eventCode}`,
        `FTC_TOURNAMENT_LEVEL=${tournamentLevel}`,
        ``,
        `# ATEM Switcher`,
        `ATEM_IP=${atemIp}`,
        ``,
        `# Field-to-Input Mapping`,
        `FIELD1_INPUT=${field1Input}`,
        `FIELD2_INPUT=${field2Input}`,
        ``,
        `# Advanced`,
        `POLL_INTERVAL_MS=5000`,
        `DASHBOARD_PORT=3000`,
        ``,
    ].join('\n');

    // Save .env file
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('');
    console.log('  ✓ Configuration saved!');
    console.log('');
}

// --- Main Application ---
async function boot() {
    // Check if .env exists, if not run setup wizard
    if (!fs.existsSync(envPath)) {
        await runSetupWizard();
    }

    // Load .env
    require('dotenv').config({ path: envPath });

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
            console.error('Delete the .env file to re-run the setup wizard.');
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
    const dashboard = new Dashboard(matchTracker, atemController, ftcApi, config.dashboardPort);
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

boot().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
});
