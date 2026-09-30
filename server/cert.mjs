// Self-signed TLS certificate for `mp-server --tls` (see docs/multiplayer/server-hosting-quick-start.md).
//
// Browsers show a one-time "not private" warning for it (choose Advanced → Proceed); after that the page and its
// wss:// connection work. The certificate is generated once and reused, so the warning doesn't return on every
// restart. It is regenerated when it expires or when a new host name / IP is requested.
// Stored outside the repo: ~/.vibepilot/certs/{cert.pem,key.pem,hosts.json}
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { isIP } from 'node:net';
import selfsigned from 'selfsigned';

export const CERT_DIR = join(homedir(), '.vibepilot', 'certs');
const VALID_DAYS = 365;

/** Every name this machine is reached by: localhost, loopback, LAN IPv4s, plus `extra` (e.g. the public IP). */
export function certHosts(extra = []) {
    const lan = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    return [...new Set(['localhost', '127.0.0.1', ...lan, ...extra])].sort();
}

/** Returns { cert, key, file, generated } — reusing the stored certificate when it still covers `hosts`. */
export async function ensureSelfSignedCert(hosts) {
    const files = { cert: join(CERT_DIR, 'cert.pem'), key: join(CERT_DIR, 'key.pem'), meta: join(CERT_DIR, 'hosts.json') };
    try {
        const meta = JSON.parse(await readFile(files.meta, 'utf8'));
        if (Date.now() < meta.expires - 7 * 864e5 && hosts.every(h => meta.hosts.includes(h))) {
            return { cert: await readFile(files.cert, 'utf8'), key: await readFile(files.key, 'utf8'), file: files.cert, generated: false };
        }
    } catch { /* none yet, or unreadable: generate */ }
    const notAfterDate = new Date(Date.now() + VALID_DAYS * 864e5);
    const altNames = hosts.map(h => (isIP(h) ? { type: 7, ip: h } : { type: 2, value: h }));
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'VibePilot multiplayer' }], {
        keySize: 2048, algorithm: 'sha256', notAfterDate,
        extensions: [
            { name: 'basicConstraints', cA: false },
            { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
            { name: 'extKeyUsage', serverAuth: true },
            { name: 'subjectAltName', altNames },
        ],
    });
    await mkdir(CERT_DIR, { recursive: true });
    await writeFile(files.cert, pems.cert);
    await writeFile(files.key, pems.private, { mode: 0o600 });
    await writeFile(files.meta, JSON.stringify({ hosts, expires: notAfterDate.getTime() }, null, 2));
    return { cert: pems.cert, key: pems.private, file: files.cert, generated: true };
}
