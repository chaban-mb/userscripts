// ==UserScript==
// @name         Advanced Logger
// @namespace    https://musicbrainz.org/user/chaban
// @version      1.0.0
// @tag          ai-created
// @description  Logger with a dynamic menu command that updates its label without a page reload.
// @author       chaban
// @license      MIT
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

'use strict';

const SCRIPT_NAME = GM.info.script.name;

// --- Logger Class ---
class Logger {
    static #LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, TRACE: 4 };
    static #levelColors = {
        [Logger.#LogLevel.DEBUG]: '#909090',
        [Logger.#LogLevel.INFO]:  '#2870F8',
        [Logger.#LogLevel.WARN]:  '#F4B000',
        [Logger.#LogLevel.ERROR]: '#D43838',
        [Logger.#LogLevel.TRACE]: '#8A2BE2',
    };
    static #levelNames = Object.fromEntries(Object.entries(Logger.#LogLevel).map(([name, value]) => [value, name]));
    static #nativeMethods = {
        [Logger.#LogLevel.DEBUG]: console.debug,
        [Logger.#LogLevel.INFO]:  console.info,
        [Logger.#LogLevel.WARN]:  console.warn,
        [Logger.#LogLevel.ERROR]: console.error,
        [Logger.#LogLevel.TRACE]: console.trace,
    };
    #scriptName;#debugModeEnabled;#storageKey;#syncAcrossTabs;#tabId;#logChannel;
    constructor(scriptName, options = {}) {
        const { defaultDebugState = false, syncAcrossTabs = false } = options;
        if (!scriptName) throw new Error('Logger requires a scriptName.');
        this.#scriptName = scriptName;
        this.#storageKey = `logger_debug_mode_${scriptName.replace(/\s+/g, '_')}`;
        this.#debugModeEnabled = GM_getValue(this.#storageKey, defaultDebugState);
        this.#syncAcrossTabs = syncAcrossTabs;
        this.#tabId = `[${Math.random().toString(36).substring(2, 6)}]`;
        if (this.#syncAcrossTabs) {
            const channelName = `${scriptName}_log_channel`;
            this.#logChannel = new BroadcastChannel(channelName);
            this.#logChannel.onmessage = (event) => {
                const { level, args, fromTabId, timestamp } = event.data;
                if (fromTabId === this.#tabId) return;
                this.#printToConsole(level, args, { tabId: fromTabId, timestamp });
            };
        }
    }
    #printToConsole(level, args, metadata) {
        const nativeMethod = Logger.#nativeMethods[level] || console.log;
        const prefix = `%c[${this.#scriptName}] %c[${new Date(metadata.timestamp).toLocaleTimeString()}] %c${metadata.tabId} %c[${Logger.#levelNames[level]}]`;
        const styles = ['color: #00A36C; font-weight: bold;','color: grey; font-weight: normal;','color: purple; font-weight: normal;',`color: ${Logger.#levelColors[level]}; font-weight: bold;`,];
        nativeMethod(prefix, ...styles, ...args);
    }
    #log(level, ...args) {
        const isDebugLevel = level === Logger.#LogLevel.DEBUG || level === Logger.#LogLevel.TRACE;
        if (isDebugLevel && !this.#debugModeEnabled) return;
        const timestamp = new Date().toISOString();
        this.#printToConsole(level, args, { tabId: this.#tabId, timestamp });
        if (this.#syncAcrossTabs) {
            this.#logChannel.postMessage({ level, args, fromTabId: this.#tabId, timestamp });
        }
    }
    toggleDebugMode() {
        this.#debugModeEnabled = !this.#debugModeEnabled;
        GM_setValue(this.#storageKey, this.#debugModeEnabled);
        this.info(`Debug/Trace logging has been ${this.#debugModeEnabled ? 'ENABLED' : 'DISABLED'}.`);
        return this.#debugModeEnabled;
    }
    get isDebugEnabled() { return this.#debugModeEnabled; }
    debug = (...args) => this.#log(Logger.#LogLevel.DEBUG, ...args);
    info = (...args) => this.#log(Logger.#LogLevel.INFO, ...args);
    warn = (...args) => this.#log(Logger.#LogLevel.WARN, ...args);
    error = (...args) => this.#log(Logger.#LogLevel.ERROR, ...args);
    trace = (...args) => this.#log(Logger.#LogLevel.TRACE, ...args);
    table = (data) => this.info(data) && console.table(data);
    group = (label) => this.info(label) && console.group(label);
    groupEnd = () => console.groupEnd();
    time = (label) => console.time(label);
    timeEnd = (label) => console.timeEnd(label);
}

// --- Script Entry Point ---
(function main() {
    const logger = new Logger(SCRIPT_NAME, {
        syncAcrossTabs: true,
        defaultDebugState: true,
    });

    let menuCommandId = null;

    const registerOrUpdateMenuCommand = () => {
        const label = logger.isDebugEnabled ? '✅ Disable Debug/Trace Logs' : '☑️ Enable Debug/Trace Logs';

        const commandCallback = () => {
            logger.toggleDebugMode();
            registerOrUpdateMenuCommand();
        };

        menuCommandId = GM_registerMenuCommand(label, commandCallback, {
            id: menuCommandId,
            autoClose: true
        });
    };

    registerOrUpdateMenuCommand();
})();