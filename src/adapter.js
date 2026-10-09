// ============================================================================
// vFlow 流体云 · 适配层
//
// 本文件**手写**，在 core.vflow.js（构建产物）之前执行。三件事：
//   1. 定义平台桥 VFLOW_ADAPTER —— core.js 里 3 处 ShortX API 的替代物
//   2. 定义 core.js 依赖的全局变量（input / tiggerTag / DebugMode / isRunAction / FLUID_CLOUD_DIR）
//   3. 首次运行自举配置目录（写 config.json / recordcopy.json / 规则库）
//
// ⚠️ 顺序不能变：core.js 的**顶层**（非函数内）就有一句
//    `var config = readJsonFile(FLUID_CLOUD_DIR + "/config.json")`，
//    文件不存在会当场抛「配置文件读取失败」。故自举必须在 core.js 之前完成。
// ============================================================================

// ---------------------------------------------------------------------------
// 配置目录
//
// 上游用 `/data/system/shortx*/data/Fluid_Cloud_Island/`（原平台是 UID 1000，可写）。
// vFlow 是普通 App（UID 10684）⇒ **/data/system 不可写**（实测结论见
// docs/fork/surveys/script-system-overview.md §8.5.4）。
// 改到 vFlow 自己的外部存储目录：App 有 MANAGE_EXTERNAL_STORAGE，脚本侧直接写。
// ---------------------------------------------------------------------------
var FLUID_CLOUD_DIR = "/sdcard/vFlow/fluid-cloud";

// ---------------------------------------------------------------------------
// 平台桥
//
// core.js 里对原平台的 3 处依赖（全部，已用 build.js 的断言锁住）：
//   showToast()        → VFLOW_ADAPTER.toast
//   CopyText()         → VFLOW_ADAPTER.setClipboard
//   OpenMain 的 shell  → VFLOW_ADAPTER.shell
// ---------------------------------------------------------------------------
var VFLOW_ADAPTER = (function () {

    /** 日志：vFlow 的 JsConsole 已提供 console，这里统一加前缀便于过滤。 */
    function log(msg) {
        try {
            console.log("[fluid-cloud] " + msg);
        } catch (e) {
            // console 缺失不应让业务中断（vFlow 已注入，这里只是防御）
        }
    }

    return {
        log: log,

        /**
         * 弹提示。
         *
         * ⚠️ 原脚本的 `showToast` 是同步调用，这里也是 —— `vflow.device.toast`
         * 内部走 `runBlocking`（见 script-system-overview.md §2.3），返回时已完成。
         */
        toast: function (text) {
            try {
                vflow.device.toast({ message: String(text) });
            } catch (e) {
                log("toast 失败：" + e);
            }
        },

        /** 写剪贴板。参数名是 `content`（`SetClipboardModule` 的输入 id）。 */
        setClipboard: function (text) {
            try {
                vflow.system.set_clipboard({ content: String(text) });
            } catch (e) {
                log("写剪贴板失败：" + e);
            }
        },

        /**
         * 执行 shell（需要 Shizuku 或 Root）。
         *
         * ⚠️ 原脚本这里只用来 `am start -d <url>`（「系统选择框」分支）。
         * 拿不到 shell 时**不抛**，只记日志 —— 那个分支失败不该中断整个流程。
         */
        shell: function (command) {
            try {
                var r = vflow.shizuku.shell_command({ mode: "auto", command: String(command) });
                if (r && r.success === false) {
                    log("shell 失败：" + (r.result || ""));
                }
                return r;
            } catch (e) {
                log("shell 异常：" + e);
                return null;
            }
        },

        /** 读文本文件；不存在返回 null（**不抛** —— 调用方要能区分「没配过」与「读坏了」）。 */
        readText: function (path) {
            try {
                var file = new java.io.File(path);
                if (!file.exists()) return null;
                var scanner = new java.util.Scanner(file, "UTF-8").useDelimiter("\\Z");
                var content = scanner.hasNext() ? scanner.next() : "";
                scanner.close();
                return String(content);
            } catch (e) {
                log("读文件失败 " + path + "：" + e);
                return null;
            }
        },

        /** 写文本文件（自动建父目录）。 */
        writeText: function (path, text) {
            try {
                var file = new java.io.File(path);
                var parent = file.getParentFile();
                if (parent && !parent.exists()) parent.mkdirs();
                var writer = new java.io.FileWriter(file);
                writer.write(String(text));
                writer.close();
                return true;
            } catch (e) {
                log("写文件失败 " + path + "：" + e);
                return false;
            }
        }
    };
})();

// ---------------------------------------------------------------------------
// core.js 依赖的全局变量
//
// ⚠️ 这些在原脚本里由**工作流的第一个动作**赋值（见用户提供的规则 JSON 的
//    `ReplaceRegex` / `ExecuteJS` 那两步）。移植后由本适配层赋值 ——
//    **core.js 里没有任何一行负责定义它们**（`grep -c "^var input"` = 0），
//    漏了会在运行时报 `ReferenceError: "input" is not defined`。
// ---------------------------------------------------------------------------

/** 本次触发的输入文本（剪贴板内容 / 广播 `data_uri` / QQ·微信 Intent 里抠出的串）。 */
var input = (function () {
    /**
     * ⚠️⚠️ **未命中的触发器输出不是空串，而是 `{{{stepId.outputId}}}`（三个花括号）。**
     *
     * 这是 vFlow `VariableResolver` 对「解析不到」的回退
     * （`VariableResolver.kt:133`：`VObjectFactory.from("{${segment.rawExpression}}")`，
     * 而 `rawExpression` 本身已含 `{{ }}` ⇒ 拼出来是三层）。
     *
     * **一个工作流挂多个触发器时，未命中的那些输出全都会是这个形态**（实测确认）。
     * 直接当值用 ⇒ 脚本会拿这串去识别链接 ⇒ **弹一个无意义的岛**，而且**不报错**。
     * ⇒ 必须显式认出来、当空处理。
     */
    function unresolved(v) {
        return typeof v !== "string" || v === "" || v.indexOf("{{{") === 0;
    }

    if (typeof inputs !== "undefined" && inputs !== null) {
        // 两个触发器各一路（键与值见 workflow/fluid-cloud.json 的 inputs，
        // 由 tools/build-workflow.py 刷新）。一次执行只命中一个，
        // 另一个必是 `{{{...}}}` ⇒ 这里谁有真值用谁。
        // ⚠️ 点击 URI 排前面：它形态明确（`vflowfc://click?…`），且要被顶层分派认出来。
        if (!unresolved(inputs.click_uri)) return inputs.click_uri;
        if (!unresolved(inputs.clipboard_text)) return inputs.clipboard_text;
    }
    if (typeof vars !== "undefined" && vars !== null) {
        // 触发器输出经 `{{step.output}}` 展开后由工作流传进来时，可能落在命名变量里
        if (typeof vars.input_text === "string") return vars.input_text;
    }
    return "";
})();

/**
 * 触发器标签 —— core.js 用它判断「本次是哪条触发源」。
 *
 * 取值：`剪切板` / `QQ` / `微信` / `附加` / **`设置`**（与原脚本的 tag 一致）。
 *
 * ⚠️ `设置` 不是输入源，是**手动触发器**的标签：本次执行要弹「设置指令 / 编辑规则」
 *    那个自绘界面（上游「点指令图标 → 执行动作」的 vFlow 版，见 core.js 的顶层分派）。
 *
 * ⚠️ vFlow 侧来源是 `[[__trigger_label]]`（命名变量），未设置时是**空串**。
 *    见 docs/fork/trigger-label-design.md。
 * ⚠️ 空串会让 core.js 的 `["选中","附加"].includes(tiggerTag)` 等判断全部走 false 分支 ——
 *    这是**静默**的（表现为「浮窗不弹」或「走错分支」）⇒ 下面显式记一条日志。
 */
var tiggerTag = (function () {
    if (typeof inputs !== "undefined" && inputs !== null && typeof inputs.trigger_label === "string") {
        return inputs.trigger_label;
    }
    if (typeof vars !== "undefined" && vars !== null && typeof vars.__trigger_label === "string") {
        return vars.__trigger_label;
    }
    return "";
})();

if (tiggerTag === "") {
    VFLOW_ADAPTER.log("⚠️ 触发器标签为空 —— core.js 会走错分支。请在触发器的「标签」里填：剪切板 / QQ / 微信 / 附加 / 设置");
} else if (tiggerTag === "设置") {
    // ⚠️ 这条日志是**手动触发那条路唯一的痕迹**：那条路不识别链接、不弹岛，
    //    界面上只有自绘的 WindowManager View。出了问题（比如标签写错成「设置 」）
    //    表现是「点了执行，什么都没发生」，只有日志能区分是哪种。
    VFLOW_ADAPTER.log("手动触发（标签「设置」）—— 打开设置界面，本次不做链接处理");
}

/** 调试模式：true 时强制显示浮窗（即使 tiggerTag 是「选中」「附加」）。 */
var DebugMode = false;

/**
 * 原脚本用它区分「用户点了指令图标 → 进设置菜单」与「触发器命中 → 走识别流程」。
 *
 * ⚠️ 原实现靠 `{factTag}` 短变量**展开失败**来判断（try/catch 里 `isRunAction = true`），
 *    那是原平台的短变量机制。vFlow 里没有这种东西 ⇒ 固定 false（永远走识别流程）。
 *    「设置菜单」是 P2 的 UI 积木改造项（见 DESIGN.md §5 P2-11）。
 */
var isRunAction = false;

/** 是否显示 Toast。core.js 会从 config.json 重新赋值，这里只是让提前调用不炸。 */
var show_toast = true;

// ---------------------------------------------------------------------------
// 首次运行自举：确保配置目录与三个 JSON 存在
//
// ⚠️ 必须在 core.js 之前 —— 它顶层就有 `readJsonFile(config.json)`。
// ⚠️ 规则库为空 = 识别不出任何链接，而**表现是「功能没反应」**（静默）。
//    故这里对「规则库缺失」显式报错，不只记日志。
// ---------------------------------------------------------------------------

var VFLOW_BOOTSTRAP = (function () {

    /**
     * 默认配置 —— 与上游 update.js 的 `configys` 逐字段一致（版本 1.5）。
     *
     * ⚠️ 两边必须同步：上游加字段后这里没跟，用户会看到「某个开关没有效果」。
     *    见 DESIGN.md §6 静默失效点。
     */
    var DEFAULT_CONFIG = {
        "Top_Level_Domain": ["com", "cn", "top", "love", "xyz", "net", "org", "vip", "cloud", "online", "icu", "fun", "work", "tv", "wiki", "email", "plus", "co", "ltd", "shop", "tech", "wang", "site", "xin", "store", "art", "cc", "website", "press", "space", "beer", "luxe", "video", "group", "ren", "fit", "yoga", "pro", "ink", "info", "mobi", "kim", "red", "run", "chat", "cool", "zone", "host", "biz", "me", "so"],
        "Email_Keyword_List": ["qq.com", "126.com", "163.com", "139.com", "gmail.com", "hotmail.com", "sohu.com", "sina.com", "sina.cn", "foxmail.com", "outlook.com", "aliyun.com", "tom.com", "yeah.net", "live.cn", "msn.com"],
        "Extractioncode_Keyword_list": ["提取码：", "密码：", "提取码:", "密码:", "访问码:", "访问码：", "提取码 : "],
        "Use_https_keyword_list": ["123pan.com"],
        "link_blacklist_keywords": ["无"],
        "Window_Configuration": {},
        "Launch_Windowing_Mode": 5,
        "Fluid_Cloud_Position": "顶部",
        "Fluid_Cloud_Position_Offset": 10,
        "Fluid_Cloud_timeout": 3000,
        "browser": "自动",
        "Browser_PackageName_BlackList": [
            "com.jingdong.app.mall",
            "com.taobao.taobao",
            "air.svran.browser.nb",
            "com.trianguloy.urlchecker",
            "com.tmall.wireless",
            "com.thestore.main"
        ],
        "allowChar": "qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM#_/+-:?%@=.&,，；;1234567890",
        "show_Multiple_users": true,
        "show_toast": true,
        "extra_default_action": "询问",
        "use_islandNotification": true,
        "pull_small_window": true
    };

    /**
     * 配置版本 —— 与 config.json 里的注释头一致，**版本闸**的基准
     * （`ensureConfig()`：与本地版本相同 ⇒ 不合并、不写盘）。
     *
     * ⚠️ **2026-10-09 实施更新机制时特意保持 `1.5` 未 bump** —— **不是漏了**：
     *    `DEFAULT_CONFIG` 本次**未变**（没有新增字段、没有需要迁移的存量设备），
     *    而版本闸的语义是「**基准变了**才写盘」。bump 只会让所有存量设备白走一次合并，
     *    并按 UPDATE.md §5.1 的已知代价**重写 config.json**（丢注释、重排键序）。
     *    ⇒ 只有 `DEFAULT_CONFIG` 真的加了字段时才 bump。
     */
    var CONFIG_VERSION = "1.5";

    function configRemarks() {
        return "一.配置版本：\n" + CONFIG_VERSION + "\n二.字段解释见 DESIGN.md\n三.配置：\n";
    }

    /**
     * 从 config 文本里取版本号 —— **第 2 行**（照上游 `reference/update.js:194-215`
     * 的 `configVersion()` 读法）。
     *
     * ⚠️ 返回**字符串**，与 `CONFIG_VERSION` 做**相等比较** —— 不做语义比较
     *    （「谁更新」需要一套版本号语义，而这里只需要「变没变」，见 UPDATE.md §4.3）。
     */
    function configVersionOf(text) {
        if (text === null || typeof text !== "string") return "";
        var lines = text.split("\n");
        return lines.length >= 2 ? String(lines[1]).replace(/^\s+|\s+$/g, "") : "";
    }

    /**
     * 把 config 文本解析成对象。
     *
     * ⚠️ **不能在 adapter 里调 `readJsonFile`** —— 它定义在 `core.js`，而
     *    `adapter.js` **先于** `core.js` 执行（见本文件头部的顺序约定）
     *    ⇒ 这里必须自带一份极小的解析（与 `readJsonFile` 同口径：跳过起始行之前的注释头）。
     */
    function parseConfigText(text) {
        var lines = String(text).split("\n");
        var out = "";
        var started = false;
        for (var i = 0; i < lines.length; i++) {
            if (!started) {
                if (lines[i].replace(/^\s+/, "").indexOf("{") === 0) started = true;
                else continue;
            }
            out += lines[i];
        }
        return started ? JSON.parse(out) : null;
    }

    /**
     * config 增量合并（UPDATE.md §5.1）—— 基准是**脚本内置的 `DEFAULT_CONFIG`**。
     *
     * | 键的类型 | 语义 |
     * |---|---|
     * | 本地**缺**的键 | 用默认值补上 |
     * | **数组**键 | 取「本地 ∪ 默认」并集去重 |
     * | **标量**键 | **永远保留本地** |
     * | **对象**键（`Window_Configuration`） | **整体保留本地** |
     *
     * ⚠️ 数组并集的顺序：**默认在前**，本地独有的追加在后 —— 照上游
     *    `reference/update.js:411-431` 的分支（UPDATE.md 未规定顺序，这是**实现时定**的）。
     * ⚠️ 代价（UPDATE.md §5.1 已记录并接受）：用户**删掉**的默认项**会被加回来**；
     *    写盘丢注释、重排键序 —— 所以才需要**版本闸**（相同就整个跳过）。
     */
    function mergeConfig(local, defaults) {
        var merged = {};
        var keys = Object.keys(defaults);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var dv = defaults[k];
            if (!Object.prototype.hasOwnProperty.call(local, k)) {
                merged[k] = dv; // 本地缺的键 ⇒ 用默认补
            } else if (Array.isArray(dv)) {
                // 数组 ⇒ 并集去重，**默认在前**（照上游）
                var union = dv.slice();
                var lv = local[k];
                if (Array.isArray(lv)) {
                    for (var j = 0; j < lv.length; j++) {
                        if (union.indexOf(lv[j]) === -1) union.push(lv[j]);
                    }
                }
                merged[k] = union;
            } else {
                // 标量 / 对象 ⇒ **保留本地**
                merged[k] = local[k];
            }
        }
        // 本地独有的键（默认里没有的）也保留 —— 免得用户自己加的字段被抹掉
        var lkeys = Object.keys(local);
        for (var m = 0; m < lkeys.length; m++) {
            if (!Object.prototype.hasOwnProperty.call(merged, lkeys[m])) merged[lkeys[m]] = local[lkeys[m]];
        }
        return merged;
    }

    function ensureConfig() {
        var path = FLUID_CLOUD_DIR + "/config.json";
        var existing = VFLOW_ADAPTER.readText(path);
        if (existing !== null && existing.indexOf("\"Top_Level_Domain\"") !== -1) {
            // ⚠️ **版本闸**（UPDATE.md §5.1）：复用上面那个**已经读出来的字符串**判版本，
            //    不再多一次 IO。相同 ⇒ 连合并都不做、不写盘（用户手改的 config 原样保留）。
            if (configVersionOf(existing) === CONFIG_VERSION) return false;

            var local = null;
            try { local = parseConfigText(existing); } catch (e) { local = null; }
            // 解析不了 ⇒ **不动它**（宁可不迁移，也不破坏用户文件）
            if (local === null || typeof local !== "object" || Array.isArray(local)) return false;

            VFLOW_ADAPTER.writeText(path, configRemarks() + JSON.stringify(mergeConfig(local, DEFAULT_CONFIG), null, 2));
            VFLOW_ADAPTER.log("配置已增量合并到版本 " + CONFIG_VERSION);
            return false;
        }
        VFLOW_ADAPTER.writeText(path, configRemarks() + JSON.stringify(DEFAULT_CONFIG, null, 2));
        VFLOW_ADAPTER.log("已写入默认配置 " + path);
        return true;
    }

    function ensureRecordCopy() {
        var path = FLUID_CLOUD_DIR + "/recordcopy.json";
        if (VFLOW_ADAPTER.readText(path) === null) {
            VFLOW_ADAPTER.writeText(path, JSON.stringify({ "CopiedText": false }, null, 2));
        }
    }

    /**
     * 规则库：**只检查在不在，不负责搬运**。
     *
     * ⚠️ 规则库（`rules.json` / `nolinkrules.json`）是**部署产物**，由
     *    `npm run build` 生成在 `dist/`，部署时随完整脚本一起 push 到
     *    `/sdcard/vFlow/fluid-cloud/`。自举**不生成**它们 ——
     *    它们由 27 + 2 个源文件合并而来，在设备上凭空造不出来。
     *
     * ⚠️ **缺失时显式抛错**：静默的后果是「复制了链接但什么都没发生」，
     *    用户完全无从判断是规则没命中还是功能坏了。
     */
    function ensureRules() {
        var rulesPath = FLUID_CLOUD_DIR + "/rules.json";
        var nolinkPath = FLUID_CLOUD_DIR + "/nolinkrules.json";

        // ⚠️ **不再读全文只为判存在**（原来每次执行读 14.5 KB，UPDATE.md §5.4）。
        // ⚠️ 判据是 `exists()` **+ 长度下界** —— **不能只判 `exists()`**：
        //    文件在但内容为空（上次写坏了）的情形会从「抛错」变成「静默识别不出」
        //    （表现是「复制了链接，什么都没发生」，用户无从判断）。
        function check(p, label) {
            var f = new java.io.File(p);
            if (!f.exists() || f.length() <= 0) {
                throw new Error(
                    label + "缺失或为空：" + p + "\n" +
                    "请把 dist/ 下的对应 JSON 复制到 " + FLUID_CLOUD_DIR + "/"
                );
            }
        }
        check(rulesPath, "规则库");
        check(nolinkPath, "无链接规则");
    }

    return {
        /** 返回本次自举做了什么，供日志与自检。 */
        run: function () {
            var created = ensureConfig();
            ensureRecordCopy();
            ensureRules();
            if (created) {
                VFLOW_ADAPTER.log("首次运行，已创建配置目录 " + FLUID_CLOUD_DIR);
            }
        },
        DEFAULT_CONFIG: DEFAULT_CONFIG
    };
})();

VFLOW_BOOTSTRAP.run();
