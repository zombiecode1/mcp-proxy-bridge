import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ID_PATH = path.resolve(__dirname, '../../identity.json');

let _identity: any = null;
let _hash: string | null = null;

export function loadIdentity(): any {
    if (_identity) return _identity;
    try {
        const raw = fs.readFileSync(ID_PATH, 'utf8');
        _identity = JSON.parse(raw);
        _hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

        // Try to set file to read-only to help make it immutable.
        try {
            fs.chmodSync(ID_PATH, 0o444);
        } catch (e: any) {
            // Not fatal; on some platforms this may be a no-op.
            console.warn('identityService: could not set identity.json read-only:', e?.message || e);
        }

        return _identity;
    } catch (err: any) {
        console.error('identityService: failed to load identity.json:', err?.message || err);
        _identity = null;
        _hash = null;
        return null;
    }
}

export function getIdentity(): any {
    if (!_identity) return loadIdentity();
    return _identity;
}

export function getIdentityHash(): string | null {
    if (!_hash) loadIdentity();
    return _hash;
}

export default {
    loadIdentity,
    getIdentity,
    getIdentityHash,
};
