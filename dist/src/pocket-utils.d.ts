import { HexString } from '@polkadot/util/types';
import { TypeRegistry } from '@polkadot/types';
import { ApiPromise } from '@polkadot/api';
/**
 * Changes the SS58 format of an address
 *
 * @param address - The address to reformat
 * @param ss58Format - The SS58 format to use
 * @returns The reformatted address
 */
export declare function changeAddressFormat(address: string, ss58Format: number): string;
/**
 * Creates a shortened representation of an address
 *
 * @param address - The address to shorten
 * @param chars - Number of characters to keep at each end
 * @returns The shortened address
 */
export declare function shortAddress(address: string, chars?: number): string;
/**
 * Pings the relay server to check latency
 *
 * @returns The latency in milliseconds
 */
export declare function relayPing(): Promise<number>;
/**
 * Gets an API instance for the specified node URL
 *
 * @param nodeUrl - The WebSocket URL of the Polymesh node
 * @returns An ApiPromise instance
 */
export declare function getPolymeshApi(nodeUrl: string): Promise<ApiPromise>;
/**
 * Decodes a payload to extract its human-readable details
 *
 * @param registry - TypeRegistry instance
 * @param payloadHex - The payload in hex format
 * @returns Decoded transaction details
 */
export declare function decodePayload(registry: TypeRegistry, payloadHex: HexString): {
    section: string;
    method: string;
    args: {
        name: string;
        value: import("@polkadot/types-codec/types").AnyJson;
    }[];
    tip: import("@polkadot/types-codec/types").AnyJson;
    era: import("@polkadot/types-codec/types").AnyJson;
    nonce: number;
    specVersion: number;
    raw: Record<string, import("@polkadot/types-codec/types").AnyJson>;
} | {
    section: string;
    method: string;
    args: never[];
    tip: string;
    era: null;
    nonce: number;
    specVersion: number;
    raw: null;
};
/**
 * Estimates the fee for a transaction
 *
 * @param api - ApiPromise instance
 * @param payloadHex - The payload in hex format
 * @returns The estimated fee as a human-readable string
 */
export declare function estimateFee(api: ApiPromise, payloadHex: HexString): Promise<string>;
