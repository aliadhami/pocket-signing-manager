import { TypeRegistry } from '@polkadot/types';
import { PolkadotSigner, SigningManager } from '@polymeshassociation/signing-manager-types';
import { SignerPayloadJSON, SignerPayloadRaw, SignerResult } from '@polkadot/types/types';
import { Polymesh } from '@polymeshassociation/polymesh-sdk';
/**
 * Polkadot JS compatible signer for Pocket Wallet
 */
export declare class PocketSigner implements PolkadotSigner {
    private readonly sid;
    private readonly registry;
    private currentId;
    private pendingRequests;
    private pollingActive;
    private processedSignatures;
    private nodeUrl?;
    private network;
    constructor(sid: string, registry: TypeRegistry);
    setNodeUrl(url: string): void;
    setNetwork(network: string): void;
    signPayload(payload: SignerPayloadJSON): Promise<SignerResult>;
    signRaw(raw: SignerPayloadRaw): Promise<SignerResult>;
    private ensurePollingActive;
    private waitForSignature;
    private checkHistoryForSignature;
    private startPolling;
}
/**
 * Main Pocket Signing Manager
 */
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
    /**
     * Create a Pocket Signing Manager
     * * @param appName - name of the application
     * @param args.network - network to use ('testnet' or 'mainnet')
     * @param args.ss58Format - SS58 format for addresses
     */
    static create(args: {
        appName: string;
        network?: string;
        ss58Format?: number;
    }): Promise<PocketSigningManager>;
    constructor(appName: string);
    setNetwork(network: string): void;
    setSs58Format(f: number): void;
    private ss58OrThrow;
    getAccounts(): Promise<string[]>;
    getExternalSigner(): PocketSigner;
    getLocalKeys(): Promise<{
        name: string;
        publicKey: string;
        address: string;
    }[]>;
    /**
     * Internal method called by Polymesh SDK patch
     */
    __pocketSetNodeUrl(url: string): Promise<void>;
    /**
     * Internal method called by Polymesh SDK patch
     */
    __pocketRegisterSdk(sdk: Polymesh): void;
    private reconnectSession;
    private bootstrap;
    private waitForConnection;
}
//# sourceMappingURL=pocket-signing-manager.d.ts.map