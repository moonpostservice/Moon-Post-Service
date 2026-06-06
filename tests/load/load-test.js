#!/usr/bin/env node
/**
 * Moon Post Service — backend load test
 * ------------------------------------------------------------------
 * Answers one question: "How many concurrent users before the backend
 * degrades?"  It probes the two ceilings that bind first on Supabase:
 *
 *   1. REALTIME  — concurrent websocket connections (Free tier cap = 200).
 *                  Ramps connections up until subscribes start failing.
 *   2. REST      — concurrent PostgREST/RPC calls against the shared
 *                  Micro CPU. Measures p50/p95/p99 latency + error rate.
 *                  Uses check_login_email (anon RPC, read-only, no writes).
 *   3. SUSTAIN   — holds N connections open for a duration; watches for
 *                  drops (tests stability over time, not just setup).
 *   4. THROUGHPUT— fan-out: S subscribers on one channel, measures broadcast
 *                  delivery ratio + latency (exercises the 2M msg/mo path).
 *
 * It does NOT create accounts, send DB messages, or write any data. Test 4
 * uses ephemeral broadcast pub/sub (counts against the realtime msg quota).
 *
 * ⚠️  This points at your LIVE project. Run it when real users aren't on
 *     (pre-launch is ideal). Realtime connections are transient and torn
 *     down after each test.
 *
 * Usage:
 *   node tests/load/load-test.js                       # all 4 tests
 *   node tests/load/load-test.js --rt --rest           # subset: any of --rt --rest --sustain --throughput
 *   node tests/load/load-test.js --rt-max=1000         # push realtime ramp higher
 *   node tests/load/load-test.js --sustain --hold=120  # hold connections 120s
 *   node tests/load/load-test.js --throughput --subs=100 --msgs=500
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY from env or .env.test.
 */

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '../../.env.test') }); } catch {}
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY (env or .env.test)');
  process.exit(1);
}

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const num = (f, d) => { const a = args.find(x => x.startsWith(f + '=')); return a ? Number(a.split('=')[1]) : d; };

const RT_LEVELS   = [25, 50, 100, 150, 200, 250, 300].filter(n => n <= num('--rt-max', 300));
const REST_LEVELS = [10, 25, 50, 100, 200];
const REST_REQS_PER_LEVEL = 300;          // total requests fired at each concurrency level
const SUBSCRIBE_TIMEOUT_MS = 10_000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p / 100 * sorted.length))] : 0;

// ── Test 1: Realtime concurrent-connection ceiling ───────────────────
async function realtimeLevel(n) {
  const clients = [];
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => new Promise((resolve) => {
      const c = createClient(URL, KEY, {
        realtime: { params: { eventsPerSecond: 1 } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      clients.push(c);
      const ch = c.channel(`loadtest-${i}-${process.pid}`);
      const timer = setTimeout(() => resolve('TIMED_OUT'), SUBSCRIBE_TIMEOUT_MS);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve('SUBSCRIBED'); }
        else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') { clearTimeout(timer); resolve(status); }
      });
    }))
  );
  // teardown
  await Promise.all(clients.map(c => c.removeAllChannels().catch(() => {})));
  clients.forEach(c => { try { c.realtime.disconnect(); } catch {} });

  const ok = results.filter(r => r === 'SUBSCRIBED').length;
  const tally = results.reduce((m, r) => (m[r] = (m[r] || 0) + 1, m), {});
  return { ok, n, tally };
}

async function runRealtime() {
  console.log('\n━━━ TEST 1: Realtime concurrent connections ━━━');
  console.log('Free-tier documented ceiling: 200 concurrent connections.\n');
  const levels = [];
  for (const n of RT_LEVELS) {
    const { ok, tally } = await realtimeLevel(n);
    const rate = ((ok / n) * 100).toFixed(0);
    const detail = Object.entries(tally).map(([k, v]) => `${k}:${v}`).join('  ');
    console.log(`  ${String(n).padStart(4)} attempted → ${String(ok).padStart(4)} subscribed (${rate}%)   [${detail}]`);
    levels.push({ n, ok });
    await sleep(2000); // let connections fully close before next level
  }
  // A real ceiling = a level that failed AND was NOT recovered at any higher level
  // (a single stray error followed by clean higher levels is just transient noise).
  const maxClean = Math.max(0, ...levels.filter(l => l.ok === l.n).map(l => l.n));
  const realCeiling = levels.find(l => l.ok < l.n && !levels.some(h => h.n > l.n && h.ok === h.n));
  const partial = levels.filter(l => l.ok < l.n).map(l => `${l.n}(${l.ok})`);
  if (realCeiling) {
    console.log(`\n  ⚠️  Sustained failures from ~${realCeiling.n} concurrent — that's your realtime ceiling.`);
  } else {
    console.log(`\n  ✅ Fully subscribed up to ${maxClean} concurrent (max tested). No hard ceiling found.`);
    if (partial.length) console.log(`     Transient blips (recovered at higher levels): ${partial.join(', ')}`);
  }
}

// ── Test 2: REST/RPC latency under concurrency ───────────────────────
async function oneRpc() {
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL}/rest/v1/rpc/check_login_email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ p_email: `loadtest_${Math.floor(Date.now() % 1e6)}@example.invalid` }),
    });
    await res.text();
    return { ms: Date.now() - t0, ok: res.ok, status: res.status };
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, status: 0, err: String(e.message || e) };
  }
}

async function restLevel(concurrency) {
  const latencies = [];
  let errors = 0, done = 0;
  async function worker() {
    while (done < REST_REQS_PER_LEVEL) {
      done++;
      const r = await oneRpc();
      latencies.push(r.ms);
      if (!r.ok) errors++;
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wall = Date.now() - t0;
  latencies.sort((a, b) => a - b);
  return {
    concurrency,
    rps: (REST_REQS_PER_LEVEL / (wall / 1000)).toFixed(0),
    p50: pct(latencies, 50), p95: pct(latencies, 95), p99: pct(latencies, 99),
    max: latencies[latencies.length - 1], errors,
  };
}

async function runRest() {
  console.log('\n━━━ TEST 2: REST/RPC latency under concurrency ━━━');
  console.log(`${REST_REQS_PER_LEVEL} read-only RPC calls per level (check_login_email).\n`);
  console.log('  conc    rps    p50     p95     p99     max    errors');
  console.log('  ─────────────────────────────────────────────────────');
  for (const c of REST_LEVELS) {
    const r = await restLevel(c);
    console.log(
      `  ${String(c).padStart(4)}  ${String(r.rps).padStart(5)}  ${String(r.p50).padStart(4)}ms  ${String(r.p95).padStart(4)}ms  ${String(r.p99).padStart(4)}ms  ${String(r.max).padStart(4)}ms  ${String(r.errors).padStart(4)}`
    );
    await sleep(1000);
  }
  console.log('\n  Watch for: p95 climbing past ~1s, or errors > 0 → CPU saturating.');
}

// ── Test 5: Write load (isolated scratch table) ──────────────────────
// Requires public._loadtest_writes to exist with an anon INSERT policy.
// The runner creates it before this test and DROPs it immediately after,
// so no real table, trigger, or cron is ever touched.
const WRITE_LEVELS = [10, 25, 50, 100];
const WRITE_REQS_PER_LEVEL = 200;

async function oneWrite() {
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL}/rest/v1/_loadtest_writes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'return=minimal' },
      body: JSON.stringify({ payload: `lt_${Date.now()}` }),
    });
    await res.text();
    return { ms: Date.now() - t0, ok: res.ok, status: res.status };
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, status: 0 };
  }
}

async function writeLevel(concurrency) {
  const latencies = []; let errors = 0, done = 0;
  async function worker() {
    while (done < WRITE_REQS_PER_LEVEL) {
      done++;
      const r = await oneWrite();
      latencies.push(r.ms);
      if (!r.ok) errors++;
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const wall = Date.now() - t0;
  latencies.sort((a, b) => a - b);
  return {
    concurrency, rps: (WRITE_REQS_PER_LEVEL / (wall / 1000)).toFixed(0),
    p50: pct(latencies, 50), p95: pct(latencies, 95), p99: pct(latencies, 99),
    max: latencies[latencies.length - 1], errors,
  };
}

async function runWrite() {
  console.log('\n━━━ TEST 5: Write load (isolated scratch table) ━━━');
  console.log(`${WRITE_REQS_PER_LEVEL} INSERTs per level into public._loadtest_writes.\n`);
  // sanity: confirm the scratch table is reachable before ramping
  const probe = await oneWrite();
  if (!probe.ok) {
    console.log(`  ⚠️  Scratch table not writable (status ${probe.status}). Did the runner create public._loadtest_writes with an anon INSERT policy? Skipping.`);
    return;
  }
  console.log('  conc    rps    p50     p95     p99     max    errors');
  console.log('  ─────────────────────────────────────────────────────');
  for (const c of WRITE_LEVELS) {
    const r = await writeLevel(c);
    console.log(
      `  ${String(c).padStart(4)}  ${String(r.rps).padStart(5)}  ${String(r.p50).padStart(4)}ms  ${String(r.p95).padStart(4)}ms  ${String(r.p99).padStart(4)}ms  ${String(r.max).padStart(4)}ms  ${String(r.errors).padStart(4)}`
    );
    await sleep(1000);
  }
  console.log('\n  Watch for: rising p95 or errors > 0 → write path (WAL/CPU/IO) saturating.');
}

// ── Test 3: Sustained held connections ──────────────────────────────
async function runSustained() {
  const hold = num('--hold', 60);
  const n = num('--sustain-n', 200);
  console.log('\n━━━ TEST 3: Sustained held connections ━━━');
  console.log(`Holding ${n} concurrent connections open for ${hold}s (drops = instability).\n`);
  const clients = [];
  const alive = new Array(n).fill(false);
  await Promise.all(Array.from({ length: n }, (_, i) => new Promise((resolve) => {
    const c = createClient(URL, KEY, {
      realtime: { params: { eventsPerSecond: 1 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.push(c);
    const ch = c.channel(`sustain-${i}-${process.pid}`);
    const timer = setTimeout(resolve, SUBSCRIBE_TIMEOUT_MS);
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') { alive[i] = true; clearTimeout(timer); resolve(); }
      else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') { clearTimeout(timer); resolve(); }
    });
  })));
  const initial = alive.filter(Boolean).length;
  console.log(`  t=0s     ${initial}/${n} subscribed`);
  const samples = Math.max(1, Math.floor(hold / 10));
  let minAlive = initial;
  for (let s = 1; s <= samples; s++) {
    await sleep(10_000);
    const aliveNow = clients.filter(c => { try { return c.realtime.isConnected(); } catch { return false; } }).length;
    minAlive = Math.min(minAlive, aliveNow);
    console.log(`  t=${String(s * 10).padStart(3)}s   ${aliveNow}/${n} sockets connected`);
  }
  clients.forEach(c => { try { c.realtime.disconnect(); } catch {} });
  console.log(minAlive >= initial
    ? `\n  ✅ All ${initial} connections stayed up for the full ${hold}s.`
    : `\n  ⚠️  Dropped to ${minAlive} during the hold — instability under sustained load.`);
}

// ── Test 4: Realtime message throughput (fan-out) ────────────────────
async function runThroughput() {
  const subs = num('--subs', 50);
  const msgs = num('--msgs', 200);
  const rate = num('--rate', 20); // broadcasts per second
  const chName = `throughput-${process.pid}`;
  console.log('\n━━━ TEST 4: Realtime message throughput (fan-out) ━━━');
  console.log(`${subs} subscribers on one channel; sending ${msgs} broadcasts at ~${rate}/s.`);
  console.log(`Expected deliveries: ${subs * msgs} (counts against the 2M/mo realtime quota).\n`);

  let received = 0;
  const latencies = [];
  const subClients = [];
  await Promise.all(Array.from({ length: subs }, () => new Promise((resolve) => {
    const c = createClient(URL, KEY, {
      realtime: { params: { eventsPerSecond: 1000 } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    subClients.push(c);
    const ch = c.channel(chName, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'ping' }, (msg) => {
      received++;
      const t = msg.payload && msg.payload.t;
      if (t) latencies.push(Date.now() - t);
    });
    const timer = setTimeout(resolve, SUBSCRIBE_TIMEOUT_MS);
    ch.subscribe((s) => { if (s === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } });
  })));

  const sender = createClient(URL, KEY, {
    realtime: { params: { eventsPerSecond: 1000 } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const sendCh = sender.channel(chName, { config: { broadcast: { self: false } } });
  await new Promise((resolve) => { const t = setTimeout(resolve, SUBSCRIBE_TIMEOUT_MS); sendCh.subscribe(s => { if (s === 'SUBSCRIBED') { clearTimeout(t); resolve(); } }); });

  const interval = 1000 / rate;
  const t0 = Date.now();
  for (let i = 0; i < msgs; i++) {
    await sendCh.send({ type: 'broadcast', event: 'ping', payload: { t: Date.now(), i } });
    await sleep(interval);
  }
  await sleep(3000); // let stragglers arrive
  const wall = (Date.now() - t0) / 1000;
  const expected = subs * msgs;
  latencies.sort((a, b) => a - b);
  subClients.forEach(c => { try { c.realtime.disconnect(); } catch {} });
  try { sender.realtime.disconnect(); } catch {}

  const loss = expected ? ((1 - received / expected) * 100).toFixed(1) : '0';
  console.log(`  Sent:      ${msgs} broadcasts in ${wall.toFixed(1)}s (~${(msgs / wall).toFixed(0)}/s)`);
  console.log(`  Delivered: ${received}/${expected}  (loss ${loss}%)`);
  console.log(`  Latency:   p50 ${pct(latencies, 50)}ms  p95 ${pct(latencies, 95)}ms  max ${latencies[latencies.length - 1] || 0}ms`);
  console.log(received / expected >= 0.99
    ? '\n  ✅ Fan-out delivered cleanly with low latency.'
    : `\n  ⚠️  ${loss}% message loss — realtime throughput saturating at this rate.`);
}

(async () => {
  console.log(`Target: ${URL}`);
  // Backward-compatible single-test flags
  if (has('--rt-only'))   { await runRealtime(); console.log('\nDone.\n'); process.exit(0); }
  if (has('--rest-only')) { await runRest();     console.log('\nDone.\n'); process.exit(0); }
  // Subset selection: any of --rt --rest --sustain --throughput; none = run all
  const sel = ['--rt', '--rest', '--sustain', '--throughput', '--write'].filter(has);
  const run = (name) => sel.length === 0 || sel.includes(name);
  if (run('--rt'))         await runRealtime();
  if (run('--rest'))       await runRest();
  if (run('--sustain'))    await runSustained();
  if (run('--throughput')) await runThroughput();
  if (run('--write'))      await runWrite();
  console.log('\nDone.\n');
  process.exit(0);
})();
