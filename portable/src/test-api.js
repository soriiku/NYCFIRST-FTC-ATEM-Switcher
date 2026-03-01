// Quick test to verify your FTC API credentials and event code work
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const FtcApi = require('./ftcApi');

const username = process.env.FTC_USERNAME;
const authKey = process.env.FTC_AUTH_KEY;
const season = parseInt(process.env.FTC_SEASON || '2025', 10);
const eventCode = process.env.FTC_EVENT_CODE;

console.log('FTC API Connection Test');
console.log('=======================');
console.log(`Username:   ${username}`);
console.log(`Season:     ${season}`);
console.log(`Event Code: ${eventCode}`);
console.log('');

async function test() {
    const api = new FtcApi(username, authKey);

    // Test 1: API connectivity
    console.log('1. Testing API connectivity...');
    try {
        const info = await api.testConnection(season);
        console.log(`   ✓ API is online (version: ${info.apiVersion || 'unknown'})`);
    } catch (err) {
        console.error(`   ✗ Failed: ${err.message}`);
        return;
    }

    // Test 2: Event schedule
    console.log('2. Fetching event schedule...');
    try {
        const schedule = await api.getSchedule(season, eventCode, 'qual');
        console.log(`   ✓ Got ${schedule.length} scheduled matches`);
        if (schedule.length > 0) {
            const fields = [...new Set(schedule.map(m => m.field).filter(Boolean))];
            console.log(`   Fields present: ${fields.join(', ') || 'none listed'}`);
            console.log(`   First match: ${schedule[0].description || 'Match 1'} — Field: ${schedule[0].field || 'N/A'}`);
            console.log(`   Last match: ${schedule[schedule.length - 1].description || `Match ${schedule.length}`} — Field: ${schedule[schedule.length - 1].field || 'N/A'}`);
        }
    } catch (err) {
        console.error(`   ✗ Failed: ${err.message}`);
    }

    // Test 3: Hybrid schedule
    console.log('3. Fetching hybrid schedule...');
    try {
        const hybrid = await api.getHybridSchedule(season, eventCode, 'qual');
        const completed = hybrid.filter(m => m.postResultTime);
        console.log(`   ✓ Got ${hybrid.length} matches (${completed.length} completed)`);
        if (completed.length > 0) {
            const last = completed[completed.length - 1];
            console.log(`   Last completed: Match ${last.matchNumber} — Red: ${last.scoreRedFinal}, Blue: ${last.scoreBlueFinal}`);
        }
    } catch (err) {
        console.error(`   ✗ Failed: ${err.message}`);
    }

    console.log('');
    console.log('Done! If all tests passed, you\'re ready to run the switcher.');
}

test().catch(console.error);
