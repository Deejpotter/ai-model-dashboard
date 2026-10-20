const D = require('better-sqlite3');
const db = new D('data/models.db', { readonly: true });
const q = (s) => db.prepare(s).all();

console.log('Distinct models with benchmarks:', db.prepare('SELECT COUNT(DISTINCT model_id) as c FROM benchmarks').get().c);
console.log('Total benchmark rows:', db.prepare('SELECT COUNT(*) as c FROM benchmarks').get().c);
console.log('\nBy source:');
q('SELECT source, COUNT(*) rows, COUNT(DISTINCT model_id) models FROM benchmarks GROUP BY source').forEach(r => console.log(`  ${r.source}: ${r.rows} rows / ${r.models} models`));

console.log('\nBy metric (distinct models):');
q('SELECT metric, COUNT(DISTINCT model_id) models FROM benchmarks GROUP BY metric ORDER BY models DESC').forEach(r => console.log(`  ${r.metric}: ${r.models}`));

console.log('\nDuplicate check (same model+source+metric more than once):');
console.log('  ', db.prepare('SELECT COUNT(*) as c FROM (SELECT model_id, source, metric FROM benchmarks GROUP BY model_id, source, metric HAVING COUNT(*) > 1)').get().c);

console.log('\nSample rows for deepseek-v4-flash:');
q("SELECT model_id, source, metric, value FROM benchmarks WHERE model_id LIKE '%deepseek-v4-flash%' ORDER BY model_id, source, metric LIMIT 20").forEach(r => console.log(`  ${r.model_id} | ${r.source} | ${r.metric} | ${r.value}`));

console.log('\nCitation + as_of present on all rows:');
const missing = db.prepare("SELECT COUNT(*) as c FROM benchmarks WHERE citation IS NULL OR as_of IS NULL").get().c;
console.log('  missing citation/as_of:', missing);
db.close();
