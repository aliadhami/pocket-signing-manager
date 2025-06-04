import fs from 'fs';
import qrcode from 'qrcode-terminal';
import fetch from 'cross-fetch';
import { SessionRow, StoredSession } from '../types';

// Constants
export const RELAY = 'https://3stars.haus/PolymeshPocket.php';
export const POLL = 2_000;
export const TIMEOUT = 5 * 60 * 1_000;
export const STORE_FILE = 'pocket-signing-manager-store.txt';

/**
 * POST wrapper for API calls
 */
export async function call<T = any>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
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
 * Store session info to file
 */
export function storeSession(sid: string, appName: string, network?: string): void {
  try {
    const storeData: Record<string, any> = {};
    storeData[sid] = appName;
    
    if (network) {
      storeData['network'] = network;
    }
    
    fs.writeFileSync(STORE_FILE, JSON.stringify(storeData));
    console.log(`Session stored for ${appName} (${sid})${network ? ` on ${network}` : ''}`);
  } catch (err) {
    console.error('Error storing session:', (err as Error).message);
  }
}

/**
 * Try to load stored session
 */
export function loadStoredSession(): StoredSession | null {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = fs.readFileSync(STORE_FILE, 'utf8');
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
 * Generate and display QR code
 */
export function generateQRCode(appName: string, sid: string, network: string): void {
  const qrPayload = Buffer
    .from(JSON.stringify({ appName, sid, network }))
    .toString('base64');

  console.log(`\nScan this QR with Pocket Wallet for ${network}:\n`);
  qrcode.generate(qrPayload, { small: true });
  console.log();
  console.log('Base64 encoded QR content:');
  console.log(qrPayload);
  console.log();
}