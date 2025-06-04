import { TypeRegistry } from '@polkadot/types';
import { PolkadotSigner, SigningManager } from '@polymeshassociation/signing-manager-types';
import { SignerPayloadJSON, SignerPayloadRaw, SignerResult } from '@polkadot/types/types';
/********************************************************************/
/********************************************************************/
import { Polymesh } from '@polymeshassociation/polymesh-sdk';
export interface SessionRow {
    session_id: string;
    origin_hash: string;
    network: string;
    status: string;
    wallets?: string[];
    testnet_wallets?: string[];
    mainnet_wallets?: string[];
    created_at: string;
    updated_at: string;
}
export interface SigningRequestRow {
    req_id: string;
    session_id: string;
    payload_hex: string;
    address: string;
    node_url?: string;
    network: string;
    status: string;
    signature_hex?: string;
    created_at: string;
    updated_at: string;
}
export interface SessionResponse {
    success: boolean;
    session: SessionRow;
    signing_requests: SigningRequestRow[];
}
export interface PendingRequestsResponse {
    success: boolean;
    pending_requests: SigningRequestRow[];
}
export interface RequestHistoryResponse {
    success: boolean;
    request_history: SigningRequestRow[];
}
export declare class PocketSigner implements PolkadotSigner {
    private readonly sid;
    private readonly registry;
    private currentId;
    private pendingRequests;
    private pollingActive;
    private lastCheckTimestamp;
    private processedSignatures;
    private nodeUrl?;
    private network;
    setNodeUrl(url: string): void;
    setNetwork(network: string): void;
    constructor(sid: string, registry: TypeRegistry);
    signPayload(payload: SignerPayloadJSON): Promise<SignerResult>;
    signRaw(raw: SignerPayloadRaw): Promise<SignerResult>;
    private ensurePollingActive;
    private waitForSignature;
    private checkHistoryForSignature;
    private pollForSignature;
    private startPolling;
}
export declare class PocketSigningManager implements SigningManager {
    private readonly appName;
    private sid;
    private wallets;
    private externalSigner;
    private ss58?;
    private sessionCreated;
    private currentNetwork;
    private sdk?;
    private autoStarted;
    private nodeUrl?;
    setNetwork(network: string): void;
    __pocketSetNodeUrl(url: string): Promise<void>;
    __pocketRegisterSdk(sdk: Polymesh): void;
    private startAutoRotate;
    constructor(appName: string);
    setSs58Format(f: number): void;
    private ss58OrThrow;
    getAccounts(): Promise<string[]>;
    getExternalSigner(): PocketSigner;
    getLocalKeys(): Promise<{
        name: string;
        publicKey: string;
        address: string;
    }[]>;
    private reconnectSession;
    private bootstrap;
    private waitForConnection;
}
