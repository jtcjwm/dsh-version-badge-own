# 版本号插件更新手册（UPDATE-PLAYBOOK）

> 这份文件是 dsh-version-badge-own 的更新素材。
> 它由 2026-10-24 那次真实更新实践蒸馏而成，记录了每个行为的**原因**、**命令**、**校验**、**失败怎么退**。
> 下次 DSH 本体或插件生态变化时，按本文顺序执行即可，不需要重新摸索。

---

## 0. 这个插件是什么

| 项 | 值 |
|---|---|
| 名称 | `dsh-version-badge-own` |
| 位置 | `D:\DSH\plugins\dsh-version-badge-own` |
| 性质 | **自研**，不从 npm 拉取，代码在本机直接维护 |
| 更新频率 | 低。**不是追新版，是适配版** |
| 职责 | ① 显示 DSH 本体与各插件版本号徽标；② 检测插件是否有新版并写 `~/.dsh/version-badge-plugins.json`；③ 携带更新编排器 `scripts/update-runner.mjs` |

**关键认知**：这个插件“自己更新”的含义不是「从远端下载自己」，而是**检查自己是否还适配当前 DSH，并把不适配的地方改掉**。

---

## 1. 两个模式，别搞混

| 命令 | 管谁 | 动磁盘 | 用在哪 |
|---|---|---|---|
| `--plan` / `--apply` / `--rollback` | **别的插件** | 会（可回滚） | 插件生态升级 |
| `--self-check` / `--self-adapt` | **自己** | `--self-check` 不动，`--self-adapt` 动 | 本体升级后自适配 |

`update-runner.mjs` 一个文件同时承担这两件事，靠参数区分。

---

## 2. 标准更新流程（每次本体升级都照这个走）

### 阶段 A · 快照（动任何东西之前）

```powershell
# 全量快照：profile 声明层 + 全部插件 package.json + 关键状态文件
# 目标：D:\DSH\备份\插件更新前全量快照-<时间戳>
```
- 记录：`profiles/desktop/package.json`、`cordis.patch.yml`、全部插件 `package.json`
- 大件跳过：redteam(952M)、dsh-ops(412M)、dsh-runtimes(363M)、speech-to-text(231M)、attachments(104M)
- **原因**：14 个插件目录无 `.git`，更新只能整目录覆盖，快照是唯一回滚手段

### 阶段 B · 停到最小集

```powershell
# 只保留三个 bundle：
#   @deepseek-ai/dsh-base      宿主内核（agent 循环、工具系统、模型 provider）
#   @deepseek-ai/dsh-web-app   Web 界面（聊天 UI、设置面板）
#   dsh-version-badge-own      观察点
# 写 package.json 的 dsh.profile.bundles，不改 dependencies（避免 pnpm 清 node_modules）
```
- 备份：`package.json.bak-before-disable-<时间戳>`
- **等人工重启**。Agent 不重启宿主，会话会断，回复送不到

### 阶段 C · 升级 DSH 本体

- 由人执行（Electron 安装包，Agent 不能代跑）
- 升级前核对基线：`resources/app/dsh/package.json` 的 version + exe FileVersion
- 升级后核对：版本号是否真变、宿主能否启动

### 阶段 D · 自适配检查

```powershell
node D:\DSH\plugins\dsh-version-badge-own\scripts\update-runner.mjs --self-check
```

检查五项（全部基于真实文件，不猜）：

| # | 检查 | 失败含义 |
|---|---|---|
| 1 | `@deepseek-ai/*` 依赖范围是否覆盖当前 DSH | 接口可能已变 |
| 2 | `main` / `exports` 指向的文件是否存在 | 入口断了 |
| 3 | `dsh.bundle.patch` / `dsh.client.platform` 契约字段 | 插件不被加载或 UI 不挂载 |
| 4 | `lib/*.js` 里 import 的 `@deepseek-ai/*` 在宿主 node_modules 是否存在 | 运行时 import 崩 |
| 5 | 自己的 `cordis.patch.yml` 引用的插件 id 是否还在 | patch 失效 |

自动修：
```powershell
node D:\DSH\plugins\dsh-version-badge-own\scripts\update-runner.mjs --self-adapt
```
- 改前备份 `package.json` 到 `D:\DSH\_tmp\update-runner\_self\`
- 原子写（临时文件 + rename）
- 改完复验，失败自动从备份还原

### 阶段 E · 恢复全量 bundles

- 从阶段 B 的备份恢复 `dsh.profile.bundles`
- **再重启一次**，让所有插件在新本体下加载
- 这时才能看出谁崩了

### 阶段 F · 升级其余插件

```powershell
node update-runner.mjs --plan                 # 只发现，不动盘
node update-runner.mjs --apply --only xxx     # 单插件先试
node update-runner.mjs --apply                # 全部
```

**执行顺序铁律**：
1. `--plan` 出清单，人看一眼
2. 单个插件先跑通（选文件少的）
3. 确认无误再批量
4. **版本号插件永远最后更新**（它是观察点，也是编排器宿主）

---

## 3. 兼容闸：它拦什么、为什么

`--apply` 时对每个插件做四项检查，任一不过就 `blocked`，**不写盘**：

| 检查 | 判据 | 典型误拦原因 |
|---|---|---|
| 版本真升上去了 | staging 的 `version` === 目标版本 | — |
| `engines.dsh` | 当前本体版本是否在范围内 | 范围写 `a \|\| b \|\| c` 枚举时，解析器要认 `\|\|` |
| `peerDependencies` 里的 `@deepseek-ai/*` | 同上 | 写 `"*"` 表示任意版本，解析器要认 `*` |
| 主入口存在 | `main` 指向的文件在 staging 里 | — |

**2026-10-24 踩过的坑**：最初的 semver 判断不认 `*` 和 `||`，把 `dsh-dock`（peer 全是 `*`）和 `dsh-prime-memory`（engines 是 `||` 枚举）误判成不兼容。修法：`satisfiesSimple()` 支持 `*`、`||`、`^`、`~`、`>=`、`<=`、`>`、`<`、精确值（含预发布标签）。

---

## 4. 替换策略：合并，不是覆盖

**核心原则：更新不等于删旧**。

npm 包里的内容通常少于本地安装目录：

| 只有本地有的 | 原因 |
|---|---|
| `tools/` 下几十个 `assert-*.mjs` | 作者自测脚本，未进 npm `files` |
| `docs/` | 文档，未打包 |
| `pnpm-lock.yaml` / `pnpm-workspace.yaml` | 开发态锁文件 |
| `assets/`、截图 | 未打包 |
| `node_modules/` | npm 包从不带依赖 |

替换步骤（`replacePlugin()` 实现）：

1. **整目录备份**到快照目录（含 node_modules）
2. `node_modules` 挪到 `_staging/_nm-<插件名>`（不参与替换）
3. **递归覆盖**：只写入新包里有的文件，**不删除**旧目录独有的文件
4. `node_modules` 放回（若新包自带 node_modules 则以新包为准）
5. 校验：`version` === 目标版本，且 `main` 指向的文件存在
6. 任一步失败 → 从第 1 步的备份整目录还原

**残留风险**：旧版本有、新版本已删除的 `lib/*.js` 会留在盘上。可接受——`package.json` 的 `main`/`exports` 指向新路径，多余文件不会被加载。如果某次残留文件确实影响加载，用 `--rollback` 退回后手工清理。

---

## 5. 回滚：三层

| 层 | 命令 | 范围 |
|---|---|---|
| 单插件 | `node update-runner.mjs --rollback <tag>` | 该快照里备份过的插件 |
| 声明层 | 手工 copy `package.json.bak-*` 回 `profiles/desktop/` | bundles 与 dependencies |
| 全量 | 从 `D:\DSH\备份\插件更新前全量快照-<ts>` 整树恢复 | 一切 |

**快照目录结构**：
```
D:\DSH\备份\插件更新快照\update-<ISO时间戳>\
  package.json              声明层
  cordis.patch.yml          声明层
  index.json                tag / 时间 / DSH版本 / 各插件版本
  plugins-pkg\<名>\package.json    仅版本，轻量
  plugins-full\<名>\               整目录，含 node_modules（重）
```

---

## 6. 已验证事实（2026-10-24 那次）

| 事实 | 证据 |
|---|---|
| 只改 `bundles` 停不干净 | `cordis.patch.yml` 有 6 处 `- insert:`，按模块名直接拉子模块，绕过 bundles |
| `cordis.yml` 不可手改 | 每次启动被重写（当时是 223 字节空数组 `[]`） |
| 宿主启动是全有全无 | 任一插件加载失败，整个进程起不来 |
| 合并替换有效 | `dsh-free-search` 0.9.14→0.9.15，`tools/` 32 个脚本、`docs/`、`pnpm-lock.yaml` 全保留，`lib` 下 13 个文件 hash 与新包逐一致，残留 0 |
| 探针文件 mtime 是活的证据 | `version-badge-plugins.json` 的 mtime 比 `checkedAt` 字段更新更可靠 |
| 正常启动不写日志 | 只有 crash 才写；无新 crash 文件 = 没崩 |

---

## 7. 下次更新的最短路径

```
1. 快照（阶段 A）
2. 停最小集（阶段 B）→ 人工重启
3. 人工升本体（阶段 C）
4. --self-check → 有红灯就 --self-adapt（阶段 D）
5. 恢复全量 bundles（阶段 E）→ 人工重启
6. --plan → 单插件试 → 批量（阶段 F）
7. 收尾：写流水、记快照 tag、确认回滚路径
```

**每一步之间都要人工确认**。这个插件半自动，不自动更新——发现归它，决定权归人。
