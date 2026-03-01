// Dashboard — Express server with SSE for live updates
const express = require('express');
const path = require('path');
const EventEmitter = require('events');

class Dashboard extends EventEmitter {
    constructor(matchTracker, atemController, port = 3000) {
        super();
        this.tracker = matchTracker;
        this.atem = atemController;
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
