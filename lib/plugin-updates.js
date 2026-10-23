/**
 * 已装插件扫描 + 源头版本比对（零依赖）。
 *
 * 目标：让侧栏徽标除了「DSH 本体有没有新版」，也能一眼看出
 * 「哪些插件在它自己的源上出了新版」。
 *
 * 做法：
 *   1. 找 profile 根：<DSH_HOME>/profiles/<name>/node_modules 里插件最多的那个；
 *   2. 逐个读 package.json，取 name / version / 安装来源；
 *   3. npm 装的查 registry 的 /<name>/latest；link:/file: 的本地副本跳过（那是开发副本，
 *      源上有没有新版跟它无关，硬比只会制造噪音）；
 *   4. 只在内存里比，不写任何文件，不碰 profile 配置。
 *
 * 全部失败都吞掉并记原因，绝不因为查不到而影响宿主启动。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 一个 node_modules 里算作「DSH 插件」的判据：名字带 dsh，且 package.json 里有 dsh 段。 */
function looksLikeDshPlugin(name, pkg) {
  if (typeof name !== "string" || name === "") return false;
  const base = name.startsWith("@") ? name.slice(name.indexOf("/") + 1) : name;
  if (!base.startsWith("dsh")) return false;
  return pkg !== null && typeof pkg === "object" && (pkg.dsh !== undefined || pkg.dshPlugin !== undefined);
}

/** 读 package.json；失败返回 undefined。 */
function readPkg(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 列出 node_modules 下的一级包（含 @scope/name 二级）。 */
function listPackages(nodeModules) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      let scoped = [];
      try {
        scoped = fs.readdirSync(path.join(nodeModules, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of scoped) {
        out.push({ name: entry.name + "/" + sub.name, dir: path.join(nodeModules, entry.name, sub.name) });
      }
      continue;
    }
    out.push({ name: entry.name, dir: path.join(nodeModules, entry.name) });
  }
  return out;
}

/** 候选 profile 根：DSH_HOME 优先，其次 ~/.dsh。 */
function listProfileRoots() {
  const homes = [];
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") homes.push(fromEnv.trim());
  homes.push(path.join(os.homedir(), ".dsh"));
  const roots = [];
  for (const home of homes) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(home, "profiles"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const name of names) roots.push({ profile: name, dir: path.join(home, "profiles", name) });
  }
  return roots;
}

/**
 * 判定一个已装包的来源。
 * @returns "link"（软链/本地目录）/ "npm"（从 registry 装的）
 */
function detectKind(dir) {
  try {
    const st = fs.lstatSync(dir);
    if (st.isSymbolicLink()) return "link";
  } catch {
    // 读不到就当 npm，后面查 registry 失败会自然记进 errors
  }
  return "npm";
}

/**
 * 扫描本机已装的 DSH 插件。
 * @returns {{ root: string, profile: string, plugins: Array<object> }}
 */
export function scanInstalledPlugins() {
  const candidates = [];
  for (const root of listProfileRoots()) {
    const nodeModules = path.join(root.dir, "node_modules");
    const pkgs = listPackages(nodeModules);
    let hits = 0;
    for (const p of pkgs) {
      const pkg = readPkg(path.join(p.dir, "package.json"));
      if (looksLikeDshPlugin(pkg?.name ?? p.name, pkg)) hits += 1;
    }
    candidates.push({ ...root, nodeModules, count: hits });
  }
  if (candidates.length === 0) return { root: "", profile: "", plugins: [] };
  candidates.sort((a, b) => b.count - a.count);
  const best = candidates[0];
  const plugins = [];
  for (const p of listPackages(best.nodeModules)) {
    const pkg = readPkg(path.join(p.dir, "package.json"));
    const name = typeof pkg?.name === "string" && pkg.name !== "" ? pkg.name : p.name;
    if (!looksLikeDshPlugin(name, pkg)) continue;
    const kind = detectKind(p.dir);
    const repo = parseRepoSlug(pkg?.repository);
    plugins.push({
      name,
      version: typeof pkg.version === "string" ? pkg.version : "",
      kind,
      repo,
      bundle: pkg?.dsh?.bundle !== undefined,
      client: pkg?.dsh?.client !== undefined
    });
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return { root: best.dir, profile: best.profile, plugins };
}

/**
 * 从 package.json 的 repository 字段解析出 owner/repo。
 * 支持 git+https://github.com/o/r.git、https://github.com/o/r、github:o/r、o/r。
 * @returns {string} "o/r"，解析不出来返回空串。
 */
function parseRepoSlug(repository) {
  if (repository === undefined || repository === null) return "";
  const raw = typeof repository === "string" ? repository : typeof repository.url === "string" ? repository.url : "";
  if (raw === "") return "";
  const cleaned = raw.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/\.git$/, "").replace(/\/+$/, "");
  const hit = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/);
  if (hit !== null) return hit[1] + "/" + hit[2];
  if (/^[\w.-]+\/[\w.-]+$/.test(cleaned)) return cleaned;
  return "";
}

/**
 * 从任意 tag 字符串里抠出版本号：v0.16.1 / dsh-dock-v0.16.1 / release-1.2.3 → 0.16.1 / 1.2.3。
 * @returns {string} 抠不出来返回空串。
 */
function pickVersion(text) {
  if (typeof text !== "string") return "";
  const hit = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return hit === null ? "" : hit[1];
}

/**
 * 查 GitHub 仓库的最新 release tag。
 * 用 releases/latest 的 302 Location 反推 tag —— 不消耗 API 配额（未认证只有 60 次/小时，
 * 十几个插件一轮就吃光了）。
 * @returns {string} 版本号；仓库没有 release 或解析失败时返回空串。
 */
async function fetchGithubLatestTag(slug, timeoutMs) {
  const url = `https://github.com/${slug}/releases/latest`;
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "text/html" }
  });
  const location = response.headers.get("location") ?? "";
  if (location !== "") {
    const tail = location.split("/tag/")[1];
    if (tail !== undefined) return pickVersion(decodeURIComponent(tail));
  }
  if (response.status === 404) return "";
  // 有些仓库只打 tag 不发 release：退回 tags 页第一个 tag
  const tags = await fetch(`https://github.com/${slug}/tags`, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "text/html" }
  });
  if (!tags.ok) return "";
  const html = await tags.text();
  const hit = html.match(/\/releases\/tag\/([^"']+)/);
  return hit === null ? "" : pickVersion(decodeURIComponent(hit[1]));
}

/** 从 registry 取一个包的最新版本；失败抛错。 */
async function fetchLatest(name, registryUrl, timeoutMs) {
  const base = String(registryUrl).replace(/\/+$/, "");
  const url = `${base}/${name.replace("/", "%2F")}/latest`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" }
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  const body = await response.json();
  const latest = typeof body?.version === "string" ? body.version : "";
  if (latest === "") throw new Error("registry 响应里没有 version");
  return latest;
}

/** 纯字符串版本比较（与 index.js 里的 compareVersions 同口径：返回 1 表示 a 比 b 新）。 */
function cmp(a, b) {
  const pa = String(a).split(/[.+-]/);
  const pb = String(b).split(/[.+-]/);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx > ny ? 1 : -1;
      continue;
    }
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * 比对每个插件在源上的最新版本。
 * @param options { registryUrl, timeoutMs, concurrency }
 * @returns {{ plugins: Array<object>, errors: Array<string>, checkedAt: number }}
 */
export async function checkPluginUpdates(options) {
  const registryUrl = options?.registryUrl ?? "https://registry.npmjs.org";
  const timeoutMs = Math.max(1000, Number(options?.timeoutMs) || 8000);
  const concurrency = Math.max(1, Math.min(8, Number(options?.concurrency) || 4));
  const scan = scanInstalledPlugins();
  const list = scan.plugins.map((p) => ({ ...p, latest: "", hasUpdate: false, checked: false, source: "" }));
  const errors = [];
  /**
   * 两条查询路径：
   *   - npm 装的 → 查 registry
   *   - link 装的但有 GitHub 仓库 → 查该仓库最新 release tag（本地开发副本也能知道上游有没有新版）
   * 两条都没有的（自己写的私有插件）跳过。
   */
  const queue = [];
  for (const item of list) {
    if (item.kind === "npm" && item.version !== "") queue.push(item);
    else if (item.repo !== "") queue.push(item);
  }
  let cursor = 0;
  const workers = [];
  for (let w = 0; w < concurrency; w += 1) {
    workers.push((async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= queue.length) return;
        const item = queue[index];
        try {
          // 双源交叉：npm 与 GitHub 各试一次，取能拿到的更高版本。
          // 有的作者只发 npm 不打 tag，有的只打 tag 不发 npm，单押一条会漏。
          const found = [];
          if (item.repo !== "") {
            try {
              const fromGh = await fetchGithubLatestTag(item.repo, timeoutMs);
              if (fromGh !== "") found.push({ version: fromGh, source: "github" });
            } catch (error) {
              errors.push(item.name + "（GitHub）：" + (error instanceof Error ? error.message : String(error)));
            }
          }
          try {
            const fromNpm = await fetchLatest(item.name, registryUrl, timeoutMs);
            if (fromNpm !== "") found.push({ version: fromNpm, source: "npm" });
          } catch (error) {
            if (item.repo === "") {
              errors.push(item.name + "（npm）：" + (error instanceof Error ? error.message : String(error)));
            }
          }
          if (found.length === 0) {
            errors.push(item.name + "：源上没取到版本号");
            continue;
          }
          found.sort((a, b) => cmp(b.version, a.version));
          item.latest = found[0].version;
          item.source = found[0].source;
          item.hasUpdate = cmp(item.latest, item.version) > 0;
          item.checked = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(item.name + "：" + message);
        }
      }
    })());
  }
  await Promise.all(workers);
  return { root: scan.root, profile: scan.profile, plugins: list, errors, checkedAt: Date.now() };
}
