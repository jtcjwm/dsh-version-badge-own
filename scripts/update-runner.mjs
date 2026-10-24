#!/usr/bin/env node
/**
 * dsh-version-badge-own · 插件更新编排器
 * ---------------------------------------------------------------
 * 设计原则
 *  1. 半自动：只发现 + 准备，绝不自行更新。两个确认点都必须人工放行。
 *  2. 可回滚：每次动盘前先快照；单插件替换失败只回滚该插件。
 *  3. 不依赖 DSH 工具系统：纯 Node + 文件系统，最小环境下也能跑。
 *  4. 原子替换：先下到 _staging，校验通过再换位。
 *
 * 用法
 *   node update-runner.mjs --plan                 发现更新，写清单，不动磁盘
 *   node update-runner.mjs --apply                执行清单里的更新（需先 --plan）
 *   node update-runner.mjs --apply --only a,b     只更新指定插件
 *   node update-runner.mjs --rollback <ts>        回滚到指定快照
 *   node update-runner.mjs --status               看当前状态与上次结果
 *
 * 退出码
 *   0 成功 / 1 参数错 / 2 有插件更新失败 / 3 兼容性闸拦截
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const HOME = os.homedir();
const DSH_HOME = path.join(HOME, '.dsh');
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'desktop');
const PROFILE_PKG = path.join(PROFILE_DIR, 'package.json');
const BADGE_JSON = path.join(DSH_HOME, 'version-badge-plugins.json');
const PLUGINS_DIR = 'D:\\DSH\\plugins';
const WORK_DIR = 'D:\\DSH\\_tmp\\update-runner';
const STAGING_DIR = path.join(WORK_DIR, '_staging');
const SNAPSHOT_ROOT = 'D:\\DSH\\备份\\插件更新快照';
const LOG_FILE = path.join(WORK_DIR, 'update-runner.log');
const PLAN_FILE = path.join(WORK_DIR, 'plan.json');
const STATE_FILE = path.join(WORK_DIR, 'state.json');

const DSH_VERSION = (() => {
  try {
    const p = 'C:\\Users\\L1772\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app\\dsh\\package.json';
    return JSON.parse(fs.readFileSync(p, 'utf8')).version;
  } catch { return 'unknown'; }
})();

// ---------------------------------------------------------------- 基础设施

function ensureDirs() {
  for (const d of [WORK_DIR, STAGING_DIR, SNAPSHOT_ROOT]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function nowIso() { return new Date().toISOString(); }
function ts() { return nowIso().replace(/[:.]/g, '-'); }

function log(phase, msg, extra) {
  const line = [nowIso(), phase, msg, extra ? JSON.stringify(extra) : ''].filter(Boolean).join(' | ');
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  console.log(line);
}

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function writeJson(p, obj) {
  const tmp = p + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function readPkgVersion(dir) {
  const j = readJson(path.join(dir, 'package.json'));
  return j ? { version: j.version, pkg: j } : null;
}

// ---------------------------------------------------------------- 发现

function discover() {
  const badge = readJson(BADGE_JSON);
  if (!badge || !Array.isArray(badge.plugins)) {
    throw new Error('读不到 version-badge-plugins.json，先让版本号插件跑一次');
  }
  const updates = badge.plugins.filter(p => p.hasUpdate);
  const items = updates.map(p => {
    const localDir = path.join(PLUGINS_DIR, p.name);
    const local = readPkgVersion(localDir);
    return {
      name: p.name,
      current: p.version,
      latest: p.latest,
      kind: p.kind,               // link / npm
      source: p.source,           // github / npm
      repo: p.repo,
      localDir,
      localExists: fs.existsSync(localDir),
      localVersion: local ? local.version : null,
      hasNodeModules: fs.existsSync(path.join(localDir, 'node_modules')),
      hasGit: fs.existsSync(path.join(localDir, '.git')),
      action: p.kind === 'npm' ? 'npm-install' : 'replace-dir',
    };
  });
  return { generatedAt: nowIso(), dshVersion: DSH_VERSION, checkedAt: badge.checkedAt, items };
}

// ---------------------------------------------------------------- 兼容闸

function compatibility(item, stagingDir) {
  const j = readJson(path.join(stagingDir, 'package.json'));
  if (!j) return { ok: false, reason: 'staging 里没有 package.json' };
  const problems = [];

  // 1) 版本必须真的升上去
  if (j.version !== item.latest) {
    problems.push(`版本不符：期望 ${item.latest}，实际 ${j.version}`);
  }

  // 2) engines 约束
  if (j.engines && j.engines.dsh && DSH_VERSION !== 'unknown') {
    const want = String(j.engines.dsh);
    if (!satisfiesSimple(DSH_VERSION, want)) {
      problems.push(`engines.dsh=${want} 不包含当前 ${DSH_VERSION}`);
    }
  }

  // 3) peerDependencies 里的 dsh 相关约束
  const peers = { ...(j.peerDependencies || {}) };
  for (const [k, v] of Object.entries(peers)) {
    if (k.startsWith('@deepseek-ai/dsh') && DSH_VERSION !== 'unknown') {
      if (!satisfiesSimple(DSH_VERSION, String(v))) {
        problems.push(`peer ${k}@${v} 不包含当前 ${DSH_VERSION}`);
      }
    }
  }

  // 4) 主入口必须存在
  const main = j.main || 'index.js';
  if (!fs.existsSync(path.join(stagingDir, main))) {
    problems.push(`主入口缺失：${main}`);
  }

  return { ok: problems.length === 0, problems, version: j.version };
}

/**
 * 极简 semver 判断。支持：
 *   *                任意版本
 *   a || b           或关系，任一满足即可
 *   ^a.b.c           同主版本且 >=（0.x 时锁次版本）
 *   ~a.b.c           同主次且 >=
 *   >=a / >a / <=a / <a
 *   a.b.c            精确匹配（含预发布标签，如 0.2.1-rc.2）
 */
function satisfiesSimple(actual, range) {
  const r0 = String(range).trim();
  if (!r0) return true;
  if (r0.includes('||')) return r0.split('||').some(p => satisfiesSimple(actual, p.trim()));
  if (r0 === '*' || r0 === 'x' || r0 === 'latest') return true;

  const parse = s => {
    const m = String(s).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.\-]+))?/);
    return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' } : null;
  };
  const a = parse(actual);
  if (!a) return false;
  const cmp = (x, t) => (x.major - t.major) || (x.minor - t.minor) || (x.patch - t.patch);

  if (r0.startsWith('^')) {
    const t = parse(r0.slice(1));
    if (!t) return false;
    if (t.major !== 0) return a.major === t.major && cmp(a, t) >= 0;
    return a.major === 0 && a.minor === t.minor && cmp(a, t) >= 0;
  }
  if (r0.startsWith('~')) {
    const t = parse(r0.slice(1));
    if (!t) return false;
    return a.major === t.major && a.minor === t.minor && cmp(a, t) >= 0;
  }
  if (r0.startsWith('>=')) { const t = parse(r0.slice(2)); return t ? cmp(a, t) >= 0 : false; }
  if (r0.startsWith('<=')) { const t = parse(r0.slice(2)); return t ? cmp(a, t) <= 0 : false; }
  if (r0.startsWith('>'))  { const t = parse(r0.slice(1)); return t ? cmp(a, t) > 0 : false; }
  if (r0.startsWith('<'))  { const t = parse(r0.slice(1)); return t ? cmp(a, t) < 0 : false; }

  const t = parse(r0);
  if (!t) return actual === r0;
  return cmp(a, t) === 0 && a.pre === t.pre;
}

// ---------------------------------------------------------------- 快照

function snapshot(tag) {
  const dir = path.join(SNAPSHOT_ROOT, `${tag}`);
  fs.mkdirSync(dir, { recursive: true });
  // 声明层
  for (const f of ['package.json', 'cordis.patch.yml']) {
    const src = path.join(PROFILE_DIR, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  // 插件包定义（只要 package.json，不复制 node_modules）
  const pkgIndex = {};
  for (const n of fs.readdirSync(PLUGINS_DIR)) {
    const pj = path.join(PLUGINS_DIR, n, 'package.json');
    const j = readJson(pj);
    if (j) {
      pkgIndex[n] = { version: j.version };
      const dst = path.join(dir, 'plugins-pkg', n);
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(pj, path.join(dst, 'package.json'));
    }
  }
  writeJson(path.join(dir, 'index.json'), { tag, at: nowIso(), dshVersion: DSH_VERSION, pkgIndex });
  log('snapshot', `快照完成 ${dir}`, { plugins: Object.keys(pkgIndex).length });
  return dir;
}

// ---------------------------------------------------------------- 下载

function fetchPackage(name, version) {
  const dst = path.join(STAGING_DIR, `${name}@${version}`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  log('fetch', `下载 ${name}@${version}`);
  execFileSync('npm', ['pack', `${name}@${version}`, '--pack-destination', dst, '--silent'], {
    stdio: ['ignore', 'pipe', 'pipe'], shell: true,
  });
  const tgz = fs.readdirSync(dst).find(f => f.endsWith('.tgz'));
  if (!tgz) throw new Error(`npm pack 没有产出 tgz: ${name}@${version}`);
  execFileSync('tar', ['-xzf', path.join(dst, tgz), '-C', dst], { stdio: ['ignore', 'pipe', 'pipe'] });
  fs.rmSync(path.join(dst, tgz), { force: true });
  const extracted = path.join(dst, 'package');
  if (!fs.existsSync(extracted)) throw new Error(`解包后没有 package 目录: ${name}`);
  return extracted;
}

// ---------------------------------------------------------------- 替换

function replacePlugin(item, stagedDir, snapDir) {
  const target = item.localDir;
  const backup = path.join(snapDir, 'plugins-full', item.name);

  // 1) 整目录备份（含 node_modules，保证能原样退回）
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  log('backup', `备份 ${item.name} -> ${backup}`);
  fs.cpSync(target, backup, { recursive: true });

  // 2) 备份 node_modules 到暂存位，替换后原样放回
  const nmSrc = path.join(target, 'node_modules');
  const nmTmp = path.join(STAGING_DIR, `_nm-${item.name}`);
  const hadNm = fs.existsSync(nmSrc);
  if (hadNm) {
    fs.rmSync(nmTmp, { recursive: true, force: true });
    fs.renameSync(nmSrc, nmTmp);
  }

  // 3) 合并式写入：只覆盖/新增新包内文件，不删除旧目录独有文件
  //    tools/、docs/、pnpm-lock.yaml、assets 等必须保留
  let written = 0;
  const walk = (srcDir, dstDir) => {
    fs.mkdirSync(dstDir, { recursive: true });
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const s = path.join(srcDir, ent.name);
      const d = path.join(dstDir, ent.name);
      if (ent.isDirectory()) walk(s, d);
      else { fs.copyFileSync(s, d); written++; }
    }
  };
  walk(stagedDir, target);

  // 4) 放回 node_modules（新包若自带则以新包为准）
  const dstNm = path.join(target, 'node_modules');
  const stagedHasNm = fs.existsSync(path.join(stagedDir, 'node_modules'));
  if (hadNm) {
    if (stagedHasNm) {
      fs.rmSync(nmTmp, { recursive: true, force: true });
    } else {
      fs.rmSync(dstNm, { recursive: true, force: true });
      fs.renameSync(nmTmp, dstNm);
    }
  }

  // 5) 校验版本与主入口
  const after = readPkgVersion(target);
  if (!after || after.version !== item.latest) {
    throw new Error(`替换后版本不符：期望 ${item.latest}，实际 ${after && after.version}`);
  }
  const main = after.pkg.main || 'index.js';
  if (!fs.existsSync(path.join(target, main))) {
    throw new Error(`替换后主入口缺失：${main}`);
  }
  log('replace', `替换完成 ${item.name} ${item.current} -> ${after.version}`, { filesWritten: written, keptNodeModules: hadNm });
  return after.version;
}

// ---------------------------------------------------------------- 主流程

function cmdPlan() {
  ensureDirs();
  const d = discover();
  const plan = { ...d, mode: 'plan', snapshotTag: null };
  writeJson(PLAN_FILE, plan);
  log('plan', `发现 ${d.items.length} 个可更新插件`);
  console.log('\n=== 可更新插件（未做任何改动）===');
  for (const it of d.items) {
    console.log(`  ${it.name}  ${it.current} -> ${it.latest}  [${it.action}]  node_modules=${it.hasNodeModules} git=${it.hasGit}`);
  }
  console.log(`\n清单已写: ${PLAN_FILE}`);
  console.log('确认无误后执行: node update-runner.mjs --apply');
  return 0;
}

function cmdApply(onlyList) {
  ensureDirs();
  const plan = readJson(PLAN_FILE);
  if (!plan || !plan.items) {
    console.error('没有 plan，先跑 --plan');
    return 1;
  }
  let items = plan.items;
  if (onlyList && onlyList.length) {
    items = items.filter(i => onlyList.includes(i.name));
  }
  if (!items.length) { console.log('没有要更新的插件'); return 0; }

  const tag = ts();
  const snapDir = snapshot(`update-${tag}`);
  plan.snapshotTag = tag;
  writeJson(PLAN_FILE, plan);

  const results = [];
  let failCount = 0;

  for (const it of items) {
    const rec = { name: it.name, from: it.current, to: it.latest, status: 'pending' };
    try {
      if (it.action === 'npm-install') {
        log('apply', `npm 类型，跳过整目录替换: ${it.name}`);
        rec.status = 'skipped-npm';
        rec.note = 'npm 依赖型插件请用 pnpm 更新 profile 依赖';
        results.push(rec);
        continue;
      }
      const staged = fetchPackage(it.name, it.latest);
      const compat = compatibility(it, staged);
      if (!compat.ok) {
        rec.status = 'blocked';
        rec.problems = compat.problems;
        log('compat', `拦截 ${it.name}`, compat.problems);
        failCount++;
        results.push(rec);
        continue;
      }
      const v = replacePlugin(it, staged, snapDir);
      rec.status = 'ok';
      rec.installedVersion = v;
      results.push(rec);
    } catch (e) {
      rec.status = 'failed';
      rec.error = String(e && e.message || e);
      log('error', `${it.name} 更新失败: ${rec.error}`);
      // 单插件回滚
      try {
        const backup = path.join(snapDir, 'plugins-full', it.name);
        if (fs.existsSync(backup)) {
          fs.rmSync(it.localDir, { recursive: true, force: true });
          fs.cpSync(backup, it.localDir, { recursive: true });
          rec.rolledBack = true;
          log('rollback', `${it.name} 已回滚`);
        }
      } catch (e2) {
        rec.rollbackError = String(e2 && e2.message || e2);
        log('error', `${it.name} 回滚失败: ${rec.rollbackError}`);
      }
      failCount++;
      results.push(rec);
    }
  }

  const state = { at: nowIso(), tag, dshVersion: DSH_VERSION, results };
  writeJson(STATE_FILE, state);

  console.log('\n=== 更新结果 ===');
  for (const r of results) {
    console.log(`  ${r.name}  ${r.from} -> ${r.to}  ${r.status}${r.rolledBack ? ' (已回滚)' : ''}${r.problems ? '  ' + r.problems.join('; ') : ''}`);
  }
  console.log(`\n快照: ${snapDir}`);
  console.log(`状态: ${STATE_FILE}`);
  console.log('需要重启 DSH 让新版本生效。');
  return failCount ? 2 : 0;
}

function cmdStatus() {
  ensureDirs();
  const plan = readJson(PLAN_FILE);
  const state = readJson(STATE_FILE);
  console.log('DSH 版本:', DSH_VERSION);
  console.log('plan:', plan ? `${plan.generatedAt} ${plan.items.length} 项` : '无');
  console.log('last apply:', state ? `${state.at} tag=${state.tag}` : '无');
  if (state) {
    for (const r of state.results) console.log(`  ${r.name} ${r.status}`);
  }
  return 0;
}

function cmdRollback(tag) {
  const dir = path.join(SNAPSHOT_ROOT, tag);
  if (!fs.existsSync(dir)) { console.error('快照不存在:', dir); return 1; }
  for (const f of ['package.json', 'cordis.patch.yml']) {
    const src = path.join(dir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(PROFILE_DIR, f));
      log('rollback', `恢复 ${f}`);
    }
  }
  const full = path.join(dir, 'plugins-full');
  if (fs.existsSync(full)) {
    for (const n of fs.readdirSync(full)) {
      const src = path.join(full, n);
      const dst = path.join(PLUGINS_DIR, n);
      fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(src, dst, { recursive: true });
      log('rollback', `恢复插件 ${n}`);
    }
  }
  console.log('回滚完成，请重启 DSH');
  return 0;
}

// ---------------------------------------------------------------- 自我适配

const SELF_DIR = 'D:\\DSH\\plugins\\dsh-version-badge-own';
const SELF_PKG = path.join(SELF_DIR, 'package.json');
const SELF_PATCH = path.join(SELF_DIR, 'cordis.patch.yml');
const DSH_NODE_MODULES = 'C:\\Users\\L1772\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app\\dsh\\node_modules';

/** 收集自检发现项 */
function selfInspect() {
  const findings = [];
  const j = readJson(SELF_PKG);
  if (!j) {
    findings.push({ level: 'fatal', area: 'package.json', msg: '读不到 package.json' });
    return { pkg: null, findings };
  }

  const add = (level, area, msg, fix) => findings.push({ level, area, msg, fix });

  // 1) 依赖版本范围是否覆盖当前 DSH
  const deps = { ...(j.dependencies || {}), ...(j.peerDependencies || {}) };
  for (const [k, v] of Object.entries(deps)) {
    if (!k.startsWith('@deepseek-ai/')) continue;
    if (DSH_VERSION === 'unknown') continue;
    if (!satisfiesSimple(DSH_VERSION, String(v))) {
      add('warn', 'deps', `${k}@${v} 范围不覆盖当前 DSH ${DSH_VERSION}`,
        { type: 'bump-range', key: k, from: String(v), to: `^${DSH_VERSION}` });
    }
  }

  // 2) main / exports 指向的文件是否存在
  const main = j.main;
  if (main && !fs.existsSync(path.join(SELF_DIR, main))) {
    add('fatal', 'entry', `main 指向的 ${main} 不存在`, { type: 'set-main', to: './lib/index.js' });
  }
  if (j.exports && typeof j.exports === 'object') {
    for (const [sub, target] of Object.entries(j.exports)) {
      const p = typeof target === 'string' ? target : (target && (target.default || target.import));
      if (typeof p === 'string' && p.startsWith('./') && !p.includes('*') && !fs.existsSync(path.join(SELF_DIR, p))) {
        add('fatal', 'exports', `exports["${sub}"] 指向的 ${p} 不存在`, null);
      }
      // 通配符导出（如 ./locale/*.json）：按目录存在性判断，不做字面 existsSync
      if (typeof p === 'string' && p.includes('*')) {
        const baseDir = path.join(SELF_DIR, path.dirname(p.split('*')[0]));
        if (!fs.existsSync(baseDir)) {
          add('warn', 'exports', `exports["${sub}"] 的通配目录 ${baseDir} 不存在`, null);
        }
      }
    }
  }

  // 3) dsh 契约字段
  const dsh = j.dsh || {};
  if (!dsh.bundle || !dsh.bundle.patch) {
    add('warn', 'dsh.bundle', '缺少 dsh.bundle.patch，插件不会被当 bundle 加载',
      { type: 'set-dsh-bundle-patch', to: './cordis.patch.yml' });
  } else if (!fs.existsSync(path.join(SELF_DIR, dsh.bundle.patch))) {
    add('fatal', 'dsh.bundle', `dsh.bundle.patch 指向的 ${dsh.bundle.patch} 不存在`, null);
  }
  if (!dsh.client || !dsh.client.platform) {
    add('warn', 'dsh.client', '缺少 dsh.client.platform，客户端 UI 不会加载',
      { type: 'set-dsh-client-platform', to: 'web' });
  } else if (dsh.client.platform !== 'web') {
    add('warn', 'dsh.client', `dsh.client.platform=${dsh.client.platform}，当前 DSH 用 web`, null);
  }

  // 4) lib 里 import 的 @deepseek-ai/* 是否真实存在
  const libDir = path.join(SELF_DIR, 'lib');
  if (fs.existsSync(libDir)) {
    for (const f of fs.readdirSync(libDir).filter(x => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(libDir, f), 'utf8');
      const re = /from\s+['"](@deepseek-ai\/[^'"]+)['"]/g;
      let m;
      while ((m = re.exec(src))) {
        const spec = m[1];
        if (!fs.existsSync(path.join(DSH_NODE_MODULES, spec))) {
          add('warn', 'import', `lib/${f} 引用的 ${spec} 在宿主 node_modules 里不存在`, null);
        }
      }
    }
  }

  // 5) 自己的 patch 引用的插件 id 是否存在于当前 DSH
  if (fs.existsSync(SELF_PATCH)) {
    const txt = fs.readFileSync(SELF_PATCH, 'utf8');
    const ids = [...txt.matchAll(/^\s*-\s*id:\s*([^\s#]+)/gm)].map(x => x[1]);
    for (const id of ids) {
      if (id.includes('/')) continue; // 子路径模块，跳过
      const hit = fs.existsSync(path.join(DSH_NODE_MODULES, id))
        || fs.existsSync(path.join(PLUGINS_DIR, id))
        || fs.existsSync(path.join(PROFILE_DIR, 'node_modules', id));
      if (!hit) add('info', 'patch', `cordis.patch.yml 引用的 id "${id}" 在本机找不到同名模块（可能只是覆盖已存在条目，可忽略）`, null);
    }
  }

  return { pkg: j, findings };
}

/** 应用可自动修的项 */
function selfAdapt(applyFixes) {
  const { pkg, findings } = selfInspect();
  if (!pkg) return 1;

  console.log(`\n=== 自检 (DSH ${DSH_VERSION}) ===`);
  if (!findings.length) {
    console.log('  未发现问题，已适配当前 DSH。');
  } else {
    for (const f of findings) {
      console.log(`  [${f.level}] ${f.area}: ${f.msg}${f.fix ? '  → 可自动修' : ''}`);
    }
  }

  const fixable = findings.filter(f => f.fix);
  console.log(`\n可自动修 ${fixable.length} 项 / 共 ${findings.length} 项`);

  if (!applyFixes) {
    if (fixable.length) console.log('执行 --self-adapt 自动修复。');
    log('self-check', `发现 ${findings.length} 项，可修 ${fixable.length} 项`);
    return fixable.length ? 3 : 0;
  }
  if (!fixable.length) { log('self-adapt', '无需修复'); return 0; }

  // 备份
  const bak = path.join(WORK_DIR, `_self\\package.json.bak-${ts()}`);
  fs.mkdirSync(path.dirname(bak), { recursive: true });
  fs.copyFileSync(SELF_PKG, bak);
  log('self-adapt', `备份 package.json -> ${bak}`);

  const changed = [];
  try {
    for (const f of fixable) {
      const fx = f.fix;
      if (fx.type === 'bump-range') {
        for (const sec of ['dependencies', 'peerDependencies']) {
          if (pkg[sec] && pkg[sec][fx.key]) { pkg[sec][fx.key] = fx.to; changed.push(`${sec}.${fx.key}: ${fx.from} -> ${fx.to}`); }
        }
      } else if (fx.type === 'set-main') {
        pkg.main = fx.to; changed.push(`main -> ${fx.to}`);
      } else if (fx.type === 'set-dsh-bundle-patch') {
        pkg.dsh = pkg.dsh || {}; pkg.dsh.bundle = pkg.dsh.bundle || {};
        pkg.dsh.bundle.patch = fx.to; changed.push(`dsh.bundle.patch -> ${fx.to}`);
      } else if (fx.type === 'set-dsh-client-platform') {
        pkg.dsh = pkg.dsh || {}; pkg.dsh.client = pkg.dsh.client || {};
        pkg.dsh.client.platform = fx.to; changed.push(`dsh.client.platform -> ${fx.to}`);
      }
    }
    // 原子写
    const tmp = SELF_PKG + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, SELF_PKG);
    log('self-adapt', '已写入', { changed });

    // 复验
    const again = selfInspect();
    const still = again.findings.filter(x => x.fix);
    console.log('\n=== 修复结果 ===');
    for (const c of changed) console.log('  改: ' + c);
    console.log(`  复验：剩余可自动修 ${still.length} 项，其余 ${again.findings.length - still.length} 项需人工判断`);
    if (still.length) { for (const s of still) console.log(`    [${s.level}] ${s.area}: ${s.msg}`); }
    console.log('\n需重启 DSH 生效。');
    log('self-adapt', `复验剩余可修 ${still.length} 项`);
    return 0;
  } catch (e) {
    log('self-adapt', '失败，回滚 package.json', { error: String(e && e.message || e) });
    try { fs.copyFileSync(bak, SELF_PKG); console.log('已从备份回滚 package.json'); } catch {}
    return 1;
  }
}

// ---------------------------------------------------------------- 部分更新

const SELECTION_FILE = path.join(WORK_DIR, 'selection.json');

/**
 * 按 selection.json 只覆盖选定目录/文件。
 * selection 形如：
 *   { at, items: [ { name, version, dirs: ["dist","lib"] } ] }
 * dirs 里 "(root)" 表示插件根目录下的散文件。
 */
function cmdApplyPartial() {
  ensureDirs();
  const sel = readJson(SELECTION_FILE);
  if (!sel || !Array.isArray(sel.items) || !sel.items.length) {
    console.error('没有 selection.json，先跑: node preview-update.mjs --select name:version:dir1,dir2');
    return 1;
  }
  const plan = readJson(PLAN_FILE);
  const badge = readJson(BADGE_JSON);
  const badgeMap = new Map(((badge && badge.plugins) || []).map(p => [p.name, p]));

  const tag = ts();
  const snapDir = path.join(SNAPSHOT_ROOT, `partial-${tag}`);
  fs.mkdirSync(snapDir, { recursive: true });

  const results = [];
  let failCount = 0;

  for (const s of sel.items) {
    const rec = { name: s.name, dirs: s.dirs, status: 'pending' };
    try {
      const bp = badgeMap.get(s.name);
      const localDir = path.join(PLUGINS_DIR, s.name);
      if (!fs.existsSync(localDir)) throw new Error(`本地插件目录不存在: ${localDir}`);
      const cur = readPkgVersion(localDir);
      rec.from = cur ? cur.version : null;
      const version = s.version || (bp && bp.latest);
      if (!version) throw new Error(`拿不到目标版本: ${s.name}`);
      rec.to = version;

      log('partial', `拉取源位包 ${s.name}@${version}`);
      const staged = fetchPackage(s.name, version);

      // 整目录备份（保证可回滚）
      const backup = path.join(snapDir, s.name);
      log('backup', `备份 ${s.name} -> ${backup}`);
      fs.cpSync(localDir, backup, { recursive: true });

      // 只覆盖选定目录
      const written = [];
      for (const d of s.dirs) {
        if (d === '(root)') {
          // 根目录散文件：只覆盖新包里真实存在于根一层的文件
          for (const ent of fs.readdirSync(staged, { withFileTypes: true })) {
            if (ent.isDirectory()) continue;
            const src = path.join(staged, ent.name);
            const dst = path.join(localDir, ent.name);
            fs.copyFileSync(src, dst);
            written.push(ent.name);
          }
        } else {
          const srcDir = path.join(staged, d);
          if (!fs.existsSync(srcDir)) { log('partial', `新包里没有目录 ${d}，跳过`); continue; }
          const dstDir = path.join(localDir, d);
          const walk = (a, b) => {
            fs.mkdirSync(b, { recursive: true });
            for (const ent of fs.readdirSync(a, { withFileTypes: true })) {
              const x = path.join(a, ent.name);
              const y = path.join(b, ent.name);
              if (ent.isDirectory()) walk(x, y);
              else { fs.copyFileSync(x, y); written.push(path.relative(staged, x).replace(/\\/g, '/')); }
            }
          };
          walk(srcDir, dstDir);
        }
      }

      // 校验：主入口存在（版本号刻意不改，部分更新不升版本）
      const after = readPkgVersion(localDir);
      const main = (after && after.pkg && after.pkg.main) || 'index.js';
      if (!fs.existsSync(path.join(localDir, main))) {
        throw new Error(`部分更新后主入口缺失: ${main}`);
      }

      rec.status = 'ok';
      rec.filesWritten = written.length;
      rec.sample = written.slice(0, 10);
      log('partial', `完成 ${s.name} 覆盖 ${written.length} 个文件`, { dirs: s.dirs });
      results.push(rec);
    } catch (e) {
      rec.status = 'failed';
      rec.error = String(e && e.message || e);
      log('error', `部分更新失败 ${s.name}: ${rec.error}`);
      try {
        const backup = path.join(snapDir, s.name);
        const localDir = path.join(PLUGINS_DIR, s.name);
        if (fs.existsSync(backup)) {
          fs.rmSync(localDir, { recursive: true, force: true });
          fs.cpSync(backup, localDir, { recursive: true });
          rec.rolledBack = true;
          log('rollback', `${s.name} 已回滚`);
        }
      } catch (e2) {
        rec.rollbackError = String(e2 && e2.message || e2);
      }
      failCount++;
      results.push(rec);
    }
  }

  writeJson(path.join(WORK_DIR, 'state-partial.json'), { at: nowIso(), tag, results });
  console.log('\n=== 部分更新结果 ===');
  for (const r of results) {
    console.log(`  ${r.name}  dirs=${(r.dirs || []).join(',')}  ${r.status}${r.filesWritten ? '  覆盖 ' + r.filesWritten + ' 文件' : ''}${r.rolledBack ? ' (已回滚)' : ''}${r.error ? '  ' + r.error : ''}`);
  }
  console.log(`\n快照: ${snapDir}`);
  console.log('需要重启 DSH 让新文件生效。');
  return failCount ? 2 : 0;
}

// ---------------------------------------------------------------- 入口

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const valueOf = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

try {
  ensureDirs();
  if (has('--plan')) process.exit(cmdPlan());
  else if (has('--apply')) {
    const only = valueOf('--only');
    process.exit(cmdApply(only ? only.split(',').map(s => s.trim()) : null));
  } else if (has('--apply-partial')) process.exit(cmdApplyPartial());
  else if (has('--status')) process.exit(cmdStatus());
  else if (has('--self-check')) process.exit(selfAdapt(false));
  else if (has('--self-adapt')) process.exit(selfAdapt(true));
  else if (has('--rollback')) {
    const t = valueOf('--rollback');
    if (!t) { console.error('--rollback 需要快照 tag'); process.exit(1); }
    process.exit(cmdRollback(t));
  } else {
    console.log(`用法:
  node update-runner.mjs --plan
  node update-runner.mjs --apply [--only a,b]
  node update-runner.mjs --status
  node update-runner.mjs --rollback <tag>`);
    process.exit(0);
  }
} catch (e) {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
}
