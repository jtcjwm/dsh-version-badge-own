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
/** 这行是不是纯装饰（徽章、图片、纯链接），对「这插件干什么」没信息量。 */
// ---------------------------------------------------------------------------
// v0.4.4：把英文更新说明换成能看懂的中文
//
// 上游 README 基本都是英文，照抄到面板上没人看得懂。这里做三层处理：
//   1) 整句模板：v1.9.36 fixes A and adds B  ->  v1.9.36：修复 A；新增 B
//   2) 常用名词短语：storage statistics -> 存储统计
//   3) 剩余零散动词：fixes -> 修复
// 翻不动的行直接丢掉 —— 宁可少显示几行，也不摆一屏看不懂的英文。
// ---------------------------------------------------------------------------
// v0.4.4：把英文更新说明换成能看懂的中文
//
// 上游 README 基本都是英文，照抄到面板上没人看得懂。这里做三层处理：
//   1) 整句模板：v1.9.36 fixes A and adds B  ->  v1.9.36：修复 A；新增 B
//   2) 常用名词短语：storage statistics -> 存储统计
//   3) 剩余零散动词：fixes -> 修复
// 翻完之后中文占比不到一半的，整行丢掉 —— 宁可不显示，也不摆中英混杂的碎句。
// ---------------------------------------------------------------------------

/** 常见技术名词短语，长的排前面（先换长的，避免短词把长词切碎）。 */
const EN_TERMS = [
  ["billion-context idle scanning stalls", "长时间空闲时的扫描卡顿"],
  ["idle scanning stalls", "空闲扫描卡顿"],
  ["storage statistics", "存储统计"],
  ["preview/confirm cleanup", "预览与确认清理"],
  ["7/30-day retention", "7/30 天保留策略"],
  ["billing history", "计费历史"],
  ["completed streams", "已完成的流"],
  ["request fees", "请求费用"],
  ["model tokens", "模型 token"],
  ["performance measurements", "性能测量"],
  ["dynamic ports", "动态端口"],
  ["compatibility notes", "兼容性说明"],
  ["storage guide", "存储说明"],
  ["release notes", "更新说明"],
  ["breaking changes", "不兼容改动"],
  ["bug fixes", "问题修复"],
  ["new features", "新增功能"],
  ["configuration and verification", "配置与验证"],
  ["search/fetch", "搜索与抓取"],
  ["workbuddy2api", "WorkBuddy2API"],
  ["opendesign", "OpenDesign"],
  ["opacity", "透明度"],
  ["cleanup", "清理"],
  ["retention", "保留策略"],
  ["stalls", "卡顿"],
  ["idle", "空闲"],
  ["streams", "流"],
  ["queries", "查询"],
  ["measurements", "测量"],
  ["statistics", "统计"],
  ["verification", "验证"],
  ["configuration", "配置"],
  ["compressed", "压缩"],
  ["official", "官方"],
  ["setup", "配置"],
  ["tokens", "token"],
  ["cli", "命令行工具"]
];

/** 整句模板，从上往下第一个命中的生效。 */
const EN_SENTENCES = [
  [/^v?([\d][\w.]*)\s+fixes\s+(.+?)\s*,?\s*and\s+adds\s+(.+)$/i, (m) => "v" + m[1] + "：修复 " + m[2] + "；新增 " + m[3]],
  [/^v?([\d][\w.]*)\s+fixes\s+(.+)$/i, (m) => "v" + m[1] + "：修复 " + m[2]],
  [/^v?([\d][\w.]*)\s+adds\s+(.+)$/i, (m) => "v" + m[1] + "：新增 " + m[2]],
  [/^v?([\d][\w.]*)\s+improves\s+(.+)$/i, (m) => "v" + m[1] + "：改进 " + m[2]],
  [/^supports?\s+(.+?)\s*,?\s*separately\s+from\s+(.+)$/i, (m) => "支持 " + m[1] + "，与 " + m[2] + " 分开计算"],
  [/^fixes?\s+(.+)$/i, (m) => "修复 " + m[1]],
  [/^adds?\s+(.+)$/i, (m) => "新增 " + m[1]],
  [/^supports?\s+(.+)$/i, (m) => "支持 " + m[1]],
  [/^improves?\s+(.+)$/i, (m) => "改进 " + m[1]],
  [/^removes?\s+(.+)$/i, (m) => "移除 " + m[1]],
  [/^deprecates?\s+(.+)$/i, (m) => "弃用 " + m[1]],
  [/^updates?\s+(.+)$/i, (m) => "更新 " + m[1]],
  [/^allows?\s+(.+)$/i, (m) => "允许 " + m[1]],
  [/^enables?\s+(.+)$/i, (m) => "启用 " + m[1]],
  [/^reduces?\s+(.+)$/i, (m) => "减少 " + m[1]],
  [/^resolves?\s+(.+)$/i, (m) => "解决 " + m[1]],
  [/^([A-Za-z][A-Za-z\s/]{2,40}):\s*(.+)$/, (m) => m[1].trim() + "：" + m[2]]
];

/** 把一行英文更新说明换成中文；换不干净就返回空串，由调用方丢弃。 */
function translateUpdateLine(line) {
  const text = String(line || "").trim();
  if (!text) return "";

  // 本来就是中文为主，原样返回
  const cjk0 = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk0 >= 4) return text;

  let out = text;

  // 1) 整句模板
  for (const [re, fn] of EN_SENTENCES) {
    const m = out.match(re);
    if (m) {
      out = fn(m);
      break;
    }
  }

  // 2) 常用固定说法
  out = out
    .replace(/fully\s+restart\s+dsh\s+after\s+updating\.?/gi, "更新后需完整重启 DSH。")
    .replace(/release\s+notes?:\s*/gi, "更新说明：")
    .replace(/see\s+the\s+storage\s+guide\.?/gi, "详见存储说明。")
    .replace(/\bis\s+retained\b/gi, "保留")
    .replace(/\bare\s+retained\b/gi, "保留")
    .replace(/\bwhile\b/gi, "同时")
    .replace(/\bwith\b/gi, "配合")
    .replace(/\bfixes\b/gi, "修复")
    .replace(/\badds\b/gi, "新增")
    .replace(/\badd\b/gi, "新增")
    .replace(/\bsupports\b/gi, "支持")
    .replace(/\bimproves\b/gi, "改进")
    .replace(/\bremoves\b/gi, "移除")
    .replace(/\bdeprecates\b/gi, "弃用")
    .replace(/\bresolves\b/gi, "解决")
    .replace(/\benables\b/gi, "启用")
    .replace(/\breduces\b/gi, "减少")
    .replace(/\ballows\b/gi, "允许")
    .replace(/\band\b/gi, "与");

  // 3) 名词短语（长的先换）
  for (const [en, zh] of EN_TERMS) {
    const re = new RegExp(en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, zh);
  }

  // 4) 清掉英语里没意义的冠词与系动词（a / an / the / are / is）
  out = out.replace(/\b(a|an|the|are|is|be|was|were)\b/gi, " ");

  // 5) 收尾标点
  out = out
    .replace(/\s*,\s*/g, "、")
    .replace(/、\s*、/g, "、")
    .replace(/、\s*([。；：，])/g, "$1")
    .replace(/([。；：，])\s*、/g, "$1")
    .replace(/、\s*\./g, "。")
    .replace(/\.\s*、/g, "。")
    .replace(/、\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([。；：，、])/g, "$1")
    .trim();

  // 6) 中文不够多、或还剩一长串英文，说明没翻动，丢掉
  const cjk = (out.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk < 4) return "";
  if (cjk / out.length < 0.35) return "";
  if (/\b[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}\b/.test(out)) return "";

  return out;
}


function isDecorativeLine(line) {
  const raw = String(line || "").trim();
  if (raw === "") return true;

  // 先剥掉 markdown 强调符号，否则 **Full feature summary** 会被行首的 * 挡住
  const t = raw.replace(/\*\*|__|`/g, "").trim();

  // markdown 图片 / 徽章
  if (/!\[[^\]]*\]\([^)]*\)/.test(raw)) return true;
  // HTML 标签
  if (/<img\b|<a\s|<br\s*\/?>/i.test(raw)) return true;
  // 徽章服务
  if (/shields\.io|badge|badgen\.net|img\.shields/i.test(raw)) return true;
  // 整行只有一个链接
  const stripped = t
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[|·•\-–—:：,，\s]/g, "");
  if (stripped.length <= 2 && /https?:\/\/|\[[^\]]*\]\(/.test(raw)) return true;
  // 纯网址
  if (/^https?:\/\/\S+$/.test(t)) return true;
  // 纯分隔线
  if (/^[=\-*_#\s]+$/.test(raw)) return true;

  // ---- 不是「这次更新了什么」的行 ----
  // 兼容性 / 环境要求 / 排障入口
  if (/host floor|adaptation target|compatibility note|troubleshooting|expand the .* below|npm\s+next/i.test(t)) return true;
  // 功能总目录这类标题（不带锚点，包含就丢）
  if (/feature\s*(summary|list|overview|highlights?)/i.test(t)) return true;
  if (/^功能\s*(一览|列表|总览|说明)?$/.test(t)) return true;
  // 超长功能罗列
  const dots = (t.match(/[·•]/g) || []).length;
  if (t.length > 160 && dots >= 3) return true;
  if (t.length > 300) return true;

  return false;
}

/** 把 markdown 的链接语法压成纯文字，别把网址露出来。 */
function stripLinks(line) {
  return String(line || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    // 粗体 / 斜体 / 行内代码的标记符号
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|$)/g, "$1$2")
    // 竖线与多余标点
    .replace(/\s*\|\s*/g, " · ")
    .replace(/[·•]\s*[·•]/g, "·")
    .replace(/^[·•\-–—:：,，\s]+/, "")
    .replace(/[·•\-–—:：,，\s]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// v0.4.4：英文更新说明中文化
//
// npm 上的插件 README 大多是英文，面板照搬过来用户读不懂。这里做两层：
// 整句模板（changelog 常见句式）+ 术语词表（fixes/adds/retention 这类）。
// 只对英文占比高的行生效，原本就是中文的行原样返回。
// ---------------------------------------------------------------------------

/** 这一行是不是英文为主，需要翻译。 */
function looksEnglish(text) {
  const t = String(text || "");
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  if (latin < 6) return false;
  return cjk === 0 || cjk * 3 < latin;
}

/** 整句模板：比词表优先，避免被拆碎后语序别扭。 */
const LOCALIZE_SENTENCES = [
  [/^release notes:\s*/i, "更新说明："],
  [/^configuration and verification:\s*/i, "配置与验证："],
  [/\bfully restart dsh after updating\.?/gi, "更新后需完全重启 DSH。"],
  [/\brestart dsh after updating\.?/gi, "更新后重启 DSH。"],
  [/\bsupports official search\/fetch request fees,\s*separately from model tokens\.?/gi,
   "支持官方 Search/Fetch 请求费用，与模型 token 分开计算。"],
  [/\bcompleted streams are compressed while billing history is retained\.?/gi,
   "已完成的流会被压缩，计费历史仍然保留。"],
  [/\bcompleted streams are compressed\.?/gi, "已完成的流会被压缩。"],
  [/\bstorage guide\.?/gi, "存储说明。"]
];

/** 术语词表：长的在前，避免 "storage statistics" 被 "statistics" 先吃掉。 */
const LOCALIZE_TERMS = [
  [/\bbillion-context idle scanning stalls\b/gi, "billion-context 空闲扫描卡顿"],
  [/\bpreview\/confirm cleanup\b/gi, "预览/确认清理"],
  [/\b7\/30-day retention\b/gi, "7/30 天保留策略"],
  [/\bsearch\/fetch request fees\b/gi, "Search/Fetch 请求费用"],
  [/\bstorage statistics\b/gi, "存储统计"],
  [/\bperformance measurements\b/gi, "性能测量"],
  [/\bbilling history\b/gi, "计费历史"],
  [/\bcompleted streams\b/gi, "已完成的流"],
  [/\bopacity fixes\b/gi, "透明度修复"],
  [/\bdynamic ports\b/gi, "动态端口"],
  [/\bmodel tokens\b/gi, "模型 token"],
  [/\bstorage guide\b/gi, "存储说明"],
  [/\ba cli\b/gi, "命令行工具"],
  [/\bcli\b/gi, "命令行工具"],
  [/\blan\b/gi, "局域网"],
  [/\band adds\b/gi, "，新增"],
  [/\bretention\b/gi, "保留策略"],
  [/\bstatistics\b/gi, "统计"],
  [/\bcleanup\b/gi, "清理"],
  [/\bretained\b/gi, "保留"],
  [/\bcompressed\b/gi, "压缩"],
  [/\bverification\b/gi, "验证"],
  [/\bconfiguration\b/gi, "配置"],
  [/\bperformance\b/gi, "性能"],
  [/\bmeasurements\b/gi, "测量"],
  [/\bfixes\b/gi, "修复"],
  [/\bfixed\b/gi, "修复了"],
  [/\badds\b/gi, "新增"],
  [/\badded\b/gi, "新增"],
  [/\bsupports\b/gi, "支持"],
  [/\bimproves\b/gi, "改进"],
  [/\bimproved\b/gi, "改进"],
  [/\bremoves\b/gi, "移除"],
  [/\bremoved\b/gi, "移除了"],
  [/\bupdates\b/gi, "更新"],
  [/\bupdated\b/gi, "更新了"],
  [/\bstalls\b/gi, "卡顿"],
  [/\bguide\b/gi, "说明"],
  [/\bsetup\b/gi, "设置"],
  [/\bqueries\b/gi, "查询"],
  [/\band\b/gi, "、"]
  [/\bwith\b/gi, "与"],
  [/\bwhile\b/gi, "，但"],
  [/\bare\b/gi, "被"],
];

/** 把一行英文说明换成中文；本来就是中文的原样返回。 */
function localizeExcerpt(text) {
  let out = String(text || "");
  if (!looksEnglish(out)) return out;

  for (const [re, zh] of LOCALIZE_SENTENCES) out = out.replace(re, zh);
  for (const [re, zh] of LOCALIZE_TERMS) out = out.replace(re, zh);

  out = out
    // 1) 英文标点先转中文，后面的合并才认得出
    .replace(/\s*,\s*/g, "，")
    .replace(/\s*;\s*/g, "；")
    // 2) 行中间的英文句号也转（后面紧跟中文时），版本号里的点不动
    .replace(/([a-zA-Z\u4e00-\u9fff])\.\s+(?=[\u4e00-\u9fff])/g, "$1。")
    // 3) 逗号顿号分号两侧去空格（冒号后面留空，读起来不挤）
    .replace(/\s+([，。；、！？）])/g, "$1")
    .replace(/([，。；、！？])\s+/g, "$1")
    .replace(/([（])\s+/g, "$1")
    // 4) 叠标点合并：，、 → ，；，， → ，
    .replace(/，、/g, "，")
    .replace(/、，/g, "，")
    .replace(/，{2,}/g, "，")
    .replace(/、{2,}/g, "、")
    // 5) 中文之间不留空格
    .replace(/([\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, "$1")
    // 6) 版本号后面的英文点，以及行尾英文点
    .replace(/(\bv?\d+\.\d+(?:\.\d+)?)\.\s+/g, "$1。")
    .replace(/\.\s*$/, "。")
    .replace(/\s{2,}/g, " ")
    .trim();

  return out;
}

function readmeExcerpt(newRoot, targetVersion) {
  const names = ["README.md", "readme.md", "README.MD", "CHANGELOG.md", "CHANGELOG"];
  for (const n of names) {
    const file = path.join(newRoot, n);
    if (!fs.existsSync(file)) continue;
    let text = "";
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }

    const lines = text.split(/\r?\n/);

    // 优先取含目标版本号那一段
    const hitIndex = lines.findIndex((l) => l.includes(targetVersion));
    if (hitIndex >= 0) {
      const slice = [];
      for (let i = hitIndex; i < lines.length && slice.length < 4; i++) {
        const raw = lines[i].replace(/^[#>\s*-]+/, "").trim();
        if (isDecorativeLine(raw)) continue;
        const clean = stripLinks(raw);
        if (clean.length < 4) continue;
        slice.push(clean);
      }
      if (slice.length > 0) return { file: n, lines: slice.map(localizeExcerpt) };
    }

    // 退而求其次：开头有信息的几行
    const head = [];
    for (const raw of lines) {
      const t = raw.trim();
      if (isDecorativeLine(t)) continue;
      const clean = stripLinks(t.replace(/^[#>\s*-]+/, ""));
      if (clean.length < 4) continue;
      head.push(clean);
      if (head.length >= 4) break;
    }
    if (head.length > 0) return { file: n, lines: head.map(localizeExcerpt) };
  }
  return null;
}

/**
 * 给一个分组生成「名字（会怎样）」。
 * 名字短、说明直白：一眼看出「这条是什么、装了会得到什么」。
 */
function labelForGroup(seg, meta) {
  const { required, entryTouching, isRoot, hasLocale } = meta;

  if (isRoot) {
    if (required) return "插件声明（package.json 等，告诉宿主这个插件怎么装、从哪启动）";
    return "说明文字（README、LICENSE，只是给人看的）";
  }
  if (hasLocale) return "多语言文案（" + seg + "/ 里的界面文字，中英日等）";
  if (REQUIRED_DIRS.has(seg)) {
    if (entryTouching) return "主程序（" + seg + "/，插件启动与运行的核心代码，改完要重启 DSH）";
    return "运行代码（" + seg + "/，插件运行时会加载）";
  }
  if (DOC_DIRS.has(seg)) {
    if (seg === "test" || seg === "tests" || seg === "__tests__") return "测试用例（开发自测用，不参与运行）";
    if (seg === "examples" || seg === "example") return "示例代码（照着用的样例，不参与运行）";
    return "文档与说明（" + seg + "/，讲解与截图，不参与运行）";
  }
  if (seg === "scripts") return "维护脚本（构建、发布、打包时手动跑，不参与运行）";
  if (seg === "locale") return "多语言文案（locale/ 里的界面文字）";
  if (seg === "icons" || seg === "assets" || seg === "images") return "图片资源（" + seg + "/，图标与配图）";
  if (seg === ".github") return "仓库配置（Issue 模板、CI 流程，跟插件运行无关）";
  if (seg === ".hoplite") return "开发工具配置（跟插件运行无关）";
  if (required) return "运行相关（" + seg + "/，插件会用到）";
  return "附带文件（" + seg + "/，与插件运行无关）";
}

// ---------------------------------------------------------------------------
// v0.4.1：文件级职责说明
//
// 面板上的分组原来只写「lib/ 里的代码，插件跑起来就靠它」这种泛称，看不出
// 具体哪个文件干什么。这里读新版本包里该组的每个文件，从首部注释 / 导出符号
// 提取一句话职责，前端按「文件名 — 干什么」逐行列出。
// ---------------------------------------------------------------------------

/** 常见文件名的兜底职责（注释与导出都提取不到时用）。 */
const KNOWN_DUTY = {
  "index.js": "插件入口，向宿主注册自己",
  "client.js": "前端界面，徽标与面板都画在这里",
  "main.js": "插件入口，向宿主注册自己",
  "updater.js": "更新对比引擎，算哪些文件变了、怎么分组",
  "updater-http.js": "HTTP 路由，给前端提供清单与执行接口",
  "plugin-updates.js": "插件版本探测，比对本地与源站",
  "helpers.js": "工具函数，被其它模块共用",
  "corpus.js": "语料库，存词条与检索逻辑",
  "memes.js": "表情包索引与检索",
  "anim.js": "动画与过渡效果",
  "panel.html": "面板页面骨架",
  "package.json": "插件声明，决定怎么被加载",
  "cordis.patch.yml": "宿主补丁，声明插件挂载点",
  "readme.md": "使用说明",
  "license": "开源许可"
};

/** 从文件头里抠出第一句能当职责的话。 */
function fileDuty(absPath, rel) {
  const base = path.basename(rel).toLowerCase();

  // 1) 已知文件名优先：这些是包里的固定角色，比文件头注释准
  if (KNOWN_DUTY[base]) return KNOWN_DUTY[base];

  let head = "";
  try {
    head = fs.readFileSync(absPath, "utf8").slice(0, 6000);
  } catch (error) {
    return "";
  }

  // 2) 首段块注释（跳过许可证、版本号这类模板行）
  const block = head.match(/\/\*[\s\S]{0,800}?\*\//);
  if (block) {
    const rows = block[0]
      .replace(/^\/\*+/, "")
      .replace(/\*+\/$/, "")
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*\*\s?/, "").trim())
      .filter((s) => s !== "");
    for (const row of rows) {
      if (!usableDuty(row)) continue;
      return row.slice(0, 70);
    }
  }

  // 3) 顶部行注释
  for (const line of head.split(/\r?\n/).slice(0, 40)) {
    const t = line.trim();
    if (!t.startsWith("//")) continue;
    const c = t.replace(/^\/\/+\s*/, "").trim();
    if (!usableDuty(c)) continue;
    return c.slice(0, 70);
  }

  // 4) 导出符号兜底
  const ex = head.match(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/);
  if (ex) return "导出 " + ex[1] + "()";

  return "";
}

/** 这行文字能不能当「这个文件干什么」用。 */
function usableDuty(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t.length < 6 || t.length > 120) return false;
  if (/^[=*#\-\s]+$/.test(t)) return false;
  if (/^(copyright|license|spdx|@license|version|vim?:)/i.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  // 描述一致性 / 键名对齐这类句子不是在说职责
  if (/一致$|保持一致|必须与|同上|见上/.test(t)) return false;
  return true;
}

/**
 * 给一组文件生成「文件名 — 职责」清单。
 * @param root   新版本包解压目录
 * @param files  [{ rel, size, kind }]
 * @param limit  最多几条（默认 8）
 */
function describeFiles(root, files, limit = 8) {
  const out = [];
  const seen = new Set();
  const ordered = files.slice().sort((a, b) => {
    // 有改动的排前面，其次按体积
    const ka = a.kind === "changed" ? 0 : 1;
    const kb = b.kind === "changed" ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return b.size - a.size;
  });
  for (const f of ordered) {
    if (out.length >= limit) break;
    const rel = String(f.rel || "");
    if (rel === "" || seen.has(rel)) continue;
    seen.add(rel);
    const duty = fileDuty(path.join(root, rel), rel);
    if (duty === "") continue;
    out.push({ rel, duty, kind: f.kind || "", size: f.size || 0 });
  }
  return out;
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
      sample: bucket.files.slice(0, 6).map((f) => f.rel),
      /* v0.4.1：这组里每个文件干什么，前端逐行列出 */
      details: describeFiles(newRoot, bucket.files, 8)
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
