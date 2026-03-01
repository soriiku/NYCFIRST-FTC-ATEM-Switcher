// Blackmagic ATEM Mini Pro Controller
const { Atem } = require('atem-connection');
const EventEmitter = require('events');

class AtemController extends EventEmitter {
    constructor(ip, fieldInputMap, dryRun = false) {
        super();
        this.ip = ip;
        this.fieldInputMap = fieldInputMap; // e.g. { 1: 1, 2: 3 } => field 1 = HDMI 1, field 2 = HDMI 3
        this.dryRun = dryRun;
        this.atem = null;
        this.connected = false;
        this.currentInput = null;
    }

    /**
     * Connect to the ATEM switcher
     */
    async connect() {
        if (this.dryRun) {
            console.log('[ATEM] DRY RUN mode — no actual ATEM connection');
            this.connected = true;
            this.emit('connected');
            return;
        }

        return new Promise((resolve, reject) => {
            this.atem = new Atem();
            let resolved = false;

            this.atem.on('connected', () => {
                this.connected = true;
                console.log(`[ATEM] Connected to ATEM at ${this.ip}`);
                this.emit('connected');
                if (!resolved) { resolved = true; resolve(); }
            });

            this.atem.on('disconnected', () => {
                this.connected = false;
                console.log('[ATEM] Disconnected from ATEM');
                this.emit('disconnected');
            });

            this.atem.on('error', (err) => {
                console.error('[ATEM] Error:', err.message);
                this.emit('error', err);
                if (!resolved) { resolved = true; reject(err); }
            });

            // Attempt connection
            console.log(`[ATEM] Connecting to ${this.ip}...`);
            this.atem.connect(this.ip).catch((err) => {
                if (!resolved) { resolved = true; reject(err); }
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    reject(new Error(`ATEM connection timed out (${this.ip})`));
                }
            }, 10000);
        });
    }

    /**
     * Switch program output to the camera for the given field number
     */
    async switchToField(fieldNumber) {
        const inputNumber = this.fieldInputMap[fieldNumber];
        if (inputNumber === undefined) {
            console.error(`[ATEM] No input mapping for field ${fieldNumber}`);
            return false;
        }

        if (this.currentInput === inputNumber) {
            console.log(`[ATEM] Already on input ${inputNumber} (Field ${fieldNumber}) — no switch needed`);
            return true;
        }

        if (this.dryRun) {
            console.log(`[ATEM] DRY RUN: Would switch to Input ${inputNumber} (Field ${fieldNumber})`);
            this.currentInput = inputNumber;
            this.emit('switched', { fieldNumber, inputNumber });
            return true;
        }

        if (!this.connected || !this.atem) {
            console.error('[ATEM] Not connected — cannot switch');
            return false;
        }

        try {
            // ME index 0 = Program output on Mix Effect 1
            await this.atem.changeProgramInput(inputNumber, 0);
            this.currentInput = inputNumber;
            console.log(`[ATEM] ✓ Switched to Input ${inputNumber} (Field ${fieldNumber})`);
            this.emit('switched', { fieldNumber, inputNumber });
            return true;
        } catch (err) {
            console.error(`[ATEM] Failed to switch: ${err.message}`);
            this.emit('error', err);
            return false;
        }
    }

    /**
     * Update the field-to-input mapping at runtime
     */
    updateFieldInputMap(newMap) {
        this.fieldInputMap = newMap;
        console.log(`[ATEM] Field input map updated: Field 1 → HDMI ${newMap[1]}, Field 2 → HDMI ${newMap[2]}`);
        this.emit('configChanged', { fieldInputMap: newMap });
    }

    /**
     * Get current connection status
     */
    getStatus() {
        return {
            connected: this.connected,
            dryRun: this.dryRun,
            ip: this.ip,
            currentInput: this.currentInput,
            fieldInputMap: this.fieldInputMap,
        };
    }

    /**
     * Reconnect to a different ATEM at a new IP address
     */
    async reconnect(newIp) {
        // Disconnect from current
        await this.disconnect();

        this.ip = newIp;
        this.currentInput = null;
        console.log(`[ATEM] Reconnecting to new IP: ${newIp}`);
        this.emit('configChanged', { ip: newIp, fieldInputMap: this.fieldInputMap });

        // Connect to new IP
        await this.connect();
    }

    /**
     * Disconnect from ATEM
     */
    async disconnect() {
        if (this.atem && this.connected) {
            await this.atem.disconnect();
        }
        this.connected = false;
    }
}

module.exports = AtemController;
