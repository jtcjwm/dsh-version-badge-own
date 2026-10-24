/**
 * 更新面板的 HTTP 端点（零第三方依赖）。
 *
 * 挂三条路由，都由宿主侧 webServer 提供：
 *   GET  /dsh-version-badge/plan?name=X
 *        生成一个插件的更新分组清单（拉包 + 对比 + 分类），不写任何文件到插件目录。
 *   POST /dsh-version-badge/apply
 *        body: { name, version, paths: ["lib","docs","(root)"] }
 *        备份 -> 只覆盖勾选路径 -> 校验 -> 失败自动回滚。
 *   GET  /dsh-version-badge/jobs
 *        返回最近若干次执行记录。
 *
 * 为什么不用 update-runner.mjs：那个脚本走的是 D:\DSH\plugins 布局，且对 npm 型
 * 插件直接跳过。这里要处理的是 profile/node_modules 下的 npm 型插件，路径与备份
 * 策略都不同，另起一份更清楚，两边不会互相污染。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildPlan, fetchPackage, needRestart } from "./updater.js";
import { checkPluginUpdates } from "./plugin-updates.js";

const HOME = os.homedir();
const DSH_HOME = path.join(HOME, ".dsh");
const BACKUP_ROOT = path.join(DSH_HOME, "version-badge-backups");
const JOB_FILE = path.join(DSH_HOME, "version-badge-updater", "jobs.json");

/** 每个插件最多保留多少条执行记录。 */
const JOBS_PER_PLUGIN = 5;

function ensureDirs() {
  for (const d of [BACKUP_ROOT, path.dirname(JOB_FILE)]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function writeJson(file, value) {
  const tmp = file + ".tmp-" + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch { /* ignore */ }
}

/** 时间戳，用于备份目录名。 */
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/** 找到一个插件的实际安装目录（npm 型在 profile/node_modules，link 型指向真实路径）。 */
function locatePlugin(name) {
  const profileRoot = path.join(DSH_HOME, "profiles", "desktop");
  const candidate = path.join(profileRoot, "node_modules", name);
  try {
    const real = fs.realpathSync(candidate);
    if (fs.existsSync(path.join(real, "package.json"))) return real;
  } catch { /* ignore */ }
  // 退一步：D:\DSH\plugins\<name>
  const alt = path.join("D:\\DSH\\plugins", name);
  if (fs.existsSync(path.join(alt, "package.json"))) return alt;
  return "";
}

/** 递归复制目录。 */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

/** 读请求体（JSON）。 */
async function readJsonBody(request, maxBytes = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("请求体过大");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return {};
  return JSON.parse(raw);
}

/** 统一的 JSON 响应。 */
function sendJson(response, code, value) {
  const body = JSON.stringify(value);
  response.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": String(Buffer.byteLength(body))
  });
  response.end(body);
}

/** 只允许同源请求，跨站一律拒绝。 */
function allowRequest(request, response) {
  const site = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (site === "cross-site") {
    sendJson(response, 403, { ok: false, error: "跨站请求被拒绝" });
    return false;
  }
  const origin = String(request.headers["origin"] || "").trim();
  if (origin === "" || origin === "null") return true;
  let originHost = "";
  try { originHost = new URL(origin).host; } catch {
    sendJson(response, 403, { ok: false, error: "Origin 不合法" });
    return false;
  }
  const host = String(request.headers["host"] || "").trim();
  if (host !== "" && originHost.toLowerCase() !== host.toLowerCase()) {
    sendJson(response, 403, { ok: false, error: "Origin 与 Host 不一致" });
    return false;
  }
  return true;
}

/** 读取执行记录。 */
function readJobs() {
  const raw = readJson(JOB_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

/** 追加一条执行记录，按插件裁剪。 */
function pushJob(job) {
  ensureDirs();
  const all = readJobs();
  all.unshift(job);
  const byName = new Map();
  const kept = [];
  for (const j of all) {
    const key = String(j.name || "");
    const count = byName.get(key) || 0;
    if (count >= JOBS_PER_PLUGIN) continue;
    byName.set(key, count + 1);
    kept.push(j);
  }
  writeJson(JOB_FILE, kept.slice(0, 60));
}

/**
 * 执行一次按勾选路径的更新。
 * @param {object} req { name, version, paths }
 */
function applyUpdate(req) {
  const name = String(req.name || "");
  const version = String(req.version || "");
  const rawPaths = Array.isArray(req.paths) ? req.paths.map(String) : [];
  if (name === "") throw new Error("缺少插件名");
  if (version === "") throw new Error("缺少目标版本");
  if (rawPaths.length === 0) throw new Error("没有勾选任何路径");

  const localDir = locatePlugin(name);
  if (localDir === "") throw new Error("找不到插件安装目录：" + name);

  const before = readJson(path.join(localDir, "package.json"), {});
  const fetched = fetchPackage(name, version);
  const staged = fetched.dir;

  // 备份：整目录（含被覆盖与未被覆盖的全部内容），放在独立目录
  ensureDirs();
  const backupDir = path.join(BACKUP_ROOT, name.replace(/[/\\@]/g, "_") + "-" + stamp());
  copyTree(localDir, backupDir);

  const written = [];
  const skipped = [];
  try {
    for (const raw of rawPaths) {
      const seg = raw.replace(/\/$/, "");
      if (seg === "(root)") {
        // 根目录散文件：只覆盖新包里根一层真实存在的文件
        for (const entry of fs.readdirSync(staged, { withFileTypes: true })) {
          if (entry.isDirectory()) continue;
          const src = path.join(staged, entry.name);
          const dst = path.join(localDir, entry.name);
          fs.copyFileSync(src, dst);
          written.push(entry.name);
        }
        continue;
      }
      const srcDir = path.join(staged, seg);
      if (!fs.existsSync(srcDir)) { skipped.push(seg + "（新包中不存在）"); continue; }
      const dstDir = path.join(localDir, seg);
      const walk = (a, b) => {
        fs.mkdirSync(b, { recursive: true });
        for (const entry of fs.readdirSync(a, { withFileTypes: true })) {
          const x = path.join(a, entry.name);
          const y = path.join(b, entry.name);
          if (entry.isDirectory()) walk(x, y);
          else if (entry.isFile()) {
            fs.copyFileSync(x, y);
            written.push(path.relative(staged, x).replace(/\\/g, "/"));
          }
        }
      };
      walk(srcDir, dstDir);
    }

    // 校验：主入口必须还在
    const after = readJson(path.join(localDir, "package.json"), {});
    const main = typeof after.main === "string" && after.main !== "" ? after.main.replace(/^\.\//, "") : "index.js";
    if (!fs.existsSync(path.join(localDir, main))) {
      throw new Error("更新后主入口缺失：" + main);
    }

    return {
      ok: true,
      name,
      from: typeof before.version === "string" ? before.version : "",
      to: version,
      localDir,
      backupDir,
      written: written.length,
      skipped,
      sample: written.slice(0, 12),
      restartRequired: true
    };
  } catch (error) {
    // 失败：整目录回滚
    try {
      fs.rmSync(localDir, { recursive: true, force: true });
      copyTree(backupDir, localDir);
      return {
        ok: false,
        name,
        error: String((error && error.message) || error),
        rolledBack: true,
        backupDir
      };
    } catch (rollbackError) {
      return {
        ok: false,
        name,
        error: String((error && error.message) || error),
        rolledBack: false,
        rollbackError: String((rollbackError && rollbackError.message) || rollbackError),
        backupDir
      };
    }
  }
}

/**
 * 注册三条路由。
 * @param ctx 宿主上下文
 * @returns disposer 数组
 */
export function registerUpdaterRoutes(ctx) {
  const disposers = [];

  if (!ctx || !ctx.webServer || typeof ctx.webServer.register !== "function") {
    ctx.logger?.warn?.("[dsh-version-badge-own] 宿主没有 webServer 服务，更新面板只能看不能点");
    return disposers;
  }

  const register = (spec) => {
    try {
      const disposer = ctx.webServer.register(spec);
      if (typeof disposer === "function") disposers.push(disposer);
    } catch (error) {
      ctx.logger?.warn?.("[dsh-version-badge-own] 路由注册失败 " + spec.path + "：" + String((error && error.message) || error));
    }
  };

  // ---- 1. 生成清单 ----
  register({
    kind: "exact",
    path: "/dsh-version-badge/plan",
    handler: async (request, response) => {
      if (!allowRequest(request, response)) return;
      try {
        const url = new URL(request.url || "/", "http://localhost");
        const name = String(url.searchParams.get("name") || "");
        if (name === "") { sendJson(response, 400, { ok: false, error: "缺少 name 参数" }); return; }

        const localDir = locatePlugin(name);
        if (localDir === "") { sendJson(response, 404, { ok: false, error: "找不到插件：" + name }); return; }

        const pkg = readJson(path.join(localDir, "package.json"), {});
        const current = typeof pkg.version === "string" ? pkg.version : "";

        // 目标版本：优先用前端传来的，否则去探针快照里找
        let latest = String(url.searchParams.get("version") || "");
        if (latest === "") {
          const badge = readJson(path.join(DSH_HOME, "version-badge-plugins.json"), {});
          const list = Array.isArray(badge.plugins) ? badge.plugins : [];
          const hit = list.find((p) => p && p.name === name);
          latest = hit && typeof hit.latest === "string" ? hit.latest : "";
        }
        if (latest === "") { sendJson(response, 400, { ok: false, error: "不知道目标版本" }); return; }

        const plan = buildPlan({ name, current, latest, localDir });
        if (!plan.ok) { sendJson(response, 500, plan); return; }

        // 默认全勾（用户明确要求）
        plan.defaultSelected = plan.groups.map((g) => g.path);
        sendJson(response, 200, plan);
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String((error && error.message) || error) });
      }
    }
  });

  // ---- 2. 执行更新 ----
  register({
    kind: "exact",
    path: "/dsh-version-badge/apply",
    handler: async (request, response) => {
      if (!allowRequest(request, response)) return;
      if (request.method !== "POST") { sendJson(response, 405, { ok: false, error: "只接受 POST" }); return; }
      try {
        const body = await readJsonBody(request);
        const result = applyUpdate(body);
        pushJob({
          at: Date.now(),
          name: result.name,
          to: result.to || "",
          ok: result.ok === true,
          written: result.written || 0,
          error: result.error || "",
          backupDir: result.backupDir || ""
        });
        sendJson(response, result.ok ? 200 : 500, result);
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String((error && error.message) || error) });
      }
    }
  });

  // ---- 3. 执行记录 ----
  register({
    kind: "exact",
    path: "/dsh-version-badge/jobs",
    handler: (request, response) => {
      if (!allowRequest(request, response)) return;
      sendJson(response, 200, { ok: true, jobs: readJobs() });
    }
  });
  // ---- 4. 立即检测：真跑一次探针，写回快照 ----
  register({
    kind: "exact",
    path: "/dsh-version-badge/recheck",
    handler: async (request, response) => {
      if (!allowRequest(request, response)) return;
      if (request.method !== "POST") { sendJson(response, 405, { ok: false, error: "只接受 POST" }); return; }
      try {
        const result = await checkPluginUpdates({ timeoutMs: 20000 });
        const file = path.join(DSH_HOME, "version-badge-plugins.json");
        const snapshot = {
          checkedAt: result.checkedAt,
          profile: result.profile,
          plugins: result.plugins,
          errors: result.errors
        };
        try {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const tmp = file + ".tmp-" + process.pid;
          fs.writeFileSync(tmp, JSON.stringify(snapshot), "utf8");
          fs.renameSync(tmp, file);
        } catch (error) {
          ctx.logger?.warn?.("[dsh-version-badge-own] 快照写回失败：" + String((error && error.message) || error));
        }
        const updates = result.plugins.filter((p) => p && p.hasUpdate === true);
        sendJson(response, 200, {
          ok: true,
          checkedAt: result.checkedAt,
          total: result.plugins.length,
          plugins: result.plugins,
          updates: updates.map((p) => ({ name: p.name, version: p.version, latest: p.latest }))
        });
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String((error && error.message) || error) });
      }
    }
  });


  ctx.logger?.info?.("[dsh-version-badge-own] 更新面板路由已挂载：/dsh-version-badge/{plan,apply,jobs}");
  return disposers;
}

export const __internals = { locatePlugin, applyUpdate, needRestart };
