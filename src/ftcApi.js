// FTC Events API v2 Client
const https = require('https');

class FtcApi {
  constructor(username, authKey) {
    this.baseUrl = 'ftc-api.firstinspires.org';
    this.username = username;
    this.authKey = authKey;
    this.token = Buffer.from(`${username}:${authKey}`).toString('base64');
    this.lastModified = {};
  }

  /**
   * Update API credentials at runtime
   */
  updateCredentials(username, authKey) {
    this.username = username;
    this.authKey = authKey;
    this.token = Buffer.from(`${username}:${authKey}`).toString('base64');
    this.lastModified = {}; // Reset cached timestamps
    console.log(`[API] Credentials updated for user: ${username}`);
  }

  /**
   * Make an authenticated GET request to the FTC API
   */
  _request(path, useOnlyModified = false) {
    return new Promise((resolve, reject) => {
      const headers = {
        'Authorization': `Basic ${this.token}`,
        'Accept': 'application/json',
      };

      // Use FMS-OnlyModifiedSince for efficient polling
      if (useOnlyModified && this.lastModified[path]) {
        headers['FMS-OnlyModifiedSince'] = this.lastModified[path];
      }

      const options = {
        hostname: this.baseUrl,
        path: path,
        method: 'GET',
        headers: headers,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          // Track Last-Modified for future requests
          if (res.headers['last-modified']) {
            this.lastModified[path] = res.headers['last-modified'];
          }

          if (res.statusCode === 304) {
            resolve(null); // No changes
            return;
          }

          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`Failed to parse API response: ${e.message}`));
            }
            return;
          }

          if (res.statusCode === 401) {
            reject(new Error('FTC API: Unauthorized — check your username and auth key'));
            return;
          }

          reject(new Error(`FTC API error: HTTP ${res.statusCode} — ${data}`));
        });
      });

      req.on('error', (err) => {
        reject(new Error(`FTC API request failed: ${err.message}`));
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('FTC API request timed out'));
      });

      req.end();
    });
  }

  /**
   * Get the match schedule with field assignments
   * GET /v2.0/{season}/schedule/{eventCode}?tournamentLevel={level}
   */
  async getSchedule(season, eventCode, tournamentLevel = 'qual') {
    const path = `/v2.0/${season}/schedule/${eventCode}?tournamentLevel=${tournamentLevel}`;
    const result = await this._request(path);
    return result ? result.schedule || [] : [];
  }

  /**
   * Get the hybrid schedule (schedule + results combined)
   * GET /v2.0/{season}/schedule/{eventCode}/{tournamentLevel}/hybrid
   */
  async getHybridSchedule(season, eventCode, tournamentLevel = 'qual', useOnlyModified = false) {
    const path = `/v2.0/${season}/schedule/${eventCode}/${tournamentLevel}/hybrid`;
    const result = await this._request(path, useOnlyModified);
    if (result === null) return null; // 304 Not Modified
    return result ? result.schedule || [] : [];
  }

  /**
   * Get alliance selection results
   * GET /v2.0/{season}/alliances/{eventCode}
   */
  async getAlliances(season, eventCode) {
    const path = `/v2.0/${season}/alliances/${eventCode}`;
    const result = await this._request(path);
    return result ? result.alliances || [] : [];
  }

  /**
   * Test API connectivity
   */
  async testConnection(season) {
    const path = `/v2.0/${season}`;
    return this._request(path);
  }
}

module.exports = FtcApi;
