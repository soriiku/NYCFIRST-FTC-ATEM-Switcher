// Dashboard — Express server with SSE for live updates
const express = require('express');
const path = require('path');
const EventEmitter = require('events');

class Dashboard extends EventEmitter {
    constructor(matchTracker, atemController, ftcApi, port = 3000) {
        super();
        this.tracker = matchTracker;
        this.atem = atemController;
        this.ftcApi = ftcApi;
        this.port = port;
        this.app = express();
        this.clients = []; // SSE clients
        this._setupRoutes();
        this._setupEvents();
    }

    _setupRoutes() {
        // Serve static files
        this.app.use(express.static(path.join(__dirname, 'public')));
        this.app.use(express.json());

        // API: Get current state
        this.app.get('/api/state', (req, res) => {
            res.json({
                tracker: this.tracker.getState(),
                atem: this.atem.getStatus(),
            });
        });

        // API: Manual override — switch to field
        this.app.post('/api/switch/:field', (req, res) => {
            const fieldNum = parseInt(req.params.field, 10);
            if (fieldNum !== 1 && fieldNum !== 2) {
                return res.status(400).json({ error: 'Field must be 1 or 2' });
            }
            this.tracker.forceField(fieldNum);
            res.json({ ok: true, field: fieldNum });
        });

        // API: Update field-to-HDMI input mapping
        this.app.post('/api/config/inputs', (req, res) => {
            const { field1Input, field2Input } = req.body;
            const f1 = parseInt(field1Input, 10);
            const f2 = parseInt(field2Input, 10);
            if (!f1 || !f2 || f1 < 1 || f1 > 8 || f2 < 1 || f2 > 8) {
                return res.status(400).json({ error: 'Inputs must be between 1 and 8' });
            }
            this.atem.updateFieldInputMap({ 1: f1, 2: f2 });
            res.json({ ok: true, fieldInputMap: { 1: f1, 2: f2 } });
        });

        // API: Connect to a different ATEM switcher
        this.app.post('/api/config/atem', async (req, res) => {
            const { ip } = req.body;
            if (!ip || !ip.trim()) {
                return res.status(400).json({ error: 'IP address is required' });
            }
            try {
                await this.atem.reconnect(ip.trim());
                res.json({ ok: true, ip: ip.trim(), connected: this.atem.connected });
            } catch (err) {
                res.status(500).json({ error: `Connection failed: ${err.message}` });
            }
        });

        // API: Change camera switch mode
        this.app.post('/api/config/switchmode', (req, res) => {
            const { mode } = req.body;
            try {
                this.tracker.setSwitchMode(mode);
                res.json({ ok: true, switchMode: mode });
            } catch (err) {
                res.status(400).json({ error: err.message });
            }
        });

        // API: Update FTC API credentials and event config
        this.app.post('/api/config/event', async (req, res) => {
            const { username, authKey, eventCode, season, tournamentLevel } = req.body;

            if (!eventCode || !eventCode.trim()) {
                return res.status(400).json({ error: 'Event code is required' });
            }

            try {
                // Update API credentials if provided
                if (username && authKey) {
                    this.ftcApi.updateCredentials(username, authKey);
                }

                // Reconfigure the match tracker with new event settings
                await this.tracker.reconfigure({
                    season: season ? parseInt(season, 10) : undefined,
                    eventCode: eventCode.trim(),
                    tournamentLevel: tournamentLevel || undefined,
                });

                res.json({
                    ok: true,
                    config: {
                        eventCode: this.tracker.eventCode,
                        season: this.tracker.season,
                        tournamentLevel: this.tracker.tournamentLevel,
                    },
                });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // SSE: Live event stream
        this.app.get('/api/events', (req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            });

            // Send initial state
            res.write(`data: ${JSON.stringify({ type: 'state', data: { tracker: this.tracker.getState(), atem: this.atem.getStatus() } })}\n\n`);

            this.clients.push(res);
            req.on('close', () => {
                this.clients = this.clients.filter(c => c !== res);
            });
        });
    }

    _setupEvents() {
        // Forward tracker events to SSE clients
        this.tracker.on('log', (entry) => {
            this._broadcast({ type: 'log', data: entry });
        });

        this.tracker.on('fieldSwitch', (data) => {
            this._broadcast({ type: 'fieldSwitch', data });
        });

        this.tracker.on('matchCompleted', (data) => {
            this._broadcast({ type: 'matchCompleted', data });
        });

        // Forward ATEM events
        this.atem.on('switched', (data) => {
            this._broadcast({ type: 'atemSwitched', data });
        });

        this.atem.on('configChanged', (data) => {
            this._broadcast({ type: 'configChanged', data });
        });

        this.tracker.on('reconfigured', (data) => {
            this._broadcast({ type: 'reconfigured', data });
        });
    }

    _broadcast(event) {
        const msg = `data: ${JSON.stringify(event)}\n\n`;
        this.clients.forEach(client => {
            try { client.write(msg); } catch (e) { /* ignore */ }
        });
    }

    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`[DASH] Dashboard running at http://localhost:${this.port}`);
                resolve();
            });
        });
    }

    stop() {
        if (this.server) this.server.close();
    }
}

module.exports = Dashboard;
