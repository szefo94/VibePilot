// Minimal static file server for local play and the browser tests.
// ES modules must be served over HTTP with a JavaScript MIME type (file:// does not work).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
};

/** Serve `root` (default: the project root); resolves with the listening http.Server. */
export function startServer(port = 8000, host = '127.0.0.1', root = ROOT) {
    const server = createServer(async (req, res) => {
        try {
            let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            if (path.endsWith('/')) path += 'index.html';
            const file = normalize(join(root, path));
            if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
            if (!(await stat(file)).isFile()) throw new Error('not a file');
            res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(await readFile(file));
        } catch {
            res.writeHead(404).end('Not found');
        }
    });
    return new Promise((done, fail) => { server.once('error', fail); server.listen(port, host, () => done(server)); });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT) || 8000;
    await startServer(port);
    console.log(`VibePilot running at http://localhost:${port}/`);
}
