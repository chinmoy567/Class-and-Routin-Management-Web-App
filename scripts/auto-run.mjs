#!/usr/bin/env node
// Unattended runner: for each spec -> PLAN (plan mode) -> IMPLEMENT -> VERIFY.
//
// Usage (from repo root):
//   node scripts/auto-run.mjs                 # specs 08 09 10
//   node scripts/auto-run.mjs 08 09 10        # explicit list
//   node scripts/auto-run.mjs --commit        # also git-commit after each spec
//
// Logs + summary go to test-results/auto-run_<timestamp>/.
// WARNING: implement/verify phases use --permission-mode bypassPermissions so nothing
// stops to ask. Run it only on a clean git branch you are happy to review/discard.

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const specNums = args.filter((a) => /^\d+$/.test(a));
const wanted = (specNums.length ? specNums : ['08', '09', '10']).map((n) => n.padStart(2, '0'));

const root = process.cwd();
const specsDir = join(root, '.claude', 'specs');
const planDir = join(root, 'implementation-plan');
const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
const outDir = join(root, 'test-results', `auto-run_${stamp}`);
mkdirSync(outDir, { recursive: true });
mkdirSync(planDir, { recursive: true });
const summaryFile = join(outDir, 'SUMMARY.md');
writeFileSync(summaryFile, `# Auto-run ${stamp}\n\n`);

const log = (m) => {
  const line = `[${new Date().toLocaleTimeString()}] ${m}`;
  console.log(line);
  appendFileSync(summaryFile, line + '\n');
};

function claude(prompt, { mode, logName }) {
  return new Promise((resolve) => {
    const p = spawn('claude', ['-p', '--permission-mode', mode], {
      cwd: root,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const logPath = join(outDir, logName);
    p.stdout.on('data', (d) => {
      out += d;
      appendFileSync(logPath, d);
    });
    p.stderr.on('data', (d) => appendFileSync(logPath, d));
    p.on('close', (code) => resolve({ code, out }));
    p.stdin.end(prompt);
  });
}

const RULES = `Follow .claude/CLAUDE.md exactly. This run is UNATTENDED: nobody can answer questions. If something is genuinely blocked by an open question, choose the safest minimal reading, note it in the plan under "Assumptions", and continue. Do not add libraries outside DOCUMENTS/tech-stack.md. Do not commit.`;

for (const num of wanted) {
  const file = readdirSync(specsDir).find((f) => f.startsWith(num + '-') && f.endsWith('.md'));
  if (!file) {
    log(`SKIP ${num}: no spec file found`);
    continue;
  }
  const name = file.replace(/\.md$/, '');
  const planFile = join(planDir, `${name}-plan.md`);
  log(`=== Spec ${name} ===`);

  // 1. PLAN (plan mode: read-only, so the script saves the plan text itself)
  if (existsSync(planFile)) {
    log(`plan exists, reusing ${planFile}`);
  } else {
    log('PLAN: start');
    const r = await claude(
      `Follow the steps of .claude/commands/plan-spec.md for spec ${name} (.claude/specs/${file}), steps 1-4 only: read everything it depends on and the current code, then output the COMPLETE plan as markdown (Goal, Rules and acceptance criteria, Assumptions, Files, Data model, API, UI, Tests, Build order, Out of scope). Output only the plan. ${RULES}`,
      { mode: 'plan', logName: `${name}-1-plan.log` },
    );
    if (r.code !== 0 || r.out.trim().length < 500) {
      log(`PLAN: FAILED (exit ${r.code}); skipping spec ${name}`);
      continue;
    }
    writeFileSync(planFile, r.out);
    log(`PLAN: saved ${planFile}`);
  }

  // 2. IMPLEMENT
  log('IMPLEMENT: start');
  const impl = await claude(
    `Implement spec ${name} by following implementation-plan/${name}-plan.md step by step (use the build-feature skill; write tests together with code). Then run the run-checks skill (lint, tests, build) and fix every failure until green. Build only what the plan covers; if you depart from it, update the plan file. ${RULES}`,
    { mode: 'bypassPermissions', logName: `${name}-2-implement.log` },
  );
  log(`IMPLEMENT: exit ${impl.code}`);

  // 3. VERIFY (audit; writes report under test-results/)
  log('VERIFY: start');
  const ver = await claude(
    `Run the /verify-spec workflow from .claude/commands/verify-spec.md for spec ${name}. Save the report to test-results/. Do not change source code. ${RULES}`,
    { mode: 'bypassPermissions', logName: `${name}-3-verify.log` },
  );
  log(`VERIFY: exit ${ver.code}`);

  if (commit) {
    try {
      execSync(`git add -A && git commit -m "feat: implement ${name} (auto-run)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`, {
        cwd: root,
        stdio: 'ignore',
      });
      log('COMMIT: done');
    } catch {
      log('COMMIT: nothing committed / failed');
    }
  }
}

log('ALL DONE');
