import QRCode from 'qrcode';
import { SessionRow, StoredSession } from '../types';

// Constants
export const RELAY = 'https://bubbleblock.io/PolymeshPocket.php';
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
    console.log('Base64 encoded QR content (Pairing Code):');
    console.log(qrPayload);
    console.log();
  } else {
    // BROWSER IMPLEMENTATION
    if (typeof document === 'undefined') return;

    const oldContainer = document.getElementById('pocket-wallet-create-container');
    if (oldContainer) oldContainer.remove();

    const container = document.createElement('div');
    container.id = 'pocket-wallet-create-container';

    const content = document.createElement('div');
    content.id = 'pocket-wallet-content';

    container.appendChild(content);
    
    const style = document.createElement('style');
    style.id = 'pocket-wallet-styles';
    style.textContent = `
      #pocket-wallet-create-container, #pocket-signing-wait-container {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        z-index: 999999; opacity: 0; transition: opacity 0.3s ease;
      }
      #pocket-wallet-content {
        background: white; padding: 2.5rem; border-radius: 16px;
        box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
        text-align: center; max-width: 90%; width: 400px; position: relative;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        transition: transform 0.3s ease, opacity 0.3s ease; color: #111;
      }
      .pocket-success-view { transform: scale(0.95); opacity: 0; transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s ease; }
      .pocket-checkmark-svg { width: 80px; height: 80px; border-radius: 50%; display: block; stroke-width: 3; stroke: #fff; stroke-miterlimit: 10; box-shadow: inset 0px 0px 0px #4bb543; animation: pocket-fill .4s ease-in-out .4s forwards, pocket-scale .3s ease-in-out .9s both; margin: 0 auto 20px auto; }
      .pocket-checkmark-circle { stroke-dasharray: 166; stroke-dashoffset: 166; stroke-width: 3; stroke-miterlimit: 10; stroke: #4bb543; fill: none; animation: pocket-stroke .6s cubic-bezier(0.65, 0, 0.45, 1) forwards; }
      .pocket-checkmark-check { transform-origin: 50% 50%; stroke-dasharray: 48; stroke-dashoffset: 48; animation: pocket-stroke .3s cubic-bezier(0.65, 0, 0.45, 1) .8s forwards; }
      @keyframes pocket-stroke { 100% { stroke-dashoffset: 0; } }
      @keyframes pocket-scale { 0%, 100% { transform: none; } 50% { transform: scale3d(1.1, 1.1, 1); } }
      @keyframes pocket-fill { 100% { box-shadow: inset 0px 0px 0px 40px #4bb543; } }
      .pocket-close-btn { position: absolute; top: 15px; right: 15px; background: #eee; border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-size: 20px; line-height: 30px; color: #555; }
      .pocket-close-btn:hover { background: #ddd; }
      .pocket-h1 { font-size: 1.5rem; margin-top: 0; margin-bottom: 0.5rem; color: #111; }
      .pocket-p { font-size: 0.95rem; color: #666; line-height: 1.5; margin-bottom: 1.5rem; }
      #pocket-qr-image { width: 250px; height: 250px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; }
      .pocket-divider { margin: 1.5rem 0; border: 0; border-top: 1px solid #eee; color: #888; text-align: center; }
      .pocket-divider::after { content: 'OR'; position: relative; top: -0.7em; background: white; padding: 0 1em; }
      .pocket-blue-btn, .pocket-back-btn { display: block; width: 250px; padding: 12px; border-radius: 8px; border: none; font-size: 1rem; font-weight: 500; cursor: pointer; transition: background-color 0.2s ease; margin: 0 auto; }
      .pocket-blue-btn { background-color: #007bff; color: white; }
      .pocket-blue-btn:hover { background-color: #0056b3; }
      .pocket-back-btn { background-color: #6c757d; color: white; margin-top: 1rem; }
      .pocket-back-btn:hover { background-color: #5a6268; }
      .pocket-copy-container { display: flex; width: 250px; margin: 0 auto; }
      #pocket-pairing-code-input { flex-grow: 1; padding: 10px; border: 1px solid #ccc; border-radius: 8px 0 0 8px; background: #f8f9fa; font-family: monospace; font-size: 0.9rem; color: #333; border-right: none; }
      #pocket-copy-btn { width: 50px; height: auto; border: 1px solid #ccc; border-radius: 0 8px 8px 0; background: #e9ecef; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background-color 0.1s ease; }
      #pocket-copy-btn:hover { background: #ced4da; }
      #pocket-copy-btn.copied { background: #d4edda; }
      .pocket-spinner { width: 60px; height: 60px; border: 6px solid rgba(0, 123, 255, 0.2); border-top-color: #007bff; border-radius: 50%; animation: pocket-spin 1s linear infinite; margin: 0 auto 1.5rem auto; }
      @keyframes pocket-spin { to { transform: rotate(360deg); } }
    `;
    
    document.body.appendChild(style);
    document.body.appendChild(container);

    let qrViewHTML = '';
    const qrImage = new Image();
    let successListener: () => void;
    
    const cleanupListeners = () => {
      document.body.removeEventListener('pocket-connection-success', successListener);
    };

    const copyToClipboard = () => {
        const input = document.getElementById('pocket-pairing-code-input') as HTMLInputElement;
        const button = document.getElementById('pocket-copy-btn');
        if (!input || !button) return;
        const textToCopy = input.value;
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(textToCopy).then(() => { button.classList.add('copied'); setTimeout(() => button.classList.remove('copied'), 1000); }).catch(err => console.error('Modern copy failed: ', err));
        } else {
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed'; textArea.style.top = '-9999px'; textArea.style.left = '-9999px';
            document.body.appendChild(textArea);
            textArea.focus(); textArea.select();
            try { document.execCommand('copy'); button.classList.add('copied'); setTimeout(() => button.classList.remove('copied'), 1000); }
            catch (err) { console.error('Fallback copy failed: ', err); }
            document.body.removeChild(textArea);
        }
    };

    const showSuccessAndClose = () => {
        cleanupListeners();
        const successViewHTML = `<div class="pocket-success-view"><svg class="pocket-checkmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><circle class="pocket-checkmark-circle" cx="26" cy="26" r="25" fill="none"/><path class="pocket-checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/></svg><h1 class="pocket-h1">Connected!</h1><p class="pocket-p">Your wallet has been connected successfully.</p></div>`;
        content.innerHTML = successViewHTML;
        const successView = content.querySelector('.pocket-success-view') as HTMLElement;
        if (successView) { requestAnimationFrame(() => { successView.style.transform = 'scale(1)'; successView.style.opacity = '1'; }); }
        setTimeout(() => { container.style.opacity = '0'; setTimeout(() => { container.remove(); style.remove(); }, 300); }, 2000);
    };

    const closePopup = () => {
        cleanupListeners();
        container.style.opacity = '0';
        setTimeout(() => {
          container.remove();
          style.remove();
          document.body.dispatchEvent(new CustomEvent('pocket-connection-cancelled'));
        }, 300);
    };
    
    const attachCloseHandler = () => {
        document.querySelector('.pocket-close-btn')?.addEventListener('click', closePopup);
    };
    
    const showPairingCodeView = () => {
        const pairingCodeViewHTML = `<button class="pocket-close-btn">&times;</button><h1 class="pocket-h1">Paste this Code in Polymesh Pocket app</h1><p class="pocket-p">Use this code in Polymesh Pocket app, in Signing section, for dApp connections click on enter Manually and paste this code there.</p><div class="pocket-copy-container"><input type="text" id="pocket-pairing-code-input" value="${qrPayload}" readonly><button id="pocket-copy-btn" title="Copy to clipboard"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div><button class="pocket-back-btn">&lt; Back</button>`;
        content.innerHTML = pairingCodeViewHTML;
        document.querySelector('.pocket-back-btn')?.addEventListener('click', showQrView);
        document.getElementById('pocket-copy-btn')?.addEventListener('click', copyToClipboard);
        attachCloseHandler();
    };

    const showQrView = () => {
      content.innerHTML = qrViewHTML;
      document.getElementById('pocket-pairing-btn')?.addEventListener('click', showPairingCodeView);
      attachCloseHandler();
    };
    
    try {
        const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 250, margin: 1 });
        qrImage.src = qrDataUrl;
        qrViewHTML = `<button class="pocket-close-btn">&times;</button><h1 class="pocket-h1">Scan in Polymesh Pocket app</h1><p class="pocket-p">Scan this QR Code in Polymesh Pocket app, in Signing section, for dApp connections click on the scan button.</p><img id="pocket-qr-image" src="${qrImage.src}" alt="QR Code for Polymesh Pocket" /><hr class="pocket-divider" /><button id="pocket-pairing-btn" class="pocket-blue-btn">Pairing Code</button>`;
        showQrView();
        successListener = () => showSuccessAndClose();
        document.body.addEventListener('pocket-connection-success', successListener, { once: true });
        requestAnimationFrame(() => { container.style.opacity = '1'; });
    } catch (err) {
        console.error('Failed to generate QR code', err);
        content.innerHTML = 'Could not generate QR Code. Please try again.';
        attachCloseHandler();
    }
  }
}

/**
 * Shows a non-closable popup to instruct the user to check their wallet for a signature request.
 */
export function showSigningPopup(): void {
  if (typeof document === 'undefined') return;

  // Remove any existing signing popup just in case
  const oldContainer = document.getElementById('pocket-signing-wait-container');
  if (oldContainer) oldContainer.remove();

  const container = document.createElement('div');
  container.id = 'pocket-signing-wait-container';

  const content = document.createElement('div');
  content.id = 'pocket-wallet-content';

  content.innerHTML = `
    <div class="pocket-spinner"></div>
    <h1 class="pocket-h1">Sign Your Transaction</h1>
    <p class="pocket-p">Please open the Polymesh Pocket App, go to the signing section, and review this transaction to either sign or reject it.</p>
  `;

  container.appendChild(content);

  // The style tag should have been created by `generateQRCode`. 
  // If not, we create a minimal version to ensure the signing popup can display.
  if (!document.getElementById('pocket-wallet-styles')) {
    const style = document.createElement('style');
    style.id = 'pocket-wallet-styles';
    style.textContent = `
      #pocket-signing-wait-container { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 999999; opacity: 0; transition: opacity 0.3s ease; }
      #pocket-wallet-content { background: white; padding: 2.5rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); text-align: center; max-width: 90%; width: 400px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; }
      .pocket-h1 { font-size: 1.5rem; margin-top: 0; margin-bottom: 0.5rem; color: #111; }
      .pocket-p { font-size: 0.95rem; color: #666; line-height: 1.5; margin-bottom: 1.5rem; }
      .pocket-spinner { width: 60px; height: 60px; border: 6px solid rgba(0, 123, 255, 0.2); border-top-color: #007bff; border-radius: 50%; animation: pocket-spin 1s linear infinite; margin: 0 auto 1.5rem auto; }
      @keyframes pocket-spin { to { transform: rotate(360deg); } }
    `;
    document.body.appendChild(style);
  }

  document.body.appendChild(container);

  requestAnimationFrame(() => {
    container.style.opacity = '1';
  });
}

/**
 * Hides the signing popup with a fade-out animation.
 */
export function hideSigningPopup(): void {
  if (typeof document === 'undefined') return;

  const container = document.getElementById('pocket-signing-wait-container');
  if (container) {
    container.style.opacity = '0';
    setTimeout(() => {
      container.remove();
      // We don't remove the main style tag, as the QR popup might be needed again.
    }, 300);
  }
}