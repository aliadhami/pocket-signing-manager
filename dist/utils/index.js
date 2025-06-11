"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORE_FILE = exports.TIMEOUT = exports.POLL = exports.RELAY = void 0;
exports.call = call;
exports.sleep = sleep;
exports.storeSession = storeSession;
exports.loadStoredSession = loadStoredSession;
exports.parseSessionRow = parseSessionRow;
exports.generateQRCode = generateQRCode;
// Constants
exports.RELAY = 'https://bubbleblock.io/PolymeshPocket.php';
exports.POLL = 2000;
exports.TIMEOUT = 5 * 60 * 1000;
exports.STORE_FILE = 'pocket-signing-manager-store.txt';
// Environment detection
const isNode = typeof window === 'undefined';
/**
 * POST wrapper for API calls
 */
async function call(endpoint, body) {
    const fetch = isNode
        ? (await Promise.resolve().then(() => __importStar(require('cross-fetch')))).default
        : window.fetch;
    const res = await fetch(`${exports.RELAY}?endpoint=${endpoint}`, {
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
 * Store session info - works in both Node.js and browser
 */
function storeSession(sid, appName, network) {
    try {
        const storeData = {};
        storeData[sid] = appName;
        if (network) {
            storeData['network'] = network;
        }
        if (isNode) {
            // Node.js: use file system
            const fs = require('fs');
            fs.writeFileSync(exports.STORE_FILE, JSON.stringify(storeData));
            console.log(`Session stored for ${appName} (${sid})${network ? ` on ${network}` : ''}`);
        }
        else {
            // Browser: use localStorage
            localStorage.setItem('pocket-signing-manager-store', JSON.stringify(storeData));
            console.log(`Session stored in browser for ${appName} (${sid})${network ? ` on ${network}` : ''}`);
        }
    }
    catch (err) {
        console.error('Error storing session:', err.message);
    }
}
/**
 * Load stored session - works in both Node.js and browser
 */
function loadStoredSession() {
    try {
        let data = null;
        if (isNode) {
            // Node.js: read from file
            const fs = require('fs');
            if (fs.existsSync(exports.STORE_FILE)) {
                data = fs.readFileSync(exports.STORE_FILE, 'utf8');
            }
        }
        else {
            // Browser: read from localStorage
            data = localStorage.getItem('pocket-signing-manager-store');
        }
        if (data) {
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
 * Generate and display QR code - works in both environments
 */
async function generateQRCode(appName, sid, network) {
    const qrPayload = Buffer
        .from(JSON.stringify({ appName, sid, network }))
        .toString('base64');
    if (isNode) {
        // Node.js: use qrcode-terminal
        const qrcode = require('qrcode-terminal');
        console.log(`\nScan this QR with Pocket Wallet for ${network}:\n`);
        qrcode.generate(qrPayload, { small: true });
        console.log();
        console.log('Base64 encoded QR content:');
        console.log(qrPayload);
        console.log();
    }
    else {
        // Browser: show QR payload and instructions
        console.log(`\n🔗 Pocket Wallet Connection for ${network}:`);
        console.log('📱 QR Code Data (scan with Pocket Wallet):');
        console.log(qrPayload);
        console.log();
        // Create a simple QR display element if DOM is available
        if (typeof document !== 'undefined') {
            const existingQR = document.getElementById('pocket-qr-display');
            if (existingQR) {
                existingQR.remove();
            }
            const qrDiv = document.createElement('div');
            qrDiv.id = 'pocket-qr-display';
            qrDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        padding: 20px;
        border: 2px solid #333;
        border-radius: 8px;
        z-index: 10000;
        max-width: 300px;
        font-family: monospace;
        font-size: 12px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      `;
            qrDiv.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 10px;">
          🔗 Pocket Wallet (${network})
        </div>
        <div style="margin-bottom: 10px;">
          📱 Scan this with your Pocket Wallet app:
        </div>
        <div style="word-break: break-all; background: #f5f5f5; padding: 10px; border-radius: 4px;">
          ${qrPayload}
        </div>
        <button onclick="this.parentElement.remove()" style="margin-top: 10px; padding: 5px 10px; cursor: pointer;">
          Close
        </button>
      `;
            document.body.appendChild(qrDiv);
        }
    }
}
//# sourceMappingURL=index.js.map