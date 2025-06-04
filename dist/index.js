"use strict";
/* istanbul ignore file */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PocketSigner = exports.PocketSigningManager = void 0;
var pocket_signing_manager_1 = require("./lib/pocket-signing-manager");
Object.defineProperty(exports, "PocketSigningManager", { enumerable: true, get: function () { return pocket_signing_manager_1.PocketSigningManager; } });
Object.defineProperty(exports, "PocketSigner", { enumerable: true, get: function () { return pocket_signing_manager_1.PocketSigner; } });
__exportStar(require("./types"), exports);
__exportStar(require("./utils"), exports);
// Polymesh SDK patch for auto-initialization
const polymesh_sdk_1 = require("@polymeshassociation/polymesh-sdk");
const _origConnect = polymesh_sdk_1.Polymesh.connect.bind(polymesh_sdk_1.Polymesh);
if (!polymesh_sdk_1.Polymesh._pocketPatched) {
    polymesh_sdk_1.Polymesh._pocketPatched = true;
    polymesh_sdk_1.Polymesh.connect = async function (opts) {
        const sm = opts === null || opts === void 0 ? void 0 : opts.signingManager;
        if (sm && typeof sm.__pocketSetNodeUrl === 'function' && (opts === null || opts === void 0 ? void 0 : opts.nodeUrl)) {
            await sm.__pocketSetNodeUrl(opts.nodeUrl);
        }
        const sdk = await _origConnect(opts);
        if (sm && typeof sm.__pocketRegisterSdk === 'function') {
            sm.__pocketRegisterSdk(sdk);
        }
        return sdk;
    };
}
//# sourceMappingURL=index.js.map