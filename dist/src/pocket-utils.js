import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { ApiPromise, WsProvider } from '@polkadot/api';
import fetch from 'cross-fetch';
const RELAY = 'https://3stars.haus/PolymeshPocket.php';
/**
 * Changes the SS58 format of an address
 *
 * @param address - The address to reformat
 * @param ss58Format - The SS58 format to use
 * @returns The reformatted address
 */
export function changeAddressFormat(address, ss58Format) {
    return encodeAddress(decodeAddress(address), ss58Format);
}
/**
 * Creates a shortened representation of an address
 *
 * @param address - The address to shorten
 * @param chars - Number of characters to keep at each end
 * @returns The shortened address
 */
export function shortAddress(address, chars = 6) {
    return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
/**
 * Pings the relay server to check latency
 *
 * @returns The latency in milliseconds
 */
export async function relayPing() {
    const t0 = Date.now();
    try {
        await fetch(`${RELAY}?endpoint=ping`);
        return Date.now() - t0;
    }
    catch (error) {
        console.error('Relay ping failed:', error.message);
        return -1;
    }
}
// Cache for API instances to avoid redundant connections
const apiCache = {};
/**
 * Gets an API instance for the specified node URL
 *
 * @param nodeUrl - The WebSocket URL of the Polymesh node
 * @returns An ApiPromise instance
 */
export async function getPolymeshApi(nodeUrl) {
    if (!apiCache[nodeUrl]) {
        const provider = new WsProvider(nodeUrl);
        apiCache[nodeUrl] = await ApiPromise.create({ provider });
    }
    return apiCache[nodeUrl];
}
/**
 * Decodes a payload to extract its human-readable details
 *
 * @param registry - TypeRegistry instance
 * @param payloadHex - The payload in hex format
 * @returns Decoded transaction details
 */
export function decodePayload(registry, payloadHex) {
    try {
        const payload = registry.createType('ExtrinsicPayload', payloadHex);
        const methodBytes = payload.method.toU8a();
        const method = registry.createType('Call', methodBytes);
        const { section, method: methodName } = registry.findMetaCall(method.callIndex);
        return {
            section,
            method: methodName,
            args: method.args.map((arg, i) => {
                const argDef = registry.findMetaCall(method.callIndex).args[i];
                return {
                    // Fix for the name property - use string instead of accessing name property
                    name: argDef.toString(), // Fixed: removed .name
                    value: arg.toHuman()
                };
            }),
            tip: payload.tip.toHuman(),
            era: payload.era.toHuman(),
            nonce: payload.nonce.toNumber(),
            specVersion: payload.specVersion.toNumber(),
            raw: method.toHuman()
        };
    }
    catch (error) {
        console.error('Failed to decode payload:', error.message);
        return {
            section: 'unknown',
            method: 'unknown',
            args: [],
            tip: '0',
            era: null,
            nonce: 0,
            specVersion: 0,
            raw: null
        };
    }
}
/**
 * Estimates the fee for a transaction
 *
 * @param api - ApiPromise instance
 * @param payloadHex - The payload in hex format
 * @returns The estimated fee as a human-readable string
 */
export async function estimateFee(api, payloadHex) {
    try {
        // Fix the queryInfo call to match the API
        const info = await api.rpc.payment.queryInfo(payloadHex); // Removed second parameter
        const feeHuman = api.createType('Balance', info.partialFee).toHuman();
        // Ensure we return a string
        return typeof feeHuman === 'string' ? feeHuman : String(feeHuman);
    }
    catch (error) {
        console.error('Fee estimation failed:', error.message);
        return 'Unknown';
    }
}
