// Electron Main Process
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const envPath = path.join(app.getPath('userData'), '.env');
let mainWindow = null;
let serverRunning = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: 'FTC ATEM Auto-Switcher',
        icon: path.join(__dirname, 'src', 'public', 'icon.ico'),
        backgroundColor: '#0f172a',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        autoHideMenuBar: true,
    });

    // Check if .env exists — show setup or dashboard
    if (!fs.existsSync(envPath) || !hasRequiredConfig()) {
        // Show the setup page served by the setup server
        startSetupServer();
    } else {
        // Start the main server and load dashboard
        startMainServer();
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function hasRequiredConfig() {
    try {
        const content = fs.readFileSync(envPath, 'utf8');
        return content.includes('FTC_USERNAME=') &&
            content.includes('FTC_AUTH_KEY=') &&
            content.includes('FTC_EVENT_CODE=') &&
            !content.includes('FTC_USERNAME=\n') &&
            !content.includes('FTC_USERNAME=\r');
    } catch {
        return false;
    }
}

function startSetupServer() {
    const express = require('express');
    const setupApp = express();
    setupApp.use(express.json());
    setupApp.use(express.static(path.join(__dirname, 'src', 'public')));

    setupApp.post('/api/setup', (req, res) => {
        const { username, authKey, eventCode, season, tournamentLevel, atemIp, field1Input, field2Input } = req.body;

        if (!username || !authKey || !eventCode) {
            return res.status(400).json({ error: 'Username, Auth Key, and Event Code are required' });
        }

        const envContent = [
            '# FTC ATEM Auto-Switcher Configuration',
            `# Generated on ${new Date().toLocaleDateString()}`,
            '',
            '# FTC Events API Credentials',
            `FTC_USERNAME=${username}`,
            `FTC_AUTH_KEY=${authKey}`,
            '',
            '# Event Configuration',
            `FTC_SEASON=${season || '2025'}`,
            `FTC_EVENT_CODE=${eventCode}`,
            `FTC_TOURNAMENT_LEVEL=${tournamentLevel || 'qual'}`,
            '',
            '# ATEM Switcher',
            `ATEM_IP=${atemIp || '192.168.10.240'}`,
            '',
            '# Field-to-Input Mapping',
            `FIELD1_INPUT=${field1Input || '1'}`,
            `FIELD2_INPUT=${field2Input || '3'}`,
            '',
            '# Advanced',
            'POLL_INTERVAL_MS=5000',
            'DASHBOARD_PORT=3000',
            '',
        ].join('\n');

        fs.writeFileSync(envPath, envContent, 'utf8');
        res.json({ ok: true });

        // Close setup server and start main app
        setTimeout(() => {
            if (setupServer) setupServer.close();
            startMainServer();
        }, 500);
    });

    const setupServer = setupApp.listen(3001, () => {
        mainWindow.loadURL('http://localhost:3001/setup.html');
    });
}

function startMainServer() {
    if (serverRunning) return;
    serverRunning = true;

    // Load .env
    require('dotenv').config({ path: envPath });

    const FtcApi = require('./src/ftcApi');
    const AtemController = require('./src/atemController');
    const MatchTracker = require('./src/matchTracker');
    const Dashboard = require('./src/dashboard');

    const dryRun = process.argv.includes('--dry-run');

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

    async function boot() {
        const ftcApi = new FtcApi(config.ftcUsername, config.ftcAuthKey);

        const atemController = new AtemController(
            config.atemIp,
            { 1: config.field1Input, 2: config.field2Input },
            dryRun
        );

        try {
            await atemController.connect();
        } catch (err) {
            console.error('[INIT] ATEM connection failed:', err.message);
            // Continue anyway — user can reconnect from dashboard
        }

        const matchTracker = new MatchTracker(ftcApi, {
            season: config.season,
            eventCode: config.eventCode,
            tournamentLevel: config.tournamentLevel,
        });

        matchTracker.on('fieldSwitch', async (data) => {
            await atemController.switchToField(data.fieldNumber);
        });

        try {
            await matchTracker.initialize();
        } catch (err) {
            console.error('[INIT] Schedule load failed:', err.message);
        }

        const dashboard = new Dashboard(matchTracker, atemController, ftcApi, config.dashboardPort);
        await dashboard.start();

        matchTracker.startPolling(config.pollIntervalMs);

        // Load dashboard in the Electron window
        mainWindow.loadURL(`http://localhost:${config.dashboardPort}`);
    }

    boot().catch((err) => {
        console.error('[FATAL]', err);
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
