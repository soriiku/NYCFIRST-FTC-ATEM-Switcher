// Match Tracker — Core orchestration logic
const EventEmitter = require('events');

class MatchTracker extends EventEmitter {
    constructor(ftcApi, config) {
        super();
        this.ftcApi = ftcApi;
        this.season = config.season;
        this.eventCode = config.eventCode;
        this.tournamentLevel = config.tournamentLevel;

        // State
        this.schedule = [];        // Full schedule with field assignments
        this.hybridSchedule = [];  // Hybrid schedule with results
        this.completedMatches = new Set(); // Match numbers we've already seen as completed
        this.currentField = null;
        this.nextMatch = null;
        this.lastSwitchTime = null;
        this.log = [];            // Event log for dashboard
        this.initialized = false;
        this.polling = false;
        this.pollTimer = null;
    }

    /**
     * Initialize — load schedule and detect current state
     */
    async initialize() {
        this._log('info', 'Loading match schedule...');

        try {
            // Fetch the full schedule (has field assignments)
            this.schedule = await this.ftcApi.getSchedule(
                this.season, this.eventCode, this.tournamentLevel
            );
            this._log('info', `Loaded ${this.schedule.length} matches from schedule`);

            // Fetch initial hybrid schedule (has result data)
            this.hybridSchedule = await this.ftcApi.getHybridSchedule(
                this.season, this.eventCode, this.tournamentLevel
            );
            this._log('info', `Loaded ${this.hybridSchedule.length} matches from hybrid schedule`);

            // Mark already-completed matches
            for (const match of this.hybridSchedule) {
                if (match.actualStartTime && match.postResultTime) {
                    this.completedMatches.add(match.matchNumber);
                }
            }
            this._log('info', `${this.completedMatches.size} matches already completed`);

            // Determine current state
            this._determineNextMatch();
            this.initialized = true;

            return true;
        } catch (err) {
            this._log('error', `Failed to initialize: ${err.message}`);
            throw err;
        }
    }

    /**
     * Start polling for match updates
     */
    startPolling(intervalMs = 5000) {
        if (this.polling) return;
        this.polling = true;
        this._log('info', `Polling every ${intervalMs / 1000}s for match updates...`);
        this._poll(intervalMs);
    }

    /**
     * Stop polling
     */
    stopPolling() {
        this.polling = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        this._log('info', 'Polling stopped');
    }

    /**
     * Poll the API for updates
     */
    async _poll(intervalMs) {
        if (!this.polling) return;

        try {
            // Use FMS-OnlyModifiedSince for efficient polling
            const updated = await this.ftcApi.getHybridSchedule(
                this.season, this.eventCode, this.tournamentLevel, true
            );

            if (updated !== null) {
                // Merge updates into our hybrid schedule
                this._processUpdates(updated);
            }
        } catch (err) {
            this._log('error', `Poll error: ${err.message}`);
        }

        // Schedule next poll
        this.pollTimer = setTimeout(() => this._poll(intervalMs), intervalMs);
    }

    /**
     * Process updated match data from polling
     */
    _processUpdates(updatedSchedule) {
        let newCompletions = [];

        for (const match of updatedSchedule) {
            const matchNum = match.matchNumber;

            // Update our local hybrid schedule
            const idx = this.hybridSchedule.findIndex(m => m.matchNumber === matchNum);
            if (idx >= 0) {
                this.hybridSchedule[idx] = match;
            } else {
                this.hybridSchedule.push(match);
            }

            // Check if this match just completed
            if (match.actualStartTime && match.postResultTime && !this.completedMatches.has(matchNum)) {
                this.completedMatches.add(matchNum);
                newCompletions.push(match);
            }
        }

        if (newCompletions.length > 0) {
            for (const match of newCompletions) {
                const fieldInfo = this._getFieldForMatch(match.matchNumber);
                this._log('match', `Match ${match.matchNumber} completed on ${fieldInfo || 'unknown field'}`);
                this.emit('matchCompleted', {
                    matchNumber: match.matchNumber,
                    field: fieldInfo,
                    redScore: match.scoreRedFinal,
                    blueScore: match.scoreBlueFinal,
                });
            }

            // Determine what to switch to next
            this._determineNextMatch();
        }
    }

    /**
     * Get the field assignment for a match number from the schedule
     */
    _getFieldForMatch(matchNumber) {
        const scheduled = this.schedule.find(m => m.matchNumber === matchNumber);
        return scheduled ? scheduled.field : null;
    }

    /**
     * Parse field string to field number (e.g., "Field 1" -> 1, "Field 2" -> 2)
     */
    _parseFieldNumber(fieldStr) {
        if (!fieldStr) return null;
        const match = fieldStr.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }

    /**
     * Determine the next unplayed match and emit field switch if needed
     */
    _determineNextMatch() {
        // Find the first match that hasn't been completed yet, ordered by match number
        const allMatchNumbers = this.schedule
            .map(m => m.matchNumber)
            .sort((a, b) => a - b);

        let nextMatchNum = null;
        for (const num of allMatchNumbers) {
            if (!this.completedMatches.has(num)) {
                nextMatchNum = num;
                break;
            }
        }

        if (nextMatchNum === null) {
            this._log('info', 'All matches completed!');
            this.nextMatch = null;
            this.emit('allComplete');
            return;
        }

        const nextField = this._getFieldForMatch(nextMatchNum);
        const nextFieldNum = this._parseFieldNumber(nextField);
        const nextScheduled = this.schedule.find(m => m.matchNumber === nextMatchNum);

        this.nextMatch = {
            matchNumber: nextMatchNum,
            field: nextField,
            fieldNumber: nextFieldNum,
            description: nextScheduled ? nextScheduled.description : `Match ${nextMatchNum}`,
            startTime: nextScheduled ? nextScheduled.startTime : null,
            teams: nextScheduled ? nextScheduled.teams : [],
        };

        this._log('info', `Next match: ${this.nextMatch.description} on ${nextField || 'unknown field'}`);

        // Emit field switch if needed
        if (nextFieldNum && nextFieldNum !== this.currentField) {
            this.currentField = nextFieldNum;
            this.lastSwitchTime = new Date().toISOString();
            this._log('switch', `→ Switching to Field ${nextFieldNum}`);
            this.emit('fieldSwitch', {
                fieldNumber: nextFieldNum,
                matchNumber: nextMatchNum,
                description: this.nextMatch.description,
            });
        }
    }

    /**
     * Get current state for dashboard
     */
    getState() {
        return {
            initialized: this.initialized,
            polling: this.polling,
            currentField: this.currentField,
            nextMatch: this.nextMatch,
            lastSwitchTime: this.lastSwitchTime,
            totalMatches: this.schedule.length,
            completedCount: this.completedMatches.size,
            log: this.log.slice(-50), // Last 50 entries
        };
    }

    /**
     * Force switch to a specific field (manual override)
     */
    forceField(fieldNumber) {
        this.currentField = fieldNumber;
        this.lastSwitchTime = new Date().toISOString();
        this._log('switch', `→ Manual override: Field ${fieldNumber}`);
        this.emit('fieldSwitch', {
            fieldNumber: fieldNumber,
            matchNumber: null,
            description: 'Manual override',
        });
    }

    /**
     * Add a log entry
     */
    _log(type, message) {
        const entry = {
            time: new Date().toISOString(),
            type: type,
            message: message,
        };
        this.log.push(entry);
        if (this.log.length > 200) this.log.shift();

        const prefix = {
            info: '[TRACK]',
            error: '[ERROR]',
            match: '[MATCH]',
            switch: '[SWITCH]',
        }[type] || '[LOG]';

        console.log(`${prefix} ${message}`);
        this.emit('log', entry);
    }
}

module.exports = MatchTracker;
