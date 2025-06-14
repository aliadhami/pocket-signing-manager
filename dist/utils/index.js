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
const qrcode_1 = __importDefault(require("qrcode"));
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
        console.log('Base64 encoded QR content (Pairing Code):');
        console.log(qrPayload);
        console.log();
    }
    else {
        // BROWSER IMPLEMENTATION
        if (typeof document === 'undefined')
            return;
        // Remove any existing popup
        const oldContainer = document.getElementById('pocket-wallet-create-container');
        if (oldContainer)
            oldContainer.remove();
        // Create popup elements
        const container = document.createElement('div');
        container.id = 'pocket-wallet-create-container';
        const content = document.createElement('div');
        content.id = 'pocket-wallet-content';
        container.appendChild(content);
        document.body.appendChild(container);
        // --- STYLES ---
        const style = document.createElement('style');
        style.textContent = `
      #pocket-wallet-create-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      #pocket-wallet-content {
        background: white;
        padding: 2.5rem;
        border-radius: 16px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        text-align: center;
        max-width: 90%;
        width: 400px;
        position: relative;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .pocket-close-btn {
        position: absolute;
        top: 15px;
        right: 15px;
        background: #eee;
        border: none;
        border-radius: 50%;
        width: 30px;
        height: 30px;
        cursor: pointer;
        font-size: 20px;
        line-height: 30px;
        color: #555;
      }
      .pocket-close-btn:hover {
        background: #ddd;
      }
      .pocket-h1 {
        font-size: 1.5rem;
        margin-top: 0;
        margin-bottom: 0.5rem;
        color: #111;
      }
      .pocket-p {
        font-size: 0.95rem;
        color: #666;
        line-height: 1.5;
        margin-bottom: 1.5rem;
      }
      #pocket-qr-image {
        width: 250px;
        height: 250px;
        margin: 0 auto;
        border: 1px solid #eee;
        border-radius: 8px;
      }
      .pocket-divider {
        margin: 1.5rem 0;
        border: 0;
        border-top: 1px solid #eee;
        color: #888;
        text-align: center;
      }
      .pocket-divider::after {
        content: 'OR';
        position: relative;
        top: -0.7em;
        background: white;
        padding: 0 1em;
      }
      .pocket-blue-btn, .pocket-back-btn {
        display: block;
        width: 250px;
        padding: 12px;
        border-radius: 8px;
        border: none;
        font-size: 1rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s ease;
        margin: 0 auto;
      }
      .pocket-blue-btn {
        background-color: #007bff;
        color: white;
      }
      .pocket-blue-btn:hover {
        background-color: #0056b3;
      }
      .pocket-back-btn {
        background-color: #6c757d;
        color: white;
        margin-top: 1rem;
      }
      .pocket-back-btn:hover {
        background-color: #5a6268;
      }
      .pocket-copy-container {
        display: flex;
        width: 250px;
        margin: 0 auto;
      }
      #pocket-pairing-code-input {
        flex-grow: 1;
        padding: 10px;
        border: 1px solid #ccc;
        border-radius: 8px 0 0 8px;
        background: #f8f9fa;
        font-family: monospace;
        font-size: 0.9rem;
        color: #333;
        border-right: none;
      }
      #pocket-copy-btn {
        width: 50px;
        height: auto;
        border: 1px solid #ccc;
        border-radius: 0 8px 8px 0;
        background: #e9ecef;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.1s ease;
      }
      #pocket-copy-btn:hover {
        background: #ced4da;
      }
      #pocket-copy-btn.copied {
        background: #d4edda;
      }
    `;
        document.head.appendChild(style);
        // --- STATE MANAGEMENT & VIEWS ---
        let qrViewHTML = '';
        const qrImage = new Image();
        const showQrView = () => {
            var _a;
            content.innerHTML = qrViewHTML;
            (_a = document.getElementById('pocket-pairing-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', showPairingCodeView);
            attachCloseHandler();
        };
        const showPairingCodeView = () => {
            var _a, _b;
            const pairingCodeViewHTML = `
        <button class="pocket-close-btn">&times;</button>
        <h1 class="pocket-h1">Paste this Code in Polymesh Pocket app</h1>
        <p class="pocket-p">Use this code in Polymesh Pocket app, in Signing section, for dApp connections click on enter Manually and paste this code there.</p>
        <div class="pocket-copy-container">
          <input type="text" id="pocket-pairing-code-input" value="${qrPayload}" readonly>
          <button id="pocket-copy-btn" title="Copy to clipboard">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
        </div>
        <button class="pocket-back-btn">&lt; Back</button>
      `;
            content.innerHTML = pairingCodeViewHTML;
            (_a = document.querySelector('.pocket-back-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', showQrView);
            (_b = document.getElementById('pocket-copy-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', copyToClipboard);
            attachCloseHandler();
        };
        const copyToClipboard = () => {
            const input = document.getElementById('pocket-pairing-code-input');
            const button = document.getElementById('pocket-copy-btn');
            if (!input || !button)
                return;
            navigator.clipboard.writeText(input.value).then(() => {
                button.classList.add('copied');
                setTimeout(() => {
                    button.classList.remove('copied');
                }, 1000);
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        };
        const closePopup = () => {
            container.style.opacity = '0';
            setTimeout(() => {
                container.remove();
                style.remove();
                // Dispatch a cancellation event for the manager to catch
                document.body.dispatchEvent(new CustomEvent('pocket-connection-cancelled'));
            }, 300);
        };
        const attachCloseHandler = () => {
            var _a;
            (_a = document.querySelector('.pocket-close-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', closePopup);
        };
        // --- INITIALIZATION ---
        try {
            const qrDataUrl = await qrcode_1.default.toDataURL(qrPayload, { width: 250, margin: 1 });
            qrImage.src = qrDataUrl;
            qrViewHTML = `
            <button class="pocket-close-btn">&times;</button>
            <h1 class="pocket-h1">Scan in Polymesh Pocket app</h1>
            <p class="pocket-p">Scan this QR Code in Polymesh Pocket app, in Signing section, for dApp connections click on the scan button.</p>
            <img id="pocket-qr-image" src="${qrImage.src}" alt="QR Code for Polymesh Pocket" />
            <hr class="pocket-divider" />
            <button id="pocket-pairing-btn" class="pocket-blue-btn">Pairing Code</button>
        `;
            showQrView();
            // Fade in
            requestAnimationFrame(() => {
                container.style.opacity = '1';
            });
        }
        catch (err) {
            console.error('Failed to generate QR code', err);
            content.innerHTML = 'Could not generate QR Code. Please try again.';
            attachCloseHandler();
        }
    }
}
//# sourceMappingURL=index.js.map