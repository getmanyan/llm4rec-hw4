// HW4 offline analysis. Every number in the report comes from this script.
// It runs the page's own script.js (via load.js), so the numbers match the page.
// The random split in section 9 is seeded, so all counts repeat exactly on a
// re-run; only the timings (ms) depend on the machine.
//
// Run from the repository root:  node analysis/evaluate.js > analysis/results.txt

const { loadApp } = require("./load.js");

const app = loadApp();
const T = app.TRANSACTIONS;
const N = T.length;
const desc = new Map(app.data.stocks.map((s, i) => [s, app.data.descriptions[i]]));
const name = (items) => items.map((s) => desc.get(s)).join(" + ");
const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
const fmt = (r) =>
  `${name(r.antecedent)} -> ${name(r.consequent)} | count(A∪B)=${r.jointCount} ` +
  `count(A)=${r.antecedentCount} count(B)=${r.consequentCount} support=${pct(r.support)} ` +
  `confidence=${pct(r.confidence)} lift=${r.lift.toFixed(4)}`;
const baskets = T.map((b) => app.dedupeBasket(b));
const findRule = (rules, a, b) =>
  rules.find((r) => r.antecedent.join("|") === a.join("|") && r.consequent.join("|") === b.join("|"));
const mine = (sup, conf, data = T) => app.generateRules(app.findFrequentItemsets(data, sup), conf);

// Metrics of A -> B inside any subset of baskets, counted by a plain scan
// (no index, no Apriori), so this is also an independent check of the miner.
function scan(subset, A, B) {
  let a = 0, b = 0, ab = 0;
  for (const basket of subset) {
    const s = new Set(basket);
    const hasA = A.every((x) => s.has(x));
    const hasB = B.every((x) => s.has(x));
    if (hasA) a += 1;
    if (hasB) b += 1;
    if (hasA && hasB) ab += 1;
  }
  const n = subset.length;
  return { n, a, b, ab, support: ab / n, confidence: ab / a, lift: ab / a / (b / n) };
}
const show = (label, m) =>
  console.log(
    `  ${label}: baskets=${m.n} count(A)=${m.a} count(B)=${m.b} count(A∪B)=${m.ab} ` +
      `confidence=${pct(m.confidence, 1)} lift=${m.lift.toFixed(2)} baseline P(B)=${pct(m.b / m.n, 1)}`,
  );

// ---------------------------------------------------------------------------
console.log("== 1. Dataset ==");
const sizes = baskets.map((b) => b.length).sort((a, b) => a - b);
const q = (p) => sizes[Math.floor(p * (sizes.length - 1))];
console.log(`baskets N=${N}, distinct items=${app.data.N_ITEMS}, rows=${sizes.reduce((s, x) => s + x, 0)}`);
console.log(`items per basket: median=${q(0.5)}, 90th percentile=${q(0.9)}, max=${sizes[sizes.length - 1]}`);
const top = app.countItem(app.TRANSACTIONS, "85123A");
console.log(`readme anchor: 85123A ${desc.get("85123A")} in ${top} baskets = ${pct(top / N)}`);
const SMALL = 16; // median basket size
const BIG = 48; // 90th percentile
const small = baskets.filter((b) => b.length <= SMALL);
const big = baskets.filter((b) => b.length > BIG);
console.log(`small baskets (<= ${SMALL} items): ${small.length}; big baskets (> ${BIG} items): ${big.length}`);

// ---------------------------------------------------------------------------
console.log("\n== 2. Check of the miner against a brute-force pair count ==");
{
  const F = app.findFrequentItemsets(T, 0.01);
  const minCount = app.minimumCount(0.01, N);
  const freq1 = new Set(F.filter((f) => f.items.length === 1).map((f) => f.items[0]));
  const pairCount = new Map();
  for (const b of baskets) {
    const items = b.filter((s) => freq1.has(s)).sort();
    for (let i = 0; i < items.length; i += 1)
      for (let j = i + 1; j < items.length; j += 1) {
        const k = items[i] + "|" + items[j];
        pairCount.set(k, (pairCount.get(k) || 0) + 1);
      }
  }
  const brute = new Map([...pairCount].filter(([, c]) => c >= minCount));
  const minerPairs = F.filter((f) => f.items.length === 2);
  const mismatched = minerPairs.filter((f) => brute.get(f.items.join("|")) !== f.count).length;
  console.log(
    `support >= 1% (count >= ${minCount}): Apriori pairs=${minerPairs.length}, brute-force pairs=${brute.size}, count mismatches=${mismatched}`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n== 3. Threshold grid ==");
console.log("support | min count | frequent itemsets by size | rules at conf 30% / 50% / 60% / 80% | min lift at 30% | mining time");
const grid = {};
for (const sup of [0.005, 0.01, 0.02, 0.03, 0.05]) {
  const t0 = Date.now();
  const F = app.findFrequentItemsets(T, sup);
  const ms = Date.now() - t0;
  const bySize = {};
  F.forEach((f) => (bySize[f.items.length] = (bySize[f.items.length] || 0) + 1));
  const counts = [0.3, 0.5, 0.6, 0.8].map((c) => app.generateRules(F, c).length);
  const r30 = app.generateRules(F, 0.3);
  grid[sup] = r30;
  const minLift = r30.length ? Math.min(...r30.map((r) => r.lift)).toFixed(2) : "-";
  console.log(
    `${pct(sup, 1)} | ${app.minimumCount(sup, N)} | ${F.length} ${JSON.stringify(bySize)} | ${counts.join(" / ")} | ${minLift} | ${ms} ms`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n== 4. Final table: support >= 1%, confidence >= 30% ==");
const FINAL = grid[0.01];
const keptLift = FINAL.filter((r) => r.lift > 1);
console.log(`rules=${FINAL.length}, rules with lift > 1=${keptLift.length}, lowest lift=${Math.min(...FINAL.map((r) => r.lift)).toFixed(4)}`);
console.log(`floor on lift: min confidence / largest P(B) = 0.30 / ${(top / N).toFixed(4)} = ${(0.3 / (top / N)).toFixed(2)}`);
const bySizeRules = {};
FINAL.forEach((r) => {
  const k = r.antecedent.length + r.consequent.length;
  bySizeRules[k] = (bySizeRules[k] || 0) + 1;
});
console.log(`rules by itemset size: ${JSON.stringify(bySizeRules)}`);
{
  const low = mine(0.005, 0.1);
  const under = low.filter((r) => r.lift <= 1);
  console.log(`lift gate check at support 0.5%, confidence 10%: rules=${low.length}, rules with lift <= 1: ${under.length}`);
  under.forEach((r) => console.log("  " + fmt(r)));
}
console.log("top 10 rules by lift (one direction per pair):");
const seen = new Set();
let shown = 0;
for (const r of FINAL) {
  const key = [...r.antecedent, ...r.consequent].sort().join("|");
  if (seen.has(key)) continue;
  seen.add(key);
  console.log("  " + fmt(r));
  if (++shown === 10) break;
}

// ---------------------------------------------------------------------------
console.log("\n== 5. Useful rule ==");
const GREEN = "22697"; // GREEN REGENCY TEACUP AND SAUCER
const ROSES = "22699"; // ROSES REGENCY TEACUP AND SAUCER
const PINK = "22698"; // PINK REGENCY TEACUP AND SAUCER
{
  const r = findRule(FINAL, [GREEN], [ROSES]);
  const back = findRule(FINAL, [ROSES], [GREEN]);
  console.log("A -> B: " + fmt(r));
  console.log("B -> A: " + fmt(back));
  console.log(
    `by hand: support=${r.jointCount}/${N}=${(r.jointCount / N).toFixed(6)}, confidence=${r.jointCount}/${r.antecedentCount}=${(r.jointCount / r.antecedentCount).toFixed(6)}, ` +
      `P(B)=${r.consequentCount}/${N}=${(r.consequentCount / N).toFixed(6)}, lift=${(r.jointCount / r.antecedentCount / (r.consequentCount / N)).toFixed(6)}`,
  );
  show("all baskets (plain scan)", scan(baskets, [GREEN], [ROSES]));
  show(`small baskets <= ${SMALL}`, scan(small, [GREEN], [ROSES]));
  show(`big baskets > ${BIG}`, scan(big, [GREEN], [ROSES]));
  console.log(`share of count(A∪B) from big baskets: ${pct(scan(big, [GREEN], [ROSES]).ab / r.jointCount, 1)}`);
  const trio = FINAL.filter(
    (x) => [...x.antecedent, ...x.consequent].sort().join("|") === [GREEN, PINK, ROSES].sort().join("|"),
  );
  console.log("rules from the 3-teacup set:");
  trio.forEach((x) => console.log("  " + fmt(x)));
  const pinkR = findRule(FINAL, [PINK], [ROSES]) || findRule(FINAL, [PINK], [GREEN]);
  if (pinkR) console.log("pink single-item rule for comparison: " + fmt(pinkR));
}

// ---------------------------------------------------------------------------
console.log("\n== 6. Rule to reject ==");
{
  const sorted = [...FINAL].sort((a, b) => a.lift - b.lift);
  const r = sorted[0];
  console.log("lowest-lift rule in the final table: " + fmt(r));
  const back = findRule(mine(0.01, 0.01), r.consequent, r.antecedent);
  console.log("its reverse: " + fmt(back));
  show("all baskets (plain scan)", scan(baskets, r.antecedent, r.consequent));
  show(`small baskets <= ${SMALL}`, scan(small, r.antecedent, r.consequent));
  show(`big baskets > ${BIG}`, scan(big, r.antecedent, r.consequent));
  console.log(`share of count(A∪B) from big baskets: ${pct(scan(big, r.antecedent, r.consequent).ab / r.jointCount, 1)}`);
  const toTop = FINAL.filter((x) => x.consequent.length === 1 && x.consequent[0] === "85123A").length;
  console.log(`rules in the final table whose B is 85123A: ${toTop}; position of this rule by lift: ${FINAL.indexOf(r) + 1} of ${FINAL.length}`);
  const bottom10 = FINAL.slice(-10).filter((x) => x.consequent.length === 1 && x.consequent[0] === "85123A").length;
  console.log(`of the 10 lowest-lift rules in the final table, ${bottom10} have 85123A as B`);
  console.log("redundant 3-item rule (adding an item does not change confidence):");
  const LRED = "20725", SUKI = "22383", JRED = "85099B";
  const triple = findRule(FINAL, [LRED, SUKI], [JRED]) || findRule(FINAL, [SUKI, LRED], [JRED]);
  const single = findRule(FINAL, [LRED], [JRED]);
  console.log("  " + fmt(triple));
  console.log("  " + fmt(single));
}

// ---------------------------------------------------------------------------
console.log("\n== 7. Rule direction ==");
{
  const PINKBAG = "22386", REDBAG = "85099B";
  const ab = findRule(FINAL, [PINKBAG], [REDBAG]);
  const ba = findRule(FINAL, [REDBAG], [PINKBAG]);
  console.log("A -> B: " + fmt(ab));
  console.log("B -> A: " + fmt(ba));
  let same = 0, pairs = 0;
  for (const r of FINAL) {
    if (r.antecedent.length + r.consequent.length !== 2) continue;
    pairs += 1;
    if (findRule(FINAL, r.consequent, r.antecedent)) same += 1;
  }
  console.log(`pair rules in the final table: ${pairs}; of them ${pairs - same} pass 30% in one direction only`);
}

// ---------------------------------------------------------------------------
console.log("\n== 8. What changes between thresholds ==");
{
  const key = (r) => r.antecedent.join("|") + ">" + r.consequent.join("|");
  const at2 = new Set(grid[0.02].map(key));
  const lost = FINAL.filter((r) => !at2.has(key(r)));
  console.log(`1% -> 2% support: ${FINAL.length} -> ${grid[0.02].length} rules; lost ${lost.length}`);
  const top20 = FINAL.slice(0, 20);
  console.log(`of the 20 highest-lift rules at 1%, still present at 2%: ${top20.filter((r) => at2.has(key(r))).length}`);
  console.log(`highest lift at 1%: ${FINAL[0].lift.toFixed(2)}; highest lift at 2%: ${grid[0.02][0].lift.toFixed(2)} (${name(grid[0.02][0].antecedent)} -> ${name(grid[0.02][0].consequent)})`);
  const at05 = grid[0.005];
  const bigRules = at05.filter((r) => r.antecedent.length + r.consequent.length >= 3).length;
  console.log(`0.5% support: ${at05.length} rules, of them ${bigRules} (${pct(bigRules / at05.length, 1)}) come from itemsets of 3+ items`);
  const at1Big = FINAL.filter((r) => r.antecedent.length + r.consequent.length >= 3).length;
  console.log(`1% support: ${FINAL.length} rules, of them ${at1Big} (${pct(at1Big / FINAL.length, 1)}) come from itemsets of 3+ items`);
}

// ---------------------------------------------------------------------------
console.log("\n== 9. Stability on a random half split (NOT a time split) ==");
{
  // Seeded shuffle (mulberry32), so the split is the same on every run.
  let seed = 42;
  const rand = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ids = T.map((_, i) => i);
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const half = Math.floor(ids.length / 2);
  const A = ids.slice(0, half).map((i) => T[i]);
  const B = ids.slice(half).map((i) => T[i]);
  const rulesA = mine(0.01, 0.3, A);
  const Bsets = B.map((b) => app.dedupeBasket(b));
  let stillPass = 0;
  const ratios = [];
  for (const r of rulesA) {
    const m = scan(Bsets, r.antecedent, r.consequent);
    if (m.support >= 0.01 && m.confidence >= 0.3) stillPass += 1;
    ratios.push(m.lift / r.lift);
  }
  ratios.sort((a, b) => a - b);
  console.log(`half A: ${A.length} baskets, ${rulesA.length} rules at 1%/30%`);
  console.log(`same rules in half B: ${stillPass} (${pct(stillPass / rulesA.length, 1)}) still pass both thresholds; median lift(B)/lift(A)=${ratios[Math.floor(ratios.length / 2)].toFixed(3)}`);
  const ra = findRule(rulesA, [GREEN], [ROSES]);
  show("teacup rule, half A", scan(A.map((b) => app.dedupeBasket(b)), [GREEN], [ROSES]));
  show("teacup rule, half B", scan(Bsets, [GREEN], [ROSES]));
  if (!ra) console.log("  (teacup rule not mined in half A)");
}
