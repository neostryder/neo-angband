// Reconciliation parser: ingest all parity findings (grok + codex + terra bonus),
// normalize to structured records, group by lane, sort by severity, and hint at
// cross-model duplicates (same lane + same ref-file basename). Output JSON + a
// human-readable per-lane digest for Claude to do the final semantic merge.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const AUD = 'parity/audit-2026-07-24';
const REPO = process.cwd();

const sources = [];
// per-lane files
for (const model of ['grok', 'codex']) {
  const dir = join(AUD, 'findings', model);
  if (existsSync(dir)) for (const f of readdirSync(dir).filter(x => x.endsWith('.md')))
    sources.push({ model, file: join(dir, f) });
}
// shared files (grok L1-L2, terra L1-L3 bonus)
if (existsSync('parity_findings_grok.md'))  sources.push({ model: 'grok',  file: 'parity_findings_grok.md' });
if (existsSync('parity_findings_terra.md')) sources.push({ model: 'terra', file: 'parity_findings_terra.md' });

const field = (block, key) => {
  const m = block.match(new RegExp('^' + key + ':\\s*(.*)$', 'mi'));
  return m ? m[1].trim() : '';
};
const refFileOf = (s) => {
  const m = (s || '').match(/([\w./-]+\.(c|h|ts|txt|json|prf|png|mp3|fon|woff2?))/i);
  return m ? basename(m[1]) : '';
};

const all = [];
const seenId = new Set();
for (const { model, file } of sources) {
  let txt; try { txt = readFileSync(file, 'utf8'); } catch { continue; }
  const parts = txt.split(/^### /m).slice(1);
  for (const p of parts) {
    const head = p.split('\n')[0].trim();
    const idm = head.match(/^([A-Za-z0-9]+_[a-z_]+-\d+)\s*(.*)$/) || head.match(/^(\S+)\s*(.*)$/);
    const id = idm ? idm[1] : head;
    const title = idm ? idm[2] : '';
    const lane = (id.match(/^([A-Za-z0-9]+_[a-z_]+)-/) || [])[1] || 'unknown';
    const rec = {
      model, lane, id, title,
      sev: (field(p, 'sev') || 'P?').toUpperCase().replace(/[^P0-9?]/g, ''),
      concession: field(p, 'concession') || '?',
      ref: field(p, 'ref'), port: field(p, 'port'),
      expected: field(p, 'expected'), actual: field(p, 'actual'),
      why: field(p, 'why'), confidence: field(p, 'confidence'),
    };
    rec.refFile = refFileOf(rec.ref);
    const dedupKey = model + '|' + id + '|' + rec.ref;
    if (seenId.has(dedupKey)) continue;   // guard against a lane appearing in both shared + per-lane
    seenId.add(dedupKey);
    all.push(rec);
  }
}

// group by lane
const byLane = {};
for (const r of all) (byLane[r.lane] ??= []).push(r);
const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3, 'P?': 4 };
const lanes = Object.keys(byLane).sort();

let md = `# Reconciliation digest (auto-generated)\n\nTotal findings ingested: ${all.length}\n\n`;
md += `## Counts by model\n`;
for (const m of ['grok', 'codex', 'terra'])
  md += `- ${m}: ${all.filter(r => r.model === m).length}\n`;
md += `\n## Counts by severity\n`;
for (const s of ['P0','P1','P2','P3','P?'])
  md += `- ${s}: ${all.filter(r => r.sev === s).length}\n`;

for (const lane of lanes) {
  const rs = byLane[lane].sort((a,b) => (sevRank[a.sev]??9)-(sevRank[b.sev]??9));
  const gm = rs.filter(r=>r.model==='grok').length, cx = rs.filter(r=>r.model==='codex').length, tr = rs.filter(r=>r.model==='terra').length;
  md += `\n---\n## ${lane}  (grok=${gm} codex=${cx} terra=${tr})\n`;
  // cross-model dup hints: same refFile touched by >1 model
  const byRefFile = {};
  for (const r of rs) if (r.refFile) (byRefFile[r.refFile] ??= new Set()).add(r.model);
  const overlaps = Object.entries(byRefFile).filter(([,ms]) => ms.size > 1).map(([f]) => f);
  if (overlaps.length) md += `_cross-model overlap on: ${overlaps.join(', ')}_\n`;
  for (const r of rs) {
    md += `\n- **[${r.sev}] ${r.id}** (${r.model}, conc:${r.concession}, conf:${r.confidence})  ${r.title}\n`;
    md += `  - ref: \`${r.ref}\`  port: \`${r.port}\`\n`;
    if (r.expected) md += `  - exp: ${r.expected}\n`;
    if (r.actual)   md += `  - act: ${r.actual}\n`;
  }
}

writeFileSync(join(AUD, 'RECONCILE_DIGEST.md'), md);
writeFileSync(join(AUD, 'findings-merged.json'), JSON.stringify(all, null, 2));
console.log(`parsed ${all.length} findings from ${sources.length} sources across ${lanes.length} lanes`);
console.log(`grok=${all.filter(r=>r.model==='grok').length} codex=${all.filter(r=>r.model==='codex').length} terra=${all.filter(r=>r.model==='terra').length}`);
for (const s of ['P0','P1','P2','P3']) console.log(`  ${s}: ${all.filter(r=>r.sev===s).length}`);
