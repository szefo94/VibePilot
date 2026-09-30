// Where players connect from, for the server log: their IP address and a rough location (city, country, network).
//
// The location comes from ip-api.com (free, no key, up to 45 lookups a minute; its free tier is plain HTTP), so
// each new public IP is sent to that service once and cached for the server's lifetime. Local-network addresses
// are never looked up. Start the server with --no-geo to keep IPs to yourself.

/** The client's IP: the socket's, or behind a reverse proxy / tunnel (trustProxy) the one it forwards. */
export function clientIp(req, trustProxy = false) {
    const forwarded = trustProxy && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim());
    const ip = forwarded || req.socket.remoteAddress || '?';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4 seen through an IPv6 socket
}

/** Loopback, private, link-local and carrier-grade NAT ranges: nothing to look up. */
export function isPrivateIp(ip) {
    if (ip === '::1' || ip === '?' || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip)) return true;
    const [a, b] = ip.split('.').map(Number);
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

const cache = new Map(); // ip → Promise<string>

/** "City, Region, Country · network" for a public IP ("local network" for private ones); cached, never rejects. */
export function locate(ip) {
    if (isPrivateIp(ip)) return Promise.resolve('local network');
    if (!cache.has(ip)) cache.set(ip, lookup(ip));
    return cache.get(ip);
}

async function lookup(ip) {
    try {
        const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,isp`, { signal: AbortSignal.timeout(4000) });
        const d = await res.json();
        if (d.status !== 'success') return `location unknown (${d.message ?? res.status})`;
        const place = [d.city, d.regionName, d.country].filter((v, i, all) => v && all.indexOf(v) === i).join(', ');
        return d.isp ? `${place} · ${d.isp}` : place;
    } catch (e) {
        cache.delete(ip); // try again next time
        return `location unknown (${e.name === 'TimeoutError' ? 'lookup timed out' : e.message})`;
    }
}
