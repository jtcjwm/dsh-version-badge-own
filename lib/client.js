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
      '.dsh-version-badge-own[data-update="true"]{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}',
      '.dsh-version-badge-own[data-update="true"]:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.85}',
      ".dsh-version-badge-own-panel{position:fixed;z-index:2147483000;box-sizing:border-box;width:400px;max-width:calc(100vw - 24px);max-height:min(72vh,600px);overflow:auto;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));box-shadow:0 12px 40px rgba(0,0,0,.28);font-size:12px;line-height:1.6;text-align:left;user-select:text}",
      ".dsh-version-badge-own-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px}",
      ".dsh-version-badge-own-panel-title{font-weight:600;font-size:13px}",
      ".dsh-version-badge-own-panel-date{font-size:11px;opacity:.6;white-space:nowrap}",
      /* v0.5.3：面板头部的立即检测按钮 */
      ".dsh-version-badge-own-panel-tools{display:flex;align-items:center;gap:8px;white-space:nowrap}",
      ".dsh-version-badge-own-panel-btn{padding:2px 8px;font-size:11px;line-height:16px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer;font-family:inherit}",
      ".dsh-version-badge-own-panel-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04))}",
      ".dsh-version-badge-own-panel-btn:disabled{opacity:.5;cursor:default}",
      ".dsh-version-badge-own-panel-section{margin-top:10px}",
      ".dsh-version-badge-own-panel-section-title{font-weight:600;margin-bottom:4px}",
      ".dsh-version-badge-own-panel-list{margin:0;padding-left:16px}",
      ".dsh-version-badge-own-panel-list li{margin:2px 0}",
      ".dsh-version-badge-own-panel-more{opacity:.6;font-size:11px;margin-top:2px}",
      ".dsh-version-badge-own-panel-link{display:inline-block;margin-top:10px;margin-right:14px;color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none}",
      ".dsh-version-badge-own-panel-link:hover{text-decoration:underline}",
      ".dsh-version-badge-own-panel-empty{opacity:.7}",
      ".dsh-version-badge-own-pluginbadge{margin-left:6px;padding:0 4px;border-radius:4px;font-size:10px;line-height:14px;font-weight:600;color:#fff;background:var(--dsw-alias-brand-primary,#4d6bfe);white-space:nowrap}",
      ".dsh-version-badge-own-plugin-row{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}",
      ".dsh-version-badge-own-plugin-flag{color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:700}",
      ".dsh-version-badge-own-plugin-name{font-weight:600}",
      ".dsh-version-badge-own-plugin-ver{opacity:.72;font-variant-numeric:tabular-nums}",
      ".dsh-version-badge-own-plugin-link{font-size:11px;color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none}",
      ".dsh-version-badge-own-plugin-link:hover{text-decoration:underline}",
      /* v0.4.0：可勾选更新面板 */
      ".dsh-version-badge-own-card{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:8px;padding:8px 10px;margin-top:8px}",
      ".dsh-version-badge-own-card-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-weight:600}",
      ".dsh-version-badge-own-card-ver{opacity:.72;font-weight:400;font-variant-numeric:tabular-nums}",
      ".dsh-version-badge-own-tag{padding:0 5px;border-radius:4px;font-size:10px;line-height:15px;font-weight:600;white-space:nowrap}",
      ".dsh-version-badge-own-tag[data-kind=\"restart\"]{color:#fff;background:#d4380d}",
      ".dsh-version-badge-own-tag[data-kind=\"reload\"]{color:#fff;background:#389e0d}",
      ".dsh-version-badge-own-tag[data-kind=\"req\"]{color:var(--dsw-alias-brand-primary,#4d6bfe);border:1px solid currentColor;background:none}",
      ".dsh-version-badge-own-group{display:flex;align-items:flex-start;gap:7px;margin-top:7px;cursor:pointer}",
      ".dsh-version-badge-own-group input{margin:2px 0 0;cursor:pointer;flex:none}",
      ".dsh-version-badge-own-group-body{flex:1;min-width:0}",
      ".dsh-version-badge-own-group-name{font-weight:500}",
      ".dsh-version-badge-own-group-meta{font-size:11px;opacity:.62;font-variant-numeric:tabular-nums}",
".dsh-version-badge-own-group-duties{margin-top:4px;display:flex;flex-direction:column;gap:1px}",
".dsh-version-badge-own-group-duty{font-size:11px;opacity:.72;line-height:1.55}",
".dsh-version-badge-own-group-duty code{font-size:10.5px;opacity:.92;background:rgba(127,127,127,.15);border-radius:3px;padding:0 3px;margin-right:3px}",
".dsh-version-badge-own-group-duty[data-more=\"1\"]{opacity:.5;font-style:italic}",
      ".dsh-version-badge-own-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}",
      ".dsh-version-badge-own-btn{box-sizing:border-box;padding:4px 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.18));background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:inherit;font-size:12px;font-family:inherit;cursor:pointer}",
      ".dsh-version-badge-own-btn:hover{opacity:.85}",
      ".dsh-version-badge-own-btn[data-primary=\"true\"]{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent;color:#fff;font-weight:600}",
      ".dsh-version-badge-own-btn:disabled{opacity:.45;cursor:not-allowed}",
      ".dsh-version-badge-own-note{margin-top:8px;font-size:11px;line-height:1.5;opacity:.8}",
      ".dsh-version-badge-own-note[data-kind=\"ok\"]{color:#389e0d;opacity:1}",
      ".dsh-version-badge-own-note[data-kind=\"err\"]{color:#cf1322;opacity:1}",
      ".dsh-version-badge-own-readme{margin-top:8px;padding:7px 9px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.03));font-size:11px;line-height:1.55}",
      ".dsh-version-badge-own-readme div{margin:1px 0;opacity:.85}",
      /* v0.5.0：多插件批量条 */
      ".dsh-version-badge-own-batch{border:1px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:8px;padding:8px 10px;margin-top:8px;background:var(--dsw-alias-bg-layer-2,rgba(77,107,254,.05))}",
      ".dsh-version-badge-own-batch-title{font-weight:600;font-size:12px}",
      ".dsh-version-badge-own-batch-hint{font-size:11px;opacity:.65;align-self:center}",
      ".dsh-version-badge-own-note div[data-kind=\"ok\"]{color:#389e0d}",
      ".dsh-version-badge-own-note div[data-kind=\"err\"]{color:#cf1322}",
      /* v0.5.1：进度条 */
      ".dsh-version-badge-own-progress{margin-top:6px}",
      ".dsh-version-badge-own-progresstrack{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2,rgba(0,0,0,.12));overflow:hidden}",
      ".dsh-version-badge-own-progressfill{height:100%;background:var(--dsw-alias-brand-primary,#4d6bfe);transition:width .25s ease}",
      ".dsh-version-badge-own-progresstext{margin-top:4px;font-size:11px;opacity:.72}",
      /* v0.5.2：全是最新 */
      ".dsh-version-badge-own-alldone{padding:8px 0 2px}",
      ".dsh-version-badge-own-alldone-title{font-size:13px;font-weight:600;color:var(--dsw-alias-brand-primary,#4d6bfe)}",
      ".dsh-version-badge-own-alldone-meta{margin-top:2px;font-size:11px;opacity:.62}",
      ".dsh-version-badge-own-alldone-quote{margin-top:10px;padding:8px 10px;border-left:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));font-size:12px;line-height:1.65;opacity:.8;font-style:italic}"
    ].join("");

    /** 往 <head> 里补一次样式；重复挂载时只插一次。 */
    function ensureStyle() {
      if (typeof document === "undefined") return;
      const existing = document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]");
      if (existing !== null) {
        if (existing.textContent !== CSS) existing.textContent = CSS;
        return;
      }
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-version-badge-own";
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** 读宿主注入的版本信息。 */
    /**
     * 全部插件已是最新时的闲聊文案。每次打开面板随机抽一条。
     * 思路：版本号是死的，机器是活的——等更新的时候顺便说句话。
     */
    const ALL_DONE_LINES = [
      /* ── 时间 ── */
      "时间是条只往前流的河，我们都是站在岸边数浪的人。",
      "钟表量得出秒，量不出一秒钟里发生过什么。",
      "昨天不是过去了，是沉下去了——河床记得每一粒沙。",
      "等待不是空白，是水在石头下面慢慢磨。",
      "有些变化慢得像树长年轮，你回头才看见它已经高过屋檐。",
      "时间对每个人都很公平：它一样地不等人，也一样地不解释。",
      "所有的「以后」，都是从一个不被注意的「现在」长出来的。",
      "钟摆从不焦虑，它只是把同一段路走了一遍又一遍。",

      /* ── 静与动 ── */
      "静止不是不动，是动得刚好平衡。",
      "水面平静的时候，才照得见天上的云。",
      "河流从不催促自己，可它终究到了海。",
      "一块石头在水里待久了，棱角是水磨的，不是时间磨的。",
      "有些东西必须停下来才看得见，比如风，比如自己。",
      "最快的往往最先散，最慢的常常留到最后。",
      "最深的水最安静，最吵的是快干的那一滩。",

      /* ── 光与影 ── */
      "灯越亮，影子越深——没有谁只带来光。",
      "影子不是光的敌人，是光留下的证据。",
      "蜡烛烧自己，不是为了被看见，是因为它只会这个。",
      "天黑了才看见星星，可星星一直都在。",
      "有些答案不在光里，在你转身之后的暗处。",
      "月亮不发光，它只是把别人的光借得体面。",
      "影子在正午最短，可那时最热。",
      "一盏灯照不亮整条街，可它让走夜路的人知道有人醒着。",

      /* ── 器物与建造 ── */
      "一把好刀，是被磨掉的比留下的多。",
      "房子盖得越高，地基要打得越深——所有的轻，都靠重撑着。",
      "钉子相信锤子，锤子相信手臂，手臂相信一个念头。",
      "门的意义不在关上，在于它知道该开向哪边。",
      "钟表内部那么复杂，外面只给你看两根针。",
      "修补过的地方，往往比原来结实——前提是补的人认真。",
      "一把椅子四条腿，缺一条才知道平衡有多贵。",
      "器物会老，会旧，会在某个下午突然不响了。",
      "重量不是问题，重心才是。",
      "斧头砍树，磨刀石磨斧头，最后树和斧头都忘了磨刀石。",
      "一根火柴的价值不在燃烧多久，在于它点着了什么。",
      "桥不是为了让人停留，是为了让人过去。",
      "镜子从不撒谎，但它只告诉你一半。",
      "所有的门都通向某个地方，除了那扇画在墙上的。",
      "风车不追风，它只是站在风必经的路上。",
      "一块表坏了两次，你就不再相信它的指针——人也是。",

      /* ── 路与旅人 ── */
      "路不是被找到的，是被走出来的，走的人多了它就硬了。",
      "迷路的人比谁都清楚方向是什么——他只是暂时没有它。",
      "走得快的人看风景，走得慢的人被风景看。",
      "每一步都算数，包括那些看起来在绕远的。",
      "山不会过来，但你可以过去；也可以不过去，那也是一种选择。",
      "背包越轻，路越长；可有些东西你舍不得扔，那也没关系。",
      "地图不是土地，可没有地图的人走得更慢。",
      "所有的路标都指向别处，没有一个指向自己。",

      /* ── 自然 ── */
      "树不着急，它一年只长一圈，可它比谁都高。",
      "风没有形状，可它经过的东西都有了形状。",
      "雾散得慢，是因为它在犹豫要不要走。",
      "落叶不是失败，是树在为一个更轻的春天做准备。",
      "种子在土里那段时间，看起来什么都没发生。",
      "石头不争，可它比争的人都留得久。",
      "潮水退的时候，才知道谁在裸泳——也才知道沙滩原来这么大。",
      "竹子长得快，是因为它前四年都在长根。",
      "云不解释自己为什么是那个形状。",
      "谷子低头，是因为它重，不是因为谦逊。",
      "沙子堆不成塔，可塔倒下之后就是沙子。",
      "潮水记得每一次上岸的位置，虽然它每次都退回去。",
      "河流改道不是因为石头，是因为它一直记着海的方向。",

      /* ── 语言与书写 ── */
      "一句话说出口就旧了，写下来才慢慢变新。",
      "词是容器，装得下多少，取决于用它的人。",
      "最好的句子是删出来的，不是写出来的。",
      "沉默也是一种回答，只是它不用标点。",
      "名字是别人给你的第一件衣服，合不合身要自己知道。",
      "所有被说清楚的事，都失去了一点原来的样子。",
      "最长的句子往往最短，因为它说完就停了。",
      "一本书读到最后一页，你带走的是书里没有的那部分。",

      /* ── 秩序与混沌 ── */
      "秩序是混沌打的盹。",
      "整理桌面的人，整理的是脑子。",
      "分类是一种暴力，可没有它我们什么都记不住。",
      "系统不出错的时候，你几乎感觉不到它在。",
      "一根线乱，是乱；一团线乱，是结构。",
      "熵只增不减，可我们还是每天叠被子——这不矛盾，这叫体面。",
      "所有的边界都是暂时的协议，连海岸线也不例外。",
      "所有的圆都想成为直线，所有的直线都在偷偷羡慕圆。",

      /* ── 更新与版本 ── */
      "版本号往上走，功能往下沉，最后沉成你不再注意的顺手。",
      "更新日志写的都是变化，可真正重要的东西从来不变。",
      "最好的版本，是让你忘了它还有个版本。",
      "补丁是承认过去不完美的勇气，不是羞耻。",
      "系统稳定运行的时候，没人会感谢它。这很正常。",
      "检查这件事本身，就已经是一种维护。",

      /* ── 存在与距离 ── */
      "你以为你在看风景，风景也在决定你能看见什么。",
      "一个人身上最硬的部分，通常是他最疼过的地方。",
      "所有的完美都是局部，所有的局部都以为自己是全部。",
      "我们不是因为看见才相信，是因为相信才看得见。",
      "距离不是空间，是还没走完的那段心思。",
      "重要的东西都轻，比如空气，比如一句「我在」。",
      "你用什么样的尺子，就量出什么样的世界。",
      "有些门推开是房间，有些门推开是自己。",
      "人在低处看见的多，在高处看见的远，很少有人两样都要。",
      "影子跟着你走了一路，从没要求过什么。",
      "星星之间的距离用光年算，人和人之间的距离用一句话算。",
      "你把石头扔进水里，水面很快恢复，湖底已经变了。",
      "所有的答案都在问题里，只是问题不肯先说完。",

      /* ── 收束 ── */
      "一天结束的方式，和它开始的方式往往不一样，这就是一天的功劳。",
      "收尾比开头难，因为开头可以假装，收尾不能。",
      "所有的「完成」，都是另一个东西的「开始」换了个说法。",
      "把灯关掉，房间没有消失，只是换了一种存在方式。",
      "事情做完的时候最安静，安静得像雪落在雪上。",
      "路走完了，脚还记得——这大概就是经历的意思。"
    ];

    /**
     * 每次启动换一句，会话内保持稳定。
     * 原来只按 pluginsCheckedAt 取模，同一检测时刻永远同一条；
     * 加一个会话级随机盐，重启后换一句，但同一次运行里不会闪。
     */
    const QUOTE_SALT = Math.floor(Math.random() * 1000003);

    function pickAllDoneLine(seed) {
      const n = ALL_DONE_LINES.length;
      if (n === 0) return "";
      const base = Math.abs(Math.floor(Number(seed) || 0));
      return ALL_DONE_LINES[(base + QUOTE_SALT) % n];
    }

    function readInfo() {
      const raw = typeof globalThis === "undefined" ? undefined : globalThis[GLOBAL_KEY];
      return raw !== null && typeof raw === "object" ? raw : {};
    }

    function formatCheckedAt(value) {
      const ms = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(ms) || ms <= 0) return "";
      const when = new Date(ms);
      const pad = (n) => String(n).padStart(2, "0");
      return pad(when.getHours()) + ":" + pad(when.getMinutes());
    }

    function formatReleaseDate(value) {
      if (typeof value !== "string" || value === "") return "";
      const when = new Date(value);
      if (Number.isNaN(when.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return when.getFullYear() + "-" + pad(when.getMonth() + 1) + "-" + pad(when.getDate());
    }

    function sourceLabel(source) {
      if (source === "feed") return "官方更新源";
      if (source === "npm") return "npm";
      if (source === "demo") return "演示值";
      return "";
    }

    function formatBytes(n) {
      const v = Number(n);
      if (!Number.isFinite(v) || v <= 0) return "0 B";
      if (v < 1024) return v + " B";
      if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
      return (v / 1024 / 1024).toFixed(1) + " MB";
    }

    /** 从相对路径里取顶层段；根目录散文件返回 "(root)"。 */
    function topSeg(rel) {
      return rel.includes("/") ? rel.split("/")[0] : "(root)";
    }

    /** 拉取某个插件的更新分组清单。 */
    async function fetchPlan(name, version) {
      const url = "/dsh-version-badge/plan?name=" + encodeURIComponent(name) + "&version=" + encodeURIComponent(version);
      const response = await fetch(url, { credentials: "same-origin" });
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw new Error(body.error || "HTTP " + response.status);
      return body;
    }

    /** 提交勾选的路径。 */
    async function postApply(name, version, paths) {
      const response = await fetch("/dsh-version-badge/apply", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, version, paths })
      });
      const body = await response.json();
      return body;
    }

    /**
     * 顶部批量条：一键全部更新。
     */
    function BatchBar(props) {
      const items = Array.isArray(props.items) ? props.items : [];
      // 快照可能过期：本地版本已经追平目标版本的，直接不列进来
      const staleSet = new Set();
      for (const it of items) {
        const cur = String(it.version || "");
        const tgt = String(it.latest || "");
        if (cur !== "" && cur === tgt) staleSet.add(String(it.name));
      }
      const [plans, setPlans] = react.useState({});
      const [loading, setLoading] = react.useState(true);
      const [busy, setBusy] = react.useState(false);
      const [step, setStep] = react.useState("");
      const [done, setDone] = react.useState(0);
      const [total, setTotal] = react.useState(0);
      const [results, setResults] = react.useState(null);
      const [tick, setTick] = react.useState(0);
      const [refreshing, setRefreshing] = react.useState(false);

      react.useEffect(() => {
        let alive = true;
        setLoading(true);
        const next = {};
        Promise.all(
          items.map((it) =>
            fetchPlan(String(it.name), String(it.latest || ""))
              .then((data) => { next[String(it.name)] = data; })
              .catch(() => {})
          )
        ).then(() => {
          if (!alive) return;
          setPlans(next);
          setLoading(false);
          setRefreshing(false);
        });
        return () => { alive = false; };
      }, [tick]);

      const refresh = () => {
        if (busy || refreshing) return;
        setRefreshing(true);
        setResults(null);
        setTick((n) => n + 1);
      };

      const usable = [];
      for (const it of items) {
        if (staleSet.has(String(it.name))) continue;
        const plan = plans[String(it.name)];
        if (plan && (plan.groups || []).length > 0) usable.push({ item: it, plan });
      }

      const runAll = async () => {
        setBusy(true);
        setResults(null);
        setDone(0);
        setTotal(usable.length);
        const out = [];
        let n = 0;
        for (const u of usable) {
          n += 1;
          const name = String(u.item.name);
          const ver = String(u.item.latest || "");
          const paths = u.plan.groups.map((g) => g.path);
          setStep(name + " · 写入 " + paths.length + " 项");
          try {
            const body = await postApply(name, ver, paths);
            out.push({ name, ok: body.ok === true, written: body.written || 0, error: body.error || "" });
          } catch (e) {
            out.push({ name, ok: false, error: String((e && e.message) || e) });
          }
          setDone(n);
          setResults(out.slice());
        }
        setStep("");
        setBusy(false);
      };

      const pct = total === 0 ? 0 : Math.round((done / total) * 100);

      const children = [
        react.createElement(
          "div",
          { key: "bar", className: "dsh-version-badge-own-batch" },
          react.createElement(
            "button",
            {
              type: "button",
              className: "dsh-version-badge-own-btn",
              "data-primary": "true",
              onClick: runAll,
              disabled: busy || loading || usable.length === 0
            },
            busy ? "更新中 " + pct + "%" : loading ? "汇总中…" : "全部更新（" + usable.length + "）"
          ),
          react.createElement(
            "button",
            {
              type: "button",
              className: "dsh-version-badge-own-btn",
              onClick: refresh,
              disabled: busy || refreshing,
              title: "重新拉取最新版本与更新内容"
            },
            refreshing ? "刷新中…" : "刷新"
          ),
          busy
            ? react.createElement(
                "div",
                { className: "dsh-version-badge-own-progress" },
                react.createElement(
                  "div",
                  { className: "dsh-version-badge-own-progresstrack" },
                  react.createElement("div", { className: "dsh-version-badge-own-progressfill", style: { width: pct + "%" } })
                ),
                react.createElement("div", { className: "dsh-version-badge-own-progresstext" }, step)
              )
            : null
        )
      ];

      if (results !== null) {
        children.push(
          react.createElement(
            "div",
            { key: "res", className: "dsh-version-badge-own-note" },
            results.map((r, i) =>
              react.createElement(
                "div",
                { key: i, "data-kind": r.ok ? "ok" : "err" },
                (r.ok ? "OK " : "失败 ") + r.name + (r.ok ? " " + r.written : " " + r.error)
              )
            )
          )
        );
      }

      return react.createElement("div", null, children);
    }

    /**
     * 单个插件的可勾选更新卡片。
     */
    function PluginUpdateCard(props) {
      const item = props.item;
      const name = String(item.name);
      const from = String(item.version || "");
      const to = String(item.latest || "");

      const [plan, setPlan] = react.useState(null);
      const [error, setError] = react.useState("");
      const [loading, setLoading] = react.useState(false);
      const [selected, setSelected] = react.useState({});
      const [busy, setBusy] = react.useState(false);
      const [result, setResult] = react.useState(null);

      // 展开时拉一次清单
      react.useEffect(() => {
        let alive = true;
        setLoading(true);
        setError("");
        fetchPlan(name, to)
          .then((data) => {
            if (!alive) return;
            setPlan(data);
            const defaults = {};
            for (const g of data.groups || []) defaults[g.path] = true; // 默认全勾
            setSelected(defaults);
          })
          .catch((e) => { if (alive) setError(String((e && e.message) || e)); })
          .then(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
      }, [name, to]);

      const groups = plan && Array.isArray(plan.groups) ? plan.groups : [];
      const chosen = groups.filter((g) => selected[g.path] === true);
      const chosenPaths = chosen.map((g) => g.path);

      // 是否需要重启：勾选里有 entryTouching 的组就要重启
      const needRestartNow = chosen.some((g) => g.entryTouching === true);
      const features = plan && Array.isArray(plan.features) ? plan.features : [];

      const toggle = (p) => setSelected((prev) => ({ ...prev, [p]: prev[p] !== true }));
      const selectAll = () => {
        const next = {};
        for (const g of groups) next[g.path] = true;
        setSelected(next);
      };
      const selectRequired = () => {
        const next = {};
        for (const g of groups) next[g.path] = g.required === true;
        setSelected(next);
      };

      const submit = async () => {
        if (chosenPaths.length === 0) { setError("没有勾选任何内容"); return; }
        setBusy(true);
        setError("");
        setResult(null);
        try {
          const body = await postApply(name, to, chosenPaths);
          setResult(body);
          if (body.ok !== true) setError(String(body.error || "更新失败"));
        } catch (e) {
          setError(String((e && e.message) || e));
        }
        setBusy(false);
      };

      // 头部：插件名 + 版本变迁 + 重启标记
      const head = react.createElement(
        "div",
        { className: "dsh-version-badge-own-card-head" },
        react.createElement("span", null, name),
        react.createElement("span", { className: "dsh-version-badge-own-card-ver" }, from + " → " + to),
        groups.length === 0
          ? null
          : react.createElement(
              "span",
              {
                className: "dsh-version-badge-own-tag",
                "data-kind": needRestartNow ? "restart" : "reload",
                title: needRestartNow ? "勾选范围包含主入口，必须重启 DSH 才会生效" : "勾选范围不涉及已加载模块，刷新页面即可"
              },
              needRestartNow ? "需重启" : "刷新即可"
            )
      );

      const children = [head];

      if (loading) {
        children.push(react.createElement("div", { className: "dsh-version-badge-own-note" }, "正在拉取新版本并对比…"));
      }

      if (error !== "") {
        children.push(react.createElement("div", { className: "dsh-version-badge-own-note", "data-kind": "err" }, error));
      }

      // 分组勾选：一行一个，勾选框 + 名字（会怎样） + 数量
      const selPrefix = (props.selPrefix === undefined || props.selPrefix === null) ? "" : String(props.selPrefix);
      for (const g of groups) {
        const key = selPrefix + g.path;
        const checked = selected[g.path] === true;
        children.push(
          react.createElement(
            "label",
            { key: g.path, className: "dsh-version-badge-own-group" },
            react.createElement("input", {
              type: "checkbox",
              checked,
              onChange: () => toggle(g.path)
            }),
            react.createElement(
              "span",
              { className: "dsh-version-badge-own-group-body" },
              react.createElement(
                "span",
                { className: "dsh-version-badge-own-group-name" },
                g.label,
                g.required === true
                  ? react.createElement("span", { className: "dsh-version-badge-own-tag", "data-kind": "req" }, "必需")
                  : null
              ),
              react.createElement(
                "div",
                { className: "dsh-version-badge-own-group-meta" },
                g.files + " 个文件 · " + formatBytes(g.bytes)
              )
            )
          )
        );
      }

      // 新功能（工具/命令增量）
      if (features.length > 0) {
        children.push(
          react.createElement(
            "div",
            { key: "feat", className: "dsh-version-badge-own-readme" },
            features.map((f, i) => react.createElement("div", { key: i }, "+ " + f.label))
          )
        );
      }

      // README 摘录
      if (plan && plan.readme && Array.isArray(plan.readme.lines) && plan.readme.lines.length > 0) {
        children.push(
          react.createElement(
            "div",
            { key: "readme", className: "dsh-version-badge-own-readme" },
            plan.readme.lines.map((line, i) => react.createElement("div", { key: i }, line))
          )
        );
      }

      // 单个插件的操作按钮
      if (groups.length > 0) {
        children.push(
          react.createElement(
            "div",
            { key: "act", className: "dsh-version-badge-own-actions" },
            react.createElement("button", { type: "button", className: "dsh-version-badge-own-btn", onClick: selectAll, disabled: busy }, "全选"),
            react.createElement("button", { type: "button", className: "dsh-version-badge-own-btn", onClick: selectRequired, disabled: busy }, "只选必需"),
            react.createElement(
              "button",
              { type: "button", className: "dsh-version-badge-own-btn", "data-primary": "true", onClick: submit, disabled: busy || chosenPaths.length === 0 },
              busy ? "更新中…" : "只更新这个（" + chosenPaths.length + "）"
            )
          )
        );
      }

      // 结果
      if (result !== null) {
        if (result.ok === true) {
          children.push(
            react.createElement(
              "div",
              { key: "done", className: "dsh-version-badge-own-note", "data-kind": "ok" },
              "已写入 " + result.written + " 个文件。" +
                (needRestartNow ? "请重启 DSH 让新代码生效。" : "刷新页面即可看到变化。") +
                " 备份在 " + String(result.backupDir || "")
            )
          );
        }
      }

      return react.createElement("div", { className: "dsh-version-badge-own-card" }, children);
    }

    /**
     * 侧栏左下角那一行极简版本号。
     */
    function VersionBadge(props) {
      const wide = props === null || props === undefined ? true : props.wide !== false;
      const info = readInfo();
      const version = typeof info.version === "string" ? info.version : "";
      const latest = typeof info.latest === "string" ? info.latest : "";
      const hasUpdate = info.hasUpdate === true && latest !== "" && latest !== version;
      const plugins = Array.isArray(info.plugins) ? info.plugins.filter((item) => item !== null && typeof item === "object") : [];
      // 探针快照可能过期：本地已追平目标版本的不算「有更新」
      const pluginUpdates = plugins.filter((item) =>
        item.hasUpdate === true &&
        !(String(item.version || "") !== "" && String(item.version || "") === String(item.latest || ""))
      );
      const pluginUpdateCount = pluginUpdates.length;
      const clickable = true; // 无更新时也能点开：面板里给出「全是最新」与一句文案
      const notes = info.latestNotes !== null && typeof info.latestNotes === "object" ? info.latestNotes : undefined;
      const withNotes = notes !== undefined && Array.isArray(notes.sections) && notes.sections.length > 0;
      const label = sourceLabel(info.latestSource);
      const downloadUrl = typeof info.latestUrl === "string" ? info.latestUrl : "";

      const [open, setOpen] = react.useState(false);
      const [checking, setChecking] = react.useState(false);
      const [recheckTick, setRecheckTick] = react.useState(0);

      const recheck = async () => {
        if (checking) return;
        setChecking(true);
        try {
          const response = await fetch("/dsh-version-badge/recheck", { method: "POST", credentials: "same-origin" });
          const body = await response.json();
          if (body && body.ok === true) {
            // 探针结果就地写回全局，让徽标与面板立刻反映新数字
            const store = globalThis[GLOBAL_KEY];
            if (store !== null && typeof store === "object") {
              const previous = Array.isArray(store.plugins) ? store.plugins : [];
              const fresh = Array.isArray(body.plugins) ? body.plugins : [];
              if (fresh.length > 0) {
                store.plugins = fresh;
                store.pluginsCheckedAt = Number(body.checkedAt) || Date.now();
              } else if (previous.length > 0) {
                store.pluginsCheckedAt = Number(body.checkedAt) || Date.now();
              }
            }
          }
        } catch (e) { /* 失败就让用户自己看日志 */ }
        setChecking(false);
        setRecheckTick((n) => n + 1);
      };
      const [position, setPosition] = react.useState(undefined);
      const anchorRef = react.useRef(null);
      const panelRef = react.useRef(null);

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
        const at = formatCheckedAt(info.latestCheckedAt);
        tooltip.push(label + "已是最新" + (at === "" ? "" : "（" + at + " 检测）"));
      }

      if (pluginUpdateCount > 0) {
        tooltip.push("插件有新版 " + pluginUpdateCount + " 个：" + pluginUpdates.slice(0, 6).map((item) => item.name).join("、") + (pluginUpdateCount > 6 ? " 等" : ""));
        const at = formatCheckedAt(info.pluginsCheckedAt);
        if (at !== "") tooltip.push("插件检测于 " + at);
        tooltip.push("点一下看是哪几个、可勾选更新");
      }

      const rowChildren = [react.createElement("span", { key: "current" }, "v" + version)];
      if (hasUpdate) {
        rowChildren.push(react.createElement("span", { key: "arrow", className: "dsh-version-badge-own-arrow" }, "→"));
        rowChildren.push(react.createElement("span", { key: "latest", className: "dsh-version-badge-own-latest" }, "v" + latest));
      }
      if (pluginUpdateCount > 0) {
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

      /* v0.5.0：多插件批量勾选 —— 全部插件一次性选中、一次性提交 */
      /* v0.5.2：没有待更新时也给出内容，面板不再空白 */
      const allDoneLine = pickAllDoneLine(Math.floor(Number(info.pluginsCheckedAt) || Date.now() / 60000));

      const pluginSection =
        pluginUpdateCount === 0
          ? react.createElement(
              "div",
              { className: "dsh-version-badge-own-panel-section" },
              react.createElement(
                "div",
                { className: "dsh-version-badge-own-alldone" },
                react.createElement("div", { className: "dsh-version-badge-own-alldone-title" }, "全部插件已是最新"),
                react.createElement(
                  "div",
                  { className: "dsh-version-badge-own-alldone-meta" },
                  "插件 " + plugins.length + " 个 · 检测于 " + formatCheckedAt(info.pluginsCheckedAt)
                ),
                allDoneLine === ""
                  ? null
                  : react.createElement("div", { className: "dsh-version-badge-own-alldone-quote" }, allDoneLine)
              )
            )
          : react.createElement(
              "div",
              { className: "dsh-version-badge-own-panel-section" },
              react.createElement("div", { className: "dsh-version-badge-own-panel-section-title" }, "插件有新版（" + pluginUpdateCount + "）"),
              react.createElement(BatchBar, { items: pluginUpdates }),
              pluginUpdates.map((item, index) =>
                react.createElement(PluginUpdateCard, { key: index, item })
              ),
              react.createElement(
                "div",
                { className: "dsh-version-badge-own-panel-more" },
                "检测于 " + formatCheckedAt(info.pluginsCheckedAt) + " · 插件 " + plugins.length + " 个"
              ),
              allDoneLine === ""
                ? null
                : react.createElement("div", { className: "dsh-version-badge-own-alldone-quote" }, allDoneLine)
            );

      const headTitle = hasUpdate
        ? "v" + latest + " 更新内容"
        : pluginUpdateCount > 0
          ? "插件可更新 " + pluginUpdateCount + " 个"
          : "版本与插件";

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
          react.createElement(
            "span",
            { className: "dsh-version-badge-own-panel-tools" },
            headDate === "" ? null : react.createElement("span", { className: "dsh-version-badge-own-panel-date" }, headDate),
            react.createElement(
              "button",
              {
                type: "button",
                className: "dsh-version-badge-own-panel-btn",
                onClick: recheck,
                disabled: checking,
                title: "立刻向源站查一次新版本"
              },
              checking ? "检测中…" : "立即检测"
            )
          )
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
          pluginUpdateCount > 0
            ? "勾选后只覆盖选中路径，整目录先备份，失败自动回滚。"
            : "没有可更新的内容。下次发版会自动出现在这里。"
        )
      );

      return react.createElement(react.Fragment, null, row, panel);
    }

    /**
     * 注册到侧栏底部官方开放的列表槽位 `sidebar.footer.action`。
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
