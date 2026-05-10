'use strict';

// ═══════════════════════════════════════════════════════════════════
//  Vault Engine — MMG dual-screenshot flow extracted from index.html
//  No DOM, no localStorage, no FileReader.
// ═══════════════════════════════════════════════════════════════════

const RELEASE_MS = 30 * 60 * 1000;   // 30 min from bothProofTime
const REFUND_MS  = 30 * 60 * 1000;   // 30 min from lockTime (if not dual_confirmed)
const INCOMPLETE = ['locked', 'buyer_proved', 'merchant_proved'];

let vaults  = [];
let mWallet = '';
let chatLog = [];

function engineLog(msg) {
  chatLog.push('[' + new Date().toISOString() + '] ' + msg);
}

function resetEngine(wallet = '0xMerchant_TestWallet_ABC') {
  vaults  = [];
  chatLog = [];
  mWallet = wallet;
}

// ── Step 1: Buyer creates request ────────────────────────────────
function createRequest(wallet, amtRaw, coin, sid = 'default_session') {
  const amount = parseFloat(amtRaw);
  if (!wallet)                            return { ok: false, err: 'Please enter your wallet address.' };
  if (!amtRaw || isNaN(amount) || amount <= 0) return { ok: false, err: 'Please enter a valid amount.' };

  const id = 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  vaults.push({
    id, sessionId: sid,
    buyerWallet: wallet,
    amount: amount.toFixed(6), coin,
    status: 'pending',
    lockTime: null, releaseTime: null,
    buyerMMGId: null,
    buyerProofTime: null, merchantProofTime: null, bothProofTime: null
  });
  engineLog('🛒 Buy request: ' + amount + ' ' + coin + ' → ' + wallet.substr(0, 14));
  return { ok: true, id };
}

// ── Step 2: Merchant locks crypto ────────────────────────────────
function merchantLock(id, now = Date.now()) {
  if (!mWallet) return { ok: false, err: 'Set and save your merchant wallet first.' };
  const v = vaults.find(x => x.id === id);
  if (!v || v.status !== 'pending') return { ok: false, err: 'Request not found or already processed.' };
  v.status   = 'locked';
  v.lockTime = now;
  engineLog('🔒 Locked ' + v.amount + ' ' + v.coin + '. Both parties have 30 min to upload MMG proof.');
  return { ok: true };
}

// ── Step 3: Buyer uploads MMG receipt ────────────────────────────
// mmgId is optional; screenshot presence is simulated via hasSS boolean.
function submitBuyerProof(id, mmgId = '', hasSS = true, sid = 'default_session', now = Date.now()) {
  const v = vaults.find(x => x.id === id);
  if (!v || v.sessionId !== sid)                         return { ok: false, err: 'Vault not found.' };
  if (!['locked', 'merchant_proved'].includes(v.status)) return { ok: false, err: 'Cannot submit proof at this stage.' };
  if (!mmgId && !hasSS)                                  return { ok: false, err: 'Enter your MMG reference number or upload a receipt screenshot (or both).' };

  v.buyerMMGId    = mmgId || null;
  v.buyerProofTime = now;

  if (v.merchantProofTime) {
    v.bothProofTime = now;
    v.releaseTime   = now + RELEASE_MS;
    v.status        = 'dual_confirmed';
    engineLog('✅ Both confirmed! Releases in 30 min.');
    return { ok: true, dual: true };
  } else {
    v.status = 'buyer_proved';
    engineLog('📤 Buyer proof uploaded. Waiting for merchant confirmation.');
    return { ok: true, dual: false };
  }
}

// ── Step 4: Merchant uploads MMG confirmation ────────────────────
function submitMerchantProof(id, hasSS = true, now = Date.now()) {
  const v = vaults.find(x => x.id === id);
  if (!v || !['locked', 'buyer_proved'].includes(v.status)) return { ok: false, err: 'Nothing to confirm here.' };
  if (!hasSS)                                               return { ok: false, err: 'Upload your MMG confirmation screenshot.' };

  v.merchantProofTime = now;

  if (v.buyerProofTime) {
    v.bothProofTime = now;
    v.releaseTime   = now + RELEASE_MS;
    v.status        = 'dual_confirmed';
    engineLog('✅ Both confirmed! Releases in 30 min.');
    return { ok: true, dual: true };
  } else {
    v.status = 'merchant_proved';
    engineLog('📥 Merchant confirmation uploaded. Waiting for buyer receipt.');
    return { ok: true, dual: false };
  }
}

// ── Tick: auto-release / auto-refund ────────────────────────────
function tick(now = Date.now()) {
  let released = 0, refunded = 0;
  vaults.forEach(v => {
    if (v.status === 'dual_confirmed' && v.releaseTime && now >= v.releaseTime) {
      v.status = 'released'; released++;
      engineLog('🎉 RELEASED: ' + v.amount + ' ' + v.coin);
    }
    if (INCOMPLETE.includes(v.status) && v.lockTime && now >= v.lockTime + REFUND_MS) {
      v.status = 'refunded'; refunded++;
      engineLog('↩️ AUTO-REFUND: ' + v.amount + ' ' + v.coin + ' (30 min, incomplete).');
    }
  });
  return { released, refunded };
}

// ── Merchant overrides ───────────────────────────────────────────
function forceRefund(id) {
  const v = vaults.find(x => x.id === id);
  if (!v) return { ok: false, err: 'Vault not found.' };
  v.status = 'refunded';
  engineLog('↩️ Merchant manually refunded.');
  return { ok: true };
}

function forceRelease(id) {
  const v = vaults.find(x => x.id === id);
  if (!v || v.status !== 'dual_confirmed') return { ok: false, err: 'Can only force-release a dual_confirmed vault.' };
  v.status = 'released';
  engineLog('🎉 Merchant force-released immediately.');
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════
//  Test harness
// ═══════════════════════════════════════════════════════════════════

let passed = 0, failed = 0;
const failList = [];

function assert(cond, name, detail = '') {
  const label = detail ? name + ' — ' + detail : name;
  if (cond) {
    passed++;
    console.log('  ✅ PASS  ' + label);
  } else {
    failed++;
    failList.push(label);
    console.log('  ❌ FAIL  ' + label);
  }
}

function section(title) {
  console.log('\n' + '═'.repeat(68));
  console.log('  ' + title);
  console.log('═'.repeat(68));
}

function countByStatus(status) {
  return vaults.filter(v => v.status === status).length;
}

// ───────────────────────────────────────────────────────────────────
//  Scenario 1 — 50 concurrent buy requests
// ───────────────────────────────────────────────────────────────────
section('Scenario 1 — 50 concurrent buy requests');
resetEngine();

const coins = ['BTC', 'ETH', 'USDT'];
const ids   = [];

for (let i = 0; i < 50; i++) {
  const r = createRequest(
    '0xBuyer_' + String(i).padStart(3, '0'),
    (0.001 * (i + 1)).toFixed(8),
    coins[i % 3],
    'session_' + i
  );
  assert(r.ok, `Request #${i + 1} created`, r.ok ? r.id : r.err);
  if (r.ok) ids.push({ id: r.id, sid: 'session_' + i });
}

assert(ids.length === 50,              'All 50 requests recorded',   `got ${ids.length}`);
assert(countByStatus('pending') === 50, 'All 50 in pending status');

// ───────────────────────────────────────────────────────────────────
//  Scenario 2 — Merchant locks all 50 simultaneously
// ───────────────────────────────────────────────────────────────────
section('Scenario 2 — Merchant locks all 50 simultaneously');

const lockNow   = Date.now();
const lockStart = process.hrtime.bigint();
let   lockOk    = 0;

for (const { id } of ids) {
  const r = merchantLock(id, lockNow);
  if (r.ok) lockOk++;
  else assert(false, `merchantLock failed for ${id}`, r.err);
}

const lockMs = Number(process.hrtime.bigint() - lockStart) / 1e6;
assert(lockOk === 50,                'All 50 locked',          `${lockOk}/50`);
assert(countByStatus('locked') === 50, 'All 50 in locked status');
console.log('  ⏱  Lock 50 vaults: ' + lockMs.toFixed(3) + 'ms');

// ───────────────────────────────────────────────────────────────────
//  Scenario 3 — All 50 buyers upload MMG receipts
// ───────────────────────────────────────────────────────────────────
section('Scenario 3 — All 50 buyers submit MMG receipt (buyer proof)');

let buyerProofOk = 0;
for (let i = 0; i < ids.length; i++) {
  const r = submitBuyerProof(ids[i].id, 'GY-REF-' + String(i).padStart(4, '0'), true, ids[i].sid, lockNow + 1000);
  if (r.ok) buyerProofOk++;
  else assert(false, `submitBuyerProof failed vault #${i}`, r.err);
}

assert(buyerProofOk === 50,              'All 50 buyer proofs submitted',    `${buyerProofOk}/50`);
assert(countByStatus('buyer_proved') === 50, 'All 50 in buyer_proved status');

// ───────────────────────────────────────────────────────────────────
//  Scenario 4 — All 50 merchants confirm; all 50 reach dual_confirmed
// ───────────────────────────────────────────────────────────────────
section('Scenario 4 — All 50 merchants confirm → all reach dual_confirmed');

const verifyNow   = lockNow + 2000;
const verifyStart = process.hrtime.bigint();
let   dualOk      = 0;

for (const { id } of ids) {
  const r = submitMerchantProof(id, true, verifyNow);
  if (r.ok && r.dual) dualOk++;
  else assert(false, `submitMerchantProof failed for ${id}`, JSON.stringify(r));
}

const verifyMs = Number(process.hrtime.bigint() - verifyStart) / 1e6;
assert(dualOk === 50,                       'All 50 reached dual_confirmed',    `${dualOk}/50`);
assert(countByStatus('dual_confirmed') === 50, 'All 50 in dual_confirmed status');
console.log('  ⏱  50 merchant confirms: ' + verifyMs.toFixed(3) + 'ms (' +
  (verifyMs / 50 * 1000).toFixed(1) + 'μs avg)');

// ───────────────────────────────────────────────────────────────────
//  Scenario 5 — Simulate 30 min passing; confirm all 50 auto-release
// ───────────────────────────────────────────────────────────────────
section('Scenario 5 — 30 min time-warp → all 50 auto-release');

// releaseTime = verifyNow + RELEASE_MS; warp just past it
const future30m = verifyNow + RELEASE_MS + 5000;

// Sanity: nothing releases at 15 min
const earlyTick = tick(verifyNow + 15 * 60 * 1000);
assert(earlyTick.released === 0, 'No releases at 15 min',   `released=${earlyTick.released}`);
assert(countByStatus('dual_confirmed') === 50, 'Still 50 dual_confirmed at 15 min');

const lateTick = tick(future30m);
assert(lateTick.released === 50,        'All 50 released after 30 min', `released=${lateTick.released}`);
assert(countByStatus('released') === 50, 'All 50 in released status');

// ───────────────────────────────────────────────────────────────────
//  Scenario 6 — 10 vaults where only buyer uploads; merchant is no-show
//              → all 10 auto-refund after 30 min
// ───────────────────────────────────────────────────────────────────
section('Scenario 6 — 10 vaults buyer-only upload, merchant no-show → refund after 30 min');
resetEngine();

const noShowNow = Date.now();
const noShowIds = [];

for (let i = 0; i < 10; i++) {
  const r = createRequest('0xNS_' + i, '1.0', 'USDT', 'ns_session_' + i);
  if (r.ok) { merchantLock(r.id, noShowNow); noShowIds.push({ id: r.id, sid: 'ns_session_' + i }); }
}
// Buyer uploads proof
for (const { id, sid } of noShowIds) {
  submitBuyerProof(id, 'NS-REF-001', true, sid, noShowNow + 1000);
}
assert(countByStatus('buyer_proved') === 10, 'All 10 in buyer_proved status (merchant has not confirmed)');

// 29m59s — no refund yet
const almostTick = tick(noShowNow + REFUND_MS - 1);
assert(almostTick.refunded === 0,        'No refunds at 29m59s',   `refunded=${almostTick.refunded}`);
assert(countByStatus('buyer_proved') === 10, 'Still 10 buyer_proved at 29m59s');

// 30m+1ms — all refund
const expiredTick = tick(noShowNow + REFUND_MS + 1);
assert(expiredTick.refunded === 10,       'All 10 refunded after 30 min', `refunded=${expiredTick.refunded}`);
assert(countByStatus('refunded') === 10,  'All 10 in refunded status');

// ───────────────────────────────────────────────────────────────────
//  Scenario 7 — 10 vaults where only merchant uploads; buyer is no-show
//              → all 10 auto-refund after 30 min
// ───────────────────────────────────────────────────────────────────
section('Scenario 7 — 10 vaults merchant-only upload, buyer no-show → refund after 30 min');
resetEngine();

const mNow = Date.now();
const mIds = [];

for (let i = 0; i < 10; i++) {
  const r = createRequest('0xMNS_' + i, '0.5', 'ETH', 'mn_session_' + i);
  if (r.ok) { merchantLock(r.id, mNow); mIds.push(r.id); }
}
// Merchant uploads confirmation first (buyer hasn't paid yet)
for (const id of mIds) {
  const r = submitMerchantProof(id, true, mNow + 500);
  assert(r.ok && !r.dual, `Merchant proof accepted, no dual yet for ${id}`);
}
assert(countByStatus('merchant_proved') === 10, 'All 10 in merchant_proved (buyer still absent)');

// Auto-refund after 30 min from lockTime
const mExpired = tick(mNow + REFUND_MS + 1);
assert(mExpired.refunded === 10,         'All 10 refunded (buyer no-show)', `refunded=${mExpired.refunded}`);
assert(countByStatus('refunded') === 10, 'All 10 in refunded status');

// ───────────────────────────────────────────────────────────────────
//  Scenario 8 — Buyer never uploads or pays at all (pure no-show)
//              → 10 locked vaults auto-refund after 30 min
// ───────────────────────────────────────────────────────────────────
section('Scenario 8 — 10 locked vaults, nobody uploads → auto-refund after 30 min');
resetEngine();

const ghostNow = Date.now();
for (let i = 0; i < 10; i++) {
  const r = createRequest('0xGhost_' + i, '1.0', 'BTC', 'g_session_' + i);
  if (r.ok) merchantLock(r.id, ghostNow);
}
assert(countByStatus('locked') === 10, 'All 10 locked with no uploads');

const ghostEarly = tick(ghostNow + REFUND_MS - 1);
assert(ghostEarly.refunded === 0,      'No refunds at 29m59s',       `refunded=${ghostEarly.refunded}`);

const ghostLate = tick(ghostNow + REFUND_MS + 1);
assert(ghostLate.refunded === 10,      'All 10 refunded after 30 min', `refunded=${ghostLate.refunded}`);

// ───────────────────────────────────────────────────────────────────
//  Scenario 9 — Edge cases
// ───────────────────────────────────────────────────────────────────
section('Scenario 9 — Edge cases');
resetEngine();

// Empty buyer wallet
const e1 = createRequest('', '1.0', 'BTC');
assert(!e1.ok, 'Reject empty wallet',    e1.err);

// Zero amount
const e2 = createRequest('0xWallet', '0', 'BTC');
assert(!e2.ok, 'Reject zero amount',     e2.err);

// Negative amount
const e3 = createRequest('0xWallet', '-5', 'BTC');
assert(!e3.ok, 'Reject negative amount', e3.err);

// NaN amount
const e4 = createRequest('0xWallet', 'abc', 'BTC');
assert(!e4.ok, 'Reject NaN amount',      e4.err);

// No merchant wallet — buyer can request; lock must fail
mWallet = '';
const e5 = createRequest('0xWallet', '1.0', 'BTC', 'e5s');
assert(e5.ok, 'Buyer can request with no merchant wallet set');
const e5lock = merchantLock(e5.id);
assert(!e5lock.ok, 'Lock rejected: no merchant wallet', e5lock.err);
mWallet = '0xMerchant_TestWallet_ABC';

// Double-lock attempt
const e6 = createRequest('0xWallet2', '1.0', 'ETH', 'e6s');
assert(e6.ok, 'Setup vault for double-lock');
merchantLock(e6.id, Date.now());
const e6dbl = merchantLock(e6.id, Date.now());
assert(!e6dbl.ok, 'Reject double-lock', e6dbl.err);

// submitBuyerProof with wrong session ID
const e7 = createRequest('0xWallet3', '1.0', 'USDT', 'e7_real_session');
assert(e7.ok, 'Setup vault for session-guard check');
merchantLock(e7.id, Date.now());
const e7bad = submitBuyerProof(e7.id, 'REF-001', true, 'e7_impostor_session');
assert(!e7bad.ok, 'Reject buyer proof from wrong session', e7bad.err);

// submitBuyerProof on pending vault (not locked)
const e8 = createRequest('0xWallet4', '1.0', 'BTC', 'e8s');
assert(e8.ok, 'Setup vault for proof-on-pending');
const e8bad = submitBuyerProof(e8.id, 'REF-001', true, 'e8s');
assert(!e8bad.ok, 'Reject buyer proof on pending vault', e8bad.err);

// submitMerchantProof on pending vault (not locked)
const e9 = createRequest('0xWallet5', '1.0', 'ETH', 'e9s');
assert(e9.ok, 'Setup vault for merchant-proof-on-pending');
const e9bad = submitMerchantProof(e9.id, true);
assert(!e9bad.ok, 'Reject merchant proof on pending vault', e9bad.err);

// submitBuyerProof with neither mmgId nor screenshot
const e10 = createRequest('0xWallet6', '1.0', 'USDT', 'e10s');
assert(e10.ok, 'Setup vault for empty-proof check');
merchantLock(e10.id, Date.now());
const e10bad = submitBuyerProof(e10.id, '', false, 'e10s');
assert(!e10bad.ok, 'Reject buyer proof with no mmgId and no screenshot', e10bad.err);

// submitMerchantProof with no screenshot
const e11 = createRequest('0xWallet7', '1.0', 'BTC', 'e11s');
assert(e11.ok, 'Setup vault for merchant-no-screenshot');
merchantLock(e11.id, Date.now());
const e11bad = submitMerchantProof(e11.id, false);
assert(!e11bad.ok, 'Reject merchant proof with no screenshot', e11bad.err);

// forceRelease only works on dual_confirmed
const e12 = createRequest('0xWallet8', '1.0', 'ETH', 'e12s');
assert(e12.ok, 'Setup vault for forceRelease guard');
merchantLock(e12.id, Date.now());
const e12fr = forceRelease(e12.id);
assert(!e12fr.ok, 'Reject forceRelease on locked vault (not dual_confirmed)', e12fr.err);

// Merchant uploads first, then buyer → should reach dual_confirmed (order reversal)
const e13 = createRequest('0xWallet9', '1.0', 'USDT', 'e13s');
assert(e13.ok, 'Setup vault for merchant-first order test');
merchantLock(e13.id, Date.now());
const e13m = submitMerchantProof(e13.id, true, Date.now());
assert(e13m.ok && !e13m.dual, 'Merchant uploads first (no dual yet)');
const e13b = submitBuyerProof(e13.id, 'REF-LATE', true, 'e13s', Date.now());
assert(e13b.ok && e13b.dual, 'Buyer uploads second → dual_confirmed', String(e13b.dual));
assert(vaults.find(v => v.id === e13.id).status === 'dual_confirmed', 'Vault is dual_confirmed after reverse order');

// ───────────────────────────────────────────────────────────────────
//  Scenario 10 — Performance: 50 full-cycle (lock→buyerProof→merchantProof→release) timed
// ───────────────────────────────────────────────────────────────────
section('Scenario 10 — Performance: 50 full-vault cycles timed');
resetEngine();

const perfNow  = Date.now();
const perfIds  = [];

for (let i = 0; i < 50; i++) {
  const r = createRequest('0xPerfBuyer_' + i, '1.0', 'USDT', 'ps_' + i);
  if (r.ok) {
    merchantLock(r.id, perfNow);
    perfIds.push({ id: r.id, sid: 'ps_' + i });
  }
}
assert(perfIds.length === 50, 'All 50 perf vaults locked');

// Time buyer proofs
const t0b = process.hrtime.bigint();
for (let i = 0; i < perfIds.length; i++) {
  submitBuyerProof(perfIds[i].id, 'PERF-REF-' + i, true, perfIds[i].sid, perfNow + 100);
}
const buyerNs = Number(process.hrtime.bigint() - t0b);

assert(countByStatus('buyer_proved') === 50, '50 vaults in buyer_proved after buyer uploads');

// Time merchant confirmations
const t0m = process.hrtime.bigint();
for (const { id } of perfIds) {
  submitMerchantProof(id, true, perfNow + 200);
}
const merchantNs = Number(process.hrtime.bigint() - t0m);

assert(countByStatus('dual_confirmed') === 50, 'All 50 dual_confirmed after merchant confirms');
console.log('  ⏱  50 buyer proofs    : ' + (buyerNs / 1e6).toFixed(3) + 'ms (' + (buyerNs / 50 / 1000).toFixed(1) + 'μs avg)');
console.log('  ⏱  50 merchant proofs : ' + (merchantNs / 1e6).toFixed(3) + 'ms (' + (merchantNs / 50 / 1000).toFixed(1) + 'μs avg)');

// Time the tick sweep
const perfRelease = perfNow + 200 + RELEASE_MS + 1000;
const t0t = process.hrtime.bigint();
const perfTick = tick(perfRelease);
const tickNs = Number(process.hrtime.bigint() - t0t);

assert(perfTick.released === 50, 'All 50 released by time-warp tick', `released=${perfTick.released}`);
console.log('  ⏱  tick() sweep 50    : ' + (tickNs / 1e6).toFixed(3) + 'ms');
console.log('  ⏱  Total (proof+proof+tick) : ' + ((buyerNs + merchantNs + tickNs) / 1e6).toFixed(3) + 'ms');

// ───────────────────────────────────────────────────────────────────
//  Summary
// ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(68));
console.log('  SUMMARY');
console.log('═'.repeat(68));
console.log('  Total  : ' + (passed + failed));
console.log('  Passed : ' + passed);
console.log('  Failed : ' + failed);
console.log('═'.repeat(68));

if (failed > 0) {
  console.log('\n  Failed tests:');
  failList.forEach(n => console.log('    ❌ ' + n));
  process.exit(1);
} else {
  console.log('\n  All tests passed!');
  process.exit(0);
}
