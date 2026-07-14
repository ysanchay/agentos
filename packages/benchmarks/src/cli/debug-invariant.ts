import { createDefaultBenchmarkSuite, getSpecById } from '../index.js';

async function main(): Promise<void> {
  const suite = createDefaultBenchmarkSuite({
    totalBudget: { ru: 500_000, mu: 200_000, eu: 50_000, vu: 10_000 },
  });
  const r = await suite.runOne('MR-001');
  console.log('compliance:', r.constitutionalCompliance);
  console.log('errors:', JSON.stringify(r.errors, null, 2));
  console.log('metrics:', JSON.stringify(r.metrics, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });