// Fast static check: every module parses, and every relative import points at an existing file.
// Linking (exported names, load order) is covered by `npm run test:browser`.
import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function* walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(path);
        else if (entry.name.endsWith('.js')) yield path;
    }
}

let failures = 0, files = 0;
for await (const file of walk(join(ROOT, 'src'))) {
    files++;
    const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (syntax.status !== 0) { failures++; console.error(syntax.stderr.trim()); }
    const source = await readFile(file, 'utf8');
    for (const [, spec] of source.matchAll(/^import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
        try { await access(resolve(dirname(file), spec)); }
        catch { failures++; console.error(`${relative(ROOT, file)}: unresolved import '${spec}'`); }
    }
}
console.log(`${files} modules checked, ${failures} problem(s)`);
process.exit(failures ? 1 : 0);
