import { v4 as uuid } from 'uuid';
import { HexString } from '@polkadot/util/types';
import { u8aToHex } from '@polkadot/util';
import { TypeRegistry } from '@polkadot/types';
import {
  PolkadotSigner,
  SigningManager,
  signedExtensions
} from '@polymeshassociation/signing-manager-types';
import {
  SignerPayloadJSON,
  SignerPayloadRaw,
  SignerResult
} from '@polkadot/types/types';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

import {
  SessionResponse,
  RequestHistoryResponse,
  SignatureRequest,
  SessionRow
} from '../types';
import {
  call,
  sleep,
  storeSession,
  loadStoredSession,
  parseSessionRow,
  generateQRCode,
  POLL,
  TIMEOUT
} from '../utils';

/**
 * Polkadot JS compatible signer for Pocket Wallet
 */
export class PocketSigner implements PolkadotSigner {
  private currentId = -1;
  private pendingRequests = new Map<string, SignatureRequest>();
  private pollingActive = false;
  private processedSignatures = new Set<string>();
  
  private nodeUrl?: string;
  private network: string = 'testnet';

  constructor(
    private readonly sid: string,
    private readonly registry: TypeRegistry
  ) {}

  public setNodeUrl(url: string): void { 
    this.nodeUrl = url;
    if (url.includes('testnet')) {
      this.setNetwork('testnet');
    } else if (url.includes('mainnet')) {
      this.setNetwork('mainnet');
    }
  }
  
  public setNetwork(network: string): void { 
    if (network !== 'testnet' && network !== 'mainnet') {
      console.warn(`Invalid network: ${network}. Using default 'testnet'`);
      this.network = 'testnet';
    } else {
      this.network = network;
      console.log(`[DEBUG] Network set to ${this.network}`);
    }
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
      
      const signature = await this.waitForSignature(requestId);
      console.log(`[DEBUG] Signature received for ${requestId}`);
      
      await sleep(1000);
      
      return { 
        id: ++this.currentId, 
        signature 
      };
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

      this.ensurePollingActive();
      
      const signature = await this.waitForSignature(requestId);
      console.log(`[DEBUG] Received signature for raw request ${requestId}`);
      return { id: ++this.currentId, signature };
    } catch (error) {
      console.error(`[ERROR] Failed raw signing request ${requestId}:`, error);
      throw error;
    }
  }

  private ensurePollingActive(): void {
    if (!this.pollingActive) {
      this.startPolling();
    }
  }

  private async waitForSignature(reqId: string): Promise<HexString> {
    return new Promise<HexString>((resolve, reject) => {
      this.checkHistoryForSignature(reqId, resolve, reject).catch(err => {
        console.error(`[ERROR] Initial history check failed: ${err.message}`);
      });
      
      const intervalId = setInterval(() => {
        this.checkHistoryForSignature(reqId, resolve, reject).catch(err => {
          console.error(`[ERROR] History check failed: ${err.message}`);
        });
      }, POLL);
      
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        console.log(`[DEBUG] Request ${reqId} timed out`);
        reject(new Error(`Signing timeout for request ${reqId}`));
      }, TIMEOUT);
      
      this.pendingRequests.set(reqId, {
        req_id: reqId,
        timestamp: Date.now(),
        resolve: (sig: HexString) => {
          clearInterval(intervalId);
          clearTimeout(timeoutId);
          resolve(sig);
        },
        reject: (err: Error) => {
          clearInterval(intervalId);
          clearTimeout(timeoutId);
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
        if (request.req_id === reqId && 
            (!request.network || request.network === this.network)) {
          const pendingReq = this.pendingRequests.get(reqId);
          if (!pendingReq || pendingReq.resolved) {
            return;
          }
          
          if (request.status === 'signed' && request.signature_hex) {
            console.log(`[DEBUG] Found signature for ${reqId}`);
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
  
  private async startPolling(): Promise<void> {
    if (this.pollingActive) return;
    
    this.pollingActive = true;
    console.log(`[DEBUG] Starting signature polling for ${this.pendingRequests.size} requests on ${this.network}`);
    
    const poll = async () => {
      if (!this.pollingActive || this.pendingRequests.size === 0) {
        this.pollingActive = false;
        return;
      }
      
      try {
        const historyResp = await call<RequestHistoryResponse>('get_request_history', {
          session_id: this.sid,
          network: this.network
        });
        
        if (historyResp.success && Array.isArray(historyResp.request_history)) {
          for (const request of historyResp.request_history) {
            if (this.processedSignatures.has(request.req_id)) {
              continue;
            }
            
            if (request.network && request.network !== this.network) {
              continue;
            }
            
            const pendingReq = this.pendingRequests.get(request.req_id);
            if (pendingReq && !pendingReq.resolved) {
              if (request.status === 'signed' && request.signature_hex) {
                this.processedSignatures.add(request.req_id);
                pendingReq.resolved = true;
                pendingReq.resolve(request.signature_hex as HexString);
              } else if (request.status === 'rejected') {
                this.processedSignatures.add(request.req_id);
                pendingReq.resolved = true;
                pendingReq.reject(new Error(`User rejected signing request ${request.req_id}`));
              }
            }
          }
        }
        
        // Cleanup old processed signatures
        if (this.processedSignatures.size > 100) {
          const oldItems = Array.from(this.processedSignatures).slice(0, 50);
          for (const item of oldItems) {
            this.processedSignatures.delete(item);
          }
        }

        // Clean up timed out requests
        const now = Date.now();
        for (const [reqId, request] of this.pendingRequests.entries()) {
          if (now - request.timestamp > TIMEOUT && !request.resolved) {
            request.resolved = true;
            clearTimeout(request.timeoutId);
            request.reject(new Error(`Signing timeout for request ${reqId}`));
            this.pendingRequests.delete(reqId);
          }
        }
      } catch (err) {
        console.error('[ERROR] Error polling for signing requests:', (err as Error).message);
      }

      if (this.pendingRequests.size > 0) {
        setTimeout(poll, POLL);
      } else {
        this.pollingActive = false;
      }
    };
    
    poll();
  }
}

/**
 * Main Pocket Signing Manager
 */
export class PocketSigningManager implements SigningManager {
  private sid: string;
  private wallets: string[] = [];
  private externalSigner: PocketSigner;
  private ss58?: number;
  private sessionCreated: boolean = false;
  private currentNetwork: string = 'testnet';
  private sdk?: Polymesh;
  private autoStarted = false;
  private nodeUrl?: string;

  /**
   * Create a Pocket Signing Manager
   * 
   * @param appName - name of the application
   * @param args.network - network to use ('testnet' or 'mainnet')
   * @param args.ss58Format - SS58 format for addresses
   */
  public static async create(args: {
    appName: string;
    network?: string;
    ss58Format?: number;
  }): Promise<PocketSigningManager> {
    const { appName, network = 'testnet', ss58Format } = args;
    
    const signingManager = new PocketSigningManager(appName);
    
    if (network) {
      signingManager.setNetwork(network);
    }
    
    if (ss58Format) {
      signingManager.setSs58Format(ss58Format);
    }
    
    return signingManager;
  }

  constructor(private readonly appName: string) {
    const storedSession = loadStoredSession();
    
    if (storedSession && storedSession.appName === this.appName) {
      console.log(`Resuming stored session for ${this.appName}`);
      this.sid = storedSession.sid;
      
      if (storedSession.network) {
        this.currentNetwork = storedSession.network;
      }
      
      this.sessionCreated = true;
    } else {
      this.sid = uuid();
      this.sessionCreated = false;
    }
    
    const reg = new TypeRegistry();
    reg.setSignedExtensions(signedExtensions);
    this.externalSigner = new PocketSigner(this.sid, reg);
  }

  public setNetwork(network: string): void {
    if (network !== 'testnet' && network !== 'mainnet') {
      throw new Error(`Invalid network: ${network}. Must be 'testnet' or 'mainnet'`);
    }
    this.currentNetwork = network;
    this.externalSigner.setNetwork(network);
    
    if (this.sessionCreated) {
      call('update_session', {
        session_id: this.sid,
        network: this.currentNetwork
      }).catch(e => console.error('Failed to update session network:', e));
    }
  }

  public setSs58Format(f: number): void { 
    this.ss58 = f; 
  }

  private ss58OrThrow(m: string): number {
    if (this.ss58 === undefined) {
      throw new Error(`Call setSs58Format before ${m}`);
    }
    return this.ss58;
  }

  public async getAccounts(): Promise<string[]> {
    if (!this.wallets.length) {
      const storedSession = loadStoredSession();
      if (storedSession && storedSession.appName === this.appName && storedSession.sid === this.sid) {
        try {
          console.log("Using stored session, retrieving wallet information...");
          const resp = await call<SessionResponse>('get_session', { session_id: this.sid });
          
          if (resp.session) {
            const row = parseSessionRow(resp.session);
            
            let networkWallets: string[] = [];
            
            if (this.currentNetwork === 'testnet' && Array.isArray(row.testnet_wallets) && row.testnet_wallets.length) {
              networkWallets = row.testnet_wallets;
            } else if (this.currentNetwork === 'mainnet' && Array.isArray(row.mainnet_wallets) && row.mainnet_wallets.length) {
              networkWallets = row.mainnet_wallets;
            } else if (Array.isArray(row.wallets) && row.wallets.length) {
              networkWallets = row.wallets;
              
              const walletField = this.currentNetwork === 'testnet' ? 'testnet_wallets' : 'mainnet_wallets';
              await call('update_session', {
                session_id: this.sid,
                [walletField]: networkWallets
              });
            }
            
            if (networkWallets.length) {
              this.wallets = networkWallets;
              console.log(`✅ Using previously connected ${this.currentNetwork} wallet:`, this.wallets);
              return this.wallets;
            } else {
              console.log(`No valid wallets for ${this.currentNetwork}, need to reconnect wallet`);
              await this.reconnectSession();
            }
          } else {
            console.log('No valid session found, need to create a new one');
            if (!this.sessionCreated) {
              await this.bootstrap();
            }
          }
        } catch (err) {
          console.error('Error retrieving stored session details:', (err as Error).message);
          await this.reconnectSession();
        }
      } else if (!this.sessionCreated) {
        await this.bootstrap();
      }
      
      await this.waitForConnection();
    }
    return this.wallets;
  }

  public getExternalSigner(): PocketSigner { 
    return this.externalSigner; 
  }

  public async getLocalKeys() {
    return this.wallets.map(w => ({ name: 'wallet', publicKey: w, address: w }));
  }

  /**
   * Internal method called by Polymesh SDK patch
   */
  public async __pocketSetNodeUrl(url: string): Promise<void> { 
    this.nodeUrl = url;
    this.setNetwork(url.includes('mainnet') ? 'mainnet' : 'testnet');
    
    if (!this.sessionCreated) {
      await this.bootstrap();
    } else {
      try {
        const resp = await call<SessionResponse>('get_session', { session_id: this.sid });
        if (resp.success && resp.session) {
          const row = parseSessionRow(resp.session);
          const detectedNetwork = url.includes('mainnet') ? 'mainnet' : 'testnet';
          
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
    
    this.externalSigner.setNodeUrl(url);
  }

  /**
   * Internal method called by Polymesh SDK patch
   */
  public __pocketRegisterSdk(sdk: Polymesh): void {
    this.sdk = sdk;
  }

  private async reconnectSession(): Promise<void> {
    console.log(`Need to reconnect wallet for ${this.currentNetwork}. Generating new QR code for existing session...`);
    
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
    
    generateQRCode(this.appName, this.sid, this.currentNetwork);
  }

  private async bootstrap(): Promise<void> {
    try {
      await call('create_session', {
        session_id: this.sid,
        origin_hash: 'cli',
        network: this.currentNetwork
      });
      this.sessionCreated = true;
      
      generateQRCode(this.appName, this.sid, this.currentNetwork);
    } catch (error) {
      console.error('Error bootstrapping session:', (error as Error).message);
      throw error;
    }
  }

  private async waitForConnection(): Promise<void> {
    console.log(`⌛ waiting for ${this.currentNetwork} wallet approval …`);
    const started = Date.now();
   
    let cancelled = false;
    const handleCancel = () => { cancelled = true; };
    document.body.addEventListener('pocket-connection-cancelled', handleCancel);

    try {
        while (Date.now() - started < TIMEOUT) {
            if (cancelled) {
                throw new Error('User cancelled the connection process.');
            }
        
            try {
              const resp = await call<SessionResponse>('get_session', { session_id: this.sid });
      
              if (resp.session) {
                const row = parseSessionRow(resp.session);
      
                if (row.status === 'connected') {
                  let networkWallets: string[] = [];
                  let walletField: string;
                  
                  if (this.currentNetwork === 'testnet') {
                    networkWallets = Array.isArray(row.testnet_wallets) ? row.testnet_wallets : [];
                    walletField = 'testnet_wallets';
                  } else {
                    networkWallets = Array.isArray(row.mainnet_wallets) ? row.mainnet_wallets : [];
                    walletField = 'mainnet_wallets';
                  }
                  
                  if (!networkWallets.length && Array.isArray(row.wallets) && row.wallets.length) {
                    networkWallets = row.wallets;
                    
                    await call('update_session', {
                      session_id: this.sid,
                      [walletField]: networkWallets
                    });
                  }
                  
                  if (networkWallets.length) {
                    this.wallets = networkWallets;
                    console.log(`✅ ${this.currentNetwork} wallet connected:`, this.wallets);
                    storeSession(this.sid, this.appName, this.currentNetwork);
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
    } finally {
        // IMPORTANT: Clean up the event listener to prevent memory leaks
        document.body.removeEventListener('pocket-connection-cancelled', handleCancel);
    }
  }
}