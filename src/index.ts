/* istanbul ignore file */

export { PocketSigningManager, PocketSigner } from './lib/pocket-signing-manager';
export * from './types';
export * from './utils';

// Polymesh SDK patch for auto-initialization
import { Polymesh } from '@polymeshassociation/polymesh-sdk';

const _origConnect = Polymesh.connect.bind(Polymesh);

if (!(Polymesh as any)._pocketPatched) {
  (Polymesh as any)._pocketPatched = true;

  Polymesh.connect = async function (opts: any) {
    const sm = opts?.signingManager;
    if (sm && typeof sm.__pocketSetNodeUrl === 'function' && opts?.nodeUrl) {
      await sm.__pocketSetNodeUrl(opts.nodeUrl);
    }
  
    const sdk = await _origConnect(opts);
  
    if (sm && typeof sm.__pocketRegisterSdk === 'function') {
      sm.__pocketRegisterSdk(sdk);
    }
    return sdk;
  };
}