"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PocketSigningManager = exports.PocketSigner = void 0;
const uuid_1 = require("uuid");
const util_1 = require("@polkadot/util");
const types_1 = require("@polkadot/types");
const signing_manager_types_1 = require("@polymeshassociation/signing-manager-types");
const utils_1 = require("../utils");
/**
 * Polkadot JS compatible signer for Pocket Wallet
 */
class PocketSigner {
    constructor(sid, registry) {
        this.sid = sid;
        this.registry = registry;
        this.currentId = -1;
        this.pendingRequests = new Map();
        this.pollingActive = false;
        this.processedSignatures = new Set();
        this.network = 'testnet';
    }
    setNodeUrl(url) {
        this.nodeUrl = url;
        if (url.includes('testnet')) {
            this.setNetwork('testnet');
        }
        else if (url.includes('mainnet')) {
            this.setNetwork('mainnet');
        }
    }
    setNetwork(network) {
        if (network !== 'testnet' && network !== 'mainnet') {
            console.warn(`Invalid network: ${network}. Using default 'testnet'`);
            this.network = 'testnet';
        }
        else {
            this.network = network;
            console.log(`[DEBUG] Network set to ${this.network}`);
        }
    }
    async signPayload(payload) {
        var _a;
        const signable = this.registry.createType('ExtrinsicPayload', payload, { version: payload.version });
        const dataU8a = signable.toU8a(true);
        const requestId = (0, uuid_1.v4)();
        console.log(`[DEBUG] Creating signing request ${requestId} for payload on ${this.network}`);
        try {
            await (0, utils_1.call)('create_signing_request', {
                session_id: this.sid,
                req_id: requestId,
                payload_hex: (0, util_1.u8aToHex)(dataU8a),
                address: payload.address,
                node_url: (_a = this.nodeUrl) !== null && _a !== void 0 ? _a : '',
                network: this.network
            });
            console.log(`[DEBUG] Request ${requestId} created, waiting for signature...`);
            const signature = await this.waitForSignature(requestId);
            console.log(`[DEBUG] Signature received for ${requestId}`);
            await (0, utils_1.sleep)(1000);
            return {
                id: ++this.currentId,
                signature
            };
        }
        catch (error) {
            console.error(`[ERROR] Failed request ${requestId}:`, error);
            throw error;
        }
    }
    async signRaw(raw) {
        var _a;
        const requestId = (0, uuid_1.v4)();
        console.log(`[DEBUG] Creating raw signing request ${requestId} on ${this.network}`);
        try {
            await (0, utils_1.call)('create_signing_request', {
                session_id: this.sid,
                req_id: requestId,
                payload_hex: raw.data,
                address: raw.address,
                node_url: (_a = this.nodeUrl) !== null && _a !== void 0 ? _a : '',
                network: this.network
            });
            this.ensurePollingActive();
            const signature = await this.waitForSignature(requestId);
            console.log(`[DEBUG] Received signature for raw request ${requestId}`);
            return { id: ++this.currentId, signature };
        }
        catch (error) {
            console.error(`[ERROR] Failed raw signing request ${requestId}:`, error);
            throw error;
        }
    }
    ensurePollingActive() {
        if (!this.pollingActive) {
            this.startPolling();
        }
    }
    async waitForSignature(reqId) {
        return new Promise((resolve, reject) => {
            this.checkHistoryForSignature(reqId, resolve, reject).catch(err => {
                console.error(`[ERROR] Initial history check failed: ${err.message}`);
            });
            const intervalId = setInterval(() => {
                this.checkHistoryForSignature(reqId, resolve, reject).catch(err => {
                    console.error(`[ERROR] History check failed: ${err.message}`);
                });
            }, utils_1.POLL);
            const timeoutId = setTimeout(() => {
                clearInterval(intervalId);
                console.log(`[DEBUG] Request ${reqId} timed out`);
                reject(new Error(`Signing timeout for request ${reqId}`));
            }, utils_1.TIMEOUT);
            this.pendingRequests.set(reqId, {
                req_id: reqId,
                timestamp: Date.now(),
                resolve: (sig) => {
                    clearInterval(intervalId);
                    clearTimeout(timeoutId);
                    resolve(sig);
                },
                reject: (err) => {
                    clearInterval(intervalId);
                    clearTimeout(timeoutId);
                    reject(err);
                },
                timeoutId: timeoutId,
                resolved: false
            });
        });
    }
    async checkHistoryForSignature(reqId, resolve, reject) {
        const historyResp = await (0, utils_1.call)('get_request_history', {
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
                        pendingReq.resolve(request.signature_hex);
                        this.pendingRequests.delete(reqId);
                        return;
                    }
                    else if (request.status === 'rejected') {
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
    async startPolling() {
        if (this.pollingActive)
            return;
        this.pollingActive = true;
        console.log(`[DEBUG] Starting signature polling for ${this.pendingRequests.size} requests on ${this.network}`);
        const poll = async () => {
            if (!this.pollingActive || this.pendingRequests.size === 0) {
                this.pollingActive = false;
                return;
            }
            try {
                const historyResp = await (0, utils_1.call)('get_request_history', {
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
                                pendingReq.resolve(request.signature_hex);
                            }
                            else if (request.status === 'rejected') {
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
                    if (now - request.timestamp > utils_1.TIMEOUT && !request.resolved) {
                        request.resolved = true;
                        clearTimeout(request.timeoutId);
                        request.reject(new Error(`Signing timeout for request ${reqId}`));
                        this.pendingRequests.delete(reqId);
                    }
                }
            }
            catch (err) {
                console.error('[ERROR] Error polling for signing requests:', err.message);
            }
            if (this.pendingRequests.size > 0) {
                setTimeout(poll, utils_1.POLL);
            }
            else {
                this.pollingActive = false;
            }
        };
        poll();
    }
}
exports.PocketSigner = PocketSigner;
/**
 * Main Pocket Signing Manager
 */
class PocketSigningManager {
    /**
     * Create a Pocket Signing Manager
     * * @param appName - name of the application
     * @param args.network - network to use ('testnet' or 'mainnet')
     * @param args.ss58Format - SS58 format for addresses
     */
    static async create(args) {
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
    constructor(appName) {
        this.appName = appName;
        this.wallets = [];
        this.sessionCreated = false;
        this.currentNetwork = 'testnet';
        this.autoStarted = false;
        const storedSession = (0, utils_1.loadStoredSession)();
        if (storedSession && storedSession.appName === this.appName) {
            console.log(`Resuming stored session for ${this.appName}`);
            this.sid = storedSession.sid;
            if (storedSession.network) {
                this.currentNetwork = storedSession.network;
            }
            this.sessionCreated = true;
        }
        else {
            this.sid = (0, uuid_1.v4)();
            this.sessionCreated = false;
        }
        const reg = new types_1.TypeRegistry();
        reg.setSignedExtensions(signing_manager_types_1.signedExtensions);
        this.externalSigner = new PocketSigner(this.sid, reg);
    }
    setNetwork(network) {
        if (network !== 'testnet' && network !== 'mainnet') {
            throw new Error(`Invalid network: ${network}. Must be 'testnet' or 'mainnet'`);
        }
        this.currentNetwork = network;
        this.externalSigner.setNetwork(network);
        if (this.sessionCreated) {
            (0, utils_1.call)('update_session', {
                session_id: this.sid,
                network: this.currentNetwork
            }).catch(e => console.error('Failed to update session network:', e));
        }
    }
    setSs58Format(f) {
        this.ss58 = f;
    }
    ss58OrThrow(m) {
        if (this.ss58 === undefined) {
            throw new Error(`Call setSs58Format before ${m}`);
        }
        return this.ss58;
    }
    async getAccounts() {
        if (!this.wallets.length) {
            const storedSession = (0, utils_1.loadStoredSession)();
            if (storedSession && storedSession.appName === this.appName && storedSession.sid === this.sid) {
                try {
                    console.log("Using stored session, retrieving wallet information...");
                    const resp = await (0, utils_1.call)('get_session', { session_id: this.sid });
                    if (resp.session) {
                        const row = (0, utils_1.parseSessionRow)(resp.session);
                        let networkWallets = [];
                        if (this.currentNetwork === 'testnet' && Array.isArray(row.testnet_wallets) && row.testnet_wallets.length) {
                            networkWallets = row.testnet_wallets;
                        }
                        else if (this.currentNetwork === 'mainnet' && Array.isArray(row.mainnet_wallets) && row.mainnet_wallets.length) {
                            networkWallets = row.mainnet_wallets;
                        }
                        else if (Array.isArray(row.wallets) && row.wallets.length) {
                            networkWallets = row.wallets;
                            const walletField = this.currentNetwork === 'testnet' ? 'testnet_wallets' : 'mainnet_wallets';
                            await (0, utils_1.call)('update_session', {
                                session_id: this.sid,
                                [walletField]: networkWallets
                            });
                        }
                        if (networkWallets.length) {
                            this.wallets = networkWallets;
                            console.log(`✅ Using previously connected ${this.currentNetwork} wallet:`, this.wallets);
                            return this.wallets;
                        }
                        else {
                            console.log(`No valid wallets for ${this.currentNetwork}, need to reconnect wallet`);
                            await this.reconnectSession();
                        }
                    }
                    else {
                        console.log('No valid session found, need to create a new one');
                        if (!this.sessionCreated) {
                            await this.bootstrap();
                        }
                    }
                }
                catch (err) {
                    console.error('Error retrieving stored session details:', err.message);
                    await this.reconnectSession();
                }
            }
            else if (!this.sessionCreated) {
                await this.bootstrap();
            }
            await this.waitForConnection();
        }
        return this.wallets;
    }
    getExternalSigner() {
        return this.externalSigner;
    }
    async getLocalKeys() {
        return this.wallets.map(w => ({ name: 'wallet', publicKey: w, address: w }));
    }
    /**
     * Internal method called by Polymesh SDK patch
     */
    async __pocketSetNodeUrl(url) {
        this.nodeUrl = url;
        this.setNetwork(url.includes('mainnet') ? 'mainnet' : 'testnet');
        if (!this.sessionCreated) {
            await this.bootstrap();
        }
        else {
            try {
                const resp = await (0, utils_1.call)('get_session', { session_id: this.sid });
                if (resp.success && resp.session) {
                    const row = (0, utils_1.parseSessionRow)(resp.session);
                    const detectedNetwork = url.includes('mainnet') ? 'mainnet' : 'testnet';
                    if (row.network !== detectedNetwork) {
                        await (0, utils_1.call)('update_session', {
                            session_id: this.sid,
                            network: detectedNetwork
                        });
                        this.currentNetwork = detectedNetwork;
                        this.externalSigner.setNetwork(detectedNetwork);
                    }
                }
            }
            catch (error) {
                console.error('[ERROR] Error checking session network:', error.message);
            }
        }
        this.externalSigner.setNodeUrl(url);
    }
    /**
     * Internal method called by Polymesh SDK patch
     */
    __pocketRegisterSdk(sdk) {
        this.sdk = sdk;
    }
    async reconnectSession() {
        console.log(`Need to reconnect wallet for ${this.currentNetwork}. Generating new QR code for existing session...`);
        try {
            await (0, utils_1.call)('create_session', {
                session_id: this.sid,
                origin_hash: 'cli',
                network: this.currentNetwork
            });
            this.sessionCreated = true;
        }
        catch (error) {
            console.error('Error recreating session:', error.message);
        }
        (0, utils_1.generateQRCode)(this.appName, this.sid, this.currentNetwork);
    }
    async bootstrap() {
        try {
            await (0, utils_1.call)('create_session', {
                session_id: this.sid,
                origin_hash: 'cli',
                network: this.currentNetwork
            });
            this.sessionCreated = true;
            (0, utils_1.generateQRCode)(this.appName, this.sid, this.currentNetwork);
        }
        catch (error) {
            console.error('Error bootstrapping session:', error.message);
            throw error;
        }
    }
    async waitForConnection() {
        console.log(`⌛ waiting for ${this.currentNetwork} wallet approval …`);
        const started = Date.now();
        let cancelled = false;
        const handleCancel = () => { cancelled = true; };
        document.body.addEventListener('pocket-connection-cancelled', handleCancel);
        try {
            while (Date.now() - started < utils_1.TIMEOUT) {
                if (cancelled) {
                    throw new Error('User cancelled the connection process.');
                }
                try {
                    const resp = await (0, utils_1.call)('get_session', { session_id: this.sid });
                    if (resp.session) {
                        const row = (0, utils_1.parseSessionRow)(resp.session);
                        if (row.status === 'connected') {
                            let networkWallets = [];
                            let walletField;
                            if (this.currentNetwork === 'testnet') {
                                networkWallets = Array.isArray(row.testnet_wallets) ? row.testnet_wallets : [];
                                walletField = 'testnet_wallets';
                            }
                            else {
                                networkWallets = Array.isArray(row.mainnet_wallets) ? row.mainnet_wallets : [];
                                walletField = 'mainnet_wallets';
                            }
                            if (!networkWallets.length && Array.isArray(row.wallets) && row.wallets.length) {
                                networkWallets = row.wallets;
                                await (0, utils_1.call)('update_session', {
                                    session_id: this.sid,
                                    [walletField]: networkWallets
                                });
                            }
                            if (networkWallets.length) {
                                this.wallets = networkWallets;
                                console.log(`✅ ${this.currentNetwork} wallet connected:`, this.wallets);
                                (0, utils_1.storeSession)(this.sid, this.appName, this.currentNetwork);
                                // Dispatch a success event so the UI can react.
                                document.body.dispatchEvent(new CustomEvent('pocket-connection-success'));
                                return;
                            }
                        }
                    }
                }
                catch (error) {
                    console.error('Error polling for connection:', error.message);
                }
                await (0, utils_1.sleep)(utils_1.POLL);
            }
            throw new Error(`Pairing timeout – user did not approve ${this.currentNetwork} wallet`);
        }
        finally {
            // IMPORTANT: Clean up the event listener to prevent memory leaks
            document.body.removeEventListener('pocket-connection-cancelled', handleCancel);
        }
    }
}
exports.PocketSigningManager = PocketSigningManager;
//# sourceMappingURL=pocket-signing-manager.js.map