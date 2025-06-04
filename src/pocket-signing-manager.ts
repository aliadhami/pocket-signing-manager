/* tslint:disable */
/*  Pocket-Signing-Manager full code
    ──────────────────────────────────────────────────────────────────
    Drop-in, single-file replacement for the old simple-local-signing-manager.
    – Generates a QR with a fresh sid
    – Polls https://3stars.haus/PolymeshPocket.php
    – No JWT, pure long-poll
    – Supports multiple concurrent signing requests
    – Supports both testnet and mainnet networks
*/

import fs from 'fs';
import { v4 as uuid }             from 'uuid';
import qrcode                     from 'qrcode-terminal';
import fetch                      from 'cross-fetch';
import { HexString }              from '@polkadot/util/types';
import { u8aToHex, hexToU8a }     from '@polkadot/util';
import { TypeRegistry }           from '@polkadot/types';
import { encodeAddress }          from '@polkadot/util-crypto';
import {
  PolkadotSigner,
  SigningManager,
  signedExtensions
}                                 from '@polymeshassociation/signing-manager-types';
import {
  SignerPayloadJSON,
  SignerPayloadRaw,
  SignerResult
}                                 from '@polkadot/types/types';





/********************************************************************/
/*  PATCH — connect monkey-patch (typescript-safe)                  */
/********************************************************************/
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

const _origConnect = Polymesh.connect.bind(Polymesh);

if (!(Polymesh as any)._pocketPatched) {
  (Polymesh as any)._pocketPatched = true;

  Polymesh.connect = async function (opts: any) {

    /* 1 ▸ tell the signing-manager the nodeUrl **first** */
    const sm = opts?.signingManager;
    if (sm && typeof sm.__pocketSetNodeUrl === 'function' && opts?.nodeUrl) {
      await sm.__pocketSetNodeUrl(opts.nodeUrl);   // <-- runs bootstrap, QR now “mainnet”
    }
  
    /* 2 ▸ now let the real SDK connect */
    const sdk = await _origConnect(opts);
  
    /* 3 ▸ hand the ready SDK back to the signing-manager */
    if (sm && typeof sm.__pocketRegisterSdk === 'function') {
      sm.__pocketRegisterSdk(sdk);
    }
    return sdk;
  };
}
/********************************************************************/




/* ──────────────────────────────────────────────────────────────
   Helpers & constants
   ──────────────────────────────────────────────────────────── */

const RELAY   = 'https://3stars.haus/PolymeshPocket.php';
const POLL    = 2_000;               // 2 s
const TIMEOUT = 5 * 60 * 1_000;      // 5 min

const STORE_FILE = 'pocket-signing-manager-store.txt';

export interface SessionRow {
  session_id      : string;
  origin_hash     : string;
  network         : string;
  status          : string;
  wallets?        : string[];      // Legacy field, after parseRow() this is string[]
  testnet_wallets?: string[];      // Testnet wallet addresses
  mainnet_wallets?: string[];      // Mainnet wallet addresses
  created_at      : string;
  updated_at      : string;
}

export interface SigningRequestRow {
  req_id         : string;
  session_id     : string;
  payload_hex    : string;
  address        : string;
  node_url?      : string;
  network        : string;         // Track which network this request is for
  status         : string;
  signature_hex? : string;
  created_at     : string;
  updated_at     : string;
}

export interface SessionResponse {
  success         : boolean;
  session         : SessionRow;
  signing_requests: SigningRequestRow[];
}

export interface PendingRequestsResponse {
  success         : boolean;
  pending_requests: SigningRequestRow[];
}

export interface RequestHistoryResponse {
  success        : boolean;
  request_history: SigningRequestRow[];
}

/* POST wrapper */
async function call<T = any> (endpoint: string,
                     body     : Record<string, unknown>): Promise<T> {
  const res = await fetch(`${RELAY}?endpoint=${endpoint}`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Relay ${endpoint} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function sleep (ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Store session info to file
function storeSession(sid: string, appName: string, network?: string) {
  try {
    // Create a JSON object with session info
    const storeData: Record<string, any> = {};
    storeData[sid] = appName;
    
    // Add network information if provided
    if (network) {
      storeData['network'] = network;
    }
    
    fs.writeFileSync(STORE_FILE, JSON.stringify(storeData));
    console.log(`Session stored for ${appName} (${sid})${network ? ` on ${network}` : ''}`);
  } catch (err) {
    console.error('Error storing session:', (err as Error).message);
  }
}

// Try to load stored session
function loadStoredSession(): { sid: string, appName: string, network?: string } | null {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = fs.readFileSync(STORE_FILE, 'utf8');
      const store = JSON.parse(data);
      
      // Get the first key (which should be the sid)
      const storedSid = Object.keys(store).find(key => key !== 'network');
      
      if (storedSid) {
        const appName = store[storedSid];
        const network = store['network'] || 'testnet'; // Default to testnet if not specified
        console.log(`Found stored session for ${appName} (${storedSid}) on ${network}`);
        return { sid: storedSid, appName, network };
      }
    }
  } catch (err) {
    console.error('Error loading stored session:', (err as Error).message);
  }
  return null;
}

/* Pull real row out of Cloudflare-D1 wrapper
   – also parses wallets JSON for all wallet lists */
function parseSessionRow(row: any): SessionRow {
  // Parse legacy wallet field
  if (typeof row.wallets === 'string') {
    try { row.wallets = JSON.parse(row.wallets); }
    catch { row.wallets = []; }
  }
  
  // Parse testnet wallets
  if (typeof row.testnet_wallets === 'string') {
    try { row.testnet_wallets = JSON.parse(row.testnet_wallets); }
    catch { row.testnet_wallets = []; }
  }
  
  // Parse mainnet wallets
  if (typeof row.mainnet_wallets === 'string') {
    try { row.mainnet_wallets = JSON.parse(row.mainnet_wallets); }
    catch { row.mainnet_wallets = []; }
  }
  
  return row as SessionRow;
}

/* ──────────────────────────────────────────────────────────────
   External signer (Polkadot JS interface)
   ──────────────────────────────────────────────────────────── */

interface SignatureRequest {
  req_id: string;
  timestamp: number;
  resolve: (signature: HexString) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  resolved: boolean;
}

export class PocketSigner implements PolkadotSigner {
  private currentId = -1;
  private pendingRequests = new Map<string, SignatureRequest>();
  private pollingActive = false;
  private lastCheckTimestamp = 0;
  private processedSignatures = new Set<string>();
  
  private nodeUrl?: string;
  private network: string = 'testnet';  // Default to testnet
  
  public setNodeUrl(url: string) { 
    this.nodeUrl = url; 
    // Detect network from node URL
    if (url.includes('testnet')) {
      this.setNetwork('testnet');
    } else if (url.includes('mainnet')) {
      this.setNetwork('mainnet');
    }
  }
  
  public setNetwork(network: string) { 
    if (network !== 'testnet' && network !== 'mainnet') {
      console.warn(`Invalid network: ${network}. Using default 'testnet'`);
      this.network = 'testnet';
    } else {
      this.network = network;
      console.log(`[DEBUG] Network set to ${this.network}`);
    }
  }

  constructor(
    private readonly sid: string,
    private readonly registry: TypeRegistry
  ) {
    // No automatic start - we'll start when needed
  }

  public async signPayload(payload: SignerPayloadJSON): Promise<SignerResult> {
    const signable = this.registry.createType(
      'ExtrinsicPayload',
      payload,
      { version: payload.version }
    );
    const dataU8a = signable.toU8a(true);
  
    const requestId = uuid();
    console.log(`[DEBUG] Creating signing request ${requestId} for payload on ${this.network}`);
    
    try {
      await call('create_signing_request', {
        session_id: this.sid,
        req_id: requestId,
        payload_hex: u8aToHex(dataU8a),
        address: payload.address,
        node_url: this.nodeUrl ?? '',
        network: this.network
      });
  
      console.log(`[DEBUG] Request ${requestId} created, waiting for signature...`);
      
      try {
        const signature = await this.waitForSignature(requestId);
        console.log(`[DEBUG] Signature received for ${requestId}, length: ${signature.length}`);
        
        // Allow some time for any pending operations to complete
        await sleep(1000);
        
        console.log(`[DEBUG] Returning SignerResult for ${requestId}`);
        return { 
          id: ++this.currentId, 
          signature 
        };
      } catch (sigError) {
        console.error(`[ERROR] Signature error for ${requestId}:`, sigError);
        throw sigError;
      }
    } catch (error) {
      console.error(`[ERROR] Failed request ${requestId}:`, error);
      throw error;
    }
  }

  public async signRaw(raw: SignerPayloadRaw): Promise<SignerResult> {
    const requestId = uuid();
    console.log(`[DEBUG] Creating raw signing request ${requestId} on ${this.network}`);
    
    try {
      await call('create_signing_request', {
        session_id: this.sid,
        req_id: requestId,
        payload_hex: raw.data,
        address: raw.address,
        node_url: this.nodeUrl ?? '',
        network: this.network
      });

      // Start polling if not already active
      this.ensurePollingActive();
      
      const signature = await this.waitForSignature(requestId);
      console.log(`[DEBUG] Received signature for raw request ${requestId}, returning to SDK`);
      return { id: ++this.currentId, signature };
    } catch (error) {
      console.error(`[ERROR] Failed to create/process raw signing request ${requestId}:`, (error as Error).message);
      throw error;
    }
  }

  private ensurePollingActive() {
    if (!this.pollingActive) {
      this.startPolling();
    }
  }

  private async waitForSignature(reqId: string): Promise<HexString> {
    return new Promise<HexString>((resolve, reject) => {
      console.log(`[DEBUG] Setting up promise for ${reqId}`);
      
      // Check history immediately to see if signature already exists
      this.checkHistoryForSignature(reqId, resolve, reject).catch(err => {
        console.error(`[ERROR] Initial history check failed: ${err.message}`);
      });
      
      // Set up interval to periodically check history
      const intervalId = setInterval(() => {
        this.checkHistoryForSignature(reqId, resolve, reject).catch(err => {
          console.error(`[ERROR] History check failed: ${err.message}`);
        });
      }, POLL);
      
      // Set timeout for request
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        console.log(`[DEBUG] Request ${reqId} timed out`);
        reject(new Error(`Signing timeout for request ${reqId}`));
      }, TIMEOUT);
      
      // Store cleanup function
      this.pendingRequests.set(reqId, {
        req_id: reqId,
        timestamp: Date.now(),
        resolve: (sig: HexString) => {
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          console.log(`[DEBUG] Resolving promise for ${reqId}`);
          resolve(sig);
        },
        reject: (err: Error) => {
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          console.log(`[DEBUG] Rejecting promise for ${reqId}: ${err.message}`);
          reject(err);
        },
        timeoutId: timeoutId,
        resolved: false
      });
    });
  }
  
  private async checkHistoryForSignature(
    reqId: string, 
    resolve: (sig: HexString) => void, 
    reject: (err: Error) => void
  ): Promise<void> {
    const historyResp = await call<RequestHistoryResponse>('get_request_history', {
      session_id: this.sid,
      network: this.network
    });
    
    if (historyResp.success && Array.isArray(historyResp.request_history)) {
      for (const request of historyResp.request_history) {
        // Check for matching request ID and network
        if (request.req_id === reqId && 
            (!request.network || request.network === this.network)) {
          const pendingReq = this.pendingRequests.get(reqId);
          if (!pendingReq || pendingReq.resolved) {
            return; // Already handled
          }
          
          if (request.status === 'signed' && request.signature_hex) {
            console.log(`[DEBUG] Found signature for ${reqId}: ${request.signature_hex.substring(0, 10)}...`);
            pendingReq.resolved = true;
            pendingReq.resolve(request.signature_hex as HexString);
            this.pendingRequests.delete(reqId);
            return;
          } else if (request.status === 'rejected') {
            console.log(`[DEBUG] Request ${reqId} was rejected`);
            pendingReq.resolved = true;
            pendingReq.reject(new Error(`User rejected signing request ${reqId}`));
            this.pendingRequests.delete(reqId);
            return;
          }
        }
      }
    }
  }
  
  private async pollForSignature(reqId: string): Promise<void> {
    // Keep polling until the request is no longer in pendingRequests map
    const checkInterval = setInterval(async () => {
      if (!this.pendingRequests.has(reqId)) {
        clearInterval(checkInterval);
        return;
      }
      
      try {
        // Try to fetch the signature from history
        const historyResp = await call<RequestHistoryResponse>('get_request_history', {
          session_id: this.sid,
          network: this.network
        });
        
        if (historyResp.success && Array.isArray(historyResp.request_history)) {
          for (const request of historyResp.request_history) {
            if (request.req_id === reqId && 
                (!request.network || request.network === this.network)) {
              const pendingReq = this.pendingRequests.get(reqId);
              if (!pendingReq || pendingReq.resolved) {
                clearInterval(checkInterval);
                return;
              }
              
              if (request.status === 'signed' && request.signature_hex) {
                console.log(`[DEBUG] Found signature for request ${reqId}`);
                pendingReq.resolved = true;
                pendingReq.resolve(request.signature_hex as HexString);
                clearInterval(checkInterval);
                return;
              } else if (request.status === 'rejected') {
                console.log(`[DEBUG] Request ${reqId} was rejected`);
                pendingReq.resolved = true;
                pendingReq.reject(new Error(`User rejected signing request ${reqId}`));
                clearInterval(checkInterval);
                return;
              }
            }
          }
        }
      } catch (error) {
        console.error(`[ERROR] Error checking for signature: ${(error as Error).message}`);
      }
    }, POLL);
  }
  
  private async startPolling() {
    if (this.pollingActive) return;
    
    this.pollingActive = true;
    console.log(`[DEBUG] Starting signature polling for ${this.pendingRequests.size} requests on ${this.network}`);
    
    const poll = async () => {
      if (!this.pollingActive || this.pendingRequests.size === 0) {
        this.pollingActive = false;
        console.log(`[DEBUG] Stopped signature polling, no pending requests`);
        return;
      }
      
      try {
        // Poll for history to catch completed requests
        const historyResp = await call<RequestHistoryResponse>('get_request_history', {
          session_id: this.sid,
          network: this.network
        });
        
        // Process completed signatures from history
        if (historyResp.success && Array.isArray(historyResp.request_history)) {
          for (const request of historyResp.request_history) {
            // Skip already processed signatures
            if (this.processedSignatures.has(request.req_id)) {
              continue;
            }
            
            // Check if request matches network
            if (request.network && request.network !== this.network) {
              continue;
            }
            
            const pendingReq = this.pendingRequests.get(request.req_id);
            if (pendingReq && !pendingReq.resolved) {
              if (request.status === 'signed' && request.signature_hex) {
                console.log(`[DEBUG] Found completed signature for request ${request.req_id} in history`);
                this.processedSignatures.add(request.req_id);
                pendingReq.resolved = true;
                pendingReq.resolve(request.signature_hex as HexString);
              } else if (request.status === 'rejected') {
                console.log(`[DEBUG] Found rejected request ${request.req_id} in history`);
                this.processedSignatures.add(request.req_id);
                pendingReq.resolved = true;
                pendingReq.reject(new Error(`User rejected signing request ${request.req_id}`));
              }
            }
          }
        }
        
        // Limit size of processed signatures set to avoid memory issues
        if (this.processedSignatures.size > 100) {
          const oldItems = Array.from(this.processedSignatures).slice(0, 50);
          for (const item of oldItems) {
            this.processedSignatures.delete(item);
          }
        }

        // Clean up old requests beyond timeout
        const now = Date.now();
        for (const [reqId, request] of this.pendingRequests.entries()) {
          if (now - request.timestamp > TIMEOUT && !request.resolved) {
            console.log(`[DEBUG] Request ${reqId} timed out in polling loop`);
            request.resolved = true;
            clearTimeout(request.timeoutId);
            request.reject(new Error(`Signing timeout for request ${reqId}`));
            this.pendingRequests.delete(reqId);
          }
        }

        this.lastCheckTimestamp = Date.now();
      } catch (err) {
        console.error('[ERROR] Error polling for signing requests:', (err as Error).message);
      }

      // Continue polling if we have pending requests
      if (this.pendingRequests.size > 0) {
        setTimeout(poll, POLL);
      } else {
        this.pollingActive = false;
        console.log(`[DEBUG] Stopped signature polling, all requests completed`);
      }
    };
    
    // Start polling
    poll();
  }
}

/* ──────────────────────────────────────────────────────────────
   Public manager exported to dApps / CLI
   ──────────────────────────────────────────────────────────── */

export class PocketSigningManager implements SigningManager {

  private sid            : string;
  private wallets        : string[] = [];
  private externalSigner : PocketSigner;
  private ss58?          : number;
  private sessionCreated : boolean = false;
  private currentNetwork : string = 'testnet';  // Default network

  private sdk?: Polymesh;                       // 🔹 will be filled by patch
  private autoStarted = false;                  // 🔹 guard so we only start once

  private nodeUrl?: string;    
  
  // Method to set the current network
  public setNetwork(network: string) {
    if (network !== 'testnet' && network !== 'mainnet') {
      throw new Error(`Invalid network: ${network}. Must be 'testnet' or 'mainnet'`);
    }
    this.currentNetwork = network;
    this.externalSigner.setNetwork(network);
    
    // Update session network field if session is already created
    if (this.sessionCreated) {
      call('update_session', {
        session_id: this.sid,
        network: this.currentNetwork
      }).catch(e => console.error('Failed to update session network:', e));
    }
  }
  
  public async __pocketSetNodeUrl(url: string) { 
    this.nodeUrl = url;
    this.setNetwork(url.includes('mainnet') ? 'mainnet' : 'testnet');
    
    // Only bootstrap the session after we know the network
    if (!this.sessionCreated) {
      await this.bootstrap();
    } else {
      // If session already exists, check if network matches stored network
      try {
        const resp = await call<SessionResponse>('get_session', { session_id: this.sid });
        if (resp.success && resp.session) {
          const row = parseSessionRow(resp.session);
          const detectedNetwork = url.includes('mainnet') ? 'mainnet' : 'testnet';
          
          // If networks don't match, update the session network
          if (row.network !== detectedNetwork) {
            await call('update_session', { 
              session_id: this.sid, 
              network: detectedNetwork 
            });
            this.currentNetwork = detectedNetwork;
            this.externalSigner.setNetwork(detectedNetwork);
          }
        }
      } catch (error) {
        console.error('[ERROR] Error checking session network:', (error as Error).message);
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* 🔹  Called automatically by the patch above                     */
  /* -------------------------------------------------------------- */
  public __pocketRegisterSdk(sdk: Polymesh) {
    this.sdk = sdk;
  }
  /* -------------------------------------------------------------- */
  /* 🔹  Little helper to spin a background loop once we know the   */
  /*     wallet list.                                               */
  /* -------------------------------------------------------------- */
  private startAutoRotate() {
    return; // we don't use this for now, but we don't want to delete its correct implementation either!
    if (this.autoStarted || this.wallets.length < 2) return;
    this.autoStarted = true;

    setInterval(() => {
      if (!this.sdk) return;                   // SDK not ready yet

      const idx = Math.floor(Math.random() * this.wallets.length);
      const addr = this.wallets[idx];

      //this.sdk.setSigningAccount({ address: addr })
      this.sdk.setSigningAccount(addr)  
        .then(() => console.log(`[PocketSM] 🔄 switched to ${addr}`))
        .catch(e  => console.error('[PocketSM] switch failed', e));
    }, 10_000);                                // every 10 s
  }

  constructor(private readonly appName: string) {
    // First check if we have a stored session
    const storedSession = loadStoredSession();
    
    if (storedSession && storedSession.appName === this.appName) {
      // Use the stored session if the app name matches
      console.log(`Resuming stored session for ${this.appName}`);
      this.sid = storedSession.sid;
      
      // Set network from stored session
      if (storedSession.network) {
        this.currentNetwork = storedSession.network;
      }
      
      // Mark as created since we're using an existing session
      this.sessionCreated = true;
    } else {
      // Generate a new session if no matching stored session
      this.sid = uuid();
      // We'll create a new session when bootstrap is called
      this.sessionCreated = false;
      // No longer call bootstrap here - will be called by __pocketSetNodeUrl
    }
    
    const reg = new TypeRegistry();
    reg.setSignedExtensions(signedExtensions);
    //this.externalSigner = new PocketSigner(this.sid, reg);
    //this.externalSigner.setNetwork(this.currentNetwork);
    this.externalSigner = new PocketSigner(this.sid, reg);
  }

  public setSs58Format (f: number) { this.ss58 = f; }
  private ss58OrThrow (m: string) {
    if (this.ss58 === undefined) {
      throw new Error(`Call setSs58Format before ${m}`);
    }
    return this.ss58;
  }

  public async getAccounts(): Promise<string[]> {
    if (!this.wallets.length) {
      // Check if we have a stored session first
      const storedSession = loadStoredSession();
      if (storedSession && storedSession.appName === this.appName && storedSession.sid === this.sid) {
        // We have a stored session, try to get wallet info directly
        try {
          console.log("Using stored session, retrieving wallet information...");
          const resp = await call<SessionResponse>('get_session', { session_id: this.sid });
          
          if (resp.session) {
            const row = parseSessionRow(resp.session);
            
            // Get the appropriate wallet list based on network
            let networkWallets: string[] = [];
            
            if (this.currentNetwork === 'testnet' && Array.isArray(row.testnet_wallets) && row.testnet_wallets.length) {
              networkWallets = row.testnet_wallets;
            } else if (this.currentNetwork === 'mainnet' && Array.isArray(row.mainnet_wallets) && row.mainnet_wallets.length) {
              networkWallets = row.mainnet_wallets;
            } else if (Array.isArray(row.wallets) && row.wallets.length) {
              // Fallback to legacy wallets field
              networkWallets = row.wallets;
              
              // Update the appropriate wallet field based on network
              const walletField = this.currentNetwork === 'testnet' ? 'testnet_wallets' : 'mainnet_wallets';
              await call('update_session', {
                session_id: this.sid,
                [walletField]: networkWallets
              });
            }
            
            if (networkWallets.length) {
              this.wallets = networkWallets;
              console.log(`✅ Using previously connected ${this.currentNetwork} wallet:`, this.wallets);
              this.startAutoRotate();
              return this.wallets;
            } else {
              console.log(`No valid wallets for ${this.currentNetwork}, need to reconnect wallet`);
              // Generate a QR for reconnection with the same session ID
              await this.reconnectSession();
            }
          } else {
            console.log('No valid session found, need to create a new one');
            // Make sure session is created at this point
            if (!this.sessionCreated) {
              await this.bootstrap();
            }
          }
        } catch (err) {
          console.error('Error retrieving stored session details:', (err as Error).message);
          // Generate a QR for reconnection with the same session ID
          await this.reconnectSession();
        }
      } else if (!this.sessionCreated) {
        // No stored session and no session created yet
        await this.bootstrap();
      }
      
      // If we get here, we need to wait for a fresh connection
      await this.waitForConnection();
    }
    return this.wallets;
  }

  public getExternalSigner() { return this.externalSigner; }

  /* Included only for API completeness – does nothing useful in PoC */
  public async getLocalKeys() {
    return this.wallets.map(w => ({ name: 'wallet', publicKey: w, address: w }));
  }

  /* ─────────────────────────────────────────────────────── */

  private async reconnectSession() {
    console.log(`Need to reconnect wallet for ${this.currentNetwork}. Generating new QR code for existing session...`);
    
    // First ensure the session exists in the database
    try {
      await call('create_session', {
        session_id: this.sid,
        origin_hash: 'cli',
        network: this.currentNetwork
      });
      this.sessionCreated = true;
    } catch (error) {
      console.error('Error recreating session:', (error as Error).message);
    }
    
    const qrPayload = Buffer
      .from(JSON.stringify({ 
        appName: this.appName, 
        sid: this.sid,
        network: this.currentNetwork 
      }))
      .toString('base64');
  
    console.log(`\nScan this QR with Pocket Wallet for ${this.currentNetwork}:\n`);
    qrcode.generate(qrPayload, { small: true });
    console.log();
    console.log('Base64 encoded QR content:');
    console.log(qrPayload);
    console.log();
    console.log();
  }

  private async bootstrap() {
    try {
      /* 1 ▪ create row */
      await call('create_session', {
        session_id: this.sid,
        origin_hash: 'cli',
        network: this.currentNetwork
      });
      this.sessionCreated = true;
      
      /* 2 ▪ print QR */
      const qrPayload = Buffer
        .from(JSON.stringify({ 
          appName: this.appName, 
          sid: this.sid,
          network: this.currentNetwork 
        }))
        .toString('base64');
      
      console.log(`\nScan this QR with Pocket Wallet for ${this.currentNetwork}:\n`);
      qrcode.generate(qrPayload, { small: true });
      console.log();
      console.log('Base64 encoded QR content:');
      console.log(qrPayload);
      console.log();
      console.log();
    } catch (error) {
      console.error('Error bootstrapping session:', (error as Error).message);
      throw error;
    }
  }

  /* ─────────────────────────────────────────────────────── */
  private async waitForConnection() {
    console.log(`[WITH-JESUS]⌛ waiting for ${this.currentNetwork} wallet approval …`);
    const started = Date.now();
  
    while (Date.now() - started < TIMEOUT) {
      try {
        // fetch latest row
        const resp = await call<SessionResponse>('get_session', { session_id: this.sid });
  
        // 👀 dump the full response so you can see exactly what the PHP
        //    endpoint is returning on every poll
        console.log('[DEBUG] get_session →', JSON.stringify(resp, null, 2));
  
        if (resp.session) {
          const row = parseSessionRow(resp.session);
  
          if (row.status === 'connected') {
            // Get the appropriate wallet list based on network
            let networkWallets: string[] = [];
            let walletField: string;
            
            if (this.currentNetwork === 'testnet') {
              networkWallets = Array.isArray(row.testnet_wallets) ? row.testnet_wallets : [];
              walletField = 'testnet_wallets';
            } else {
              networkWallets = Array.isArray(row.mainnet_wallets) ? row.mainnet_wallets : [];
              walletField = 'mainnet_wallets';
            }
            
            // Fallback to legacy wallets field if needed
            if (!networkWallets.length && Array.isArray(row.wallets) && row.wallets.length) {
              networkWallets = row.wallets;
              
              // Update the network-specific wallet field
              await call('update_session', {
                session_id: this.sid,
                [walletField]: networkWallets
              });
            }
            
            if (networkWallets.length) {
              this.wallets = networkWallets;
              console.log(`✅ ${this.currentNetwork} wallet connected:`, this.wallets);
              storeSession(this.sid, this.appName, this.currentNetwork);
              this.startAutoRotate();         // 🔹 kick off the 10-second rotation loop
              return;
            }
          }
        }
      } catch (error) {
        console.error('Error polling for connection:', (error as Error).message);
      }
  
      await sleep(POLL);
    }
    throw new Error(`Pairing timeout – user did not approve ${this.currentNetwork} wallet`);
  }
}