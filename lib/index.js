import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { checkPluginUpdates } from "./plugin-updates.js";
import { registerUpdaterRoutes } from "./updater-http.js";

/**
 * 宿主半边：读出 DSH 本体的真实运行版本，并（可选）定期查询官方更新源上的
 * 最新版本、从 GitHub Release 拉取该版本的更新说明，一起通过 webserver 的
 * index 注入通道交给浏览器半边（lib/client.js）去渲染。
 *
 * 为什么要绕到宿主端取版本：客户端 bundle 是预编译产物，DSH 核心自己也只能
 * 把版本硬编码进去（见 dsh-client-ui-settings-general 的 CurrentVersionRow、
 * dsh-client-ui-sidebar 的 localBuildVersion）。硬编码的常量在 DSH 升级后会
 * 变成谎话，所以这里每次启动都去读真实的 package.json。
 *
 * 「有没有新版本」以**桌面应用自己的 electron-updater feed** 为准：地址取自
 * resources/app-update.yml 的 url + channel（本机是 .../win-x64/nightly.yml）。
 * npm registry 只在 feed 不可用时兜底——npm 上的 @deepseek-ai/dsh 只是 CLI 包，
 * 两条发布链路未必同步，拿它当唯一依据会漏报或误报。
 *
 * 所有网络动作都是**后台的、只读 GET**：启动后延迟一点再发、不 await、不阻塞
 * 启动路径，也绝不执行升级或写任何文件；失败只记日志，不打断插件。
 *
 * 本文件刻意保持**零第三方依赖**：本插件常以 `link:` 方式安装，模块解析路径
 * 不经过 profile 的 node_modules，`import` 一个没装进本插件目录的包会直接让插件
 * 加载失败（实测过）。所以配置校验和 YAML 取值都是手写的。
 */

/** 注入到浏览器页面的全局键名；必须与 lib/client.js 保持一致。 */
const VERSION_GLOBAL = "__DSH_VERSION_BADGE__";

/** DSH 本体在 npm 上的包名（仅在官方更新源查不到时作为兜底）。 */
const DSH_PACKAGE_NAME = "@deepseek-ai/dsh";

/** 更新说明的来源仓库（官方 Release Notes 就是这份中文文案）。 */
const DEFAULT_RELEASES_REPO = "deepseek-ai/deepseek-harness";

/**
 * 桌面版 electron-updater 的默认更新源。
 *
 * 用户实际运行的是打包好的桌面应用，它的升级走 resources/app-update.yml 里
 * 声明的 generic provider（feed 由 `url + channel + .yml` 构成）。所以判断
 * 「有没有新版本」应当以这份 feed 为准：npm 上的 @deepseek-ai/dsh 只是 CLI
 * 包，两条发布链路未必同步，拿它当唯一依据会漏报或误报。
 *
 * 这里的默认值只在读不到 app-update.yml 时兜底（例如 dsh web 部署形态）。
 */
const DEFAULT_FEED_BASE = "https://download.deepseek.com/dsh-desk/feeds/win-x64/";

/** 默认更新通道；本机 app-update.yml 里是 nightly。 */
const DEFAULT_FEED_CHANNEL = "nightly";

/** 官方更新源查不到时，给用户一个能点开的 npm 包页面。 */
const NPM_PACKAGE_PAGE = "https://www.npmjs.com/package/@deepseek-ai/dsh";

/** 每段更新要点在界面上最多列几条。 */
const NOTES_ITEMS_PER_SECTION = 5;

/**
 * 启动后多久才发第一次检测请求。
 *
 * 用户明确要求「每次开启就后台检测一次，不要影响前台运行」：这里故意不 await、
 * 也让开一点启动高峰，请求在后台异步完成，任何时候都不会挡住启动流程。
 */
const STARTUP_CHECK_DELAY_MS = 1000;

/** 各项选项的默认值。 */
const DEFAULTS = {
  checkLatest: true,
  /** 是否优先用桌面版官方更新源判断新版；关掉就退回旧行为（只查 npm）。 */
  preferFeed: true,
  /** 留空 = 自动：先读桌面应用的 app-update.yml，读不到才用内置默认。 */
  feedUrl: "",
  feedChannel: "",
  registryUrl: "https://registry.npmjs.org",
  packageName: DSH_PACKAGE_NAME,
  checkIntervalMs: 6 * 60 * 60 * 1000,
  requestTimeoutMs: 10 * 1000,
  demoLatestVersion: "",
  fetchNotes: true,
  /** v0.3.0：是否顺带检测已装插件在各自源上有没有新版。 */
  checkPlugins: true,
  releasesRepo: DEFAULT_RELEASES_REPO,
  notesCacheMs: 60 * 60 * 1000
};

/**
 * 读一个 package.json 的版本信息。
 * @param file package.json 的绝对路径。
 * @returns 版本信息；文件不存在、不是合法 JSON 或没有 version 时返回 undefined。
 */
function readPackage(file) {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (pkg === null || typeof pkg !== "object") return undefined;
    if (typeof pkg.version !== "string" || pkg.version === "") return undefined;
    return {
      name: typeof pkg.name === "string" ? pkg.name : "",
      version: pkg.version,
      path: file
    };
  } catch {
    return undefined;
  }
}

/**
 * 从一个 asar 归档里读文件（零依赖实现）。
 *
 * 桌面应用把 dsh 本体打进 `resources/app.asar`，那是个归档而非目录，
 * `fs.readFileSync` 读不进去——JS 侧只有 Electron 打过补丁的 fs 才认。
 * 本插件刻意不依赖 electron，所以这里直接解析 asar 头部拿内容。
 *
 * asar 布局：8 字节 pickle 头 + 4 字节(UInt32LE) 索引 JSON 长度 + 索引 JSON
 *           数据区起始 = 16 + indexSize
 * 索引结构：{ files: { "<片段>": { files: {...} } | { size, offset, integrity } } }
 *
 * @param archive asar 文件绝对路径。
 * @param inner 归档内路径，如 "dsh/package.json"。
 * @returns 文件内容；归档不存在、路径不存在或格式异常时返回 undefined。
 */
function readAsarFile(archive, inner) {
  let fd;
  try {
    fd = fs.openSync(archive, "r");
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) !== 16) return undefined;
    const indexSize = head.readUInt32LE(12);
    // 索引长度做上限保护，避免损坏文件导致巨额分配
    if (!Number.isFinite(indexSize) || indexSize <= 0 || indexSize > 64 * 1024 * 1024) return undefined;
    const raw = Buffer.alloc(indexSize);
    if (fs.readSync(fd, raw, 0, indexSize, 16) !== indexSize) return undefined;
    const index = JSON.parse(raw.toString("utf8"));

    // 沿路径逐段下钻；兼容索引根节点自带 files 包装的两种写法
    let node = index !== null && typeof index === "object" && index.files !== undefined ? index : { files: index };
    for (const segment of inner.split("/")) {
      if (node === undefined || node === null) return undefined;
      const children = node.files !== undefined ? node.files : node;
      node = children[segment];
      if (node === undefined) return undefined;
    }
    if (node.files !== undefined) return undefined; // 命中的是目录，不是文件
    if (typeof node.size !== "number" || node.offset === undefined) return undefined;

    const dataStart = 16 + indexSize;
    const buf = Buffer.alloc(node.size);
    if (fs.readSync(fd, buf, 0, node.size, dataStart + Number(node.offset)) !== node.size) return undefined;
    return buf;
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* 关闭失败不影响结果 */ }
    }
  }
}

/**
 * 读 asar 归档内某个 package.json 的版本信息。
 * @param archive asar 文件绝对路径。
 * @param inner 归档内 package.json 路径。
 * @returns 版本信息；读不到时返回 undefined。
 */
function readAsarPackage(archive, inner) {
  const buf = readAsarFile(archive, inner);
  if (buf === undefined) return undefined;
  try {
    const pkg = JSON.parse(buf.toString("utf8"));
    if (pkg === null || typeof pkg !== "object") return undefined;
    if (typeof pkg.version !== "string" || pkg.version === "") return undefined;
    return {
      name: typeof pkg.name === "string" ? pkg.name : "",
      version: pkg.version,
      path: `${archive}/${inner}`
    };
  } catch {
    return undefined;
  }
}

/**
 * 定位 DSH 本体的 package.json，返回它记录的版本。
 *
 * 候选来源有四类：
 *   1. 本插件的模块解析位置（某些部署能直接命中 @deepseek-ai/dsh）；
 *   2. 进程参数派生 —— `dsh web` 的 argv 里是 `<...>/@deepseek-ai/dsh/lib/bin.js`，
 *      桌面应用的 argv 里则有 `<...>/resources/app.asar/dsh` 这个 dsh 根目录；
 *   3. 桌面应用特有 —— 从可执行文件位置推出 `resources/app.asar/dsh/package.json`；
 *   4. **asar 归档内** —— 上一条在 Electron 下会被 `fs` 挡住（asar 是归档不是目录），
 *      所以额外把归档内的 package.json 交给 readAsarPackage 直接解析。
 *      实测桌面版 dsh 本体在 `app.asar/dsh/package.json`
 *      （包名 `@deepseek-ai/dsh-desktop-runtime`，与本体同版本发布）。
 *
 * 命中优先级：`@deepseek-ai/dsh` 本体 > `@deepseek-ai/dsh*` 同厂包 > 任意读到
 * version 的包。全都取不到时返回 undefined，此时客户端不渲染那一行 ——
 * 宁可什么都不显示，也不显示一个假的版本号。
 * @returns 命中的版本信息；都取不到时返回 undefined。
 */
function resolveDshVersion() {
  try {
    const require = createRequire(import.meta.url);
    const hit = readPackage(require.resolve(`${DSH_PACKAGE_NAME}/package.json`));
    if (hit !== undefined) return hit;
  } catch {
    // 解析不到就继续走下面的候选，这是常态
  }

  const candidates = [];
  for (const arg of process.argv.slice(1)) {
    if (typeof arg !== "string" || arg === "") continue;
    if (arg.endsWith(".js")) candidates.push(path.resolve(path.dirname(arg), "..", "package.json"));
    candidates.push(path.join(arg, "package.json"));
  }

  /** asar 归档内需要单独解析的候选（普通 fs 读不进去）。 */
  const asarCandidates = [];
  if (typeof process.execPath === "string" && process.execPath !== "") {
    const resources = path.join(path.dirname(process.execPath), "resources");
    candidates.push(path.join(resources, "app.asar", "dsh", "package.json"));
    candidates.push(path.join(resources, "app.asar", "package.json"));
    candidates.push(path.join(resources, "app", "dsh", "package.json"));
    // Electron 打包形态：dsh 本体在 asar 内，登记给 asar 解析器
    asarCandidates.push({ archive: path.join(resources, "app.asar"), inner: "dsh/package.json" });
    asarCandidates.push({ archive: path.join(resources, "app.asar"), inner: "package.json" });
    // dsh web 部署形态下 dsh 本体就装在 resources 下
    candidates.push(path.join(resources, "dsh", "package.json"));
  }

  let dshFamily;
  let anyFallback;
  for (const candidate of candidates) {
    const hit = readPackage(candidate);
    if (hit === undefined) continue;
    if (hit.name === DSH_PACKAGE_NAME) return hit;
    if (dshFamily === undefined && hit.name.startsWith(DSH_PACKAGE_NAME)) dshFamily = hit;
    if (anyFallback === undefined) anyFallback = hit;
  }
  for (const { archive, inner } of asarCandidates) {
    const hit = readAsarPackage(archive, inner);
    if (hit === undefined) continue;
    if (hit.name === DSH_PACKAGE_NAME) return hit;
    if (dshFamily === undefined && hit.name.startsWith(DSH_PACKAGE_NAME)) dshFamily = hit;
    if (anyFallback === undefined) anyFallback = hit;
  }
  return dshFamily ?? anyFallback;
}

/** 把版本号切成「数字段 + 预发布段」。 */
function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (match === null) return undefined;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? [] : match[4].split(".")
  };
}

/**
 * 按 semver 语义比较两个版本号。
 * 预发布规则：同为正式版则数字段定胜负；有预发布段的更小（0.2.0-rc.1 < 0.2.0）；
 * 两段预发布逐段比，数字段比字母小（rc.2 < rc.10，rc.2 < rc.beta）。
 * @returns 负数表示 a < b，0 表示相等，正数表示 a > b；无法解析时返回 0。
 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === undefined || right === undefined) return 0;

  for (let i = 0; i < 3; i++) {
    if (left.numbers[i] !== right.numbers[i]) return left.numbers[i] > right.numbers[i] ? 1 : -1;
  }

  const isNumeric = (part) => /^\d+$/.test(part);
  const len = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < len; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    // 某一方没有预发布段，说明它是正式版：正式版 > 预发布版（0.2.0 > 0.2.0-rc.2）。
    // 这两行的方向必须与上面的注释一致——写反会让「rc 升正式版」被判成没有新版。
    if (l === undefined) return 1;
    if (r === undefined) return -1;
    if (l === r) continue;
    if (isNumeric(l) && isNumeric(r)) return Number(l) > Number(r) ? 1 : -1;
    if (isNumeric(l) !== isNumeric(r)) return isNumeric(l) ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

/**
 * 清掉行内 HTML、链接语法、@署名，并压掉多余空白。
 * @param text 原始片段。
 * @returns 适合直接展示的一行文字。
 */
function cleanInline(text) {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*@[A-Za-z0-9_-]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/[,、;，；:：]+$/, "")
    .trim();
}

/**
 * 从 GitHub Release 的正文里抽出「中文要点」。
 *
 * 官方文案形如：
 *   [中文](#cn-xxx) | [English](#en-xxx)
 *   <h3 id="cn-xxx">✨ 新增功能</h3>
 *   - 一句话说清楚……
 * @param body release 正文。
 * @returns 分段要点；解析不出内容时返回空数组。
 */
function parseReleaseNotes(body) {
  if (typeof body !== "string" || body.trim() === "") return [];

  // 只保留中文段。注意：不能把导航行里的 "[English](...)" 当边界——它就在正文
  // 第一行，那样会把整篇都切掉（实测踩过这个坑）。真正的边界是英文段的标题锚点。
  const englishAt = body.search(/<h[1-6][^>]*id="en-|^#{1,6}\s*(?:en-|English\b)/im);
  const chinese = englishAt > 0 ? body.slice(0, englishAt) : body;

  const sections = [];
  let current;
  const ensureSection = (title) => {
    if (current === undefined) {
      current = { title: "", items: [] };
      sections.push(current);
    }
    if (title !== "" && current.title === "") current.title = title;
    return current;
  };

  for (const rawLine of chinese.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    if (/^\[中文\]/i.test(line)) continue;
    if (/^-{3,}$/.test(line)) continue;

    const heading = line.match(/^#{1,6}\s*(.+)$/) ?? line.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    if (heading !== null) {
      const title = cleanInline(heading[1]);
      if (title === "") continue;
      current = { title, items: [] };
      sections.push(current);
      continue;
    }

    const item = line.match(/^[-*]\s+(.+)$/);
    if (item !== null) {
      const text = cleanInline(item[1]);
      if (text !== "") ensureSection("").items.push(text);
      continue;
    }

    // 普通段落（比如"本版本汇总了自 vX 以来的主要变更"）也当一条
    const text = cleanInline(line);
    if (text !== "") ensureSection("").items.push(text);
  }

  // 丢掉解析出来却没内容的空段
  return sections.filter((section) => section.items.length > 0);
}

/**
 * 从一段极简 YAML 里取一个顶层标量值。
 *
 * 只认顶层 `key:`，够用即可——feed 和 app-update.yml 都是扁平的。支持
 * electron-updater 生成 feed 时的折叠块写法：
 *   path: >-
 *     https://download.../x.exe
 * @param text YAML 文本。
 * @param key 顶层键名。
 * @returns 取到的字符串；没有该键时返回 undefined。
 */
function readYamlScalar(text, key) {
  if (typeof text !== "string") return undefined;
  const match = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
  if (match === null) return undefined;

  let value = match[1].trim();
  if (/^[>|][-+]?$/.test(value)) {
    // 折叠块：把后面所有缩进行接成一行
    const rest = text.slice(match.index + match[0].length).split(/\r?\n/);
    const parts = [];
    for (const line of rest) {
      if (line.trim() === "") {
        if (parts.length > 0) break;
        continue;
      }
      if (!/^[ \t]/.test(line)) break;
      parts.push(line.trim());
    }
    value = parts.join(" ").trim();
  }

  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

/**
 * 解析 electron-updater 的 feed（nightly.yml / latest.yml）。
 *
 * 只关心三件事：最新版本号、安装包地址、发布时间。
 * @param text feed 文本。
 * @returns 解析结果；没有 version 时返回 undefined。
 */
function parseUpdaterFeed(text) {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  const version = readYamlScalar(text, "version");
  if (version === undefined || version.trim() === "") return undefined;
  const downloadUrl = readYamlScalar(text, "path");
  const releaseDate = readYamlScalar(text, "releaseDate");
  return {
    version: version.trim().replace(/^v/, ""),
    downloadUrl: downloadUrl === undefined ? "" : downloadUrl.trim(),
    releaseDate: releaseDate === undefined ? "" : releaseDate.trim()
  };
}

/**
 * 读桌面应用自己的更新源配置（resources/app-update.yml）。
 *
 * 这是判断「官方有没有新版」最可靠的依据：它就是 electron 自动更新正在用的
 * 那份配置，含 provider/url/channel。读不到（例如 dsh web 形态）返回 undefined，
 * 由调用方回退到内置默认值。
 * @returns { url, channel, file }；读不到时返回 undefined。
 */
function readUpdaterConfig() {
  try {
    if (typeof process.execPath !== "string" || process.execPath === "") return undefined;
    const file = path.join(path.dirname(process.execPath), "resources", "app-update.yml");
    const text = fs.readFileSync(file, "utf8");
    const url = readYamlScalar(text, "url");
    if (url === undefined || url.trim() === "") return undefined;
    const channel = readYamlScalar(text, "channel");
    return {
      url: url.trim(),
      channel: channel === undefined || channel.trim() === "" ? "latest" : channel.trim(),
      file
    };
  } catch {
    return undefined;
  }
}

/**
 * 手工校验部署选项（零依赖）。
 * 环境变量可作兜底：DSH_VERSION_BADGE_* 系列，方便不改 profile 就做实验。
 * @param raw profile patch 里给的配置；缺省或类型不对时逐项回退到默认值。
 * @returns 规范化后的选项。
 */
function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === "object" ? raw : {};
  const pick = (key, envName) => (input[key] !== undefined ? input[key] : process.env[envName]);
  const positiveNumber = (value, fallback, min) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  const nonEmptyString = (value, fallback) => {
    if (typeof value !== "string") return fallback;
    return value.trim() === "" ? fallback : value.trim();
  };
  const booleanish = (value, fallback) => {
    if (value === undefined) return fallback;
    return value !== false;
  };

  return {
    checkLatest: booleanish(pick("checkLatest", "DSH_VERSION_BADGE_CHECK"), DEFAULTS.checkLatest),
    preferFeed: booleanish(pick("preferFeed", "DSH_VERSION_BADGE_PREFER_FEED"), DEFAULTS.preferFeed),
    feedUrl: nonEmptyString(pick("feedUrl", "DSH_VERSION_BADGE_FEED_URL"), DEFAULTS.feedUrl),
    feedChannel: nonEmptyString(pick("feedChannel", "DSH_VERSION_BADGE_FEED_CHANNEL"), DEFAULTS.feedChannel),
    registryUrl: nonEmptyString(pick("registryUrl", "DSH_VERSION_BADGE_REGISTRY"), DEFAULTS.registryUrl),
    packageName: nonEmptyString(pick("packageName", "DSH_VERSION_BADGE_PACKAGE"), DEFAULTS.packageName),
    checkIntervalMs: positiveNumber(pick("checkIntervalMs", "DSH_VERSION_BADGE_INTERVAL_MS"), DEFAULTS.checkIntervalMs, 60_000),
    requestTimeoutMs: positiveNumber(pick("requestTimeoutMs", "DSH_VERSION_BADGE_TIMEOUT_MS"), DEFAULTS.requestTimeoutMs, 1_000),
    demoLatestVersion: nonEmptyString(pick("demoLatestVersion", "DSH_VERSION_BADGE_DEMO"), DEFAULTS.demoLatestVersion),
    fetchNotes: booleanish(pick("fetchNotes", "DSH_VERSION_BADGE_NOTES"), DEFAULTS.fetchNotes),
    checkPlugins: booleanish(pick("checkPlugins", "DSH_VERSION_BADGE_PLUGINS"), DEFAULTS.checkPlugins),
    releasesRepo: nonEmptyString(pick("releasesRepo", "DSH_VERSION_BADGE_RELEASES_REPO"), DEFAULTS.releasesRepo),
    notesCacheMs: positiveNumber(pick("notesCacheMs", "DSH_VERSION_BADGE_NOTES_CACHE_MS"), DEFAULTS.notesCacheMs, 60_000)
  };
}

/**
 * 发布版本信息，并把它注入每一次 index HTML。
 * @param ctx 宿主上下文。
 * @param rawConfig profile patch 传来的部署选项（可能为空）。
 */
function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  const current = resolveDshVersion();

  // 更新源优先级：显式配置 > 桌面应用自己的 app-update.yml > 内置默认
  const updater = readUpdaterConfig();
  const feedBase = config.feedUrl !== "" ? config.feedUrl : updater === undefined ? DEFAULT_FEED_BASE : updater.url;
  const feedChannel =
    config.feedChannel !== "" ? config.feedChannel : updater === undefined ? DEFAULT_FEED_CHANNEL : updater.channel;

  const payload = {
    product: "DeepSeek Harness",
    version: current?.version ?? "",
    packageName: current?.name ?? "",
    resolvedFrom: current?.path ?? "",
    /** 官方更新源上查到的最新版本；查不到或关闭检测时为空串。 */
    latest: "",
    /** 最新版本确实比当前版本新（由宿主端算好，客户端不用再比）。 */
    hasUpdate: false,
    /** 上一次检测的时刻（epoch ms），0 表示还没查过。 */
    latestCheckedAt: 0,
    /** 上一次检测的失败原因；成功时为空串。 */
    latestError: "",
    /** 最新版本是从哪儿查到的："feed" / "npm" / "demo"；空串表示还没查到。 */
    latestSource: "",
    /** 有新版本时给用户一个能直接点开的地址（安装包直链或包页面）。 */
    latestUrl: "",
    /** 最新版本的更新要点；没取到时不带这个字段。 */
    latestNotes: undefined,
    /** 更新说明没取到的原因。 */
    notesError: "",
    /** 每段最多显示几条（客户端截断用）。 */
    notesItemsPerSection: NOTES_ITEMS_PER_SECTION,
    /** 已装插件清单与它们各自在源上的最新版本（v0.3.0 新增）。 */
    plugins: [],
    /** 插件清单最近一次比对的时刻（epoch ms），0 表示还没查过。 */
    pluginsCheckedAt: 0,
    /** 插件比对里失败的那些，逐条「包名：原因」。 */
    pluginsErrors: [],
    /** 有更新的插件数量（宿主端算好，客户端直接用）。 */
    pluginsWithUpdate: 0,
    /** 插件清单来自哪个 profile。 */
    pluginsProfile: ""
  };

  const where = payload.resolvedFrom === "" ? "" : ` ← ${payload.resolvedFrom}`;
  ctx.logger?.info?.(`[dsh-version-badge-own] 运行版本 ${payload.version === "" ? "(未取到)" : payload.version}${where}`);
  ctx.logger?.info?.(`[dsh-version-badge-own] 更新源 ${feedBase.replace(/\/+$/, "")}/${feedChannel}.yml`);

  // 更新说明的缓存：GitHub 未认证接口有速率限制，同一版本一小时内只拉一次
  const notesCache = { at: 0, key: "", value: undefined };

  // 两条链路的失败原因分开记，最后合并进 payload.latestError
  let feedError = "";
  let registryError = "";

  /** 把一次成功的版本查询写进 payload。 */
  const applyLatest = (version, source, url) => {
    payload.latest = version;
    payload.latestSource = source;
    payload.latestUrl = url;
    payload.hasUpdate = compareVersions(version, payload.version) > 0;
    payload.latestCheckedAt = Date.now();
    payload.latestError = "";
  };

  /**
   * 查官方更新源（桌面应用自动更新用的那份 feed）。
   * @returns 成功拿到版本返回 true；失败返回 false 并记下原因，由调用方走兜底。
   */
  const checkFeed = async () => {
    const base = String(feedBase).replace(/\/+$/, "");
    const channel = String(feedChannel).replace(/^\/+|\/+$/g, "");
    const url = `${base}/${channel}.yml`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: { accept: "text/yaml, text/plain;q=0.9, */*;q=0.5" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseUpdaterFeed(await response.text());
      if (parsed === undefined) throw new Error("feed 里没有 version 字段");
      applyLatest(parsed.version, "feed", parsed.downloadUrl);
      return true;
    } catch (error) {
      feedError = error instanceof Error ? error.message : String(error);
      ctx.logger?.warn?.(`[dsh-version-badge-own] 官方更新源查询失败：${feedError}`);
      return false;
    }
  };

  /**
   * npm registry 兜底查询（feed 不可用，或显式关掉了 preferFeed）。
   * @returns 成功拿到版本返回 true；失败返回 false 并记下原因。
   */
  const checkRegistry = async () => {
    const base = String(config.registryUrl).replace(/\/+$/, "");
    const name = String(config.packageName);
    const url = `${base}/${name.startsWith("@") ? name.replace("/", "%2F") : name}/latest`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(config.requestTimeoutMs),
        headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      const latest = typeof body?.version === "string" ? body.version.trim() : "";
      if (latest === "") throw new Error("响应里没有 version 字段");
      applyLatest(latest, "npm", NPM_PACKAGE_PAGE);
      return true;
    } catch (error) {
      registryError = error instanceof Error ? error.message : String(error);
      ctx.logger?.warn?.(`[dsh-version-badge-own] npm 兜底查询失败：${registryError}`);
      return false;
    }
  };

  /**
   * 拉取指定版本的更新说明。
   * 找不到完全匹配的 tag 时退回最新的那条 release（演示模式就靠这个仍有内容可看）。
   * @param tag 目标版本号。
   * @returns 更新说明对象；失败时返回 undefined。
   */
  const fetchNotes = async (tag) => {
    if (!config.fetchNotes) return undefined;
    const now = Date.now();
    if (notesCache.value !== undefined && notesCache.key === tag && now - notesCache.at < config.notesCacheMs) {
      return notesCache.value;
    }

    const url = `https://api.github.com/repos/${config.releasesRepo}/releases?per_page=20`;
    // GitHub 在不同网络下快慢差别很大（实测踩过 10 秒超时的坑），这里单独放宽并重试一次。
    const timeoutMs = Math.max(config.requestTimeoutMs, 30_000);
    let list;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: "application/vnd.github+json", "user-agent": "dsh-version-badge-own" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        list = await response.json();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (list === undefined) throw lastError ?? new Error("拉取失败");
    if (!Array.isArray(list) || list.length === 0) throw new Error("仓库没有 release");

    const normalize = (value) => String(value).replace(/^dsh-/, "").replace(/^v/, "");
    const exact = list.find((row) => normalize(row?.tag_name ?? "") === normalize(tag));
    const chosen = exact ?? list[0];

    const value = {
      tag: typeof chosen?.tag_name === "string" ? chosen.tag_name : "",
      name: typeof chosen?.name === "string" ? chosen.name : "",
      publishedAt: typeof chosen?.published_at === "string" ? chosen.published_at : "",
      url: typeof chosen?.html_url === "string" ? chosen.html_url : "",
      matched: exact !== undefined,
      sections: parseReleaseNotes(chosen?.body)
    };
    notesCache.at = now;
    notesCache.key = tag;
    notesCache.value = value;
    return value;
  };

  /**
   * 查一次最新版本：先官方更新源，失败退 npm，都失败只记录。
   * 顺带在「确实有新版本」时把该版本的更新说明拉回来。
   * 全程异步、不 await 在启动路径上，也不抛出任何异常。
   */
  /**
   * 查一遍已装插件各自在源上有没有新版（v0.3.0）。
   * 与本体版本检测完全解耦：自己吞掉所有异常、失败只往 payload.pluginsErrors 里记一条，
   * 绝不让插件检测的失败影响徽标主体。
   */
  /**
   * 插件检测结果的落盘快照。
   * 为什么要有它：注入通道是「每个 index 请求现取」，页面一加载就定版；
   * 检测是启动后才跑的异步活，等它回来时页面早就渲染完了。所以：
   *   启动时**先同步读这份快照**塞进 payload（首帧就有上次的结果），
   *   检测完再**原子写回**（下次刷新/下次启动就是新值）。
   */
  const pluginCacheFile = () => {
    const home = typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME.trim() !== ""
      ? process.env.DSH_HOME.trim()
      : path.join(os.homedir(), ".dsh");
    return path.join(home, "version-badge-plugins.json");
  };

  const readPluginCache = () => {
    try {
      const raw = fs.readFileSync(pluginCacheFile(), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.plugins)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  };

  const writePluginCache = (value) => {
    const file = pluginCacheFile();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp-" + process.pid;
      fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
      JSON.parse(fs.readFileSync(tmp, "utf8"));
      fs.renameSync(tmp, file);
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-version-badge-own] 插件快照落盘失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const checkPlugins = async () => {
    if (!config.checkPlugins) {
      payload.plugins = [];
      payload.pluginsCheckedAt = 0;
      payload.pluginsWithUpdate = 0;
      return;
    }
    try {
      const result = await checkPluginUpdates({
        registryUrl: config.registryUrl,
        timeoutMs: Math.max(config.requestTimeoutMs, 8000)
      });
      payload.plugins = result.plugins;
      payload.pluginsProfile = result.profile;
      payload.pluginsErrors = result.errors;
      payload.pluginsCheckedAt = result.checkedAt;
      payload.pluginsWithUpdate = result.plugins.filter((item) => item.hasUpdate === true).length;
      writePluginCache({
        checkedAt: result.checkedAt,
        profile: result.profile,
        plugins: result.plugins,
        errors: result.errors
      });
      const stale = result.plugins.filter((item) => item.hasUpdate === true).map((item) => item.name + " " + item.version + "→" + item.latest);
      ctx.logger?.info?.(
        `[dsh-version-badge-own] 插件 ${result.plugins.length} 个（profile ${result.profile}）` +
          (payload.pluginsWithUpdate > 0 ? `，有更新 ${payload.pluginsWithUpdate} 个：${stale.join("、")}` : "，都已是最新") +
          (result.errors.length > 0 ? `；${result.errors.length} 个没查成` : "")
      );
    } catch (error) {
      payload.pluginsErrors = [error instanceof Error ? error.message : String(error)];
      payload.pluginsCheckedAt = Date.now();
      ctx.logger?.warn?.(`[dsh-version-badge-own] 插件更新检测失败：${payload.pluginsErrors[0]}`);
    }
  };

  const checkLatest = async () => {
    if (!config.checkLatest) return;

    // 插件检测甩到后面自己跑，不受下面本体检测的 return 影响
    void checkPlugins();

    if (config.demoLatestVersion !== "") {
      applyLatest(config.demoLatestVersion, "demo", "");
      ctx.logger?.info?.(`[dsh-version-badge-own] 演示模式：把最新版本当作 ${config.demoLatestVersion}（跳过网络查询）`);
    } else {
      feedError = "";
      registryError = "";
      let got = false;
      if (config.preferFeed) got = await checkFeed();
      if (!got) got = await checkRegistry();
      if (!got) {
        payload.latest = "";
        payload.latestSource = "";
        payload.latestUrl = "";
        payload.hasUpdate = false;
        payload.latestCheckedAt = Date.now();
        const parts = [];
        if (config.preferFeed && feedError !== "") parts.push(`官方更新源：${feedError}`);
        if (registryError !== "") parts.push(`npm：${registryError}`);
        payload.latestError = parts.join("；") || "检测失败";
      }
      if (payload.latestSource !== "") {
        const via = payload.latestSource === "feed" ? "官方更新源" : "npm";
        ctx.logger?.info?.(
          `[dsh-version-badge-own] 最新版本 ${payload.latest}（来源 ${via}）${payload.hasUpdate ? " → 有新版本" : "（已是最新）"}`
        );
      }
    }

    // 只有"确实有新版本"时才去拉更新说明——平时不消耗 GitHub 的接口额度
    if (!payload.hasUpdate) {
      payload.latestNotes = undefined;
      payload.notesError = "";
      return;
    }
    try {
      const notes = await fetchNotes(payload.latest);
      payload.latestNotes = notes;
      payload.notesError = notes === undefined ? "已关闭更新说明拉取" : "";
      if (notes !== undefined) {
        const count = notes.sections.reduce((sum, section) => sum + section.items.length, 0);
        ctx.logger?.info?.(`[dsh-version-badge-own] 更新说明 ${notes.tag}：${notes.sections.length} 段 / ${count} 条`);
      }
    } catch (error) {
      payload.latestNotes = undefined;
      payload.notesError = error instanceof Error ? error.message : String(error);
      ctx.logger?.warn?.(`[dsh-version-badge-own] 拉取更新说明失败：${payload.notesError}`);
    }
  };

  /**
   * 后台检测节奏：
   *   - 每次 DSH 启动，延迟 STARTUP_CHECK_DELAY_MS 后检测一次（不阻塞启动）；
   *   - 之后按 checkIntervalMs 复查（默认 6 小时，比「每天」更勤）；
   *   - 关掉 checkLatest 时两个定时器都不建，不留空转的 interval；
   *   - 插件卸载时定时器清掉。
   * 这里只把异步任务丢出去，永远不 await，所以前台启动流程完全不受影响。
   */
  ctx.effect(() => {
    if (!config.checkLatest) return () => {};
    const kick = setTimeout(() => void checkLatest(), STARTUP_CHECK_DELAY_MS);
    const timer = setInterval(() => void checkLatest(), config.checkIntervalMs);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, "dsh-version-badge-own: 最新版本检测");

  // 首帧预热：把上次落盘的快照先塞进 payload，页面一加载就有角标，
  // 不必等这一轮网络查询回来（后台查完会覆盖并把新快照写回磁盘）。
  const warm = readPluginCache();
  if (warm !== undefined) {
    payload.plugins = warm.plugins;
    payload.pluginsCheckedAt = typeof warm.checkedAt === "number" ? warm.checkedAt : 0;
    payload.pluginsErrors = Array.isArray(warm.errors) ? warm.errors : [];
    payload.pluginsProfile = typeof warm.profile === "string" ? warm.profile : "";
    payload.pluginsWithUpdate = warm.plugins.filter((item) => item?.hasUpdate === true).length;
    ctx.logger?.info?.(
      `[dsh-version-badge-own] 插件快照预热：${payload.plugins.length} 个，其中 ${payload.pluginsWithUpdate} 个待更新（来自磁盘快照）`
    );
  } else {
    ctx.logger?.info?.(`[dsh-version-badge-own] 没有插件快照，等本轮后台检测（文件 ${pluginCacheFile()}）`);
  }

  /**
   * 更新面板的 HTTP 端点（v0.4.0）。
   * 宿主必须显式声明依赖 webServer，否则拿不到注册路由的句柄。
   */
  ctx.inject(["webServer"], (host) => {
    host.effect(() => {
      const stop = registerUpdaterRoutes(host);
      return () => {
        for (let i = stop.length - 1; i >= 0; i -= 1) {
          try { stop[i](); } catch { /* ignore */ }
        }
      };
    });
  }, "dsh-version-badge-own: 更新面板路由");

  ctx.on("webserver/index-inject", (table) => {
    table.push({ kind: "global", name: VERSION_GLOBAL, value: payload });
  });
}

export { apply, parseUpdaterFeed, readYamlScalar, compareVersions };
