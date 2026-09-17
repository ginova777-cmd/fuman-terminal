'use strict';
const fs = require('node:fs');
const path = require('node:path');
function audit(catalog, root) {
  const ids = ['A', 'B'].flatMap(prefix => Array.from({length: prefix === 'A' ? 19 : 24}, (_, i) => prefix + String(i + 1).padStart(2, '0')));
  const items = ids.map(id => {
    const matches = (catalog.items || []).filter(row => row.id === id);
    const row = matches[0];
    const blockers = [];
    if (matches.length !== 1) blockers.push('CATALOG_ID_COUNT');
    const anchors = (row?.candidate_code || []).map(entry => {
      const resolved = path.resolve(root, entry.file);
      const relative = path.relative(root, resolved);
      const within = relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
      const exists = within && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
      const found = exists && typeof entry.anchor === 'string' && entry.anchor.length > 0 && fs.readFileSync(resolved, 'utf8').includes(entry.anchor);
      if (!exists) blockers.push('CANDIDATE_FILE_MISSING:' + entry.file);
      else if (!found) blockers.push('CANDIDATE_ANCHOR_MISSING:' + entry.file + ':' + entry.anchor);
      return {...entry, file_exists: exists, anchor_found: found};
    });
    if (!anchors.length) blockers.push('NO_CANDIDATE_ANCHOR');
    for (const field of ['source_fields', 'units', 'time_definition', 'writer_call', 'read_interface', 'independent_verifier', 'acceptance_cases']) {
      const value = row?.wiring?.[field];
      if (value == null || value === '' || (Array.isArray(value) && !value.length)) blockers.push('MISSING_WIRING:' + field);
    }
    return {id, item: row?.item || null, prior_wiring: row?.wiring || null, anchors, trace_blockers: blockers,
      status: 'REQUIRES_CURRENT_FIELD_LEVEL_VERIFICATION', deployment: 'NOT_PROVEN', anon_readback: 'NOT_PROVEN', natural_acceptance: 'PENDING', receipt: null};
  });
  return {contract: 'mother_pool_candidate_catalog_audit_v1', complete: false, candidate_root: root,
    specification_lock_status: catalog.specification_lock_status,
    specification_conflicts: catalog.specification_conflicts || [], scope_count: items.length,
    trace_blocked_items: items.filter(row => row.trace_blockers.length).map(row => row.id), items,
    limitation: 'Text anchors locate code only. Prior wiring is unverified historical context, not proof of execution, deployment or receipt.'};
}
module.exports = {audit};
if (require.main === module) {
  const source = process.argv.find(arg => arg.startsWith('--catalog='))?.slice(10);
  const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
  if (!source || !out) throw new Error('Required: --catalog=<existing catalog> --out=<local audit>');
  const result = audit(JSON.parse(fs.readFileSync(source, 'utf8')), path.resolve(__dirname, '..'));
  fs.mkdirSync(path.dirname(path.resolve(out)), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({scope_count: result.scope_count, trace_blocked_items: result.trace_blocked_items, complete: false, out}));
}
