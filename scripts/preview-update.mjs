#!/usr/bin/env node
/**
 * dsh-version-badge-own - update preview / release-notes generator
 * ---------------------------------------------------------------
 * Purpose: before updating anything, show WHAT the new version has.
 * User decides: full update / partial files only / skip.
 *
 * Modes
 *   node preview-update.mjs                       preview all updatable plugins
 *   node preview-update.mjs --only a,b            preview selected only
 *   node preview-update.mjs --filelist            also print full file list
 *   node preview-update.mjs --select a:v1.2.3:dist,lib    partial update selection
 *
 * Output
 *   D:\DSH\_tmp\update-runner\preview.json         machine readable
 *   D:\DSH\_tmp\update-runner\preview.txt          human readable
 *
 * Exit codes
 *   0 ok / 1 bad args / 2 nothing to update / 3 fetch failed
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const DSH_HOME = path.join(HOME, '.dsh');
const PLUGINS_DIR = 'D:\\DSH\\plugins';
const BADGE_JSON = path.join(DSH_HOME, 'version-badge-plugins.json');
const WORK_DIR = 'D:\\DSH\\_tmp\\update-runner';
const STAGING = path.join(WORK_DIR, '_preview');
const PREVIEW_JSON = path.join(WORK_DIR, 'preview.json');
const PREVIEW_TXT = path.join(WORK_DIR, 'preview.txt');
const SELECTION_FILE = path.join(WORK_DIR, 'selection.json');
const LOG_FILE = path.join(WORK_DIR, 'preview.log');

function ensure() {
  for (const d of [WORK_DIR, STAGING]) fs.mkdirSync(d, { recursive: true });
}
function nowIso() { return new Date().toISOString(); }
function log(phase, msg, extra) {
  const line = [nowIso(), phase, msg, extra ? JSON.stringify(extra) : ''].filter(Boolean).join(' | ');
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  console.log(line);
}
function readJson(p, fb = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; }
}
function writeJson(p, o) {
  const t = p + '.tmp-' + process.pid;
  fs.writeFileSync(t, JSON.stringify(o, null, 2) + '\n', 'utf8');
  fs.renameSync(t, p);
}
function walkFiles(root, base = root, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else out.push({ rel: path.relative(base, full).replace(/\\/g, '/'), size: fs.statSync(full).size });
  }
  return out;
}
function dirSize(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else { try { total += fs.statSync(full).size; } catch {} }
    }
  }
  return total;
}

// ---------------------------------------------------------------- fetch

function fetchPackage(name, version) {
  const dst = path.join(STAGING, `${name.replace(/[/\\]/g, '_')}@${version}`);
  if (fs.existsSync(path.join(dst, 'package', 'package.json'))) {
    log('cache', `use cached ${name}@${version}`);
    return path.join(dst, 'package');
  }
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  log('fetch', `npm pack ${name}@${version}`);
  execFileSync('npm', ['pack', `${name}@${version}`, '--pack-destination', dst, '--silent'], {
    stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });
  const tgz = fs.readdirSync(dst).find(f => f.endsWith('.tgz'));
  if (!tgz) throw new Error(`npm pack produced no tgz: ${name}@${version}`);
  execFileSync('tar', ['-xzf', path.join(dst, tgz), '-C', dst], { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.rmSync(path.join(dst, tgz), { force: true });
  const out = path.join(dst, 'package');
  if (!fs.existsSync(out)) throw new Error(`no package dir: ${name}`);
  return out;
}

// ---------------------------------------------------------------- diff

function diffDirs(oldDir, newDir) {
  const oldFiles = new Map(walkFiles(oldDir).map(f => [f.rel, f.size]));
  const newFiles = new Map(walkFiles(newDir).map(f => [f.rel, f.size]));
  const added = [], removed = [], changed = [], same = [];
  for (const [rel, size] of newFiles) {
    if (!oldFiles.has(rel)) added.push({ rel, size });
    else if (oldFiles.get(rel) !== size) changed.push({ rel, size, oldSize: oldFiles.get(rel) });
    else same.push({ rel, size });
  }
  for (const [rel, size] of oldFiles) {
    if (!newFiles.has(rel)) removed.push({ rel, size });
  }
  return { added, removed, changed, same };
}

function topDirs(files) {
  const m = new Map();
  for (const f of files) {
    const seg = f.rel.includes('/') ? f.rel.split('/')[0] : '(root)';
    const cur = m.get(seg) || { dir: seg, count: 0, bytes: 0 };
    cur.count++; cur.bytes += f.size;
    m.set(seg, cur);
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

function readmeExcerpt(dir) {
  for (const n of ['README.md', 'readme.md', 'README.MD', 'CHANGELOG.md', 'CHANGELOG']) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) {
      const txt = fs.readFileSync(p, 'utf8').slice(0, 4000);
      const lines = txt.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
      return { file: n, lines };
    }
  }
  return null;
}

function detectNewFeatures(oldPkg, newPkg, diff) {
  const feats = [];
  const od = oldPkg?.dsh || {}, nd = newPkg?.dsh || {};
  const oT = (od.tools || []), nT = (nd.tools || []);
  const oToolNames = new Set(oT.map(t => typeof t === 'string' ? t : t?.name));
  for (const t of nT) {
    const nm = typeof t === 'string' ? t : t?.name;
    if (nm && !oToolNames.has(nm)) feats.push(`new tool: ${nm}`);
  }
  const oC = (od.commands || []), nC = (nd.commands || []);
  const oCmd = new Set(oC.map(c => typeof c === 'string' ? c : c?.name));
  for (const c of nC) {
    const nm = typeof c === 'string' ? c : c?.name;
    if (nm && !oCmd.has(nm)) feats.push(`new command: ${nm}`);
  }
  for (const a of diff.added) {
    if (/^(lib|dist|src)\/.*\.(js|mjs|cjs)$/.test(a.rel)) feats.push(`new module file: ${a.rel}`);
    if (/^locale\/.*\.json$/.test(a.rel)) feats.push(`new locale: ${a.rel}`);
  }
  const oMain = oldPkg?.main, nMain = newPkg?.main;
  if (nMain && oMain !== nMain) feats.push(`main entry changed: ${oMain || '(none)'} -> ${nMain}`);
  const oDeps = Object.keys(oldPkg?.dependencies || {});
  const nDeps = Object.keys(newPkg?.dependencies || {});
  const addedDeps = nDeps.filter(d => !oDeps.includes(d));
  if (addedDeps.length) feats.push(`new dependencies: ${addedDeps.join(', ')}`);
  return [...new Set(feats)];
}

// ---------------------------------------------------------------- preview one

function previewOne(item, verbose) {
  const localDir = item.localDir;
  const localPkg = readJson(path.join(localDir, 'package.json'));
  let staged;
  try {
    staged = fetchPackage(item.name, item.latest);
  } catch (e) {
    return { name: item.name, ok: false, error: String(e && e.message || e), current: item.current, latest: item.latest };
  }
  const newPkg = readJson(path.join(staged, 'package.json'));
  const diff = diffDirs(localDir, staged);
  const feats = detectNewFeatures(localPkg, newPkg, diff);
  const readme = readmeExcerpt(staged);
  const newBytes = dirSize(staged);
  const totalChanged = diff.added.length + diff.changed.length + diff.removed.length;

  const rec = {
    name: item.name,
    ok: true,
    current: item.current,
    latest: item.latest,
    kind: item.kind,
    source: item.source,
    repo: item.repo || null,
    localDir,
    summary: {
      filesInNew: diff.added.length + diff.changed.length + diff.same.length,
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removed.length,
      unchanged: diff.same.length,
      totalChanged,
      newPackageBytes: newBytes,
    },
    features: feats,
    readme,
    groups: {
      addedByDir: topDirs(diff.added).slice(0, 12),
      changedByDir: topDirs(diff.changed).slice(0, 12),
      removedByDir: topDirs(diff.removed).slice(0, 12),
    },
    selectableDirs: [...new Set([
      ...diff.added.map(f => f.rel.includes('/') ? f.rel.split('/')[0] : '(root)'),
      ...diff.changed.map(f => f.rel.includes('/') ? f.rel.split('/')[0] : '(root)'),
    ])].sort(),
  };
  if (verbose) {
    rec.files = {
      added: diff.added,
      changed: diff.changed,
      removed: diff.removed,
    };
  }
  return rec;
}

// ---------------------------------------------------------------- render

function renderText(previews) {
  const L = [];
  L.push('='.repeat(72));
  L.push('  DSH plugin update preview');
  L.push('  generated: ' + nowIso());
  L.push('='.repeat(72));
  if (!previews.length) {
    L.push('');
    L.push('  Nothing to update. All plugins are at the latest version.');
    return L.join('\n');
  }
  for (const p of previews) {
    L.push('');
    L.push('-'.repeat(72));
    L.push(`  ${p.name}   ${p.current}  ->  ${p.latest}   [${p.kind}/${p.source || '?'}]`);
    if (p.repo) L.push(`  repo: ${p.repo}`);
    L.push('-'.repeat(72));
    if (!p.ok) {
      L.push('  FETCH FAILED: ' + p.error);
      continue;
    }
    const s = p.summary;
    L.push(`  files: +${s.added}  ~${s.changed}  -${s.removed}  (=${s.unchanged} unchanged)`);
    L.push(`  new package size: ${(s.newPackageBytes / 1024).toFixed(1)} KB`);
    L.push('');
    if (p.features.length) {
      L.push('  WHAT IS NEW:');
      for (const f of p.features.slice(0, 25)) L.push('    * ' + f);
      if (p.features.length > 25) L.push(`    ... and ${p.features.length - 25} more`);
    } else {
      L.push('  WHAT IS NEW: (no structural change detected; likely bugfix only)');
    }
    L.push('');
    if (p.readme) {
      L.push(`  README/CHANGELOG (${p.readme.file}) excerpt:`);
      for (const ln of p.readme.lines) L.push('    | ' + ln);
      L.push('');
    }
    if (p.groups.addedByDir.length) {
      L.push('  ADDED files by directory:');
      for (const g of p.groups.addedByDir) L.push(`    + ${g.dir.padEnd(20)} ${String(g.count).padStart(3)} files  ${(g.bytes / 1024).toFixed(1)} KB`);
      L.push('');
    }
    if (p.groups.changedByDir.length) {
      L.push('  CHANGED files by directory:');
      for (const g of p.groups.changedByDir) L.push(`    ~ ${g.dir.padEnd(20)} ${String(g.count).padStart(3)} files  ${(g.bytes / 1024).toFixed(1)} KB`);
      L.push('');
    }
    if (p.groups.removedByDir.length) {
      L.push('  REMOVED files by directory:');
      for (const g of p.groups.removedByDir) L.push(`    - ${g.dir.padEnd(20)} ${String(g.count).padStart(3)} files`);
      L.push('');
    }
    L.push('  SELECTABLE DIRS (for partial update): ' + (p.selectableDirs.join(', ') || '(none)'));
    if (p.files) {
      L.push('');
      L.push('  FULL FILE LIST:');
      for (const f of p.files.added) L.push(`    + ${f.rel}  (${f.size} B)`);
      for (const f of p.files.changed) L.push(`    ~ ${f.rel}  (${f.oldSize} -> ${f.size} B)`);
      for (const f of p.files.removed) L.push(`    - ${f.rel}  (${f.size} B)`);
    }
  }
  L.push('');
  L.push('='.repeat(72));
  L.push('  HOW TO DECIDE');
  L.push('='.repeat(72));
  L.push('');
  L.push('  A) Update everything:');
  L.push('       node update-runner.mjs --apply');
  L.push('');
  L.push('  B) Update only selected plugins:');
  L.push('       node update-runner.mjs --apply --only name1,name2');
  L.push('');
  L.push('  C) Partial update: only selected directories of a plugin');
  L.push('       node preview-update.mjs --select name:version:dir1,dir2');
  L.push('       node update-runner.mjs --apply-partial');
  L.push('');
  L.push('  D) Skip: do nothing.');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------- selection

function writeSelection(args) {
  // args like ["pkg@1.2.3:dist,lib", "pkg2@2.0.0:lib"]
  const sel = { at: nowIso(), items: [] };
  for (const a of args) {
    const m = String(a).match(/^([^:]+):(.+)$/);
    if (!m) { console.error('bad --select format, want name:ver:dir1,dir2 -> ' + a); return 1; }
    const left = m[1];
    const dirs = m[2].split(',').map(s => s.trim()).filter(Boolean);
    const at = left.lastIndexOf('@');
    const name = at > 0 ? left.slice(0, at) : left;
    const version = at > 0 ? left.slice(at + 1) : null;
    sel.items.push({ name, version, dirs });
  }
  writeJson(SELECTION_FILE, sel);
  console.log('selection written: ' + SELECTION_FILE);
  for (const it of sel.items) console.log(`  ${it.name} ${it.version || '(latest)'} dirs=${it.dirs.join(',')}`);
  return 0;
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const valueOf = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const valuesOf = f => {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === f && argv[i + 1]) out.push(argv[i + 1]);
  return out;
};

try {
  ensure();

  if (has('--select')) {
    const list = valuesOf('--select');
    process.exit(writeSelection(list));
  }

  const badge = readJson(BADGE_JSON);
  if (!badge || !Array.isArray(badge.plugins)) {
    console.error('cannot read version-badge-plugins.json; let the badge plugin run once first');
    process.exit(3);
  }
  let updates = badge.plugins.filter(p => p.hasUpdate);
  const only = valueOf('--only');
  if (only) {
    const names = only.split(',').map(s => s.trim());
    updates = updates.filter(p => names.includes(p.name));
  }
  if (!updates.length) {
    const txt = renderText([]);
    fs.writeFileSync(PREVIEW_TXT, txt, 'utf8');
    writeJson(PREVIEW_JSON, { at: nowIso(), items: [] });
    console.log(txt);
    process.exit(2);
  }

  const verbose = has('--filelist');
  const previews = [];
  for (const p of updates) {
    const localDir = path.join(PLUGINS_DIR, p.name);
    const item = {
      name: p.name,
      current: p.version,
      latest: p.latest,
      kind: p.kind,
      source: p.source,
      repo: p.repo,
      localDir,
    };
    log('preview', `inspecting ${p.name} ${p.version} -> ${p.latest}`);
    const rec = previewOne(item, verbose);
    previews.push(rec);
    if (rec.ok) {
      log('preview', `${p.name}: +${rec.summary.added} ~${rec.summary.changed} -${rec.summary.removed}, features=${rec.features.length}`);
    } else {
      log('preview', `${p.name}: FETCH FAILED ${rec.error}`);
    }
  }

  const txt = renderText(previews);
  fs.writeFileSync(PREVIEW_TXT, txt, 'utf8');
  writeJson(PREVIEW_JSON, { at: nowIso(), dshVersion: null, items: previews });
  console.log(txt);
  console.log('preview.json: ' + PREVIEW_JSON);
  console.log('preview.txt : ' + PREVIEW_TXT);
  process.exit(0);
} catch (e) {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
}
