// Match Tracker — Core orchestration logic
const EventEmitter = require('events');

class MatchTracker extends EventEmitter {
    constructor(ftcApi, config) {
        super();
        this.ftcApi = ftcApi;
        this.season = config.season;
        this.eventCode = config.eventCode;
        this.tournamentLevel = config.tournamentLevel;

        // Switch mode: 'score' or 'timer'
        this.switchMode = config.switchMode || 'score';

        // State
        this.schedule = [];        // Full schedule with field assignments
        this.hybridSchedule = [];  // Schedule + results
        this.alliances = [];       // Alliance selection results
        this.completedMatches = new Set(); // Match numbers we've already seen as completed
        this.startedMatches = new Set();   // Match numbers we've already seen as started
        this.currentField = null;
        this.nextMatch = null;
        this.lastSwitchTime = null;
        this.log = [];            // Event log for dashboard
        this.initialized = false;
        this.polling = false;
        this.pollTimer = null;
        this._switchTimers = new Map();  // Match number -> timer for timer mode
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

            // Mark already-started and already-completed matches
            for (const match of this.hybridSchedule) {
                if (match.actualStartTime) {
                    this.startedMatches.add(match.matchNumber);
                }
                if (match.actualStartTime && match.postResultTime) {
                    this.completedMatches.add(match.matchNumber);
                }
            }
            this._log('info', `${this.completedMatches.size} matches completed, mode: ${this.switchMode}`);

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
     * Reconfigure with new event settings and reinitialize
     */
    async reconfigure(newConfig) {
        const wasPolling = this.polling;
        const pollInterval = this._pollInterval || 5000;

        // Stop current polling
        this.stopPolling();

        // Update config
        if (newConfig.season !== undefined) this.season = newConfig.season;
        if (newConfig.eventCode !== undefined) this.eventCode = newConfig.eventCode;
        if (newConfig.tournamentLevel !== undefined) this.tournamentLevel = newConfig.tournamentLevel;

        // Reset state
        this.schedule = [];
        this.hybridSchedule = [];
        this.completedMatches = new Set();
        this.startedMatches = new Set();
        this._clearSwitchTimers();
        this.currentField = null;
        this.nextMatch = null;
        this.lastSwitchTime = null;
        this.initialized = false;

        this._log('info', `Reconfiguring for event: ${this.eventCode} (${this.season}) — ${this.tournamentLevel}`);

        // Reinitialize
        await this.initialize();

        // Resume polling if it was active
        if (wasPolling) {
            this.startPolling(pollInterval);
        }

        this.emit('reconfigured', {
            season: this.season,
            eventCode: this.eventCode,
            tournamentLevel: this.tournamentLevel,
        });
    }

    /**
     * Start polling for match updates
     */
    startPolling(intervalMs = 5000) {
        if (this.polling) return;
        this.polling = true;
        this._pollInterval = intervalMs;
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
        if (this._playoffCheckTimer) {
            clearTimeout(this._playoffCheckTimer);
            this._playoffCheckTimer = null;
        }
        this._checkingPlayoffs = false;
        this._clearSwitchTimers();
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

            // Periodically refresh the full schedule to pick up new matches
            // (e.g., new playoff rounds: semis, finals)
            this._pollCount = (this._pollCount || 0) + 1;
            if (this._pollCount % 6 === 0) {  // Every ~30s at 5s interval
                await this._refreshSchedule();
            }
        } catch (err) {
            this._log('error', `Poll error: ${err.message}`);
        }

        // Schedule next poll
        this.pollTimer = setTimeout(() => this._poll(intervalMs), intervalMs);
    }

    /**
     * Refresh the full schedule to detect newly added matches
     */
    async _refreshSchedule() {
        try {
            const freshSchedule = await this.ftcApi.getSchedule(
                this.season, this.eventCode, this.tournamentLevel
            );

            if (freshSchedule && freshSchedule.length > this.schedule.length) {
                const newCount = freshSchedule.length - this.schedule.length;
                this._log('info', `📋 ${newCount} new match(es) added to schedule (now ${freshSchedule.length} total)`);

                // Add new matches directly into hybrid schedule so frontend sees them immediately
                for (let i = this.schedule.length; i < freshSchedule.length; i++) {
                    const matchNum = freshSchedule[i].matchNumber;
                    if (!this.hybridSchedule.find(m => m.matchNumber === matchNum)) {
                        this.hybridSchedule.push(freshSchedule[i]);
                    }
                }

                this.schedule = freshSchedule;

                // Re-determine next match with the updated schedule
                this._determineNextMatch();
                this.emit('reconfigured');
            }

            // Check for alliances (useful after quals or before playoffs)
            if (this.alliances.length === 0 || Math.random() < 0.2) {
                try {
                    const alliances = await this.ftcApi.getAlliances(this.season, this.eventCode);
                    if (alliances && alliances.length > 0 && this.alliances.length !== alliances.length) {
                        this.alliances = alliances;
                        this._log('info', `🤝 Loaded ${alliances.length} alliances from Alliance Selection`);
                        this.emit('reconfigured');
                    }
                } catch (e) {
                    // Ignore: might be quals where alliances don't exist yet
                }
            }
        } catch (err) {
            // Silent fail — schedule refresh is non-critical
        }
    }

    /**
     * Process updated match data from polling
     */
    _processUpdates(updatedSchedule) {
        let newCompletions = [];
        let newStarts = [];

        for (const match of updatedSchedule) {
            const matchNum = match.matchNumber;

            // Update our local hybrid schedule
            const idx = this.hybridSchedule.findIndex(m => m.matchNumber === matchNum);
            if (idx >= 0) {
                this.hybridSchedule[idx] = match;
            } else {
                this.hybridSchedule.push(match);
            }

            // Check if this match just started
            if (match.actualStartTime && !this.startedMatches.has(matchNum)) {
                this.startedMatches.add(matchNum);
                newStarts.push(match);
            }

            // Check if this match just completed
            if (match.actualStartTime && match.postResultTime && !this.completedMatches.has(matchNum)) {
                this.completedMatches.add(matchNum);
                newCompletions.push(match);
            }
        }

        // Handle match starts (for timer mode)
        if (newStarts.length > 0 && this.switchMode === 'timer') {
            for (const match of newStarts) {
                this._scheduleTimerSwitch(match);
            }
        }

        // Handle completions
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

            // In score mode, switch on completion
            if (this.switchMode === 'score') {
                this._determineNextMatch();
            }
        }

        // Always update next match info
        if (newStarts.length > 0 || newCompletions.length > 0) {
            this._updateNextMatch();
        }
    }

    /**
     * Schedule a timer-based switch 2:45 after a match starts
     */
    _scheduleTimerSwitch(match) {
        const matchNum = match.matchNumber;
        const fieldInfo = this._getFieldForMatch(matchNum);
        this._log('match', `Match ${matchNum} started on ${fieldInfo || 'unknown field'}`);

        // Calculate delay: 2:45 (165s) from actualStartTime
        const startTime = new Date(match.actualStartTime).getTime();
        const switchAt = startTime + (165 * 1000); // 2 min 45 sec
        const now = Date.now();
        const delay = Math.max(0, switchAt - now);

        const delaySec = Math.round(delay / 1000);
        this._log('info', `⏱ Timer set: switching in ${delaySec}s (2:45 after match start)`);

        // Cancel any existing timer for this match
        if (this._switchTimers.has(matchNum)) {
            clearTimeout(this._switchTimers.get(matchNum));
        }

        const timer = setTimeout(() => {
            this._switchTimers.delete(matchNum);
            this._log('info', `⏱ Timer fired for match ${matchNum}`);
            this._determineNextMatch();
        }, delay);

        this._switchTimers.set(matchNum, timer);
    }

    /**
     * Clear all pending switch timers
     */
    _clearSwitchTimers() {
        for (const timer of this._switchTimers.values()) {
            clearTimeout(timer);
        }
        this._switchTimers.clear();
    }

    /**
     * Set the switch mode at runtime
     */
    setSwitchMode(mode) {
        if (mode !== 'score' && mode !== 'timer') {
            throw new Error('Invalid switch mode. Use "score" or "timer".');
        }
        const oldMode = this.switchMode;
        this.switchMode = mode;

        // Clear any pending timer switches when changing mode
        this._clearSwitchTimers();

        this._log('info', `Switch mode changed: ${oldMode} → ${mode}`);
        this.emit('configChanged', { switchMode: mode });
    }

    /**
     * Update next match info without triggering a switch
     */
    _updateNextMatch() {
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
            this.nextMatch = null;
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

            // Auto-switch to playoffs if we're in quals
            if (this.tournamentLevel === 'qual' && !this._checkingPlayoffs) {
                this._checkForPlayoffs();
            }
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
     * Check if a playoff schedule is available and auto-switch to it
     */
    async _checkForPlayoffs() {
        this._checkingPlayoffs = true;
        this._log('info', 'Quals complete — checking for playoff schedule...');

        try {
            const playoffSchedule = await this.ftcApi.getSchedule(
                this.season, this.eventCode, 'playoff'
            );

            if (playoffSchedule && playoffSchedule.length > 0) {
                this._log('info', `🏆 Playoff schedule found! ${playoffSchedule.length} matches — switching automatically`);
                this._checkingPlayoffs = false;

                // Reconfigure to playoff mode
                await this.reconfigure({
                    season: this.season,
                    eventCode: this.eventCode,
                    tournamentLevel: 'playoff',
                });
            } else {
                this._log('info', 'No playoff schedule yet — will check again in 30s');
                // Retry in 30 seconds
                this._playoffCheckTimer = setTimeout(() => {
                    this._checkingPlayoffs = false;
                    this._checkForPlayoffs();
                }, 30000);
            }
        } catch (err) {
            this._log('error', `Playoff check failed: ${err.message} — will retry in 30s`);
            this._playoffCheckTimer = setTimeout(() => {
                this._checkingPlayoffs = false;
                this._checkForPlayoffs();
            }, 30000);
        }
    }

    /**
     * Get current state for dashboard
     */
    getState() {
        // Build schedule with completion status for dashboard
        const scheduleWithStatus = this.schedule.map(m => {
            const hybrid = this.hybridSchedule.find(h => h.matchNumber === m.matchNumber);
            const completed = this.completedMatches.has(m.matchNumber);
            return {
                matchNumber: m.matchNumber,
                description: m.description || `Match ${m.matchNumber}`,
                field: m.field || null,
                startTime: m.startTime || null,
                teams: m.teams || [],
                completed: completed,
                scoreRedFinal: hybrid ? hybrid.scoreRedFinal : null,
                scoreBlueFinal: hybrid ? hybrid.scoreBlueFinal : null,
            };
        }).sort((a, b) => a.matchNumber - b.matchNumber);

        return {
            initialized: this.initialized,
            polling: this.polling,
            currentField: this.currentField,
            nextMatch: this.nextMatch,
            lastSwitchTime: this.lastSwitchTime,
            totalMatches: this.schedule.length,
            completedCount: this.completedMatches.size,
            schedule: scheduleWithStatus,
            hybridSchedule: this.hybridSchedule,
            alliances: this.alliances,
            log: this.log.slice(-50), // Last 50 entries
            config: {
                season: this.season,
                eventCode: this.eventCode,
                tournamentLevel: this.tournamentLevel,
                switchMode: this.switchMode,
            },
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
