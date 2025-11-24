#!/usr/bin/env node
/**
 * Sequentially run the cross-browser hub test N times and summarize results.
 * In-place progress now reflects internal test phases for each iteration.
 * Removed JSON file output per user request.
 */
import { spawn } from 'child_process';

const ITERATIONS = parseInt(process.env.CB_ITERATIONS || '5', 10);
const TEST_SCRIPT = 'test/cross-browser-hub-test.js';

const summary = [];

// Phase-driven progress with peer creation sub-fraction
// Each phase contributes 1 unit; peer creation phase has internal fraction peersCreated/totalPeers
const PHASES = [
  { label: 'hubs', re: /Hub 2 started|✅ Hub 2 started/i },
  { label: 'http', re: /HTTP server running/i },
  { label: 'browsers', re: /✅ All browsers launched/i },
  { label: 'peers', re: /All \d+ peers created/i, sub: true },
  { label: 'settle', re: /Short settling window/i },
  { label: 'rescue', re: /Zero-connection rescue pass/i },
  { label: 'assure', re: /Open-channel assurance/i },
  { label: 'topology', re: /Pre-broadcast topology summary/i },
  { label: 'broadcast', re: /Sending broadcast from Peer/i },
  { label: 'results', re: /Broadcast Results:/i },
  { label: 'summary', re: /📊 TEST SUMMARY|TEST SUMMARY/i }
];

function renderProgress(iterIndex, totalIterations, phaseIndex, phaseFraction, completedIterations) {
  const iterDisplay = iterIndex + 1;
  const totalPhases = PHASES.length;
  // Force 100% when on or beyond final phase (iteration summary time)
  const iterFraction = phaseIndex >= totalPhases - 1 ? 1 : (phaseIndex + phaseFraction) / totalPhases;
  const overallFraction = (completedIterations + iterFraction) / totalIterations;
  const barWidth = 30;
  const mkBar = (fraction) => {
    const filled = Math.round(fraction * barWidth);
    return '[' + '#'.repeat(filled) + '-'.repeat(barWidth - filled) + ']';
  };
  const iterBar = mkBar(iterFraction);
  const overallBar = mkBar(overallFraction);
  const phaseLabel = PHASES[Math.min(phaseIndex, totalPhases - 1)].label;
  const line = `Iter ${iterDisplay}/${totalIterations} ${iterBar} ${(iterFraction*100).toFixed(1)}% (${phaseLabel})  Overall ${overallBar} ${(overallFraction*100).toFixed(1)}%`;
  // Ensure residual chars from prior longer line are cleared
  const padded = line.padEnd(renderProgress._prevLen || line.length, ' ');
  process.stdout.write('\r' + padded);
  renderProgress._prevLen = padded.length;
  if (completedIterations === totalIterations && phaseIndex >= totalPhases - 1) process.stdout.write('\n');
}

async function runOnce(iterIndex, completedCount) {
  return new Promise(resolve => {
    console.log(`\n=== Iteration ${iterIndex+1}/${ITERATIONS} START ===`);
    const child = spawn('node', [TEST_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let phaseIndex = 0; // which PHASES matched
    let peersCreated = 0;
    let totalPeers = 0;
    const totalPhases = PHASES.length;

    function updateProgress() {
      let phaseFraction = 0; // sub-fraction inside current phase
      if (PHASES[phaseIndex] && PHASES[phaseIndex].sub && totalPeers > 0) {
        phaseFraction = Math.min(peersCreated / totalPeers, 0.999); // avoid premature 100%
      }
      renderProgress(iterIndex, ITERATIONS, phaseIndex, phaseFraction, completedCount);
    }

    updateProgress(); // initial (phase 0, fraction 0)

    function scanForPhaseAdvancement(text) {
      // Peer creation progress lines (sub-fraction in peers phase)
      const peerProg = text.match(/Progress:\s+(\d+)\/(\d+)\s+peers initialized/i);
      if (peerProg) {
        peersCreated = parseInt(peerProg[1], 10);
        totalPeers = parseInt(peerProg[2], 10);
        updateProgress();
      }
      // Advance at most one phase per chunk (next sequential phase)
      for (let i = phaseIndex + 1; i < totalPhases; i++) {
        if (PHASES[i].re.test(text)) {
          phaseIndex = i;
          updateProgress();
          break; // stop after first match to avoid skipping intermediate progress
        }
      }
    }

    child.stdout.on('data', d => { const t = d.toString(); output += t; scanForPhaseAdvancement(t); });
    child.stderr.on('data', d => { const t = d.toString(); output += t; scanForPhaseAdvancement(t); });

    child.on('close', code => {
      // Force final phase
      phaseIndex = totalPhases - 1;
      updateProgress();
      process.stdout.write('\n');
      const summaryBlockMatch = output.match(/={5,}[\s\S]*?📊 TEST SUMMARY[\s\S]*?={5,}\n/);
      let condensed = summaryBlockMatch ? summaryBlockMatch[0] : 'NO SUMMARY BLOCK FOUND';
      const successMatch = output.match(/Success rate:\s+(\d+\.\d|\d+)%/);
      const senderMatch = output.match(/•\s*Sent by: Peer (\d+) \(([^)]+)\)/);
      const openSummaryMatch = output.match(/Pre-broadcast topology summary:[\s\S]*?Open channels -> min=(\d+) avg=(\d+\.\d+) max=(\d+)/);
      const connectionsSummaryMatch = output.match(/Connections\s+-> min=(\d+) avg=(\d+\.\d+) max=(\d+)/);
      const successRate = successMatch ? parseFloat(successMatch[1]) : null;
      const senderPeer = senderMatch ? `${senderMatch[1]}:${senderMatch[2]}` : 'unknown';
      const minOpen = openSummaryMatch ? parseInt(openSummaryMatch[1],10) : null;
      const avgOpen = openSummaryMatch ? parseFloat(openSummaryMatch[2]) : null;
      const maxOpen = openSummaryMatch ? parseInt(openSummaryMatch[3],10) : null;
      const minConn = connectionsSummaryMatch ? parseInt(connectionsSummaryMatch[1],10) : null;
      const avgConn = connectionsSummaryMatch ? parseFloat(connectionsSummaryMatch[2]) : null;
      const maxConn = connectionsSummaryMatch ? parseInt(connectionsSummaryMatch[3],10) : null;
      summary.push({ iteration: iterIndex+1, successRate, senderPeer, minOpen, avgOpen, maxOpen, minConn, avgConn, maxConn, rawSummaryBlock: condensed.trim() });
      console.log(`Iteration ${iterIndex+1} Summary:`);
      console.log(`  Sender: ${senderPeer}`);
      console.log(`  Success Rate: ${successRate ?? 'NA'}%`);
      console.log(`  Open Channels (min/avg/max): ${minOpen}/${avgOpen}/${maxOpen}`);
      console.log(`  Connections   (min/avg/max): ${minConn}/${avgConn}/${maxConn}`);
      if (code !== 0) console.log(`  Exit code: ${code}`);
      console.log(`=== Iteration ${iterIndex+1} END ===`);
      resolve();
    });
  });
}

async function main() {
  for (let i = 0; i < ITERATIONS; i++) {
    await runOnce(i, i);
  }
  printSummary();
}

function printSummary() {
  console.log('\n===== Final Multi-Run Summary =====');
  summary.forEach(s => {
    console.log(`Iteration ${s.iteration}: success=${s.successRate ?? 'NA'}% sender=${s.senderPeer} open=${s.minOpen}/${s.avgOpen}/${s.maxOpen} conn=${s.minConn}/${s.avgConn}/${s.maxConn}`);
  });
  const allRates = summary.filter(s => typeof s.successRate === 'number').map(s => s.successRate);
  if (allRates.length) {
    const avgRate = (allRates.reduce((a,b)=>a+b,0)/allRates.length).toFixed(2);
    const minRate = Math.min(...allRates).toFixed(2);
    const maxRate = Math.max(...allRates).toFixed(2);
    console.log(`\nAggregate success rate: avg=${avgRate}% min=${minRate}% max=${maxRate}% over ${allRates.length} runs`);
  }
}

process.on('SIGINT', () => {
  console.log('\nInterrupted – printing partial summary...');
  printSummary();
  process.exit(130);
});

main().catch(e => {
  console.error('Fatal error in multi-run script:', e);
  process.exit(1);
});

// Print summary table
// (summary printing moved into printSummary())
