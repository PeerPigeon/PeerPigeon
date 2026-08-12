import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const packageRoots = [projectRoot, path.join(projectRoot, 'examples/vue3')];
const repositoryUrl = 'https://github.com/draeder/freertc.git';
const resolveTimeoutMs = 15_000;
const installTimeoutMs = 90_000;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolvedCommit(lock, packageName) {
  const resolved = lock?.packages?.[`node_modules/${packageName}`]?.resolved;
  return typeof resolved === 'string' ? resolved.split('#').at(-1) : null;
}

function packageIsPinned(packageRoot, dependencySpec, commit) {
  const manifestPath = path.join(packageRoot, 'package.json');
  const lockPath = path.join(packageRoot, 'package-lock.json');
  const installedLockPath = path.join(packageRoot, 'node_modules/.package-lock.json');
  const installedManifestPath = path.join(packageRoot, 'node_modules/freertc/package.json');

  if (![manifestPath, lockPath, installedLockPath, installedManifestPath].every(existsSync)) {
    return false;
  }

  const manifest = readJson(manifestPath);
  const lock = readJson(lockPath);
  const installedLock = readJson(installedLockPath);

  return manifest.dependencies?.freertc === dependencySpec
    && resolvedCommit(lock, 'freertc') === commit
    && resolvedCommit(installedLock, 'freertc') === commit;
}

let remoteHead = '';
try {
  remoteHead = execFileSync('git', [
    '-c',
    'credential.interactive=never',
    'ls-remote',
    repositoryUrl,
    'HEAD'
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: resolveTimeoutMs,
    killSignal: 'SIGKILL',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    }
  }).trim();
} catch (error) {
  const timedOut = error?.code === 'ETIMEDOUT' || error?.signal === 'SIGKILL';
  throw new Error(
    timedOut
      ? `Timed out after ${resolveTimeoutMs / 1000}s resolving FreeRTC GitHub HEAD`
      : `Failed to resolve FreeRTC GitHub HEAD: ${error?.message || error}`
  );
}
const commit = remoteHead.split(/\s+/)[0];

if (!/^[a-f0-9]{40}$/i.test(commit)) {
  throw new Error(`Could not resolve a valid FreeRTC HEAD from: ${remoteHead || '(empty response)'}`);
}

// Use the explicit HTTPS form so machines without GitHub SSH credentials do
// not stall on an SSH authentication prompt.
const dependencySpec = `git+https://github.com/draeder/freertc.git#${commit}`;

for (const packageRoot of packageRoots) {
  const label = path.relative(projectRoot, packageRoot) || '.';
  if (packageIsPinned(packageRoot, dependencySpec, commit)) {
    console.log(`FreeRTC ${commit.slice(0, 12)} already pinned in ${label}`);
    continue;
  }

  console.log(`Pinning FreeRTC HEAD ${commit} in ${label}`);
  try {
    execFileSync('npm', [
      'install',
      '--save-exact',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--fetch-retries=1',
      '--fetch-retry-mintimeout=1000',
      '--fetch-retry-maxtimeout=5000',
      '--fetch-timeout=30000',
      `freertc@${dependencySpec}`
    ], {
      cwd: packageRoot,
      stdio: 'inherit',
      timeout: installTimeoutMs,
      killSignal: 'SIGKILL',
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });
  } catch (error) {
    const timedOut = error?.code === 'ETIMEDOUT' || error?.signal === 'SIGKILL';
    throw new Error(
      timedOut
        ? `Timed out after ${installTimeoutMs / 1000}s installing FreeRTC in ${label}`
        : `Failed to install FreeRTC in ${label}: ${error?.message || error}`
    );
  }
}

console.log(`FreeRTC HEAD pinned at ${commit}`);
