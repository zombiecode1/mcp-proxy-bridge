import { Request, Response, NextFunction } from 'express';
import { getIdentity, getIdentityHash } from '../services/identityService';

export function identityMiddleware(req: Request, res: Response, next: NextFunction) {
    try {
        const identity = getIdentity();
        const idHash = getIdentityHash();

        // Required custom header per identity protocol
        res.setHeader('X-Powered-By', 'ZombieCoder-by-SahonSrabon');

        if (identity && identity.system_identity) {
            const id = identity.system_identity;
            if (id.version) res.setHeader('X-Identity-Version', String(id.version));
            if (id.name) res.setHeader('X-Identity-Name', String(id.name));
        }

        if (idHash) {
            res.setHeader('X-Identity-Hash', idHash);
        }
    } catch (e) {
        // don't fail requests if header injection fails
        // eslint-disable-next-line no-console
        console.warn('identityMiddleware error:', (e as any)?.message || e);
    }

    next();
}

export default identityMiddleware;
