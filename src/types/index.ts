import { HexString } from '@polkadot/util/types';

export type UnsubCallback = () => void;

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

export interface SignatureRequest {
  req_id: string;
  timestamp: number;
  resolve: (signature: HexString) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  resolved: boolean;
}

export interface StoredSession {
  sid: string;
  appName: string;
  network?: string;
}