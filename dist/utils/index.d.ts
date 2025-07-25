import { SessionRow, StoredSession } from '../types';
export declare const RELAY = "https://bubbleblock.io/PolymeshPocket.php";
export declare const POLL = 2000;
export declare const TIMEOUT: number;
export declare const STORE_FILE = "pocket-signing-manager-store.txt";
/**
 * POST wrapper for API calls
 */
export declare function call<T = any>(endpoint: string, body: Record<string, unknown>): Promise<T>;
/**
 * Sleep utility
 */
export declare function sleep(ms: number): Promise<void>;
/**
 * Store session info - works in both Node.js and browser
 */
export declare function storeSession(sid: string, appName: string, network?: string): void;
/**
 * Load stored session - works in both Node.js and browser
 */
export declare function loadStoredSession(): StoredSession | null;
/**
 * Parse session row from API response
 */
export declare function parseSessionRow(row: any): SessionRow;
/**
 * Generate and display QR code - works in both environments
 */
export declare function generateQRCode(appName: string, sid: string, network: string): Promise<void>;
/**
 * Shows a non-closable popup to instruct the user to check their wallet for a signature request.
 */
export declare function showSigningPopup(): void;
/**
 * Hides the signing popup with a fade-out animation.
 */
export declare function hideSigningPopup(): void;
//# sourceMappingURL=index.d.ts.map