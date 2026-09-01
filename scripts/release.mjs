import { createHash } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: options.encoding ?? 'utf8', maxBuffer: 100 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
};

const dirty = run('git', ['status', '--porcelain=v1', '--untracked-files=all'])
  .split(/\r?\n/)
  .filter(Boolean)
  // Các thư mục công cụ cục bộ này bị loại khỏi ZIP theo thiết kế; chúng không
  // được phép buộc người phát hành xóa phiên làm việc chỉ để đóng gói HEAD.
  .filter((line) => {
    const path = line.slice(3).replace(/\\/g, '/');
    return !path.startsWith('.agents/') && !path.startsWith('scratchpad/');
  });
if (dirty.length > 0) throw new Error(`Working tree has unreleased changes:\n${dirty.join('\n')}`);

const commit = run('git', ['rev-parse', 'HEAD']).trim();
const short = commit.slice(0, 12);
const files = run('git', ['ls-tree', '-r', '--name-only', 'HEAD']).split(/\r?\n/).filter(Boolean);
const forbiddenPaths = /(^|\/)(\.env|backups?|database|scratchpad|sessions?)(\/|$)/i;
const secretPatterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/\b\d{7,12}:[A-Za-z0-9_-]{30,50}\b/, 'Telegram bot token'],
  [/\b(?:sk-ant-|sk-proj-|sk-live-)[A-Za-z0-9_-]{20,}\b/, 'API key'],
  [new RegExp(`\\b${['cattshop', 'site'].join('\\.')}\\b`, 'i'), 'production domain'],
  [new RegExp(`\\b${['100', '74', '131', '110'].join('\\.')}\\b`), 'production host'],
  [new RegExp(`\\b${['riviu', '123'].join('')}\\b`, 'i'), 'production credential'],
];

const entries = [];
for (const path of files) {
  if (forbiddenPaths.test(path) && !path.endsWith('.env.example') && path !== '.env.docker.example') throw new Error(`Forbidden release path: ${path}`);
  const bytes = run('git', ['show', `HEAD:${path}`], { encoding: 'buffer' });
  if (!Buffer.isBuffer(bytes)) throw new Error(`Could not read ${path} as bytes.`);
  if (!bytes.includes(0)) {
    const text = bytes.toString('utf8');
    for (const [pattern, label] of secretPatterns) if (pattern.test(text)) throw new Error(`Secret scan found ${label} in ${path}.`);
  }
  entries.push({ path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') });
}

const manifest = [
  '# Digital Store release manifest',
  `commit ${commit}`,
  `createdAt ${new Date().toISOString()}`,
  '',
  ...entries.map((entry) => `${entry.sha256}  ${entry.path}`),
  '',
].join('\n');

await mkdir('dist', { recursive: true });
const target = `dist/digital-store-${short}.zip`;
await rm(target, { force: true });
const output = createWriteStream(target, { mode: 0o600 });
const archive = archiver('zip', { zlib: { level: 9 } });
const completed = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); });
archive.pipe(output);
for (const entry of entries) {
  const modeText = run('git', ['ls-tree', 'HEAD', entry.path]).slice(0, 6);
  archive.append(entry.bytes, { name: entry.path, mode: modeText === '100755' ? 0o755 : 0o644 });
}
archive.append(manifest, { name: 'RELEASE-MANIFEST.sha256', mode: 0o644 });
await archive.finalize();
await completed;
console.log(`${target}\ncommit=${commit}\nfiles=${entries.length + 1}\nbytes=${archive.pointer()}`);
