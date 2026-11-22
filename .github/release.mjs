#!/usr/bin/env node
// Readies this package for npm, after its build (.github/workflows/release.yml runs it):
//   1. the version: package.json's when npm does not have it yet, else the next patch above npm's newest;
//   2. the other Pigeon packages it depends on, pinned here to GitHub commits, as their npm versions
//      (so `npm install <this>` installs from npm, not GitHub).
// Writes package.json and prints `version=<v>` and `bumped=<true|false>` for $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const PIGEON = ['unsea', 'pigeonidp', 'freertc', 'peerpigeon'];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const npmView = (spec, field) => {
  try { return JSON.parse(execFileSync('npm', ['view', spec, field, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || 'null'); }
  catch { return null; }
};
const parse = (v) => v.split('-')[0].split('.').map(Number);
const newer = (a, b) => { const [x, y] = [parse(a), parse(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

// 1. The version.
const published = [].concat(npmView(pkg.name, 'versions') ?? []);
let version = pkg.version;
let bumped = false;
if (published.includes(version)) {
  const top = published.filter((v) => !v.includes('-')).reduce((a, b) => (newer(b, a) ? b : a), version);
  const [maj, min, pat] = parse(newer(top, version) ? top : version);
  version = `${maj}.${min}.${pat + 1}`;
  bumped = true;
}
pkg.version = version;

// 2. Pigeon dependencies pinned to GitHub: their npm versions instead.
const pinned = (spec) => typeof spec === 'string' && !/^[\^~]?\d|^\*$|^latest$|^npm:/.test(spec);
for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
  for (const name of PIGEON) {
    const spec = pkg[section]?.[name];
    if (!pinned(spec)) continue;
    const latest = npmView(name, 'version');
    if (!latest) throw new Error(`${name} is not on npm: publish it first (it is a ${section} of ${pkg.name})`);
    pkg[section][name] = `^${latest}`;
    console.log(`${section}.${name}: ${spec} -> ^${latest}`);
  }
}

writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`${pkg.name}@${version}${bumped ? ' (next patch: the version in package.json is already on npm)' : ''}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nbumped=${bumped}\n`);
