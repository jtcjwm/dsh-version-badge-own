# dsh-version-badge-own

在 DeepSeek Harness 侧栏左下角常驻一行**极简版本号**（例如 `v0.2.0-rc.2`），
不用点进「设置 → 通用」就能一眼看到当前软件版本；官方发了新版本时，这一行会
自己变成 `v0.2.0-rc.2 → v0.3.0`，点开就能看更新了哪些内容。

```
侧栏左下角
├── v0.2.0-rc.2              ← 已是最新
├── v0.2.0-rc.2 → v0.3.0     ← 有新版本（蓝色可点，浮出更新说明）
└── ⚙ 设置                    ← DSH 原有控件，完全不动
```

## 插件更新提示（v0.3.0 新增）

除了 DSH 本体，这一行也会盯着**你装的所有插件**：

```
侧栏左下角
├── v0.2.0-rc.2  插件 3↑     ← 3 个插件在各自源上有新版（蓝色可点）
```

- **扫什么**：当前 profile 的 `node_modules` 里所有带 `dsh` 段的包（含 `@scope/name`），
  读各自的 `name` / `version` / `repository`。
- **查哪儿**（双源交叉，取能拿到的更高版本）：
  - **npm registry**（`registry.npmjs.org/<name>/latest`）——适用于 npm 装的包；
  - **GitHub 最新 release tag**（拿 `releases/latest` 的 302 Location 反推 tag，
    不消耗 API 配额；仓库只打 tag 不发 release 时退回 `tags` 页）——这一条让
    `link:` 装的**本地副本**也能知道上游有没有新版。
  - 两条都查不到的（自己写的、没发源的私有插件）直接跳过，不报错、不刷噪音。
- **点开面板**：逐条列出「插件名 · 当前版本 → 最新版本」+ 一个指向该仓库 releases 的「源」链接。
- **节奏**：与本体检测同一个定时器（启动后 1 秒、之后每 6 小时），后台跑、不 `await`、不阻塞启动。
- **关掉**：profile patch 里给本插件配置 `checkPlugins: false`，或设环境变量
  `DSH_VERSION_BADGE_PLUGINS=false`。

实测（本机 19 个插件）：一轮检测 5.6 秒，零错误，命中 3 个可更新。

## 为什么不是硬编码版本号

DSH 的客户端 bundle 是预编译产物，核心自己也只能把版本硬编码在代码里
（`dsh-client-ui-settings-general` 的 `CurrentVersionRow`、`dsh-client-ui-sidebar`
的 `localBuildVersion`）。硬编码的常量在 DSH 升级后会变成谎话。

所以本插件在**宿主端**读真实的 `@deepseek-ai/dsh/package.json`，再经
`webserver/index-inject` 注入页面全局 `__DSH_VERSION_BADGE__`，客户端组件读取它渲染。
显示的永远是当前实际运行的版本。

## 怎么知道有没有新版本

- **每次 DSH 启动**，插件在后台检测一次：延迟 1 秒才发请求、全程不 `await`、
  不占用启动路径，所以**不会影响前台运行**；之后每 6 小时复查一次，插件卸载时
  两个定时器都会被清掉。
- **检测源优先级**：
  1. profile 配置里显式写的 `feedUrl` / `feedChannel`；
  2. 桌面应用自己的 `resources/app-update.yml` —— 也就是 electron 自动更新正在用的
     那份配置（本机是 `https://download.deepseek.com/dsh-desk/feeds/win-x64/` + `nightly`，
     即 `nightly.yml`）；
  3. 内置默认值（同 2）。
- 官方更新源查不到时**自动退回 npm registry**（`@deepseek-ai/dsh`）兜底；两条都失败
  时只在鼠标悬停的提示里写明原因，不影响任何别的功能。
- 判断「是不是新版」按 semver 比较，预发布版小于同号正式版（`0.2.0-rc.2 < 0.2.0`），
  所以「rc 升正式版」也会被正确提示。
- 发现新版本时点那一行，浮出面板里是该版本的中文更新要点（取自 GitHub Release）
  加一个「下载官方安装包 →」入口（走 npm 兜底时给的是包页面）。
- 本插件**只提示，不下载、不安装、不升级**。

### 配置项

写进 profile patch 的 `config`，或用同名环境变量临时覆盖：

| 配置键 | 环境变量 | 默认 | 说明 |
| --- | --- | --- | --- |
| `checkLatest` | `DSH_VERSION_BADGE_CHECK` | `true` | 检测总开关 |
| `preferFeed` | `DSH_VERSION_BADGE_PREFER_FEED` | `true` | 优先用官方更新源；关掉就只查 npm |
| `feedUrl` | `DSH_VERSION_BADGE_FEED_URL` | 空＝自动 | 官方更新源基地址 |
| `feedChannel` | `DSH_VERSION_BADGE_FEED_CHANNEL` | 空＝自动 | 更新通道，如 `nightly` |
| `checkIntervalMs` | `DSH_VERSION_BADGE_INTERVAL_MS` | `21600000`（6 小时） | 后台复查间隔 |
| `requestTimeoutMs` | `DSH_VERSION_BADGE_TIMEOUT_MS` | `10000` | 单次请求超时（毫秒） |
| `demoLatestVersion` | `DSH_VERSION_BADGE_DEMO` | 空 | 演示用：把最新版假装成这个值，不联网 |
| `fetchNotes` | `DSH_VERSION_BADGE_NOTES` | `true` | 是否拉取更新说明 |
| `registryUrl` | `DSH_VERSION_BADGE_REGISTRY` | `https://registry.npmjs.org` | npm 兜底源 |
| `packageName` | `DSH_VERSION_BADGE_PACKAGE` | `@deepseek-ai/dsh` | npm 兜底包名 |
| `releasesRepo` | `DSH_VERSION_BADGE_RELEASES_REPO` | `deepseek-ai/deepseek-harness` | 更新说明来源仓库 |
| `notesCacheMs` | `DSH_VERSION_BADGE_NOTES_CACHE_MS` | `3600000`（1 小时） | 更新说明缓存时长 |

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 声明 `dsh.bundle.patch`（宿主半边）与 `dsh.client.platform: web`（浏览器半边） |
| `cordis.patch.yml` | 把本插件 insert 进目标 profile 的配置树 |
| `lib/index.js` | 宿主端：读出真实版本、后台检测官方更新源（失败退 npm）、注入页面全局 |
| `lib/client.js` | 浏览器端：注册到官方槽位 `sidebar.footer.action`，渲染版本号与更新面板 |

落点是 DSH 官方开放的列表槽位（文档原文："Optional actions beside Settings at the
sidebar foot"），不是改核心代码、也不是 hack DOM。

## 安装（本地开发，不发布 npm）

```powershell
$env:DSH_HOME = 'D:\DSH\lab-web'          # 目标实例的数据目录
$node = 'C:\Users\L1772\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
$bin  = 'C:\Users\L1772\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\lib\bin.js'
& $node $bin plugin --profile web add "link:D:\DSH\dsh-逆向\dsh-version-badge-own"
```

`dsh plugin add` 会自动写 `dependencies` 并把插件名加入 `dsh.profile.bundles`。
装完重启该实例即可。

## 卸载

```powershell
& $node $bin plugin --profile web remove dsh-version-badge-own
```

或直接把插件名从该 profile 的 `package.json` 的 `dependencies` 与
`dsh.profile.bundles` 里删掉。

## 已知行为

- 取不到版本号时整行不渲染（不留空白、不影响布局）。
- 侧栏折叠成 rail 时，版本号居中并改用更小字号。
- 只在 `kind: list` 的 `sidebar.footer.action` 槽位占一个条目，`order: 100`，
  不会替换或遮挡任何已有条目。
- 宿主端（`lib/index.js`）改动需要**重启 DSH** 才生效；浏览器端（`lib/client.js`）
  改动刷新页面即可。
