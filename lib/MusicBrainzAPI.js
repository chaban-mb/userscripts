// ==UserScript==
// @name         MusicBrainz API Module
// @namespace    https://musicbrainz.org/user/chaban
// @version      0.2.0
// @description  Module for interacting with the MusicBrainz API.
// @author       chaban
// @license      MIT
// @grant        GM.xmlHttpRequest
// ==/UserScript==

class MusicBrainzAPI {
    constructor(options = {}) {
        this.base_url = 'https://musicbrainz.org/ws/2';
        this.user_agent = options.user_agent || `UserJS.MusicBrainzAPI/0.2.0 ( https://musicbrainz.org/user/chaban )`;
        this.rate_limit_delay = 1000;
        this.max_retries = options.max_retries || 5;
        this.cache = new Map();
        this.next_available_request_time = 0;
    }

    _parseHeaders(headerStr) {
        const headers = {};
        if (!headerStr) {
            return headers;
        }
        const headerPairs = headerStr.split('\u000d\u000a');
        for (const headerPair of headerPairs) {
            const index = headerPair.indexOf('\u003a\u0020');
            if (index > 0) {
                const key = headerPair.substring(0, index).toLowerCase();
                const value = headerPair.substring(index + 2);
                headers[key] = value;
            }
        }
        return headers;
     }

    async _request(endpoint, params = {}) {
        const url = new URL(`${this.base_url}/${endpoint}`);
        params.fmt = 'json';
        for (const [key, value] of Object.entries(params)) {
            if (Array.isArray(value)) {
                for (const v of value) {
                    url.searchParams.append(key, v);
                }
            } else if (value !== undefined) {
                url.searchParams.append(key, value);
            }
        }

        for (let i = 0; i < this.max_retries; i++) {
            const now = Date.now();
            const waitTime = this.next_available_request_time - now;
            if (waitTime > 0) {
                await new Promise(resolve => setTimeout(resolve, waitTime));
             }

            try {
                const response = await new Promise((resolve, reject) => {
                    GM.xmlHttpRequest({
                        method: 'GET',
                        url: url.toString(),
                        headers: {
                             'User-Agent': this.user_agent,
                             'Accept': 'application/json',
                             'Origin': location.origin,
                            },
                        anonymous: true,
                        onload: (res) => {
                            const responseTime = Date.now();
                            const headers = this._parseHeaders(res.responseHeaders);
                            const rateLimitReset = parseInt(headers['x-ratelimit-reset'], 10) * 1000;
                            const rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'], 10);
                            const retryAfterSeconds = parseInt(headers['retry-after'], 10);

                            if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
                                this.next_available_request_time = responseTime + (retryAfterSeconds * 1000);
                            } else if (!isNaN(rateLimitReset) && rateLimitRemaining === 0) {
                                this.next_available_request_time = rateLimitReset;
                            } else {
                                this.next_available_request_time = responseTime + this.rate_limit_delay;
                            }

                            if (res.status >= 200 && res.status < 300) {
                                resolve(JSON.parse(res.responseText));
                            } else if (res.status === 503) {
                                reject(new Error('Rate limit hit or server overloaded'));
                            } else {
                                const ErrorClass = (res.status >= 400 && res.status < 500) ? PermanentError : Error;
                                reject(new ErrorClass(`HTTP Error ${res.status}: ${res.statusText}`));
                            }
                        },
                        onerror: (err) => {
                            this.next_available_request_time = Date.now() + 5000;
                            reject(new Error('Network error'));
                        },
                        ontimeout: () => {
                            this.next_available_request_time = Date.now() + 5000;
                            reject(new Error('Request timed out'));
                        },
                    });
                });

                return response;
            } catch (error) {
                if (error instanceof PermanentError) {
                    throw error; // Stop retrying and propagate the error.
                }
                if (i === this.max_retries - 1) throw error;
                const delay = this.rate_limit_delay * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async lookupUrl(urls, inc = []) {
        const isInputArray = Array.isArray(urls);
        const urlArray = isInputArray ? [...new Set(urls)] : [urls];

        if (urlArray.length === 0) {
            return isInputArray ? {} : null;
        }

        const results = {};
        const uncachedUrls = [];

        for (const url of urlArray) {
            if (this.cache.has(url)) {
                results[url] = this.cache.get(url);
            } else {
                uncachedUrls.push(url);
            }
        }

        if (uncachedUrls.length > 0) {
            try {
                const response = await this._request('url', {
                    resource: uncachedUrls,
                    inc: inc.join('+')
                });

                // This logic is crucial because the MusicBrainz API response format is different
                // for single vs. multiple URL lookups.
                if (uncachedUrls.length === 1) {
                    // API returns a single object directly
                    const result = response && response.resource === uncachedUrls[0] ? response : null;
                    this.cache.set(uncachedUrls[0], result);
                    results[uncachedUrls[0]] = result;
                } else {
                    // API returns an object containing a 'urls' array
                    const responseMap = new Map(response.urls?.map(u => [u.resource, u]) || []);
                    for (const url of uncachedUrls) {
                        const result = responseMap.get(url) || null;
                        this.cache.set(url, result);
                        results[url] = result;
                    }
                }
            } catch (error) {
                // This ensures failed lookups are also cached as null and included in the results
                uncachedUrls.forEach(url => {
                    this.cache.set(url, null);
                    results[url] = null;
                });
                if (error instanceof PermanentError) {
                    throw error; // Re-throw errors like 404 Not Found
                }
            }
        }

        return isInputArray ? results : results[urlArray[0]];
    }

    async search(entity, query, limit = 100, inc = [], fetch_all = false) {
        if (!fetch_all) {
            return this._request(entity, { query, limit, inc: inc.join('+') });
        }

        let results = [];
        let offset = 0;
        let total;

        do {
            const data = await this._request(entity, { query, limit, offset, inc: inc.join('+') });
            const entities = data[entity + 's'] || [];
            results.push(...entities);
            total = data.count;
            offset += entities.length;
            if (entities.length === 0) break;
        } while (offset < total);

        return results;
    }

    get(entity, mbid, inc = []) {
        return this._request(`${entity}/${mbid}`, { inc: inc.join('+') });
    }

    clearCache() {
        this.cache.clear();
    }


    invalidateCacheForUrl(url) {
        const urls = Array.isArray(url) ? url : [url];
        urls.forEach(u => this.cache.delete(u));
    }
}

class PermanentError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PermanentError';
    }
}