window.__ModuleLoader__.load({
  id: "dsh-version-badge-own",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require("react");

    /** 与 lib/index.js 的 VERSION_GLOBAL 一致。 */
    const GLOBAL_KEY = "__DSH_VERSION_BADGE__";

    const CSS_TAG_ID = "dsh-version-badge-own/VersionBadge.module.css";
    const CSS = [
      ".dsh-version-badge-own{display:flex;align-items:center;box-sizing:border-box;width:100%;padding:0 12px 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,#8b8b8b));font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:text;cursor:default;background:none;border:0;font-family:inherit;text-align:left}",
      '.dsh-version-badge-own[data-rail="true"]{justify-content:center;padding:0 4px 6px;font-size:10px}',
      ".dsh-version-badge-own-arrow{margin:0 4px;opacity:.7}",
      ".dsh-version-badge-own-latest{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:500}",
      '.dsh-version-badge-own[data-clickable="true"]{cursor:pointer}',
      '.dsh-version-badge-own[data-clickable="true"]:hover{color:var(--dsw-alias-label-secondary,#666)}',
      // 有新版本时整行「划重点」：换成品牌强调色并加粗。
      // 颜色一律走 DSH 的 CSS 变量，深浅主题与皮肤切换会自动跟随，不写死色值。
      '.dsh-version-badge-own[data-update="true"]{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}',
      // 可点状态悬停时保持品牌色（不要变回灰色），只微微变淡作为点击反馈
      '.dsh-version-badge-own[data-update="true"]:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.85}',
      ".dsh-version-badge-own-panel{position:fixed;z-index:2147483000;box-sizing:border-box;width:360px;max-width:calc(100vw - 24px);max-height:min(64vh,520px);overflow:auto;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));box-shadow:0 12px 40px rgba(0,0,0,.28);font-size:12px;line-height:1.6;text-align:left;user-select:text}",
      ".dsh-version-badge-own-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}",
      ".dsh-version-badge-own-panel-title{font-weight:600;font-size:13px}",
      ".dsh-version-badge-own-panel-date{font-size:11px;opacity:.6;white-space:nowrap}",
      ".dsh-version-badge-own-panel-section{margin-top:10px}",
      ".dsh-version-badge-own-panel-section-title{font-weight:600;margin-bottom:4px}",
      ".dsh-version-badge-own-panel-list{margin:0;padding-left:16px}",
      ".dsh-version-badge-own-panel-list li{margin:2px 0}",
      ".dsh-version-badge-own-panel-more{opacity:.6;font-size:11px;margin-top:2px}",
      ".dsh-version-badge-own-panel-link{display:inline-block;margin-top:10px;margin-right:14px;color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none}",
      ".dsh-version-badge-own-panel-link:hover{text-decoration:underline}",
      ".dsh-version-badge-own-panel-empty{opacity:.7}",
      /* v0.3.0：插件更新角标与面板内列表 */
      ".dsh-version-badge-own-pluginbadge{margin-left:6px;padding:0 4px;border-radius:4px;font-size:10px;line-height:14px;font-weight:600;color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);white-space:nowrap}",
      ".dsh-version-badge-own-plugin-row{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}",
      ".dsh-version-badge-own-plugin-flag{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:700}",
      ".dsh-version-badge-own-plugin-name{font-weight:600}",
      ".dsh-version-badge-own-plugin-ver{opacity:.72;font-variant-numeric:tabular-nums}",
      ".dsh-version-badge-own-plugin-link{font-size:11px;color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none}",
      ".dsh-version-badge-own-plugin-link:hover{text-decoration:underline}"
    ].join("");

    /** 往 <head> 里补一次样式；重复挂载时只插一次。 */
    function ensureStyle() {
      if (typeof document === "undefined") return;
      const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]");
      if (existing !== null) {
        // 内容一致就不动；不一致（插件热更新后样式改了）就把旧样式换掉，
        // 否则刷新前页面上会一直赖着上一版 CSS。
        if (existing.textContent !== CSS) existing.textContent = CSS;
        return;
      }
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-version-badge-own";
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** 读宿主注入的版本信息；宿主没注入（或注入失败）时返回空对象。 */
    function readInfo() {
      const raw = typeof globalThis === "undefined" ? undefined : globalThis[GLOBAL_KEY];
      return raw !== null && typeof raw === "object" ? raw : {};
    }

    /** 把注入的时间戳渲染成 HH:mm；非法值返回空串。 */
    function formatCheckedAt(value) {
      const ms = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(ms) || ms <= 0) return "";
      const when = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      return pad(when.getHours()) + ":" + pad(when.getMinutes());
    }

    /** 把 release 的 ISO 时间渲染成 YYYY-MM-DD；非法值返回空串。 */
    function formatReleaseDate(value) {
      if (typeof value !== "string" || value === "") return "";
      const when = new Date(value);
      if (Number.isNaN(when.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return when.getFullYear() + "-" + pad(when.getMonth() + 1) + "-" + pad(when.getDate());
    }

    /**
     * 「最新版本」是从哪儿查到的，用于把提示写清楚。
     * feed = 桌面应用官方更新源（electron-updater 用的那份）；npm = 兜底查询。
     */
    function sourceLabel(source) {
      if (source === "feed") return "官方更新源";
      if (source === "npm") return "npm";
      if (source === "demo") return "演示值";
      return "";
    }

    /**
     * 侧栏左下角那一行极简版本号。
     * - 已是最新（或没查到）：只显示 `v<当前版本>`，不可点击
     * - 发现新版本：显示 `v<当前> → v<最新>`，点击在侧栏右侧浮出更新说明面板
     * - 只读：这里只做展示和读取，升级动作一概不碰
     * - 取不到当前版本时整行不渲染（不占位、不留白）
     */
    function VersionBadge(props) {
      const wide = props === null || props === undefined ? true : props.wide !== false;
      const info = readInfo();
      const version = typeof info.version === "string" ? info.version : "";
      const latest = typeof info.latest === "string" ? info.latest : "";
      const hasUpdate = info.hasUpdate === true && latest !== "" && latest !== version;
      /* v0.3.0：已装插件里在各自源上有新版的那些 */
      const plugins = Array.isArray(info.plugins) ? info.plugins.filter((item) => item !== null && typeof item === "object") : [];
      const pluginUpdates = plugins.filter((item) => item.hasUpdate === true);
      const pluginUpdateCount = pluginUpdates.length;
      /* 本体有新版、或者插件有新版 —— 两种情况都让徽标可点 */
      const clickable = hasUpdate || pluginUpdateCount > 0;
      const notes = info.latestNotes !== null && typeof info.latestNotes === "object" ? info.latestNotes : undefined;
      const withNotes = notes !== undefined && Array.isArray(notes.sections) && notes.sections.length > 0;
      const label = sourceLabel(info.latestSource);
      const downloadUrl = typeof info.latestUrl === "string" ? info.latestUrl : "";

      const [open, setOpen] = react.useState(false);
      const [position, setPosition] = react.useState(undefined);
      const anchorRef = react.useRef(null);
      const panelRef = react.useRef(null);

      // 点面板外面、或者按 Esc 就收起
      react.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          const inAnchor = anchorRef.current !== null && anchorRef.current.contains(target);
          const inPanel = panelRef.current !== null && panelRef.current.contains(target);
          if (!inAnchor && !inPanel) setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown, true);
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
          document.removeEventListener("mousedown", onPointerDown, true);
          document.removeEventListener("keydown", onKeyDown, true);
        };
      }, [open]);

      // 打开时把面板贴到版本号右侧；窗口尺寸/滚动变化时跟着走
      react.useEffect(() => {
        if (!open) return undefined;
        const place = () => {
          const node = anchorRef.current;
          if (node === null || typeof node.getBoundingClientRect !== "function") return;
          const rect = node.getBoundingClientRect();
          setPosition({
            left: Math.round(rect.right + 8) + "px",
            bottom: Math.round(window.innerHeight - rect.bottom) + "px"
          });
        };
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
          window.removeEventListener("resize", place);
          window.removeEventListener("scroll", place, true);
        };
      }, [open]);

      if (version === "") return null;

      const tooltip = [(info.product ? info.product + " " : "") + version];
      if (hasUpdate) {
        tooltip.push((label === "" ? "最新版本" : label) + "：" + latest);
        const at = formatCheckedAt(info.latestCheckedAt);
        if (at !== "") tooltip.push("检测于 " + at);
        tooltip.push(withNotes ? "点一下看更新了哪些内容" : "本插件只提示，不会自动升级");
      } else if (typeof info.latestError === "string" && info.latestError !== "") {
        tooltip.push("最新版本检测失败：" + info.latestError);
      } else if (label !== "") {
        // 后台检测过、且确实是最新的：把「什么时候查的」也交代清楚
        const at = formatCheckedAt(info.latestCheckedAt);
        tooltip.push(label + "已是最新" + (at === "" ? "" : "（" + at + " 检测）"));
      }

      if (pluginUpdateCount > 0) {
        tooltip.push("插件有新版 " + pluginUpdateCount + " 个：" + pluginUpdates.slice(0, 6).map((item) => item.name).join("、") + (pluginUpdateCount > 6 ? " 等" : ""));
        const at = formatCheckedAt(info.pluginsCheckedAt);
        if (at !== "") tooltip.push("插件检测于 " + at);
        tooltip.push("点一下看是哪几个");
      }

      const rowChildren = [react.createElement("span", { key: "current" }, "v" + version)];
      if (hasUpdate) {
        rowChildren.push(react.createElement("span", { key: "arrow", className: "dsh-version-badge-own-arrow" }, "→"));
        rowChildren.push(react.createElement("span", { key: "latest", className: "dsh-version-badge-own-latest" }, "v" + latest));
      }
      if (pluginUpdateCount > 0) {
        /* 插件角标：贴在版本号后面，不受宽窄切换影响 */
        rowChildren.push(
          react.createElement(
            "span",
            { key: "plugins", className: "dsh-version-badge-own-pluginbadge", title: pluginUpdateCount + " 个插件有新版" },
            "插件 " + pluginUpdateCount + "↑"
          )
        );
      }

      const row = react.createElement(
        "button",
        {
          ref: anchorRef,
          type: "button",
          className: "dsh-version-badge-own",
          "data-rail": wide ? "false" : "true",
          "data-clickable": clickable ? "true" : "false",
          "data-update": clickable ? "true" : "false",
          title: tooltip.join("\n"),
          "aria-expanded": open ? "true" : "false",
          onClick: () => {
            if (clickable) setOpen((value) => !value);
          }
        },
        rowChildren
      );

      if (!open || !clickable) return row;

      const limit = Number.isFinite(Number(info.notesItemsPerSection)) ? Number(info.notesItemsPerSection) : 5;
      const body = withNotes
        ? notes.sections.map((section, sectionIndex) => {
            const items = Array.isArray(section.items) ? section.items : [];
            const shown = items.slice(0, limit);
            const children = [];
            if (typeof section.title === "string" && section.title !== "") {
              children.push(
                react.createElement("div", { key: "title", className: "dsh-version-badge-own-panel-section-title" }, section.title)
              );
            }
            children.push(
              react.createElement(
                "ul",
                { key: "list", className: "dsh-version-badge-own-panel-list" },
                shown.map((item, itemIndex) => react.createElement("li", { key: itemIndex }, String(item)))
              )
            );
            if (items.length > shown.length) {
              children.push(
                react.createElement(
                  "div",
                  { key: "more", className: "dsh-version-badge-own-panel-more" },
                  "还有 " + (items.length - shown.length) + " 条，见完整说明"
                )
              );
            }
            return react.createElement("div", { key: sectionIndex, className: "dsh-version-badge-own-panel-section" }, children);
          })
        : [
            react.createElement(
              "div",
              { key: "empty", className: "dsh-version-badge-own-panel-empty" },
              typeof info.notesError === "string" && info.notesError !== ""
                ? "更新说明没能取到：" + info.notesError
                : "这个版本没有提供文字说明"
            )
          ];

      const headDate = notes === undefined ? "" : formatReleaseDate(notes.publishedAt);

      /* v0.3.0：面板顶部的「插件更新」区块 */
      const pluginSection =
        pluginUpdateCount === 0
          ? null
          : react.createElement(
              "div",
              { className: "dsh-version-badge-own-panel-section" },
              react.createElement("div", { className: "dsh-version-badge-own-panel-section-title" }, "插件有新版（" + pluginUpdateCount + "）"),
              react.createElement(
                "ul",
                { className: "dsh-version-badge-own-panel-list" },
                pluginUpdates.map((item, index) =>
                  react.createElement(
                    "li",
                    { key: index, className: "dsh-version-badge-own-plugin-row" },
                    react.createElement("span", { className: "dsh-version-badge-own-plugin-flag" }, "↑"),
                    react.createElement("span", { className: "dsh-version-badge-own-plugin-name" }, String(item.name)),
                    react.createElement("span", { className: "dsh-version-badge-own-plugin-ver" }, String(item.version) + " → " + String(item.latest)),
                    item.repo !== "" && typeof item.repo === "string"
                      ? react.createElement(
                          "a",
                          {
                            className: "dsh-version-badge-own-plugin-link",
                            href: "https://github.com/" + item.repo + "/releases",
                            target: "_blank",
                            rel: "noreferrer"
                          },
                          "源"
                        )
                      : null
                  )
                )
              ),
              react.createElement(
                "div",
                { className: "dsh-version-badge-own-panel-more" },
                "检测于 " + formatCheckedAt(info.pluginsCheckedAt) + " · 插件 " + plugins.length + " 个"
              )
            );

      const headTitle = hasUpdate ? "v" + latest + " 更新内容" : "插件可更新 " + pluginUpdateCount + " 个";

      const panel = react.createElement(
        "div",
        {
          ref: panelRef,
          className: "dsh-version-badge-own-panel",
          style: position === undefined ? { visibility: "hidden" } : position,
          role: "dialog",
          "aria-label": "版本与插件更新"
        },
        react.createElement(
          "div",
          { className: "dsh-version-badge-own-panel-head" },
          react.createElement("span", { className: "dsh-version-badge-own-panel-title" }, headTitle),
          headDate === "" ? null : react.createElement("span", { className: "dsh-version-badge-own-panel-date" }, headDate)
        ),
        pluginSection,
        hasUpdate && notes !== undefined && notes.matched === false
          ? react.createElement(
              "div",
              { className: "dsh-version-badge-own-panel-empty" },
              "（没找到这个版本对应的说明，下面是最近一条发布记录）"
            )
          : null,
        hasUpdate ? body : null,
        notes !== undefined && typeof notes.url === "string" && notes.url !== ""
          ? react.createElement(
              "a",
              { className: "dsh-version-badge-own-panel-link", href: notes.url, target: "_blank", rel: "noreferrer" },
              "在 GitHub 看完整说明 →"
            )
          : null,
        // 「可更新」得是个能点的动作：官方更新源直接给安装包，npm 兜底就给包页面。
        downloadUrl !== ""
          ? react.createElement(
              "a",
              { className: "dsh-version-badge-own-panel-link", href: downloadUrl, target: "_blank", rel: "noreferrer" },
              info.latestSource === "feed" ? "下载官方安装包 →" : "在 npm 上查看 →"
            )
          : null,
        react.createElement(
          "div",
          { className: "dsh-version-badge-own-panel-more" },
          "本插件只负责提示，不会自动下载或安装。"
        )
      );

      return react.createElement(react.Fragment, null, row, panel);
    }

    /**
     * 注册到侧栏底部官方开放的列表槽位 `sidebar.footer.action`
     * （文档：Optional actions beside Settings at the sidebar foot）。
     * 它的渲染位置就在"设置/账号"那一行的正上方，不会遮挡或改动原有控件。
     */
    function apply(ctx) {
      ensureStyle();
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          { name: "sidebar.footer.action", id: "dsh-version-badge-own", order: 100 },
          VersionBadge
        )
      );
    }

    const inject = ["slots"];

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
