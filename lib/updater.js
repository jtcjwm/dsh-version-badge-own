/**
 * 更新分组器（零第三方依赖）。
 *
 * 职责：拿到一个插件「当前版本 -> 目标版本」的差异，把它翻译成
 * 人能勾选的功能组，每组带一句「会怎样」的说明。
 *
 * 分组依据（A+B 合并）：
 *   A. 文件路径聚类 —— 按顶层目录把新增/改动/删除的文件分组
 *   B. 工具/命令增量 —— 对比新旧 package.json 的 dsh.tools / dsh.commands
 *
 * 每组会算出：
 *   - files / bytes
 *   - entryTouching：是否触及 main 入口或它的依赖链（决定是否必须重启）
 *   - required：是否算「必需」（主入口 / 包声明 / 功能代码）
 *
 * 不写任何文件到目标插件目录；只在 <WORK>/_staging 下解包。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const DSH_HOME = path.join(HOME, ".dsh");
const WORK = path.join(DSH_HOME, "version-badge-updater");
const STAGING = path.join(WORK, "_staging");

/** 参与「必需」判定的顶层目录名。 */
const REQUIRED_DIRS = new Set(["lib", "dist", "mcp", "src", "bin", "build", "out"]);

/** 纯文档/测试类目录名，一律非必需。 */
const DOC_DIRS = new Set(["docs", "doc", "test", "tests", "__tests__", "examples", "example", "assets"]);

function ensureDirs() {
  for (const d of [WORK, STAGING]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

/** 递归列出目录下所有文件（跳过 node_modules / .git），返回相对路径 + 大小。 */
function walk(root, base = root, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(root, entry.name);
    let stat = null;
    try { stat = fs.lstatSync(full); } catch { continue; }
    if (stat.isDirectory()) walk(full, base, out);
    else if (stat.isFile()) {
      out.push({ rel: path.relative(base, full).replace(/\\/g, "/"), size: stat.size });
    }
  }
  return out;
}

/** 把包从 npm 拉到暂存区并解包，返回解包目录。有缓存就直接用。 */
export function fetchPackage(name, version, timeoutMs = 180000) {
  ensureDirs();
  const safe = name.replace(/[/\\@]/g, "_");
  const dir = path.join(STAGING, safe + "@" + version);
  const extracted = path.join(dir, "package");
  if (fs.existsSync(path.join(extracted, "package.json"))) {
    return { dir: extracted, cached: true };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["pack", name + "@" + version, "--pack-destination", dir, "--silent"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
    timeout: timeoutMs
  });
  const tgz = fs.readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error("npm pack 没有产出 tgz：" + name + "@" + version);
  execFileSync("tar", ["-xzf", path.join(dir, tgz), "-C", dir], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs
  });
  try { fs.rmSync(path.join(dir, tgz), { force: true }); } catch { /* ignore */ }
  if (!fs.existsSync(extracted)) throw new Error("解包后没有 package 目录：" + name);
  return { dir: extracted, cached: false };
}

/** 对比两棵目录树，返回 added / changed / removed。 */
function diffTrees(oldRoot, newRoot) {
  const oldFiles = new Map(walk(oldRoot).map((f) => [f.rel, f.size]));
  const newFiles = new Map(walk(newRoot).map((f) => [f.rel, f.size]));
  const added = [];
  const changed = [];
  const removed = [];
  const same = [];
  for (const [rel, size] of newFiles) {
    if (!oldFiles.has(rel)) added.push({ rel, size });
    else if (oldFiles.get(rel) !== size) changed.push({ rel, size, oldSize: oldFiles.get(rel) });
    else same.push({ rel, size });
  }
  for (const [rel, size] of oldFiles) {
    if (!newFiles.has(rel)) removed.push({ rel, size });
  }
  return { added, changed, removed, same };
}

/** 取相对路径的顶层段；根目录散文件返回 "(root)"。 */
function topSeg(rel) {
  return rel.includes("/") ? rel.split("/")[0] : "(root)";
}

/**
 * 判断一组文件是否触及插件主入口。
 * 规则：main 指向的文件本身、或 main 所在目录下的任何文件，算触及。
 */
function isEntryTouching(files, mainRel) {
  if (!mainRel) return false;
  const mainDir = mainRel.includes("/") ? mainRel.split("/").slice(0, -1).join("/") : "";
  for (const f of files) {
    if (f.rel === mainRel) return true;
    if (mainDir !== "" && f.rel.startsWith(mainDir + "/")) return true;
  }
  return false;
}

/** 从 package.json 抽出工具名集合（兼容字符串数组与对象数组两种写法）。 */
function toolNames(pkg) {
  const raw = pkg && pkg.dsh && pkg.dsh.tools;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === "string") out.push(item);
    else if (item && typeof item === "object" && typeof item.name === "string") out.push(item.name);
  }
  return out;
}

/** 从 package.json 抽出命令名集合。 */
function commandNames(pkg) {
  const raw = pkg && pkg.dsh && pkg.dsh.commands;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (typeof item === "string") out.push(item);
    else if (item && typeof item === "object" && typeof item.name === "string") out.push(item.name);
  }
  return out;
}

/** 从 README 里摘出与目标版本相关的更新说明片段。 */
function readmeExcerpt(newRoot, targetVersion) {
  const names = ["README.md", "readme.md", "README.MD", "CHANGELOG.md", "CHANGELOG", "CHANGELOG.md"];
  for (const n of names) {
    const file = path.join(newRoot, n);
    if (!fs.existsSync(file)) continue;
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    // 优先找含目标版本号的那一段
    const hitIndex = lines.findIndex((l) => l.includes(targetVersion));
    if (hitIndex >= 0) {
      const slice = lines.slice(hitIndex, hitIndex + 8).map((l) => l.replace(/^[#>\s*-]+/, "").trim()).filter(Boolean);
      if (slice.length > 0) return { file: n, lines: slice.slice(0, 6) };
    }
    // 退而求其次：取开头有内容的 6 行
    const head = lines.map((l) => l.trim()).filter(Boolean).slice(0, 6);
    if (head.length > 0) return { file: n, lines: head };
  }
  return null;
}

/**
 * 给一个分组生成「名字（会怎样）」。
 * 名字短、说明直白：一眼看出「这条是什么、装了会得到什么」。
 */
function labelForGroup(seg, meta) {
  const { required, entryTouching, isRoot, hasLocale, added, changed, removed } = meta;

  if (isRoot) {
    if (required) return "插件配置（package.json 等，决定插件怎么被加载）";
    return "说明文件（README、LICENSE，只是文字）";
  }
  if (hasLocale) return "界面文字（" + seg + "/ 里的多语言文案）";
  if (REQUIRED_DIRS.has(seg)) {
    if (entryTouching) return "功能本体（" + seg + "/ 里的代码，插件跑起来就靠它）";
    return "功能代码（" + seg + "/，插件的运行逻辑）";
  }
  if (DOC_DIRS.has(seg)) return "文档资料（" + seg + "/，讲解与示例，装了也不影响运行）";
  if (seg === "scripts") return "辅助脚本（" + seg + "/，构建和维护时用）";
  if (seg === "locale") return "界面文字（locale/ 里的多语言文案）";
  if (seg === "icons" || seg === "assets" || seg === "images") return "图片资源（" + seg + "/，图标与配图）";
  if (required) return "运行相关（" + seg + "/，插件会用到）";
  return "附加内容（" + seg + "/，非核心）";
}

/**
 * 生成一个插件的更新分组清单。
 *
 * @param {object} input
 *   - name        插件包名
 *   - current     当前版本
 *   - latest      目标版本
 *   - localDir    本地安装目录（绝对路径）
 * @returns {object} { ok, name, current, latest, groups, tools, commands, restartRequired, readme, error }
 */
export function buildPlan(input) {
  const { name, current, latest, localDir } = input;
  let fetched;
  try {
    fetched = fetchPackage(name, latest);
  } catch (error) {
    return { ok: false, name, current, latest, error: String((error && error.message) || error) };
  }
  const newRoot = fetched.dir;
  if (!fs.existsSync(localDir)) {
    return { ok: false, name, current, latest, error: "本地插件目录不存在：" + localDir };
  }

  const oldPkg = readJson(path.join(localDir, "package.json"), {});
  const newPkg = readJson(path.join(newRoot, "package.json"), {});
  const mainRel = typeof newPkg.main === "string" ? newPkg.main.replace(/^\.\//, "") : "";

  const diff = diffTrees(localDir, newRoot);
  const allChanged = [...diff.added, ...diff.changed];

  // ---- A. 按顶层段聚类 ----
  const buckets = new Map();
  const touch = (entry, kind) => {
    const seg = topSeg(entry.rel);
    let bucket = buckets.get(seg);
    if (!bucket) {
      bucket = { seg, files: [], bytes: 0, added: 0, changed: 0, removed: 0 };
      buckets.set(seg, bucket);
    }
    bucket.files.push({ rel: entry.rel, size: entry.size, kind });
    bucket.bytes += entry.size;
    if (kind === "added") bucket.added += 1;
    else if (kind === "changed") bucket.changed += 1;
    else bucket.removed += 1;
  };
  for (const f of diff.added) touch(f, "added");
  for (const f of diff.changed) touch(f, "changed");
  for (const f of diff.removed) touch(f, "removed");

  const groups = [];
  for (const bucket of buckets.values()) {
    const isRoot = bucket.seg === "(root)";
    const seg = bucket.seg;
    // 根目录里如果含 main 文件或 package.json，算必需
    const rootHasEntry = isRoot && bucket.files.some((f) => f.rel === mainRel || f.rel === "package.json");
    const required = isRoot ? rootHasEntry : REQUIRED_DIRS.has(seg);
    const entryTouching = isEntryTouching(bucket.files, mainRel);
    const hasLocale = bucket.files.some((f) => /^locale\/.*\.json$/.test(f.rel));
    const label = labelForGroup(seg, { required, entryTouching, isRoot, hasLocale, added: bucket.added, changed: bucket.changed, removed: bucket.removed });
    groups.push({
      key: seg === "(root)" ? "(root)" : seg + "/",
      path: seg,
      label,
      required,
      entryTouching,
      hasLocale,
      files: bucket.files.length,
      bytes: bucket.bytes,
      added: bucket.added,
      changed: bucket.changed,
      removed: bucket.removed,
      sample: bucket.files.slice(0, 6).map((f) => f.rel)
    });
  }
  groups.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return b.bytes - a.bytes;
  });

  // ---- B. 工具 / 命令增量 ----
  const oldTools = new Set(toolNames(oldPkg));
  const newTools = toolNames(newPkg).filter((t) => !oldTools.has(t));
  const oldCommands = new Set(commandNames(oldPkg));
  const newCommands = commandNames(newPkg).filter((c) => !oldCommands.has(c));

  const features = [];
  for (const t of newTools) features.push({ kind: "tool", name: t, label: "多了一个能干活的工具：" + t });
  for (const c of newCommands) features.push({ kind: "command", name: c, label: "多了一条能直接敲的命令：" + c });
  if (mainRel !== "" && (oldPkg.main || "") !== (newPkg.main || "")) {
    features.push({ kind: "entry", name: mainRel, label: "插件启动入口换了位置：" + (oldPkg.main || "(无)") + " → " + newPkg.main });
  }

  // ---- 是否需要重启 ----
  const entryGroupTouched = groups.some((g) => g.entryTouching);
  const restartRequired = entryGroupTouched || newTools.length > 0 || newCommands.length > 0;

  return {
    ok: true,
    name,
    current,
    latest,
    localDir,
    cached: fetched.cached === true,
    summary: {
      filesInNew: diff.added.length + diff.changed.length + diff.same.length,
      added: diff.added.length,
      changed: diff.changed.length,
      removed: diff.removed.length,
      unchanged: diff.same.length,
      totalChanged: allChanged.length,
      newBytes: walk(newRoot).reduce((n, f) => n + f.size, 0)
    },
    groups,
    features,
    restartRequired,
    restartReason: restartRequired
      ? entryGroupTouched
        ? "勾选范围包含主入口或其所在目录，必须重启 DSH 才会加载新代码"
        : "本次新增了工具或命令声明，必须重启 DSH 才会注册"
      : "勾选范围不涉及已加载的模块，刷新页面即可",
    readme: readmeExcerpt(newRoot, latest),
    fetchedAt: Date.now()
  };
}

/** 计算一组勾选路径是否必须重启。 */
export function needRestart(groups, selectedPaths) {
  const set = new Set(selectedPaths.map((p) => (p === "(root)" ? "(root)" : p.replace(/\/$/, ""))));
  for (const g of groups) {
    const key = g.path;
    if (!set.has(key) && !set.has(g.key)) continue;
    if (g.entryTouching) return { restart: true, reason: g.label };
  }
  return { restart: false, reason: "" };
}

export const __paths = { WORK, STAGING };
