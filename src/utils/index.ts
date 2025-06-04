import { SessionRow, StoredSession } from '../types';

// Constants
export const RELAY = 'https://postapp.at/PolymeshPocket.php';
export const POLL = 2_000;
export const TIMEOUT = 5 * 60 * 1_000;
export const STORE_FILE = 'pocket-signing-manager-store.txt';

// Environment detection
const isNode = typeof window === 'undefined';

/**
 * POST wrapper for API calls
 */
export async function call<T = any>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const fetch = isNode 
    ? (await import('cross-fetch')).default 
    : window.fetch;

  const res = await fetch(`${RELAY}?endpoint=${endpoint}`, {
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
export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Store session info - works in both Node.js and browser
 */
export function storeSession(sid: string, appName: string, network?: string): void {
  try {
    const storeData: Record<string, any> = {};
    storeData[sid] = appName;
    
    if (network) {
      storeData['network'] = network;
    }
    
    if (isNode) {
      // Node.js: use file system
      const fs = require('fs');
      fs.writeFileSync(STORE_FILE, JSON.stringify(storeData));
      console.log(`Session stored for ${appName} (${sid})${network ? ` on ${network}` : ''}`);
    } else {
      // Browser: use localStorage
      localStorage.setItem('pocket-signing-manager-store', JSON.stringify(storeData));
      console.log(`Session stored in browser for ${appName} (${sid})${network ? ` on ${network}` : ''}`);
    }
  } catch (err) {
    console.error('Error storing session:', (err as Error).message);
  }
}

/**
 * Load stored session - works in both Node.js and browser
 */
export function loadStoredSession(): StoredSession | null {
  try {
    let data: string | null = null;
    
    if (isNode) {
      // Node.js: read from file
      const fs = require('fs');
      if (fs.existsSync(STORE_FILE)) {
        data = fs.readFileSync(STORE_FILE, 'utf8');
      }
    } else {
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
  } catch (err) {
    console.error('Error loading stored session:', (err as Error).message);
  }
  return null;
}

/**
 * Parse session row from API response
 */
export function parseSessionRow(row: any): SessionRow {
  if (typeof row.wallets === 'string') {
    try { row.wallets = JSON.parse(row.wallets); }
    catch { row.wallets = []; }
  }
  
  if (typeof row.testnet_wallets === 'string') {
    try { row.testnet_wallets = JSON.parse(row.testnet_wallets); }
    catch { row.testnet_wallets = []; }
  }
  
  if (typeof row.mainnet_wallets === 'string') {
    try { row.mainnet_wallets = JSON.parse(row.mainnet_wallets); }
    catch { row.mainnet_wallets = []; }
  }
  
  return row as SessionRow;
}

/**
 * Generate and display QR code - works in both environments
 */
export async function generateQRCode(appName: string, sid: string, network: string): Promise<void> {
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
  } else {
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