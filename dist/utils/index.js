"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORE_FILE = exports.TIMEOUT = exports.POLL = exports.RELAY = void 0;
exports.call = call;
exports.sleep = sleep;
exports.storeSession = storeSession;
exports.loadStoredSession = loadStoredSession;
exports.parseSessionRow = parseSessionRow;
exports.generateQRCode = generateQRCode;
const fs_1 = __importDefault(require("fs"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const cross_fetch_1 = __importDefault(require("cross-fetch"));
// Constants
exports.RELAY = 'https://3stars.haus/PolymeshPocket.php';
exports.POLL = 2000;
exports.TIMEOUT = 5 * 60 * 1000;
exports.STORE_FILE = 'pocket-signing-manager-store.txt';
/**
 * POST wrapper for API calls
 */
async function call(endpoint, body) {
    const res = await (0, cross_fetch_1.default)(`${exports.RELAY}?endpoint=${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        throw new Error(`Relay ${endpoint} → ${res.status} ${res.statusText}`);
    }
    return res.json();
}
/**
 * Sleep utility
 */
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
/**
 * Store session info to file
 */
function storeSession(sid, appName, network) {
    try {
        const storeData = {};
        storeData[sid] = appName;
        if (network) {
            storeData['network'] = network;
        }
        fs_1.default.writeFileSync(exports.STORE_FILE, JSON.stringify(storeData));
        console.log(`Session stored for ${appName} (${sid})${network ? ` on ${network}` : ''}`);
    }
    catch (err) {
        console.error('Error storing session:', err.message);
    }
}
/**
 * Try to load stored session
 */
function loadStoredSession() {
    try {
        if (fs_1.default.existsSync(exports.STORE_FILE)) {
            const data = fs_1.default.readFileSync(exports.STORE_FILE, 'utf8');
            const store = JSON.parse(data);
            const storedSid = Object.keys(store).find(key => key !== 'network');
            if (storedSid) {
                const appName = store[storedSid];
                const network = store['network'] || 'testnet';
                console.log(`Found stored session for ${appName} (${storedSid}) on ${network}`);
                return { sid: storedSid, appName, network };
            }
        }
    }
    catch (err) {
        console.error('Error loading stored session:', err.message);
    }
    return null;
}
/**
 * Parse session row from API response
 */
function parseSessionRow(row) {
    if (typeof row.wallets === 'string') {
        try {
            row.wallets = JSON.parse(row.wallets);
        }
        catch {
            row.wallets = [];
        }
    }
    if (typeof row.testnet_wallets === 'string') {
        try {
            row.testnet_wallets = JSON.parse(row.testnet_wallets);
        }
        catch {
            row.testnet_wallets = [];
        }
    }
    if (typeof row.mainnet_wallets === 'string') {
        try {
            row.mainnet_wallets = JSON.parse(row.mainnet_wallets);
        }
        catch {
            row.mainnet_wallets = [];
        }
    }
    return row;
}
/**
 * Generate and display QR code
 */
function generateQRCode(appName, sid, network) {
    const qrPayload = Buffer
        .from(JSON.stringify({ appName, sid, network }))
        .toString('base64');
    console.log(`\nScan this QR with Pocket Wallet for ${network}:\n`);
    qrcode_terminal_1.default.generate(qrPayload, { small: true });
    console.log();
    console.log('Base64 encoded QR content:');
    console.log(qrPayload);
    console.log();
}
//# sourceMappingURL=index.js.map