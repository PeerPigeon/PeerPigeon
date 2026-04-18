#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
  const args = {
    runs: Number(process.env.E2E_RUNS ?? 5),
    timeoutMs: Number(process.env.E2E_TIMEOUT_MS ?? 45_000),
    maxRunSeconds: Number.isFinite(Number(process.env.E2E_MAX_RUN_SECONDS))
      ? Number(process.env.E2E_MAX_RUN_SECONDS)
      : undefined,
    spec: process.env.E2E_SPEC ?? 'tests/vue3-15-peers-crossbrowser.spec.ts',
    reporter: process.env.E2E_REPORTER ?? 'dot'
  };

  for (let i = 0; i < argv.length; i += 1) {
    let a = argv[i];
    let inlineValue;

    if (typeof a === 'string' && a.includes('=')) {
      const idx = a.indexOf('=');
      inlineValue = a.slice(idx + 1);
      a = a.slice(0, idx);
    }

    if (a === '--runs') {
      args.runs = Number(inlineValue ?? argv[++i]);
      continue;
    }

    if (a === '--timeoutMs') {
      args.timeoutMs = Number(inlineValue ?? argv[++i]);
      continue;
    }

    if (a === '--timeoutSeconds' || a === '--timeoutSec') {
      args.timeoutMs = Math.round(Number(inlineValue ?? argv[++i]) * 1000);
      continue;
    }

    if (a === '--maxRunSeconds') {
      args.maxRunSeconds = Number(inlineValue ?? argv[++i]);
      continue;
    }

    if (a === '--spec') {
      args.spec = inlineValue ?? argv[++i];
      continue;
    }

    if (a === '--reporter') {
      args.reporter = inlineValue ?? argv[++i];
      continue;
    }

    if (a === '--help' || a === '-h') {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown arg: ${a}`);
  }

  return args;
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) return 'n/a';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function extractFailureHint(output) {
  const lines = output.split(/\r?\n/);

  // Prefer the first explicit FAIL line if present.
  const failLine = lines.find((l) => /^\s*\d+\)\s+/.test(l)) || lines.find((l) => /\bFAIL\b/.test(l));
  if (failLine) return failLine.trim();

  // Otherwise fall back to the last non-empty line.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i]?.trim();
    if (l) return l;
  }

  return '';
}

async function runOnce({ runIndex, spec, timeoutMs, reporter, maxRunSeconds }) {
  const args = ['playwright', 'test', '--timeout', String(timeoutMs), '--reporter', reporter];
  if (spec) args.push(spec);

  const start = performance.now();

  return await new Promise((resolve) => {
    const child = spawn('npx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;

    const killTimer =
      Number.isFinite(maxRunSeconds) && maxRunSeconds > 0
        ? setTimeout(() => {
            killedForTimeout = true;
            child.kill('SIGKILL');
          }, maxRunSeconds * 1000)
        : undefined;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code, signal) => {
      if (killTimer) clearTimeout(killTimer);

      const durationMs = performance.now() - start;
      const passed = code === 0 && !killedForTimeout;

      resolve({
        runIndex,
        passed,
        exitCode: code,
        signal,
        killedForTimeout,
        durationMs,
        hint: passed ? '' : extractFailureHint(`${stdout}\n${stderr}`)
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !Number.isFinite(args.runs) || args.runs <= 0) {
    console.log(
      `Usage: node scripts/run-e2e-loop.mjs [--spec tests/your.spec.ts] [--runs 5] [--timeoutMs 15000] [--timeoutSeconds 15] [--reporter dot] [--maxRunSeconds 90]\n` +
        `Env vars: E2E_SPEC, E2E_RUNS, E2E_TIMEOUT_MS, E2E_REPORTER, E2E_MAX_RUN_SECONDS\n`
    );
    process.exit(args.help ? 0 : 2);
  }

  const results = [];

  for (let i = 1; i <= args.runs; i += 1) {
    console.log(`\n===== RUN ${i}/${args.runs} (timeout=${formatMs(args.timeoutMs)}) =====`);

    // eslint-disable-next-line no-await-in-loop
    const result = await runOnce({
      runIndex: i,
      spec: args.spec,
      timeoutMs: args.timeoutMs,
      reporter: args.reporter,
      maxRunSeconds: args.maxRunSeconds
    });

    results.push(result);
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  console.log('\n===== SUMMARY =====');
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const meta = r.killedForTimeout
      ? `killed (>${args.maxRunSeconds}s)`
      : r.signal
        ? `signal=${r.signal}`
        : `exit=${r.exitCode}`;

    const hint = r.passed ? '' : r.hint ? ` | ${r.hint}` : '';
    console.log(`Run ${String(r.runIndex).padStart(2, '0')}: ${status} (${formatMs(r.durationMs)}, ${meta})${hint}`);
  }

  console.log(`\nTotal: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);

  process.exit(failedCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
