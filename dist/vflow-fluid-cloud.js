// ============================================================================
// vFlow 流体云 · 完整脚本（构建产物）
//
// ⚠️ 不要手改本文件 —— 改 src/adapter.js 或 src/core.js 后重跑：
//      node src/generate.js
//
// 部署：adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/
//      （工作流里放的是 dist/bootstrap.js，它会读这个文件并 eval）
// ============================================================================

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


// ============================================================================
// ↓↓↓ 核心逻辑（src/core.js）
// ============================================================================

// ============================================================================
// vFlow 流体云 · 核心逻辑
//
// 本文件是**主要维护对象** —— 规则匹配、链接识别、UI 构建、岛通知、小窗启动
// 全在这里。可以直接改。
//
// ## 来历
//
// 从上游 `reference/core.js`（v3.2.3，逐字节镜像）移植而来，
// **一次性**做了 5 类改动：
//
//   1. 删 3 行 `importClass(Packages.tornaco.apps.shortx...)`（原平台的 protobuf 类）
//   2. `showToast`  → `VFLOW_ADAPTER.toast`        → vflow.device.toast
//   3. `CopyText`   → `VFLOW_ADAPTER.setClipboard` → vflow.system.set_clipboard
//   4. shell 调用   → `VFLOW_ADAPTER.shell`        → vflow.shizuku.shell_command
//   5. 9 处配置路径 → `FLUID_CLOUD_DIR`（/sdcard/vFlow/fluid-cloud）
//
// 改动点是**就地标注**的（搜 `[vflow]` 可见）。
//
// **要对照原始实现**：`reference/core.js`（**同名文件，直接 diff**，不用做名字映射）。
//
// ⚠️ **本项目不再跟随上游更新** —— 只维护这一份。
//    上游后续版本若带来需要的功能，**手工挑拣**过来，不做自动同步。
//
// ## 运行时依赖（由 src/adapter.js 预先定义）
//
//   VFLOW_ADAPTER   —— 平台桥（toast / setClipboard / shell / 读写文件）
//   FLUID_CLOUD_DIR —— 配置目录（绝对路径）
//   input           —— 本次触发的输入文本
//   tiggerTag       —— 触发器标签（剪切板 / QQ / 微信 / 附加 / **设置**）
//
// ⚠️ `设置` 是**手动触发器**的标签（不是输入源）—— 它只用来分流到
//    「设置指令 / 编辑规则」那个自绘界面（见文件末尾的顶层分派）。
// ============================================================================

importClass(org.json.JSONArray);
importClass(org.json.JSONObject);
importClass(org.json.JSONTokener);
importClass(android.os.Handler);
importClass(android.os.Looper);
importPackage(android.view);
importPackage(android.widget);
importPackage(android.content);
importPackage(android.graphics);
importClass(android.graphics.drawable.GradientDrawable);
importClass(android.graphics.PixelFormat);
importClass(android.view.WindowManager);
importClass(java.lang.Runnable);
importClass(java.lang.Thread);
importClass(android.app.ActivityOptions);
importClass(android.graphics.Rect);
importClass(android.graphics.Point);
importClass(android.view.Surface);
importClass(android.app.ActivityManager);
importClass(android.content.pm.PackageManager);
importClass(android.os.UserHandle);
importClass(android.net.Uri);


importClass(android.view.Gravity);
importClass(android.view.MotionEvent);
importClass(android.util.DisplayMetrics);
importClass(android.content.Context);
importClass(java.io.FileReader);
importClass(java.io.BufferedReader);

importClass(android.os.ServiceManager);
importClass(android.content.pm.IPackageManager$Stub);
var windowManager = context.getSystemService(Context.WINDOW_SERVICE);
var metrics = new DisplayMetrics();
windowManager.getDefaultDisplay().getMetrics(metrics);
var screenWidth = metrics.widthPixels;
var screenHeight = metrics.heightPixels;
/**
 * 获取屏幕真实尺寸（自然方向）
 * @returns {String} 格式为"宽X高"的屏幕尺寸字符串
 */
function getNaturalScreenSize() {
    try {
        var context = android.app.ActivityThread.currentApplication().getApplicationContext();
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var display = wm.getDefaultDisplay();
        var point = new Point();
        display.getRealSize(point);
        // 获取物理尺寸，不受旋转影响（取宽高的最小值作为宽，最大值作为高）
        var naturalWidth = Math.min(point.x, point.y);
        var naturalHeight = Math.max(point.x, point.y);
        return naturalWidth + "X" + naturalHeight;
    } catch (e) {
        // 异常情况下返回默认值
        return "1080X1920";
    }
}
function getForegroundAppPackageName() {
    var am = context.getSystemService(Context.ACTIVITY_SERVICE);
    var runningAppProcesses = am.getRunningAppProcesses();
    if (runningAppProcesses != null) {
        for (var i = 0; i < runningAppProcesses.size(); i++) {
            var processInfo = runningAppProcesses.get(i);
            if (processInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                return String(processInfo.pkgList[0]);
            }
        }
    }
    return null;
}
function ToBoolean(str) {
    return String(str).toLowerCase() === "true";
}
function showToast(text) {
    if (typeof show_toast === "undefined" || show_toast) {
        /* [vflow] */ VFLOW_ADAPTER.toast(text);  // ← 原：shortx.executeAction(ShowToast…)
    }
}
function readJsonFile(filePath) {
    try {
        var reader = new BufferedReader(new FileReader(filePath));
        var sb = new java.lang.StringBuilder();
        var line;
        var start = false;
        while ((line = reader.readLine()) != null) {
            var trimmed = line.trim();
            if (!start) {
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    start = true;
                } else {
                    continue;
                }
            }
            sb.append(line);
        }
        reader.close();
        var jsonText = String(sb.toString());
        return JSON.parse(jsonText);
    } catch (e) {
        throw new Error("配置文件读取失败：" + e.message);
    }
}
var config = readJsonFile(/* [vflow] */ FLUID_CLOUD_DIR + "/config.json")
function writeConfigToFile(filePath, config, Remarks) {
    try {
        var writer = new java.io.FileWriter(filePath);
        var bufferedWriter = new java.io.BufferedWriter(writer);
        var jsonString = JSON.stringify(config, null, 2);
        bufferedWriter.write(Remarks + jsonString);
        bufferedWriter.close();
    } catch (e) { showToast("配置保存失败") }
}
function showStringListEditor(defaultValues, listname, callback) {
    var result = null;
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 40, 40, 40);
        layout.setBackgroundColor(android.graphics.Color.parseColor("#FF2E2E2E"));
        var title = new TextView(context);
        title.setText(listname);
        title.setTextColor(android.graphics.Color.WHITE);
        title.setTextSize(20);
        title.setGravity(android.view.Gravity.CENTER);
        title.setPadding(0, 0, 0, 30);
        layout.addView(title);
        var scrollView = new ScrollView(context);
        var scrollParams = new LinearLayout.LayoutParams(-1, dip2px(400));
        scrollView.setLayoutParams(scrollParams);
        var container = new LinearLayout(context);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(0, 10, 0, 10);
        scrollView.addView(container);
        layout.addView(scrollView);
        var inputItems = [];
        function addInputItem(text) {
            var itemLayout = new LinearLayout(context);
            itemLayout.setOrientation(LinearLayout.HORIZONTAL);
            itemLayout.setPadding(0, 10, 0, 10);
            var et = new EditText(context);
            et.setText(text || "");
            et.setTextColor(android.graphics.Color.WHITE);
            et.setHintTextColor(android.graphics.Color.GRAY);
            et.setBackgroundColor(android.graphics.Color.parseColor("#33FFFFFF"));
            et.setPadding(20, 20, 20, 20);
            et.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
            et.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
            var delBtn = new TextView(context);
            delBtn.setText("✕");
            delBtn.setTextSize(18);
            delBtn.setTextColor(android.graphics.Color.LTGRAY);
            delBtn.setPadding(30, 20, 30, 20);
            delBtn.setGravity(android.view.Gravity.CENTER);
            delBtn.setOnClickListener(new View.OnClickListener({
                onClick: function () {
                    container.removeView(itemLayout);
                    inputItems = inputItems.filter(function (item) {
                        return item !== et;
                    });
                }
            }));
            itemLayout.addView(et);
            itemLayout.addView(delBtn);
            container.addView(itemLayout);
            inputItems.push(et);
        }
        for (var i = 0; i < defaultValues.length; i++) {
            addInputItem(defaultValues[i]);
        }
        var addBtn = new TextView(context);
        addBtn.setText("＋ 新建");
        addBtn.setTextSize(16);
        addBtn.setTextColor(android.graphics.Color.WHITE);
        addBtn.setPadding(20, 20, 20, 20);
        addBtn.setGravity(android.view.Gravity.CENTER);
        var addBg = new android.graphics.drawable.GradientDrawable();
        addBg.setColor(android.graphics.Color.parseColor("#3344FF44"));
        addBg.setCornerRadius(20);
        addBtn.setBackground(addBg);
        var addParams = new LinearLayout.LayoutParams(-1, -2);
        addParams.setMargins(0, 30, 0, 10);
        addBtn.setLayoutParams(addParams);
        addBtn.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                addInputItem("");
            }
        }));
        layout.addView(addBtn);
        var confirmBtn = new TextView(context);
        confirmBtn.setText("✔ 确认");
        confirmBtn.setTextSize(16);
        confirmBtn.setTextColor(android.graphics.Color.WHITE);
        confirmBtn.setPadding(30, 20, 30, 20);
        confirmBtn.setGravity(android.view.Gravity.CENTER);
        var confirmBg = new android.graphics.drawable.GradientDrawable();
        confirmBg.setColor(android.graphics.Color.parseColor("#4466CCFF"));
        confirmBg.setCornerRadius(30);
        confirmBtn.setBackground(confirmBg);
        var confirmParams = new LinearLayout.LayoutParams(-1, -2);
        confirmParams.setMargins(0, 10, 0, 0);
        confirmBtn.setLayoutParams(confirmParams);
        confirmBtn.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                result = [];
                for (var i = 0; i < inputItems.length; i++) {
                    result.push(String(inputItems[i].getText()));
                }
                try { wm.removeView(layout); } catch (e) { }
                if (callback) {
                    callback(result);
                }
            }
        }));
        layout.addView(confirmBtn);
        var params = new android.view.WindowManager.LayoutParams(
            dip2px(360), -2,
            android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            android.graphics.PixelFormat.TRANSLUCENT
        );
        params.gravity = android.view.Gravity.TOP;
        wm.addView(layout, params);
        layout.post(function () {
            params.flags = params.flags & ~android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            wm.updateViewLayout(layout, params);
            if (inputItems.length > 0) {
                inputItems[0].requestFocus();
                var imm = context.getSystemService(Context.INPUT_METHOD_SERVICE);
                imm.showSoftInput(inputItems[0], android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
            }
        });
    });
    function dip2px(dp) {
        var scale = context.getResources().getDisplayMetrics().density;
        return Math.floor(dp * scale + 0.7);
    }
}
function getScreenWidth(context) {
    var metrics = new DisplayMetrics();
    var wm = context.getSystemService(Context.WINDOW_SERVICE);
    wm.getDefaultDisplay().getMetrics(metrics);
    return String(metrics.widthPixels);
}
function showsettingsui() {
    var result = null;
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        try {
            wm = context.getSystemService(Context.WINDOW_SERVICE);
            var outerLayout = new LinearLayout(context);
            outerLayout.setOrientation(LinearLayout.VERTICAL);
            outerLayout.setBackgroundColor(android.graphics.Color.parseColor("#FF2E2E2E"));
            outerLayout.setPadding(40, 40, 40, 40);
            var titleView = new TextView(context);
            titleView.setText("指令设置");
            titleView.setTextSize(20);
            titleView.setTypeface(null, android.graphics.Typeface.BOLD);
            titleView.setTextColor(android.graphics.Color.WHITE);
            titleView.setGravity(android.view.Gravity.CENTER);
            titleView.setPadding(0, 0, 0, 30);
            outerLayout.addView(titleView);
            var scrollView = new ScrollView(context);
            scrollView.setFillViewport(true);
            scrollView.setLayoutParams(new LinearLayout.LayoutParams(-1, 0, 1));
            var scrollContent = new LinearLayout(context);
            scrollContent.setOrientation(LinearLayout.VERTICAL);
            scrollContent.setPadding(0, 0, 0, 0);
            scrollView.addView(scrollContent);
            outerLayout.addView(scrollView);
            var menuTitles = [
                "编辑顶级域名列表",
                "编辑电子邮箱列表",
                "编辑仅HTTPS可用列表",
                "编辑提取码关键词列表",
                "编辑黑名单关键词列表",
                "浏览器黑名单列表"
            ];
            for (var i = 0; i < menuTitles.length; i++) {
                var menuLayout = new LinearLayout(context);
                menuLayout.setOrientation(LinearLayout.HORIZONTAL);
                menuLayout.setGravity(android.view.Gravity.CENTER_VERTICAL);
                var menuText = new TextView(context);
                menuText.setText(menuTitles[i]);
                menuText.setTextSize(16);
                menuText.setTextColor(android.graphics.Color.WHITE);
                menuText.setTypeface(null, android.graphics.Typeface.BOLD);
                menuText.setPadding(20, 20, 20, 20);
                menuText.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
                var arrow = new TextView(context);
                arrow.setText("＞");
                arrow.setTextSize(20);
                arrow.setTextColor(android.graphics.Color.LTGRAY);
                arrow.setPadding(0, 20, 20, 20);
                menuLayout.addView(menuText);
                menuLayout.addView(arrow);
                var menuBg = new android.graphics.drawable.GradientDrawable();
                menuBg.setColor(android.graphics.Color.parseColor("#33FFFFFF"));
                menuBg.setCornerRadius(20);
                menuLayout.setBackground(menuBg);
                var menuParams = new LinearLayout.LayoutParams(-1, -2);
                menuParams.setMargins(0, 10, 0, 10);
                menuLayout.setLayoutParams(menuParams);
                scrollContent.addView(menuLayout);
                (function (index) {
                    menuLayout.setOnClickListener(new View.OnClickListener({
                        onClick: function () {
                            try { wm.removeView(outerLayout); } catch (e) { }
                            var listData = [
                                config.Top_Level_Domain,
                                config.Email_Keyword_List,
                                config.Use_https_keyword_list,
                                config.Extractioncode_Keyword_list,
                                config.link_blacklist_keywords,
                                config.Browser_PackageName_BlackList
                            ];
                            new Handler(Looper.getMainLooper()).post(new Runnable({
                                run: function () {
                                    showStringListEditor(listData[index], menuTitles[index], function (res) {
                                        if (index === 0) config.Top_Level_Domain = res;
                                        else if (index === 1) config.Email_Keyword_List = res;
                                        else if (index === 2) config.Use_https_keyword_list = res;
                                        else if (index === 3) config.Extractioncode_Keyword_list = res;
                                        else if (index === 4) config.link_blacklist_keywords = res;
                                        else if (index === 5) config.Browser_PackageName_BlackList = res;
                                        showsettingsui();
                                    });
                                }
                            }));
                        }
                    }));
                })(i);
            }
            var inputs = [];
            var messagelist = [
                "小窗配置：\n竖屏高度",
                "横屏高度",
                "宽高比",
                "竖屏左侧留空",
                "横屏左侧留空",
                "竖屏上侧留空",
                "横屏上侧留空",
                "小窗参数",
                "流体云配置：\n流体云位置(顶部/底部)",
                "流体云位置偏移(上减下加)",
                "流体云显示超时(ms)",
                "其他：\n浏览器(自动/包名)",
                "允许出现在链接中的字符",
                "显示多用户",
                "显示吐司提示",
                "附加插件动作(询问/小窗打开/全屏打开)",
                "使用超级岛通知(true/false)",
                "开启下拉小窗(true/false)"
            ];
            // 获取当前屏幕尺寸配置
            var screenSize = getNaturalScreenSize();
            var windowConfig = [1200, 1100, 0.6, 200, 150, 400, 80]; // 默认配置
            // 确保Window_Configuration是对象格式
            if (typeof config.Window_Configuration !== 'object' || config.Window_Configuration === null || Array.isArray(config.Window_Configuration)) {
                config.Window_Configuration = {};
            } else {
                // 尝试获取当前屏幕尺寸的配置
                if (config.Window_Configuration[screenSize] && Array.isArray(config.Window_Configuration[screenSize]) && config.Window_Configuration[screenSize].length === 7) {
                    windowConfig = config.Window_Configuration[screenSize];
                }
            }
            var defaultValues = windowConfig.concat([config.Launch_Windowing_Mode, config.Fluid_Cloud_Position, config.Fluid_Cloud_Position_Offset, config.Fluid_Cloud_timeout, config.browser, config.allowChar, config.show_Multiple_users, config.show_toast, config.extra_default_action, config.use_islandNotification || true, config.pull_small_window || true]);
            var firstInput = null;
            for (var i = 0; i < messagelist.length; i++) {
                var label = new TextView(context);
                label.setText(messagelist[i]);
                label.setTextColor(android.graphics.Color.LTGRAY);
                label.setPadding(10, 15, 10, 5);
                scrollContent.addView(label);
                var et = new EditText(context);
                et.setHint("请输入内容");
                et.setText(String(defaultValues[i]));
                et.setTextColor(android.graphics.Color.WHITE);
                et.setHintTextColor(android.graphics.Color.GRAY);
                et.setBackgroundColor(android.graphics.Color.parseColor("#33FFFFFF"));
                et.setPadding(20, 20, 20, 20);
                et.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
                et.setInputType(android.text.InputType.TYPE_CLASS_TEXT);
                scrollContent.addView(et);
                inputs.push(et);
                if (i === 0) firstInput = et;
            }
            var confirmBtn = new TextView(context);
            confirmBtn.setText("确定");
            confirmBtn.setTextSize(16);
            confirmBtn.setTextColor(android.graphics.Color.WHITE);
            confirmBtn.setGravity(android.view.Gravity.CENTER);
            confirmBtn.setPadding(30, 20, 30, 20);
            var btnBg = new android.graphics.drawable.GradientDrawable();
            btnBg.setColor(android.graphics.Color.parseColor("#44FFFFFF"));
            btnBg.setCornerRadius(30);
            confirmBtn.setBackground(btnBg);
            var btnParams = new LinearLayout.LayoutParams(-2, -2);
            btnParams.gravity = android.view.Gravity.END;
            btnParams.setMargins(0, 30, 0, 0);
            confirmBtn.setLayoutParams(btnParams);
            outerLayout.addView(confirmBtn);
            confirmBtn.setOnClickListener(new View.OnClickListener({
                onClick: function () {
                    result = [];
                    for (var i = 0; i < inputs.length; i++) {
                        result.push(String(inputs[i].getText()));
                    }
                    // 获取当前屏幕尺寸
                    var screenSize = getNaturalScreenSize();
                    // 确保Window_Configuration是对象格式
                    if (typeof config.Window_Configuration !== 'object' || config.Window_Configuration === null || Array.isArray(config.Window_Configuration)) {
                        config.Window_Configuration = {};
                    }
                    // 保存当前屏幕尺寸的配置
                    config.Window_Configuration[screenSize] = [
                        parseInt(result[0]),
                        parseInt(result[1]),
                        parseFloat(result[2]),
                        parseInt(result[3]),
                        parseInt(result[4]),
                        parseInt(result[5]),
                        parseInt(result[6])];
                    config.Launch_Windowing_Mode = parseInt(result[7]);
                    config.Fluid_Cloud_Position = result[8];
                    config.Fluid_Cloud_Position_Offset = parseInt(result[9]);
                    config.Fluid_Cloud_timeout = parseInt(result[10]);
                    config.browser = result[11];
                    config.allowChar = result[12];
                    config.show_Multiple_users = ToBoolean(result[13]);
                    config.show_toast = ToBoolean(result[14]);
                    config.extra_default_action = result[15];
                    config.use_islandNotification = ToBoolean(result[16]);
                    config.pull_small_window = ToBoolean(result[17]);
                    var configPath = /* [vflow] */ FLUID_CLOUD_DIR + "/config.json";
                    writeConfigToFile(configPath, config, "一.配置版本：\n1.5\n二.字段解释：\nTop_Level_Domain：顶级域名列表\nEmail_Keyword_List：邮箱关键词列表\nExtractioncode_Keyword_list：提取码关键词列表\nUse_https_keyword_list：仅https可用的链接关键词列表（链接无请求头时使用）\nlink_blacklist_keywords：链接黑名单关键词列表(注意是链接内的关键词，不是包名)\nWindow_Configuration:小窗的大小与位置配置，从左到右依次为竖屏高度 横屏高度 宽高比 竖屏左侧留空 横屏左侧留空 竖屏上侧留空 横屏上侧留空\nLaunch_Windowing_Mode：可触发小窗的Windowsmode值，coloros为100(会自动识别，旧版本可能不能识别需要修改为100)，米，类原生为5\nFluid_Cloud_Position：流体云显示位置（顶部，底部）\nFluid_Cloud_Position_Offset:流体云位置偏移(向上偏移减小值向下偏移增加值)\nFluid_Cloud_timeout：流体云显示超时时长，超过设定毫秒数无动作浮窗消失\nbrowser:浏览器包名(填自动表示自动识别)\nBrowser_PackageName_BlackList：浏览器黑名单，识别到的默认浏览器在黑名单内时会重新寻找其他的浏览器\nallowChar:允许出现在链接中的字符\nshow_Multiple_users:显示多用户应用（true 开启/false 关闭）\nshow_toast:是否显示吐司提示(true 显示/false 不显示)\n\n三.配置：\n");
                    try { wm.removeView(outerLayout); } catch (e) { }
                }
            }));
            var params = new android.view.WindowManager.LayoutParams(
                parseInt(screenWidth * 0.9), parseInt(screenHeight * 0.6),
                android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL |
                android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                android.graphics.PixelFormat.TRANSLUCENT
            );
            params.gravity = android.view.Gravity.TOP;
            wm.addView(outerLayout, params);
        } catch (e) { }
    });
}
function showFileEditorUI(filePath) {
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(40, 40, 40, 40);
        layout.setBackgroundColor(android.graphics.Color.parseColor("#FF2E2E2E"));
        var title = new TextView(context);
        title.setText("规则编辑器(规则在下面)");
        title.setTextSize(20);
        title.setTextColor(android.graphics.Color.WHITE);
        title.setGravity(android.view.Gravity.CENTER);
        title.setPadding(0, 0, 0, 30);
        layout.addView(title);
        var scrollView = new ScrollView(context);
        var scrollParams = new LinearLayout.LayoutParams(-1, dip2px(400));
        scrollView.setLayoutParams(scrollParams);
        var input = new EditText(context);
        input.setTextColor(android.graphics.Color.WHITE);
        input.setHint("请输入内容...");
        input.setHintTextColor(android.graphics.Color.GRAY);
        input.setBackgroundColor(android.graphics.Color.parseColor("#33FFFFFF"));
        input.setPadding(20, 20, 20, 20);
        input.setMinHeight(dip2px(300));
        input.setGravity(android.view.Gravity.TOP);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        input.setSingleLine(false);
        input.setHorizontallyScrolling(false);
        try {
            var f = new java.io.File(filePath);
            if (f.exists()) {
                var br = new java.io.BufferedReader(new java.io.FileReader(f));
                var sb = new java.lang.StringBuilder();
                var line;
                while ((line = br.readLine()) != null) {
                    sb.append(line).append("\n");
                }
                br.close();
                input.setText(sb.toString());
            }
        } catch (e) {
            input.setText("");
        }
        scrollView.addView(input);
        layout.addView(scrollView);
        var btnLayout = new LinearLayout(context);
        btnLayout.setOrientation(LinearLayout.HORIZONTAL);
        btnLayout.setGravity(android.view.Gravity.END);
        function makeBtn(text, bgColor, callback) {
            var btn = new TextView(context);
            btn.setText(text);
            btn.setTextColor(android.graphics.Color.WHITE);
            btn.setTextSize(16);
            btn.setPadding(40, 20, 40, 20);
            btn.setGravity(android.view.Gravity.CENTER);
            var bg = new android.graphics.drawable.GradientDrawable();
            bg.setColor(android.graphics.Color.parseColor(bgColor));
            bg.setCornerRadius(20);
            btn.setBackground(bg);
            btn.setOnClickListener(new View.OnClickListener({ onClick: callback }));
            var params = new LinearLayout.LayoutParams(-2, -2);
            params.setMargins(20, 40, 0, 0);
            btn.setLayoutParams(params);
            return btn;
        }
        var cancelBtn = makeBtn("取消", "#FF555555", function () {
            try { wm.removeView(layout); } catch (e) { }
        });
        var saveBtn = makeBtn("保存", "#FF3399FF", function () {
            try {
                var writer = new java.io.FileWriter(filePath, false);
                writer.write(String(input.getText()));
                writer.close();
            } catch (e) { showToast("保存失败") }
            try { wm.removeView(layout); } catch (e) { console.log("移除识图时出现错误：" + e.message) }
        });
        btnLayout.addView(cancelBtn);
        btnLayout.addView(saveBtn);
        layout.addView(btnLayout);
        var params = new android.view.WindowManager.LayoutParams(
            dip2px(360), -2,
            android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
            android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            android.graphics.PixelFormat.TRANSLUCENT
        );
        params.gravity = android.view.Gravity.TOP;
        wm.addView(layout, params);
        layout.post(function () {
            params.flags = params.flags & ~android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
            wm.updateViewLayout(layout, params);
            input.requestFocus();
            var imm = context.getSystemService(Context.INPUT_METHOD_SERVICE);
            imm.showSoftInput(input, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
        });
    });
    function dip2px(dp) {
        var scale = context.getResources().getDisplayMetrics().density;
        return Math.floor(dp * scale + 0.5);
    }
}
function getOpenApps(url, userId) {
    var intent = new Intent(Intent.ACTION_VIEW);
    intent.setData(Uri.parse(url));
    var type = null;
    var flags = PackageManager.MATCH_DEFAULT_ONLY;
    try {
        var binder = ServiceManager.getService("package");
        var iPm = IPackageManager$Stub.asInterface(binder);
        var resolveListSlice = iPm.queryIntentActivities(intent, type, flags, userId);
        var resolveList = resolveListSlice.getList();
        var packages = [];
        for (var i = 0; i < resolveList.size(); i++) {
            var resolveInfo = resolveList.get(i);
            if (resolveInfo.activityInfo != null) {
                var pkg = resolveInfo.activityInfo.packageName;
                if (pkg !== RealDefaultBrowser) {
                    packages.push(String(pkg));
                }
            }
        }
        if (packages.length === 0 && RealDefaultBrowser != null) {
            packages.push(String(defaultBrowser));
        }
        return packages;
    } catch (e) {
        console.log("获取用户 " + userId + " 的可打开应用失败: " + e);
        return [String(defaultBrowser)];
    }
}
function getScreenWidth(context) {
    var metrics = new DisplayMetrics();
    var wm = context.getSystemService(Context.WINDOW_SERVICE);
    wm.getDefaultDisplay().getMetrics(metrics);
    return String(metrics.widthPixels);
}
function findbrowser() {
    var pm = context.getPackageManager();
    var apps = pm.getInstalledApplications(0);
    var testUri = Uri.parse("http://www.example.com");
    for (var i = 0; i < apps.size(); i++) {
        var pkg = apps.get(i).packageName;
        var intent = new Intent(Intent.ACTION_VIEW, testUri);
        intent.setPackage(pkg);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        var resolvedActivity = pm.resolveActivity(intent, 0);
        if (resolvedActivity != null && resolvedActivity.activityInfo != null && !Browser_PackageName_BlackList.includes(String(pkg))) {
            return String(pkg);
        }
    }
    return false;
}
function getDefaultBrowserPackageName(context) {
    var intent = new Intent(Intent.ACTION_VIEW);
    intent.setData(Uri.parse("http://"));
    var pm = context.getPackageManager();
    var resolveInfo = pm.resolveActivity(intent, 65536);
    if (resolveInfo != null && resolveInfo.activityInfo != null) {
        var browserPackageName = String(resolveInfo.activityInfo.packageName);
        if (Browser_PackageName_BlackList.includes(browserPackageName)) {
            browserPackageName = findbrowser();
            if (browserPackageName === false) {
                throw new Error("默认浏览器未设置且未找到浏览器，请前往设置中设置默认浏览器");
            } else {
                return browserPackageName;
            }
        } else {
            return browserPackageName;
        }
    } else {
        var browserPackageName = findbrowser();
        if (browserPackageName === false) {
            throw new Error("默认浏览器未设置且未找到浏览器，请前往设置中设置默认浏览器");
        } else {
            return browserPackageName;
        }
    }
}
function showFloatingPrompt(opts) {
    var result = null;
    var timeout = opts.timeout || 3000;
    var useNotification = config.use_islandNotification || false;
    // 【vflow】⚠️⚠️ 广播回传**只支持「有 openWith 的终结动作」**
    //          （岛上的主体/按钮 = 打开一个链接，然后结束）。
    //
    // 没有 openWith 的（如多链接的「点击选择链接」，`ManyLink_Fluid_Cloud`）
    // 需要**脚本继续参与**（点击后要弹选择框、再走识别链路）——
    // 而脚本已经不当接收方了（`new BroadcastReceiver` 在 vFlow 里必然抛），
    // 这类场景**做不到回传** ⇒ **一律走浮窗**。
    //
    // ⚠️ 浮窗路径的点击是脚本自己的 `View.OnClickListener`（`core.js:874`）——
    //    那是**接口**，走 `java.lang.reflect.Proxy`，**不涉及子类化，本来就不炸**，
    //    而且能继续等待（`while (result === null)`）。
    //
    // ⚠️ **代价（如实记录）**：`use_islandNotification = true` 时，
    //    **多链接场景会从「岛」退化成「浮窗」**。要恢复它，得把「选择」本身
    //    也搬进工作流（见 DESIGN.md §4.6 的 A/B 两类交互）。**本轮不做。**
    if (useNotification && opts.openWith && VFLOW_CLICK_BROADCAST) {
        return showIslandNotification(opts, result, timeout);
    }
    // 否则显示浮窗提示
    return showFluidCloud(opts, result, timeout);
}
function showFluidCloud(opts, result, timeout) {
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var pm = context.getPackageManager();
        var layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.HORIZONTAL);
        layout.setPadding(30, 30, 30, 30);
        layout.setGravity(Gravity.CENTER_VERTICAL);
        var bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#DD1F1F1F"));
        bg.setCornerRadius(60);
        layout.setBackground(bg);
        var iconView = new ImageView(context);
        var iconSize = 130;
        var iconParams = new LinearLayout.LayoutParams(iconSize, iconSize);
        iconParams.setMargins(0, 0, 30, 0);
        iconView.setLayoutParams(iconParams);
        try {
            var userId = opts.userId || 0;
            var userHandle = UserHandle.of(userId);
            var userContext = context.createPackageContextAsUser(opts.pkg, 0, userHandle);
            var userPm = userContext.getPackageManager();
            var icon = userPm.getApplicationIcon(opts.pkg);
            iconView.setImageDrawable(icon);
        } catch (e) {
            console.log("获取图标失败: " + e);
            iconView.setImageResource(android.R.drawable.sym_def_app_icon);
        }
        layout.addView(iconView);
        var textLayout = new LinearLayout(context);
        textLayout.setOrientation(LinearLayout.VERTICAL);
        textLayout.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        var title = new TextView(context);
        title.setText(opts.title || "打开应用");
        title.setTextSize(18);
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        title.setTextColor(Color.WHITE);
        var subtitle = new TextView(context);
        subtitle.setText(opts.subtitle || "");
        subtitle.setTextSize(14);
        subtitle.setTextColor(Color.LTGRAY);
        textLayout.addView(title);
        textLayout.addView(subtitle);
        layout.addView(textLayout);
        var btn = new TextView(context);
        btn.setText(opts.buttonText || "浮窗打开");
        btn.setTextSize(14);
        btn.setTextColor(Color.WHITE);
        btn.setGravity(Gravity.CENTER);
        btn.setPadding(30, 20, 30, 20);
        var btnBg = new GradientDrawable();
        btnBg.setColor(Color.parseColor("#44FFFFFF"));
        btnBg.setCornerRadius(60);
        btn.setBackground(btnBg);
        var btnParams = new LinearLayout.LayoutParams(-2, -2);
        btnParams.setMargins(30, 0, 0, 0);
        btn.setLayoutParams(btnParams);
        layout.addView(btn);
        layout.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                result = opts.resultOnClick || "click";
                try { wm.removeView(layout); } catch (e) { }
            }
        }));
        btn.setOnClickListener(new View.OnClickListener({
            onClick: function () {
                result = opts.resultOnButton || "button";
                try { wm.removeView(layout); } catch (e) { }
            }
        }));
        var downY = 0;
        layout.setOnTouchListener(new View.OnTouchListener({
            onTouch: function (v, event) {
                switch (event.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downY = event.getRawY();
                        return false;
                    case MotionEvent.ACTION_UP:
                        var upY = event.getRawY();
                        if (downY - upY > 100) {
                            result = opts.resultOnSwipe || "swipe_close";
                            try { wm.removeView(layout); } catch (e) { }
                            return true;
                        } else if (upY - downY > 100) {
                            result = opts.resultOnSwipeDown || "swipe_down";
                            try { wm.removeView(layout); } catch (e) { }
                            return true;
                        }
                        return false;
                }
                return false;
            }
        }));
        var params = new WindowManager.LayoutParams(
            parseInt(getScreenWidth(context) * 0.9), -2,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = opts.gravity || (Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        params.x = opts.x || 0;
        params.y = opts.y || 150;
        wm.addView(layout, params);
        new Thread(new Runnable({
            run: function () {
                Thread.sleep(timeout);
                runOnUiThread(function () {
                    if (result === null) {
                        result = opts.resultOnTimeout || "timeout";
                        try { wm.removeView(layout); } catch (e) { }
                    }
                });
            }
        })).start();
    });
    while (result === null) {
        Thread.sleep(150);
    }
    return result;
}
function showOptionsDialog(options, titleText) {
    var result = null;
    function runOnUiThread(fn) {
        new Handler(Looper.getMainLooper()).post(new Runnable({ run: fn }));
    }
    runOnUiThread(function () {
        var pm = context.getPackageManager();
        var wm = context.getSystemService(Context.WINDOW_SERVICE);
        var layout = new FrameLayout(context);
        var isDarkMode = (context.getResources().getConfiguration().uiMode
            & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
            === android.content.res.Configuration.UI_MODE_NIGHT_YES;
        var shape = new GradientDrawable();
        var backgroundColor = isDarkMode ? "#343434" : "#FAFAFA";
        var textColor = isDarkMode ? Color.WHITE : Color.BLACK;
        shape.setColor(Color.parseColor(backgroundColor));
        shape.setCornerRadius(30);
        if (!isDarkMode) shape.setStroke(2, Color.parseColor("#22000000"));
        layout.setBackground(shape);
        var displayMetrics = context.getResources().getDisplayMetrics();
        var maxWidth = displayMetrics.widthPixels * 0.8;
        var maxHeight = displayMetrics.heightPixels * 0.6;
        var params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.CENTER;
        params.width = maxWidth;
        var scrollView = new ScrollView(context);
        var scrollParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        );
        scrollView.setLayoutParams(scrollParams);
        var container = new LinearLayout(context);
        container.setOrientation(LinearLayout.VERTICAL);
        var titleView = new TextView(context);
        titleView.setText(titleText || "请选择");
        titleView.setTextSize(20);
        titleView.setTextColor(textColor);
        titleView.setGravity(Gravity.CENTER);
        titleView.setTypeface(null, android.graphics.Typeface.BOLD);
        titleView.setPadding(40, 40, 40, 20);
        container.addView(titleView);
        scrollView.addView(container);
        layout.addView(scrollView);
        scrollView.post(new Runnable({
            run: function () {
                if (scrollView.getHeight() > maxHeight) {
                    var newParams = scrollView.getLayoutParams();
                    newParams.height = maxHeight;
                    scrollView.setLayoutParams(newParams);
                }
            }
        }));
        function makeOptionView(item) {
            if (typeof item === "string") {
                var simpleLayout = new LinearLayout(context);
                simpleLayout.setOrientation(LinearLayout.VERTICAL);
                simpleLayout.setPadding(30, 30, 30, 30);
                var labelView = new TextView(context);
                labelView.setText(item);
                labelView.setTextSize(16);
                labelView.setTextColor(textColor);
                simpleLayout.addView(labelView);
                simpleLayout.setOnClickListener(new View.OnClickListener({
                    onClick: function () {
                        result = item;
                        try { wm.removeView(layout); } catch (e) { }
                    }
                }));
                return simpleLayout;
            }
            var itemLayout = new LinearLayout(context);
            itemLayout.setOrientation(LinearLayout.HORIZONTAL);
            itemLayout.setPadding(30, 30, 30, 30);
            itemLayout.setGravity(Gravity.CENTER_VERTICAL);
            var iconView = new ImageView(context);
            var iconSize = 96;
            var iconParams = new LinearLayout.LayoutParams(iconSize, iconSize);
            iconParams.setMargins(0, 0, 30, 0);
            iconView.setLayoutParams(iconParams);
            if (item.pkg) {
                try {
                    var userId = item.userId || 0;
                    var userHandle = UserHandle.of(userId);
                    var userContext = context.createPackageContextAsUser(item.pkg, 0, userHandle);
                    var userPm = userContext.getPackageManager();
                    var icon = userPm.getApplicationIcon(item.pkg);
                    iconView.setImageDrawable(icon);
                } catch (e) {
                    console.log("获取图标失败: " + e);
                    iconView.setImageResource(android.R.drawable.sym_def_app_icon);
                }
                itemLayout.addView(iconView);
            } else if (item.icon) {
                var emoji = new TextView(context);
                emoji.setText(item.icon);
                emoji.setTextSize(20);
                emoji.setLayoutParams(iconParams);
                itemLayout.addView(emoji);
            } else {
                iconView.setImageResource(android.R.drawable.sym_def_app_icon);
                itemLayout.addView(iconView);
            }
            var textLayout = new LinearLayout(context);
            textLayout.setOrientation(LinearLayout.VERTICAL);
            var title = new TextView(context);
            title.setText(item.label || item.value || "未命名");
            title.setTextSize(16);
            title.setTextColor(textColor);
            var desc = new TextView(context);
            desc.setText(item.desc || "");
            desc.setTextSize(13);
            desc.setTextColor(isDarkMode ? Color.LTGRAY : Color.DKGRAY);
            textLayout.addView(title);
            textLayout.addView(desc);
            itemLayout.addView(textLayout);
            itemLayout.setOnClickListener(new View.OnClickListener({
                onClick: function () {
                    result = item.value;
                    try { wm.removeView(layout); } catch (e) { }
                }
            }));
            return itemLayout;
        }
        for (var i = 0; i < options.length; i++) {
            container.addView(makeOptionView(options[i]));
        }
        try {
            wm.addView(layout, params);
        } catch (e) {
            result = null;
        }
    });
    while (result === null) {
        Thread.sleep(150);
    }
    return result;
}
function RecordCopiedText(CopiedText) {
    writeConfigToFile(/* [vflow] */ FLUID_CLOUD_DIR + "/recordcopy.json", { "CopiedText": CopiedText }, "");
}
function removeRequestHead(link) {
    var r = link.replace("http://", "").replace("https://", "");
    r = r.split(" ")[0];
    return r;
}
function Compare(a, output) {
    for (var i = 0; i < output.length; i++) {
        if (removeRequestHead(output[i]) === removeRequestHead(a)) {
            return false;
        }
    }
    return true;
}
function where(list, value_to_find) {
    var result = [];
    for (var i = 0; i < list.length; i++) {
        if (removeRequestHead(list[i]) === removeRequestHead(value_to_find)) {
            result.push(i);
        }
    }
    return result;
}
function RollBackToFind(list, value_to_find, list_to_find, cleanCode) {
    var indices = where(list, value_to_find);
    for (var i = 0; i < indices.length; i++) {
        var pos = indices[i];
        for (var j = pos - 1; j >= 0; j--) {
            if (!Compare(list[j], list_to_find)) {
                if (list[j].split(" ").length < 2) {
                    var ExtractionCode = cleanCode;
                    if (!ExtractionCode || ExtractionCode === "") {
                        ExtractionCode = list[pos + 1].replace(/[^a-zA-Z0-9]/g, "");
                    }
                    var outputIndices = where(list_to_find, list[j]);
                    if (outputIndices.length > 0) {
                        if (!list_to_find[outputIndices[0]].includes("提取码:")) {
                            list_to_find[outputIndices[0]] = list[j] + " 提取码:" + ExtractionCode;
                        } else {
                            list_to_find.push(String(list[j] + " 提取码:" + ExtractionCode));
                        }
                        break;
                    }
                }
            }
        }
    }
}
function removeDisallowedChar(text, allowchar) {
    var escapedAllowChar = allowchar.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
    var allowRegex = new RegExp('[^' + escapedAllowChar.split('').join('') + ']', 'g');
    for (var i = 0; i < Extractioncode_Keyword_list.length; i++) {
        text = text.replace(new RegExp(Extractioncode_Keyword_list[i], "g"), " Extractioncode:");
    }
    text = text.replace(/\[[^\]]*\]/g, "").trim();
    text = text.replace(allowRegex, '');
    return text.trim();
}
function ScreeningParagraphs(a) {
    a = a.replace(/http:\/\//g, " http://").replace(/https:\/\//g, " https://");
    var Paragraph = a.split(/\n|,|，|；|;|\s+/);
    Paragraph = Paragraph.filter(function (token) { return token.trim() !== ""; });
    var output = [];
    var candidateLinks = [];
    var withExtractionCode = false;
    var ExtractionCodeList = [];
    if (a.includes("Extractioncode:")) {
        withExtractionCode = true;
        for (var i = 0; i < Paragraph.length; i++) {
            if (Paragraph[i].includes("Extractioncode:")) {
                var raw = Paragraph[i];
                var match = Paragraph[i].match(/Extractioncode:([A-Za-z0-9]+)/);
                var clean = match ? match[1] : "";
                ExtractionCodeList.push({ raw: raw, clean: clean });
            }
        }
    }
    for (var i = 0; i < Top_Level_Domain.length; i++) {
        for (var j = 0; j < Paragraph.length; j++) {
            if (Paragraph[j].includes("." + Top_Level_Domain[i] + "/") && Paragraph[j].length > Top_Level_Domain[i].length + 2) {
                if (Compare(Paragraph[j], output)) {
                    output.push(Paragraph[j]);
                }
            } else if (Compare(Paragraph[j], candidateLinks)) {
                candidateLinks.push(Paragraph[j]);
            }
        }
    }
    for (var i = 0; i < Top_Level_Domain.length; i++) {
        for (var j = 0; j < candidateLinks.length; j++) {
            if (candidateLinks[j].includes("." + Top_Level_Domain[i]) && candidateLinks[j].length > Top_Level_Domain[i].length + 1) {
                var suffix = "." + Top_Level_Domain[i];
                if (candidateLinks[j].substr(candidateLinks[j].length - suffix.length) === suffix) {
                    if (Compare(candidateLinks[j], output)) {
                        var isEmail = false;
                        for (var w = 0; w < Email_Keyword_List.length; w++) {
                            if (candidateLinks[j].includes("@" + Email_Keyword_List[w])) {
                                isEmail = true;
                                break;
                            }
                        }
                        if (!isEmail) {
                            output.push(candidateLinks[j]);
                        }
                    }
                }
            } else if ((candidateLinks[j].includes("http://") || candidateLinks[j].includes("https://")) && candidateLinks[j].length > 8 && candidateLinks[j].includes(".")) {
                if (Compare(candidateLinks[j], output)) {
                    output.push(candidateLinks[j]);
                }
            }
        }
    }
    if (withExtractionCode) {
        for (var i = 0; i < ExtractionCodeList.length; i++) {
            RollBackToFind(Paragraph, ExtractionCodeList[i].raw, output, ExtractionCodeList[i].clean);
        }
    }
    return output;
}
function AddRequestHead(linkList) {
    var output = [];
    for (var i = 0; i < linkList.length; i++) {
        var link = linkList[i];
        if (!link.includes("http://") && !link.includes("https://")) {
            var httpLink = "http://" + link;
            var httpsLink = "https://" + link;
            if (!output.includes(httpLink) && !output.includes(httpsLink)) {
                var useHttps = false;
                for (var j = 0; j < Use_https_keyword_list.length; j++) {
                    if (link.includes(Use_https_keyword_list[j])) {
                        useHttps = true;
                        break;
                    }
                }
                output.push(useHttps ? String(httpsLink) : String(httpLink));
            }
        } else if (!output.includes(link)) {
            output.push(String(link));
        }
    }
    return output;
}
function cleanLinksInBlackList(linkList) {
    for (var i = 0; i < link_blacklist_keywords.length; i++) {
        for (var j = 0; j < linkList.length; j++) {
            if (linkList[j].includes(link_blacklist_keywords[i])) {
                linkList.splice(j, 1);
                j--;
            }
        }
    }
    return linkList;
}
function RecognitionMain(a) {
    return cleanLinksInBlackList(AddRequestHead(ScreeningParagraphs(removeDisallowedChar(a, allowChar + " \n"))));
}
function getAppName(packageName, userId) {
    var pm = context.getPackageManager();
    try {
        var appInfo = pm.getApplicationInfoAsUser(packageName, 0, userId);
        var appName = pm.getApplicationLabel(appInfo).toString();
        if (userId !== 0) {
            return appName + "(" + userId + ")"
        }
        return appName;
    } catch (e) {
        console.log("获取应用名失败: " + e);
        return "****";
    }
}
var APPList_cache = {};
function getAppList(userId) {
    var cachelist = Object.keys(APPList_cache);
    if (cachelist == undefined) cachelist = [];
    if (cachelist.includes(userId)) {
        return APPList_cache[userId];
    }
    var pm = context.getPackageManager();
    var result = [];
    try {
        var apps = pm.getInstalledApplicationsAsUser(PackageManager.GET_META_DATA, userId);
        for (var i = 0; i < apps.size(); i++) {
            result.push(String(apps.get(i).packageName));
        }
    } catch (e) {
        console.log("获取包名列表失败: " + e);
    }
    APPList_cache[userId] = result;
    return result;
}
function getAllUserIds() {
    if (show_Multiple_users) {
        try {
            var userManager = context.getSystemService("user");
            var users = userManager.getUsers();
            var result = [];
            for (var i = 0; i < users.size(); i++) {
                var userInfo = users.get(i);
                result.push(parseInt(userInfo.id));
            }
            return result;
        } catch (e) {
            console.log("获取用户列表失败: " + e);
            return [0];
        }
    } else {
        return [0];
    }
}
function isAppinstall(pkgName, UserId) {
    return getAppList(UserId).includes(pkgName);
}
function isKeyInOblist(objectlist, key, value) {
    var qvc = objectlist.some(function (item) {
        return item[key] === value;
    }); return qvc;
}
function isKeyPairInOblist(objectlist, key1, value1, key2, value2) {
    var result = objectlist.some(function (item) {
        return item[key1] === value1 && item[key2] === value2;
    });
    return result;
}
function getAppOpenActivities(url, targetPackage, userId) {
    try {
        var intent = new Intent(Intent.ACTION_VIEW);
        intent.setData(Uri.parse(url));
        var resolvedType = null;
        var flags = PackageManager.MATCH_DEFAULT_ONLY;
        var binder = ServiceManager.getService("package");
        var iPm = IPackageManager$Stub.asInterface(binder);
        var resolveSlice = iPm.queryIntentActivities(intent, resolvedType, flags, userId);
        var resolveInfos = resolveSlice.getList();
        for (var i = 0; i < resolveInfos.size(); i++) {
            var ri = resolveInfos.get(i);
            if (ri.activityInfo != null && String(ri.activityInfo.packageName) === targetPackage) {
                return String(ri.activityInfo.name);
            }
        }
    } catch (e) {
        console.log("查询用户 " + userId + " 的 activity 失败: " + e);
    }
    return null;
}
function pkgCheck(pkg) {
    var result = { pass: false, result: [] };
    if (pkg.includes("://")) {
        for (var i = 0; i < UserIds.length; i++) {
            var Apps = getOpenApps(pkg, UserIds[i]);
            var fakebrowserapp = getOpenApps("http://example.com", UserIds[i]).concat(getOpenApps("https://example.com", UserIds[i]));
            if (!Apps.includes(defaultBrowser)) {
                for (var j = 0; j < Apps.length; j++) {
                    var fakebrowserappcheckpass = true;
                    for (var z = 0; z < fakebrowserapp.length; z++) {
                        if (Apps[j].includes(String(fakebrowserapp[z]))) {
                            fakebrowserappcheckpass = false;
                        }
                    }
                    if (fakebrowserappcheckpass == true) {
                        result["result"].push({ packageName: Apps[j], UserId: UserIds[i] });
                    }
                }
                if (result.result.length != 0) result["pass"] = true;
            }
        }
    } else {
        for (var i = 0; i < UserIds.length; i++) {
            if (isAppinstall(pkg, UserIds[i])) {
                result["pass"] = true;
                result["result"].push({ packageName: pkg, UserId: UserIds[i] });
            }
        }
    }
    return result;
}
function findVariable(text) {
    if (text == undefined) return [];
    var results = [];
    var start = -1;
    var depth = 0;
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        if (ch === "【") {
            if (depth === 0) start = i;
            depth++;
        } else if (ch === "】") {
            depth--;
            if (depth === 0 && start !== -1) {
                var inner = text.substring(start + 1, i);
                results.push(inner);
                start = -1;
            }
        }
    }
    return results;
}
var regexCache = {};
function getRegex(pattern, flags) {
    var key = pattern + "/" + (flags || "");
    if (!regexCache[key]) {
        regexCache[key] = new RegExp(pattern, flags);
    }
    return regexCache[key];
}
function containsMatch(text, pattern) {
    return getRegex(pattern, "i").test(text);
}
function replaceAll(text, target, replacement) {
    return text.replace(getRegex(target, "g"), replacement);
}
function buildKeyValueMap(list, key) {
    var map = {};
    for (var i = 0; i < list.length; i++) {
        map[list[i][key]] = list[i];
    }
    return map;
}
function buildValueSet(list, key) {
    var set = {};
    for (var i = 0; i < list.length; i++) {
        set[list[i][key]] = true;
    }
    return set;
}
function islistinstr(str, strlist) {
    for (var i = 0; i < strlist.length; i++) {
        if (containsMatch(str, strlist[i])) {
            return true;
        }
    }
    return false;
}
function findObjectByKeyValue(list, key, value) {
    return list.find(function (item) {
        return item[key] === value;
    });
}
function getValuesFromObjectArray(objArray, key) {
    var result = objArray.map(function (item) {
        return item[key];
    });
    return result;
}
function SynthesisRule(VariableList, inputvalue) {
    var output = inputvalue;
    if (output === undefined) return null;
    var variableNames = buildValueSet(VariableList, "name");
    var Variables = findVariable(output);
    for (var j = 0; j < Variables.length; j++) {
        if (variableNames[Variables[j]]) {
            output = replaceAll(output, "【" + Variables[j] + "】", findObjectByKeyValue(VariableList, "name", Variables[j]).value);
            findObjectByKeyValue(VariableList, "name", Variables[j]).count++;
        }
    }
    return output;
}
function getVariablevalues(text, VariableList, object) {
    var results = findVariable(text);
    if (results === undefined) return VariableList;
    var variableNames = buildValueSet(VariableList, "name");
    for (var i = 0; i < results.length; i++) {
        if (!variableNames[results[i]]) {
            if (results[i]) {
                var Variableobject = findObjectByKeyValue(object.Custom_variable, "name", results[i]);
                if (!Variableobject) {
                    showToast("规则错误：自定义变量：" + results[i] + "未定义");
                    continue;
                }
            }
            var issuccess = true;
            if (typeof Variableobject.action === "string") {
                var action = Variableobject.action;
            } else {
                var action = "match";
            }
            if (action !== "splicing") {
                var sourse_text = Variableobject.text;
                if (!variableNames[sourse_text]) {
                    VariableList = getVariablevalues("【" + sourse_text + "】", VariableList, object);
                }
            }
            if (action === "match") {
                var a = findObjectByKeyValue(VariableList, "name", sourse_text).value.match(getRegex(Variableobject.pattern));
                if (a !== null) {
                    if (typeof Variableobject.index !== "number") Variableobject.index = 1;
                    VariableList.push({ name: results[i], value: a[Variableobject.index], count: 0 });
                } else {
                    issuccess = false;
                }
            } else if (action === "replace") {
                VariableList.push({ name: results[i], value: replaceAll(findObjectByKeyValue(VariableList, "name", sourse_text).value, Variableobject.pattern, Variableobject.replacement), count: 0 });
            } else if (action === "splicing") {
                var valuetext = Variableobject.valuetext;
                VariableList.push({ name: results[i], value: SynthesisRule(getVariablevalues(valuetext, VariableList, object), valuetext), count: 0 });
            }
            if (!issuccess) {
                VariableList.push({ name: results[i], value: "", count: 0 });
                showToast(object.name + "规则" + results[i] + "字段匹配失败,规则可能已过期");
            }
        }
    }
    return VariableList;
}
function isconditionpass(condition, withcode, VariableList) {
    var condition_type = condition.condition_type;
    if (condition_type === "withcode") return withcode;
    else if (condition_type === "withoutcode") return !withcode;
    else if (condition_type === "contains") {
        return containsMatch(findObjectByKeyValue(VariableList, "name", condition.condition_text).value, condition.condition_pattern);
    } else if (condition_type === "notcontains") {
        return !containsMatch(findObjectByKeyValue(VariableList, "name", condition.condition_text).value, condition.condition_pattern);
    } else return true;
}
function istopconditionpass(condition, VariableList, withcode) {
    var condition_tactic = condition.many_condition_tactic || "Any";
    var conditionlist = condition.condition;
    var condition_pass = false;
    if (condition_tactic === "All") {
        condition_pass = conditionlist.every(function (cond) {
            return isconditionpass(cond, withcode, VariableList);
        });
    } else if (condition_tactic === "Any") {
        condition_pass = conditionlist.some(function (cond) {
            return isconditionpass(cond, withcode, VariableList);
        });
    } else if (condition_tactic === "None") {
        condition_pass = conditionlist.every(function (cond) {
            return !isconditionpass(cond, withcode, VariableList);
        });
    } else {
        showToast("规则错误：置顶条件未知的多条件策略" + condition_tactic);
    }
    return condition_pass;
}
function chooseRules(object, VariableList, withcode) {
    var max_condition_num = 0;
    var max_condition_index = 0;
    var ruleobjectlist = object.rule;
    for (var i = 0; i < ruleobjectlist.length; i++) {
        var conditionlist = ruleobjectlist[i].condition;
        if (!conditionlist || conditionlist.length === 0) {
            if (max_condition_num === 0) {
                max_condition_index = i;
            }
            continue;
        }
        var condition_tactic = ruleobjectlist[i].many_condition_tactic || "All";
        var condition_pass = false;
        if (condition_tactic === "All") {
            condition_pass = conditionlist.every(function (cond) {
                return isconditionpass(cond, withcode, VariableList);
            });
        } else if (condition_tactic === "Any") {
            condition_pass = conditionlist.some(function (cond) {
                return isconditionpass(cond, withcode, VariableList);
            });
        } else if (condition_tactic === "None") {
            condition_pass = conditionlist.every(function (cond) {
                return !isconditionpass(cond, withcode, VariableList);
            });
        } else {
            showToast("规则错误：" + object.name + "规则，未知的多条件策略" + condition_tactic);
            continue;
        }
        if (condition_pass && conditionlist.length > max_condition_num) {
            max_condition_num = conditionlist.length;
            max_condition_index = i;
        }
    }
    var ruletext = ruleobjectlist[max_condition_index].rule_text;
    var output = SynthesisRule(getVariablevalues(ruletext, VariableList, object), ruletext);
    var codeobject = findObjectByKeyValue(VariableList, "name", "code");
    if (withcode && codeobject.count === 0) copy = codeobject.value;
    return output;
}
function matchRules(linkall, isnolink) {
    var link, ExtractionCode, RULES, withExtractionCode;
    if (!isnolink) {
        var linkparts = linkall.split(" 提取码:");
        link = String(linkparts[0]);
        if (linkparts.length === 2) {
            ExtractionCode = linkparts[1];
        }
        RULES = readJsonFile(/* [vflow] */ FLUID_CLOUD_DIR + "/rules.json");
        withExtractionCode = true;
    } else {
        link = linkall;
        RULES = readJsonFile(/* [vflow] */ FLUID_CLOUD_DIR + "/nolinkrules.json");
        withExtractionCode = false;
    }
    var results = [];
    for (var i = 0; i < RULES.length; i++) {
        var addToFirst = false;
        if (islistinstr(link, RULES[i].tigger)) {
            var VariableList = [
                { name: "input", value: input, count: 0 }
            ];
            if (["url", "intent"].includes(RULES[i].type)) {
                var OpenApps = pkgCheck(RULES[i].check);
                if (!OpenApps.pass) continue;
                if (!isnolink) {
                    VariableList.push({ name: "link", value: link });
                    if (typeof ExtractionCode !== "undefined" && ExtractionCode !== null) {
                        VariableList.push({ name: "code", value: ExtractionCode, count: 0 });
                    } else {
                        withExtractionCode = false;
                        VariableList.push({ name: "code", value: "", count: 0 });
                        var ExtractionCode = "";
                    }
                }
                var copy = "";
                var output = chooseRules(RULES[i], VariableList, withExtractionCode);
                if (typeof RULES[i].topcondition === "object") {
                    if (istopconditionpass(RULES[i].topcondition, VariableList, withExtractionCode)) {
                        addToFirst = true;
                    }
                }
                var urlpkgn = OpenApps.result;
                if (addToFirst) urlpkgn.reverse();
                for (var k = 0; k < urlpkgn.length; k++) {
                    if (!isKeyPairInOblist(results, "pkg", urlpkgn[k].packageName, "UserId", urlpkgn[k].UserId)) {
                        var titletext = SynthesisRule(getVariablevalues(RULES[i].title, VariableList, RULES[i]), RULES[i].title);
                        var messagetext = SynthesisRule(getVariablevalues(RULES[i].message, VariableList, RULES[i]), RULES[i].message);
                        if (!addToFirst) {
                            results.push({
                            type: RULES[i].type,
                            pkg: urlpkgn[k].packageName,
                            urlsharme: output,
                            activity: null,
                            copy: copy,
                            title: titletext,
                            message: messagetext,
                            UserId: urlpkgn[k].UserId,
                            icon: RULES[i].icon,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        } else {
                            results.unshift({
                            type: RULES[i].type,
                            pkg: urlpkgn[k].packageName,
                            urlsharme: output,
                            activity: null,
                            copy: copy,
                            title: titletext,
                            message: messagetext,
                            UserId: urlpkgn[k].UserId,
                            icon: RULES[i].icon,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        }
                    }
                }
            } else if (!isnolink && RULES[i].type === "pkg") {
                var OpenApps = pkgCheck(RULES[i].pkg);
                var packageName = OpenApps.result;
                if (!OpenApps.pass) continue;
                if (addToFirst) packageName.reverse();
                for (var k = 0; k < OpenApps.result.length; k++) {
                    var activityname = null;
                    if (RULES[i].pkg.includes("://")) {
                        activityname = getAppOpenActivities(RULES[i].pkg, packageName[k].packageName, packageName[k].UserId);
                    } else if (RULES[i].activityname !== undefined && RULES[i].activityname !== null) {
                        activityname = RULES[i].activityname;
                    }
                    if (!isKeyPairInOblist(results, "pkg", packageName[k].packageName, "UserId", packageName[k].UserId)) {
                        if (!addToFirst) {
                            results.push({
                            type: "pkg",
                            link: link,
                            pkg: packageName[k].packageName,
                            activity: activityname,
                            copy: ExtractionCode,
                            UserId: packageName[k].UserId,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        } else {
                            results.unshift({
                            type: "pkg",
                            link: link,
                            pkg: packageName[k].packageName,
                            activity: activityname,
                            copy: ExtractionCode,
                            UserId: packageName[k].UserId,
                            clearClipboard: RULES[i].clearClipboard || false
                        });
                        }
                    }
                }
            } else if (isnolink && RULES[i].type == "rein") {
                var text = RecognitionMain(chooseRules(RULES[i], VariableList, false));
                if (text.length > 0) {
                    OpenMain(text, true);
                } else {
                    nolinkMain(text, true);
                }
                return "rein";
            }
            else {
                throw new Error("规则错误，未知的type：" + RULES[i].type);
            }
        }
    }
    if (!isnolink) {
        var AdaptiveAPP = pkgCheck(link);
        if (AdaptiveAPP.pass) {
            for (var i = 0; i < AdaptiveAPP.result.length; i++) {
                if (
                    !isKeyPairInOblist(results, "pkg", AdaptiveAPP.result[i].packageName, "UserId", AdaptiveAPP.result[i].UserId) &&
                    !Browser_PackageName_BlackList.includes(AdaptiveAPP.result[i].packageName)
                ) {
                    results.push({
                    type: "pkg",
                    link: link,
                    pkg: AdaptiveAPP.result[i].packageName,
                    activity: null,
                    copy: ExtractionCode,
                    UserId: AdaptiveAPP.result[i].UserId,
                    clearClipboard: false
                });
                }
            }
        }
        if (!isKeyInOblist(results, "pkg", defaultBrowser)) {
            results.push({
                type: "pkg",
                link: link,
                pkg: defaultBrowser,
                activity: null,
                copy: ExtractionCode,
                UserId: 0,
                clearClipboard: false
            });
        }
    }
    return results.length !== 0 ? results : false;
}
function launchWithMode(launchType, input, config, freeformMode, mode, packageName, activityName, userId) {
    try {
        var Intent = android.content.Intent;
        var Uri = android.net.Uri;
        var Point = android.graphics.Point;
        var Surface = android.view.Surface;
        var Rect = android.graphics.Rect;
        var ActivityOptions = android.app.ActivityOptions;
        var context = android.app.ActivityThread.currentApplication().getApplicationContext();
        var PackageManager = android.content.pm.PackageManager;
        var intent;
        if (launchType === "intent") {
            intent = Intent.parseUri(input, 0);
        } else {
            intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(input));
        }
        if (packageName && packageName.trim() !== "") {
            intent.setPackage(packageName);
            if (!activityName || activityName.trim() === "") {
                var pm = context.getPackageManager();
                var resolveInfo = pm.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
                if (resolveInfo != null && resolveInfo.activityInfo != null) {
                    activityName = resolveInfo.activityInfo.name;
                } else {
                    throw new Error("未找到可启动的 Activity");
                }
            }
            if (activityName && activityName.trim() !== "") {
                intent.setClassName(packageName, activityName);
            }
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        var userHandle = (userId != null && typeof userId === "number")
            ? android.os.UserHandle.of(userId)
            : android.os.UserHandle.of(0);
        if (mode === "fullscreen") {
            var pm = context.getPackageManager();
            var cmp = intent.resolveActivity(pm);
            if (cmp == null) {
                throw new Error("全屏启动失败：Intent 无法解析到任何 Activity");
            }
            context.startActivityAsUser(intent, null, userHandle);
            return "已全屏启动：" + (launchType === "intent" ? "Intent URI" : input);
        }
        var useMode = isAppinstall("oplus", 0) ? 100 : freeformMode;
        var wm = context.getSystemService("window");
        var display = wm.getDefaultDisplay();
        var point = new Point();
        display.getRealSize(point);
        // 获取屏幕真实尺寸（自然方向）
        var screenSize = getNaturalScreenSize();
        // 确保config是对象格式，并根据屏幕尺寸获取对应的配置
        var configArray = [1200, 1100, 0.6, 200, 150, 400, 80]; // 默认配置
        if (typeof config === 'object' && config !== null && !Array.isArray(config)) {
            // 尝试根据屏幕尺寸获取对应的配置
            if (config[screenSize] && Array.isArray(config[screenSize]) && config[screenSize].length === 7) {
                configArray = config[screenSize];
            }
        }
        var rotation = display.getRotation();
        var isPortrait = (rotation === Surface.ROTATION_0 || rotation === Surface.ROTATION_180);
        var width = isPortrait ? parseInt(configArray[0]) : parseInt(configArray[1]);
        var height = parseInt(width / parseFloat(configArray[2]));
        var left = isPortrait ? parseInt(configArray[3]) : parseInt(configArray[4]);
        var top = isPortrait ? parseInt(configArray[5]) : parseInt(configArray[6]);
        var right = left + width;
        var bottom = top + height;
        var options = ActivityOptions.makeBasic();
        options.setLaunchWindowingMode(useMode);
        options.setLaunchBounds(new Rect(left, top, right, bottom));
        if (launchType === "intent") {
            context.startActivityAsUser(intent, options.toBundle(), userHandle);
        } else {
            context.startActivity(intent, options.toBundle());
        }
        return "已小窗启动：" + (launchType === "intent" ? "Intent URI" : input);
    } catch (e) {
        if (e.message && e.message.includes("No Activity found")) {
            throw new Error("在目标应用中未找到可以打开链接的活动");
        } else {
            throw e;
        }
    }
}
function CopyText(text) {
    /* [vflow] */ VFLOW_ADAPTER.setClipboard(text);  // ← 原：shortx.executeAction(WriteClipboard…)
}
function Recognizeagain() {
    var ModeA = "常规识别模式";
    var ModeB = "加料的复杂单链接(需确保链接前后无允许字符干扰)";
    var ModeC = "未加料的含有非法字符的链接(如中文域名)";
    var ModeD = "强制使用无链接模式";
    var Recognition_Mode = showOptionsDialog([ModeA, ModeB, ModeC, ModeD, "取消"], "识别模式");
    if (Recognition_Mode == ModeA) {
        var text = RecognitionMain(input);
        if (text.length > 0) {
            OpenMain(text, false);
        } else {
            nolinkMain(input, false);
        }
    } else if (Recognition_Mode == ModeB) {
        var text = AddRequestHead(ScreeningParagraphs(removeDisallowedChar(input, allowChar + "\n")));
        if (text.length > 0) {
            OpenMain(text, false);
        } else {
            nolinkMain(input, false);
        }
    } else if (Recognition_Mode == ModeC) {
        var text = AddRequestHead(ScreeningParagraphs(input));
        if (text.length > 0) {
            OpenMain(text, false);
        } else {
            nolinkMain(input, false);
        }
    } else if (Recognition_Mode == ModeD) {
        nolinkMain(input, false);
    }
}
function nolinkMain(input, showfloat) {
    var Open_With_List = matchRules(input, true);
    if (Open_With_List == "rein" || Open_With_List == false || isKeyInOblist(Open_With_List, "pkg", getForegroundAppPackageName())) {
        return 1;
    }
    var DialogBoxOption = [];
    for (var i = 0; i < Open_With_List.length; i++) {
        if (typeof Open_With_List[i].icon === "string") {
            var icon = Open_With_List[i].icon;
        } else {
            var icon = Open_With_List[i].pkg;
        }
        DialogBoxOption.push({
            label: Open_With_List[i].title + "(全屏)",
            desc: Open_With_List[i].message,
            pkg: icon,
            userId: Open_With_List[i].UserId,
            value: ["fullscreen", Open_With_List[i]]
        });
        DialogBoxOption.push({
            label: Open_With_List[i].title + "(小窗)",
            desc: Open_With_List[i].message,
            pkg: icon,
            userId: Open_With_List[i].UserId,
            value: ["window", Open_With_List[i]]
        });
    }
    DialogBoxOption.push({ label: "重新识别", desc: "使用其他识别模式重新识别", icon: "⤴️", value: "重新识别" });
    DialogBoxOption.push({ label: "取消", desc: "关闭指令窗口", icon: "❌", value: "取消" });
    var Fluid_Cloud_Message;
    if (typeof Open_With_List[0].icon === "string") {
        var icon = Open_With_List[0].icon;
    } else {
        var icon = Open_With_List[0].pkg;
    }
    if (Fluid_Cloud_Position == "顶部") {
        Fluid_Cloud_Message = {
            openWith: Open_With_List[0],
            pkg: icon,
            userId: Open_With_List[0].UserId,
            title: Open_With_List[0].title,
            subtitle: Open_With_List[0].message,
            buttonText: "浮窗打开",
            resultOnClick: "fullscreen",
            resultOnButton: "window",
            resultOnTimeout: "取消",
            resultOnSwipe: "取消",
            resultOnSwipeDown: "choose",
            timeout: Fluid_Cloud_timeout,
            gravity: Gravity.TOP | Gravity.CENTER,
            x: 0,
            y: Fluid_Cloud_Position_Offset
        };
    } else {
        Fluid_Cloud_Message = {
            openWith: Open_With_List[0],
            pkg: icon,
            userId: Open_With_List[0].UserId,
            title: Open_With_List[0].title,
            subtitle: Open_With_List[0].message,
            buttonText: "浮窗打开",
            resultOnClick: "fullscreen",
            resultOnButton: "window",
            resultOnTimeout: "取消",
            resultOnSwipe: "choose",
            resultOnSwipeDown: "取消",
            timeout: Fluid_Cloud_timeout,
            gravity: Gravity.BOTTOM | Gravity.CENTER,
            x: 0,
            y: Fluid_Cloud_Position_Offset
        };
    }
    var openWith;
    var Fluid_Cloud_choose_result = !showfloat ? "choose" : showFloatingPrompt(Fluid_Cloud_Message);
    if (Fluid_Cloud_choose_result === "choose") {
        var DialogBoxResult = showOptionsDialog(DialogBoxOption, "打开方式(可滚动)");
        if (!["取消", "重新识别"].includes(DialogBoxResult)) {
            openWith = DialogBoxResult[1];
            openWith.openact = DialogBoxResult[0];
        } else {
            if (DialogBoxResult == "取消") {
                return 1;
            } else if (DialogBoxResult == "重新识别") {
                Recognizeagain();
                return 1;
            }
        }
    } else if (["fullscreen", "window"].includes(Fluid_Cloud_choose_result)) {
        openWith = Open_With_List[0];
        openWith.openact = Fluid_Cloud_choose_result;
    } else {
        return 1;
    }
    if (["url", "intent"].includes(openWith.type)) {
        launchWithMode(openWith.type, openWith.urlsharme, Window_Configuration, Launch_Windowing_Mode, openWith.openact, openWith.pkg, openWith.activity, openWith.UserId);
    } else {
        throw new Error("未知的type：" + openWith.type);
    }
}
function findAllBrowsers(link, userIds) {
    var pm = context.getPackageManager();
    var intent = new Intent(Intent.ACTION_VIEW, Uri.parse(link));
    intent.addCategory(Intent.CATEGORY_BROWSABLE);
    var result = [];
    for (var j = 0; j < userIds.length; j++) {
        var userId = userIds[j];
        var list = null;
        list = pm.queryIntentActivitiesAsUser(intent, PackageManager.MATCH_ALL, userId);
        if (list && list.size() > 0) {
            var seen = {};
            for (var i = 0; i < list.size(); i++) {
                var resolveInfo = list.get(i);
                var pkg = resolveInfo.activityInfo.packageName;
                var key = userId + "@" + pkg;
                if (!seen[key]) {
                    seen[key] = true;
                    result.push({
                        type: "pkg",
                        pkg: pkg,
                        link: link,
                        UserId: userId,
                        activity: null,
                        copy: ""
                    });
                }
            }
        }
    }
    return result;
}
// 发送超级岛通知函数
function showIslandNotification(opts, result, timeout) {
        var NotificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE);
        var NotificationBuilder = android.app.Notification.Builder;
        var PendingIntent = android.app.PendingIntent;
        var Icon = android.graphics.drawable.Icon;
        var userId = opts.userId || 0;
        var pkg = opts.pkg;
        var pull_small_window = config.pull_small_window || true;
        var openWith = opts.openWith;
        var title = opts.title || "打开应用";
        var content = opts.subtitle || "";
        // 创建通知渠道
        var channelId = "fluid_cloud_channel";
        var channelName = "流体云通知";
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            var importance = android.app.NotificationManager.IMPORTANCE_HIGH;
            var channel = new android.app.NotificationChannel(channelId, channelName, importance);
            NotificationManager.createNotificationChannel(channel);
        }
        // 生成唯一通知ID
        var notificationId = java.lang.System.currentTimeMillis() & 0x7fffffff;
        // 【vflow】⚠️⚠️ **只改「按钮」那一条，主体那条保持上游原样。**
        //
        //  上游这里有两条 PendingIntent，**只有一条被 vFlow 阻塞**：
        //
        //  | 通道 | 上游写法 | 谁接 | 被阻塞？ |
        //  |---|---|---|---|
        //  | **主体**（点通知/岛本体） | `getActivity(createLaunchIntent(...))` | **系统**直接拉起 Activity | ❌ **不阻塞** —— 脚本完全不参与 |
        //  | **按钮**（岛上的「浮窗打开」） | `getBroadcast` → **脚本自己 `registerReceiver` 的 receiver** | 脚本 | ✅ **被阻塞**（`new BroadcastReceiver` 必然抛，见 DESIGN.md §4.6） |
        //
        //  ⇒ **主体不许改**。它本来就没坏；改成广播只会多绕一圈，
        //    还平白要求「工作流必须在场」。（我第一版把两条一起改了，是错的。）
        //
        //  ⇒ **按钮必须改**：`getBroadcast` 的目标从「脚本的 receiver」换成
        //    **工作流**（vFlow 广播触发器接），脚本从此不当接收方。
        //    详见本文件顶部的「点击交给工作流」注释块。
        //
        // ⚠️ 唯一的例外是 `pull_small_window == false` 时的**主体**：上游那里也是
        //    `getBroadcast(ACTION_CLICK_MAIN)` 发给脚本自己的 receiver ⇒ **同样被阻塞**
        //    （receiver 已经删了，不改的话那条 PendingIntent 会发给空气、静默无效）。
        //    所以这一条也一并改走工作流。
        var mainIntent;
        var mainPendingIntent;
        if (pull_small_window && openWith) {
            // ⬅️ 上游原样：系统直接拉起 Activity，脚本不参与
            mainIntent = createLaunchIntent(openWith);
            mainPendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                mainIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        } else {
            // ⬅️ 上游此处是 `getBroadcast(ACTION_CLICK_MAIN)` → 脚本 receiver（已被删）⇒ 改走工作流
            mainPendingIntent = createClickBroadcastIntent(
                buildClickPayload(openWith, opts.resultOnClick || "fullscreen", notificationId),
                notificationId);
        }
        // ⚠️⚠️ **按钮这条是本次改动的主角**（上游 `getBroadcast(ACTION_CLICK_BUTTON)` → 脚本 receiver）。
        //
        //  `requestCode` 用 `notificationId + 1`，与主体那条（`notificationId`）**必须不同**：
        //  两条的 `data` 本来就有 `act=` 之差（`PendingIntentRecord.Key.equals` 含
        //  `requestIntent.filterEquals`，而它比 data），data 不同就足以区分；
        //  但**再多一道 requestCode 更保险** —— 万一将来有人把 `act` 从载荷里去掉，
        //  两条就会完全同身份、**按钮静默变成全屏**（不报错）。加一不加价。
        var buttonPendingIntent = createClickBroadcastIntent(
            buildClickPayload(openWith, opts.resultOnButton || "window", notificationId),
            notificationId + 1);
        // 获取应用图标用于超级岛
        var appIcon = null;
        if (pkg) {
            try {
                var userHandle = android.os.UserHandle.of(userId);
                var userContext = context.createPackageContextAsUser(pkg, userId, userHandle);
                var userPm = userContext.getPackageManager();
                appIcon = userPm.getApplicationIcon(pkg);
            } catch (e) {
                console.log("获取应用图标失败: " + e);
            }
        }
        // 构建超级岛参数
        var islandParams = buildIslandParams(title, content, opts.buttonText || "查看");
        // 添加图片数据到通知extras
        var extras = new android.os.Bundle();
        var iconBitmap = null;
        var iconDrawable;
        // 添加应用图标到图片数据
        if (appIcon) {
            try {
                var picsBundle = new android.os.Bundle();
                iconBitmap = getBitmapFromDrawable(appIcon);
                if (iconBitmap != null && !iconBitmap.isRecycled()) {
                    iconDrawable = Icon.createWithBitmap(iconBitmap);
                    picsBundle.putParcelable("miui.focus.pic_app", iconDrawable);
                    extras.putBundle("miui.focus.pics", picsBundle);
                }
            } catch (e) {
                console.log("处理图标时出错: " + e);
            }
        }
        // 添加Action数据（打开应用的action）
        var actionsBundle = new android.os.Bundle();
        var openAction = new android.app.Notification.Action.Builder(
            null,null,
            buttonPendingIntent
        ).build();
        actionsBundle.putParcelable("miui.focus.action_open", openAction);
        extras.putBundle("miui.focus.actions", actionsBundle);
        // 构建基础通知
        var builder = new NotificationBuilder(context, channelId)
            .setContentTitle(title)
            .setContentText(content)
            .setSmallIcon(iconDrawable)
            .setContentIntent(mainPendingIntent)
            // ⚠️⚠️ **系统级的自动收通知**（AOSP `NotificationManagerService` 用
            //    `AlarmManager.setExactAndAllowWhileIdle` 到点 cancel，见 `NMS.java:10269-10274`）。
            //    上游**完全依赖自己那段超时线程**去 cancel —— 而那段线程跑在
            //    `new Thread(new Runnable{…})` 上（**不可靠路径**，见 DESIGN.md §4.6 的实测矩阵），
            //    且本次改动把它删了（不再阻塞）⇒ **没有它，通知会永久留在通知栏**（用户 2026-10-08 实测）。
            //
            // ⚠️ 它只影响**通知栏那条通知**；超级岛的消失由 `islandTimeout` 独立控制
            //    （所以用户看到的是「岛没了、通知还在」）。
            //
            // ⚠️ `timeout` 是**毫秒**（与 `Fluid_Cloud_timeout` 同单位），直接传。
            .setTimeoutAfter(timeout > 0 ? timeout : 3000)
            .setWhen(java.lang.System.currentTimeMillis())
            .setShowWhen(true);
        builder.addExtras(extras);
        var notification = builder.build();
        // 添加超级岛参数到通知
        notification.extras.putString("miui.focus.param", islandParams);
        // 显示通知
        NotificationManager.notify(notificationId, notification);

        // 【vflow】不再等待点击 —— 弹完就返回。
        //
        // 原来这里是：
        //     new Thread(new Runnable({ run: function() { Thread.sleep(timeout); … } })).start();
        //     while (result === null) { Thread.sleep(150); }     // ← 阻塞 Fluid_Cloud_timeout 毫秒
        //     return result;
        //
        // 点击现在由**工作流**处理（广播触发器），脚本不参与 ⇒ **不需要等待**。
        // ⚠️ 顺带去掉的还有那段「超时线程」：它内部也在 `result` / `unregisterReceiver` 上，
        //    receiver 删了之后那两句已经没有语义（unregister 会抛，被 try/catch 吞掉 ⇒ 静默空转）。
        // ⚠️ **代价：超时自动收岛没了。** 通知会一直留到用户点它或划掉。
        //    岛自身的超时由 `param_island.islandTimeout`（上面 buildIslandParams 里写了 10）
        //    承担 —— ⚠️ **该字段的实际效果未在真机验证过**（见 DESIGN.md §4.6 的未决项 0b）。
        return "已发送";
}
// 构建超级岛参数
/**
 * 岛的存活时长（**秒**）。
 *
 * ⚠️ **单位与配置不同** —— `Fluid_Cloud_timeout` 是**毫秒**（默认 3000），
 *    而岛参数 `islandTimeout` 是**秒**（官方模板约定，见 vFlow 的
 *    `IslandTemplate.kt`：「注意与通知的 `timeout`（分钟）单位不同」）。
 *
 * ⚠️ **上游写死 10 秒**（`reference/core.js:2170`），**没读配置** ——
 *    本次改为读配置（用户 2026-10-08 要求）。⇒ 默认配置下岛会从 10 秒变成 **3 秒**。
 *    嫌太快就调大 `config.json` 的 `Fluid_Cloud_timeout`（它是同一个「等用户多久」的语义）。
 */
function islandTimeoutSeconds() {
    var ms = parseInt(Fluid_Cloud_timeout, 10);
    if (isNaN(ms) || ms <= 0) ms = 3000;
    // ⚠️ 向上取整且**至少 1 秒** —— 传 0 给 `islandTimeout` 的语义未定义
    return Math.max(1, Math.ceil(ms / 1000));
}

function buildIslandParams(title, content, buttonText) {
    var islandParams = {
        "param_v2": {
            "protocol": 1,
            "business": "fluid_cloud", // 业务场景
            "enableFloat": true, // 允许展开
            "updatable": false, // 非持续性通知
            // ⚠️ 这个 `timeout` 是**分钟**（官方模板约定），上游写死 10。
            //    本次与 `islandTimeout` 一起从配置推导（取同一个「等用户多久」的语义）。
            "timeout": Math.max(1, Math.ceil(islandTimeoutSeconds() / 60)),
            "islandFirstFloat": true,
            // 状态栏数据
            "ticker": title,
            "tickerPic": "miui.focus.pic_app",
            // 息屏AOD数据
            "aodTitle": title,
            "aodPic": "miui.focus.pic_app",
            // 岛数据
            "param_island": {
                "islandProperty": 1, // 信息展示为主
                // ⚠️ 秒（见 islandTimeoutSeconds 的注释）。上游写死 10，现读配置。
                "islandTimeout": islandTimeoutSeconds(),
                // 大岛内容 - 使用基础信息模板
                "bigIslandArea": {
                    "imageTextInfoLeft": {
                        "type": 1,
                        "picInfo": {
                            "type": 1,
                            "pic": "miui.focus.pic_app"
                        }
                    },
                    "textInfo": {
                        "title": title,
                        "narrowFont": true,
                        "showHighlightColor": true
                    }
                },
                // 小岛内容
                "smallIslandArea": {
                    "picInfo": {
                        "type": 1,
                        "pic": "miui.focus.pic_app"
                    }
                }
            },
            // 焦点通知数据
            "iconTextInfo": {
                "title": title,
                "content": content,
                "animIconInfo": {
                    "type": 0,
                    "src": "miui.focus.pic_app"
                }
            },
            "actions": [
                {
                    "type": 2,
                    "actionTitle": buttonText,
                    "action": "miui.focus.action_open"
                }
            ]
        }
    };
    return JSON.stringify(islandParams);
}
// 检查是否支持超级岛功能
function isSupportIsland() {
    try {
        // 反射查询系统是否支持岛功能
        var clazz = java.lang.Class.forName("android.os.SystemProperties");
        var method = clazz.getDeclaredMethod("getBoolean",
            java.lang.Class.forName("java.lang.String"),
            java.lang.Boolean.TYPE);
        var result = method.invoke(null, "persist.sys.feature.island", false);
        return Boolean(result);
    } catch (e) {
        var errorMsg = "检查超级岛支持失败: " + e.toString(); // 使用 toString() 而不是直接拼接
        console.log(errorMsg); // 复制错误信息到剪切板
        return false;
    }
}
// 检查焦点通知权限
function hasFocusPermission() {
    try {
        var uri = android.net.Uri.parse("content://miui.statusbar.notification.public");
        var extras = new android.os.Bundle();
        extras.putString("package", context.getPackageName());
        var bundle = context.getContentResolver().call(uri, "canShowFocus", null, extras);
        return bundle.getBoolean("canShowFocus", false);
    } catch (e) {
        console.log("检查焦点通知权限失败: " + e);
        return false;
    }
}
// 检查焦点通知协议版本
function getFocusProtocolVersion() {
    try {
        return android.provider.Settings.System.getInt(
            context.getContentResolver(),
            "notification_focus_protocol", 0);
    } catch (e) {
        console.log("获取焦点通知协议版本失败: " + e);
        return 0;
    }
}
// 辅助函数：将Drawable转换为Bitmap
function getBitmapFromDrawable(drawable) {
    if (drawable instanceof android.graphics.drawable.BitmapDrawable) {
        return drawable.getBitmap();
    }
    var bitmap = android.graphics.Bitmap.createBitmap(
        drawable.getIntrinsicWidth(),
        drawable.getIntrinsicHeight(),
        android.graphics.Bitmap.Config.ARGB_8888
    );
    var canvas = new android.graphics.Canvas(bitmap);
    drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
    drawable.draw(canvas);
    return bitmap;
}
// ════════════════════════════════════════════════════════════════════════════
// 【vflow】点击交给工作流 —— 广播回传（2026-10-07）
//
// ## 为什么要有这一段
//
// 原实现用 `new BroadcastReceiver({...})` 自己接收按钮点击。**在 vFlow 里这行必然抛**：
//
//     实例化错误 (can't load this type of class file)：
//     类 android.content.BroadcastReceiver 是接口或抽象类
//
// 真因是 vFlow 的 `ContextFactory` 没覆写 `createClassLoader`（见 DESIGN.md §4.6）。
//
// ## 改法：脚本只【发】广播，不当接收方
//
// 「发送」是脚本的活，「接收 + 执行」是工作流的活。按钮的 PendingIntent 本来就是
// `getBroadcast` —— 系统只负责发，谁收是另一件事。
//
// 附带好处：**不再阻塞**。原来 `while (result === null) { Thread.sleep(150); }`
// 会把工作流线程占住 `Fluid_Cloud_timeout`（默认 3000ms）。
//
// ## ⚠️ 只覆盖「终结动作」，不覆盖「选择」
//
// 岛上的按钮点一下 = 打开一个链接，**然后结束** ⇒ 工作流接了就能干完。
// 而「多链接选择」「打开方式选择」那类框是**脚本自己画的浮窗**（`View.OnClickListener`
// 走 Proxy，本来就不炸），结果要写回脚本的局部变量继续跑 —— 那个**没法用广播回传**。
// ⇒ 本函数只服务前者；后者仍走自绘浮窗（见 DESIGN.md §4.6 的 A/B 两类）。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 点击回传的广播地址。
 *
 * ⚠️⚠️ **这两个常量必须与工作流里配的完全一致，且都是【写死的常量】。**
 *    原实现是 `"FLUID_CLOUD_CLICK_BUTTON_" + notificationId`（运行期拼的），
 *    而 vFlow 广播触发器的 `actions` 参数**不接受变量**（`IntentFilter` 在
 *    工作流注册期就固定了）⇒ **不能带任何运行期后缀**。
 *
 * ⚠️ 那「怎么区分是哪一次点击」？靠 **`data` 里的载荷**，不靠 action。
 */
var FLUID_CLOUD_ACTION_CLICK = "com.chaomixian.vflow.fluidcloud.CLICK";

/** `data` 的 scheme —— 工作流那边要填 `addDataScheme("vflowfc")` 才能收到。 */
var FLUID_CLOUD_DATA_SCHEME = "vflowfc";

/**
 * 岛**按钮**那条回传的开关（默认开）。
 *
 * ⚠️ 它**只影响岛路径**（`showFloatingPrompt` 的分流 + `showIslandNotification` 里
 *    按钮那条 PendingIntent）。**不碰主体那条** —— 主体是 `getActivity`，
 *    由系统直接拉起 Activity，脚本不参与，**本来就没被 vFlow 阻塞**，不该改。
 *
 * 关掉时按钮那条改回「脚本自己收」的写法（但 receiver 已删 ⇒ 实际没人接），
 * 是**排查用的**，不是长期配置项。
 */
var VFLOW_CLICK_BROADCAST = true;

/**
 * 把「这次点击要做什么」编码成 `data` 的 URI。
 *
 * 形如：`vflowfc://click?act=window&pkg=tv.danmaku.bili&uid=0&type=url&url=<编码后的链接>`
 *
 * ## ⚠️ 为什么放 `data` 而不是 `extras`
 *
 * | | `extras` | `data` |
 * |---|---|---|
 * | 预算 | ⚠️ **8 KiB**（`BroadcastTriggerHandler.MAX_EXTRAS_JSON_BYTES`） | ✅ **无**（`dataUri = intent.dataString` 原样输出） |
 * | 精确寻址 | 不行 | ✅ `addDataScheme("vflowfc")` 能把别的 App 发来的同 action 广播卡掉 |
 *
 * 实测一条典型载荷约 166 字节，`extras` 其实**装得下**（25 倍余量）——
 * 选 `data` 是因为**寻址与过滤**，不是因为容量。
 *
 * ## ⚠️ `url` 必须编码
 *
 * 链接里**本来就有 `?` 与 `&`**（如 `…/video/BV1xx?share_source=copy_web&vd_source=…`），
 * 不编码会被 URI 解析器**吃掉**（`&` 之后的段变成新的 query 参数）。
 * `encodeURIComponent` 的代价很小（实测 92 → 110 字节，1.20×），
 * 换来「解析绝不会错」。
 */
function buildClickPayload(openWith, act, notificationId) {
    // ⚠️ `act` 决定打开方式，`type` 决定链接怎么解析（与 launchWithMode 的两个入参对应）
    var type = openWith.type || "url";
    // ⚠️ 与 OpenMain 里 launchWithMode 的取值口径一致：
    //    type=url/intent 用 urlsharme；type=pkg 用 link（见 core.js 的 launchWithMode 调用点）
    var raw = (type === "pkg") ? openWith.link : openWith.urlsharme;
    var qs = [
        "act=" + encodeURIComponent(String(act || "fullscreen")),
        // ⚠️ `nid` = 通知 ID —— 工作流处理完点击后**用它把通知栏那条收掉**。
        //    为什么必须带上：通知的自动消失已经交给系统的 `setTimeoutAfter`，
        //    但**用户点开之后**那条通知没有理由继续挂着（原来靠脚本自己 cancel，
        //    现在脚本不参与点击了）⇒ 由工作流补这一刀。
        //    见 `launchFromClick` 与 DESIGN.md §4.6。
        "nid=" + encodeURIComponent(String(notificationId == null ? "" : notificationId)),
        "pkg=" + encodeURIComponent(String(openWith.pkg || "")),
        "uid=" + encodeURIComponent(String(openWith.UserId == null ? 0 : openWith.UserId)),
        "type=" + encodeURIComponent(String(type)),
        "url=" + encodeURIComponent(String(raw == null ? "" : raw))
    ];
    return FLUID_CLOUD_DATA_SCHEME + "://click?" + qs.join("&");
}

/**
 * 造一个「点击就发广播」的 `PendingIntent`。
 *
 * ## ⚠️⚠️ `requestCode` 必须让每条通知、每条通道都不同
 *
 * `PendingIntent` 的等价判据在系统侧是 **`PendingIntentRecord.Key.equals`**
 * （AOSP `services/core/java/com/android/server/am/PendingIntentRecord.java`，已逐字核实）：
 *
 * ```
 * type / userId / packageName / featureId / activity / who /
 * requestCode / requestIntent.filterEquals / requestResolvedType / flags
 * ```
 *
 * 而 `Intent.filterEquals`（`Intent.java:11837`，已逐字核实）比的是：
 * **`mAction / mData / mType / mIdentifier / mPackage / mComponent / mCategories`**
 * —— **比较 `data`，不比较 `extras`，也不比较 `flags`**。
 *
 * ⇒ **改这个函数时最容易踩的两个坑**（两个都不报错、都不崩）：
 *
 * | 坑 | 后果 |
 * |---|---|
 * | **`requestCode` 写死 + `data` 里只有 `act` 不同** | 两条 PendingIntent 仍不同（data 参与判据）⇒ 侥幸能跑。但**一旦有人把 `act` 从 payload 去掉**，两条就完全同身份 ⇒ **按钮静默变成全屏** |
 * | **`requestCode` 写死 + 跨通知也相同**（`data` 也相同） | 第二条通知的 `getBroadcast` **命中第一条**；本函数**没带 `FLAG_UPDATE_CURRENT`**（`FLAG_IMMUTABLE` 不含它）⇒ `getIntentSender` 命中已有 Key 时**直接返回旧记录**（`PendingIntentController.java:167-180`）⇒ **点第二条的按钮，打开的是第一条的链接** |
 *
 * ⇒ **两道保险都上**：`requestCode` 用 `notificationId`（每条通知不同）、
 *    按钮那条用 `notificationId + 1`（同一通知内两条通道不同）。
 *
 * @param data 由 [buildClickPayload] 造出的 URI 字符串
 * @param requestCode ⚠️ **必须每条通知、每条通道都不同**
 */
function createClickBroadcastIntent(data, requestCode) {
    // ⚠️ 类名在函数内**显式取一次**（照 createLaunchIntent 的写法）——
    //    `importPackage(android.content)` 注册的短名在 Rhino 里未必解析得到，
    //    而 `PendingIntent` 是 showIslandNotification 里的**局部变量**，本函数够不到。
    var Intent = android.content.Intent;
    var Uri = android.net.Uri;
    var PendingIntent = android.app.PendingIntent;

    var intent = new Intent(FLUID_CLOUD_ACTION_CLICK);
    intent.setData(Uri.parse(data));
    // ⚠️ 显式指定接收者（vFlow 自己）—— 把「任意 App 可伪造」收窄成
    //    「必须知道包名 + action + scheme 形状」。
    //    脚本本来就跑在 vFlow 里，`getPackageName()` 直接就有，**不是硬编码**。
    try {
        intent.setPackage(context.getPackageName());
    } catch (e) {
        console.log("设置广播接收包名失败（将退化为隐式广播）：" + e);
    }
    return PendingIntent.getBroadcast(
        context,
        requestCode,
        intent,
        PendingIntent.FLAG_IMMUTABLE
    );
}

/**
 * 解析点击回传的载荷（与 [buildClickPayload] 成对）。
 *
 * ## 为什么需要它
 *
 * 工作流收到广播后，把 `data_uri` 作为输入再喂回**同一个脚本**（见 DESIGN.md §4.6）——
 * 那次执行的 `inputs.text` 就是这条 URI。不解析的话脚本会拿整串 URI 去识别链接，
 * 识别出一堆垃圾。
 *
 * ## ⚠️ 必须在【顶层分派之前】调用
 *
 * 调用点是文件末尾那段顶层代码：`if (VFLOW_CLICK_ACTION == "click") { launchFromClick(…) } else { …原识别链路… }`
 * ⇒ 点击回传那次执行**不会**走识别、**不会**弹岛，只做「打开」这一件事。
 * 这正是「不阻塞」的兑现方式：第一次执行弹完就退场，第二次执行只管打开。
 *
 * ## ⚠️ 解析失败必须**显式报错**
 *
 * 静默的后果是「点了按钮什么都没发生」，而用户完全无从判断是广播没到、
 * 载荷解析错了、还是打开失败 ⇒ 每一处都抛/打日志。
 *
 * @return 解析出的对象，或 `null`（不是点击载荷）
 */
function parseClickPayload(uri) {
    if (typeof uri !== "string" || uri.indexOf(FLUID_CLOUD_DATA_SCHEME + "://click?") !== 0) {
        return null;
    }
    var qs = uri.substring((FLUID_CLOUD_DATA_SCHEME + "://click?").length);
    var out = {};
    var pairs = qs.split("&");
    for (var i = 0; i < pairs.length; i++) {
        var eq = pairs[i].indexOf("=");
        if (eq < 0) continue;
        var k = pairs[i].substring(0, eq);
        var v = pairs[i].substring(eq + 1);
        try {
            out[k] = decodeURIComponent(v);
        } catch (e) {
            // 解码失败就保留原文 —— 总比丢掉强
            out[k] = v;
        }
    }
    if (!out.url) {
        throw new Error("点击载荷里没有 url：" + uri);
    }
    return out;
}

/**
 * 点击回传那次执行的全部动作：把载荷变成一次 `launchWithMode`。
 *
 * ⚠️ `type` 决定用哪个字段（与 [buildClickPayload] 的编码口径、以及
 *    `OpenMain` 里 `launchWithMode` 的调用口径**三处一致**）：
 *    `url`/`intent` ⇒ 载荷里的 `url`；`pkg` ⇒ 也是载荷里的 `url`（编码时已从 `link` 取过）。
 *
 * ⚠️ 这里**没有 `openWith` 对象**（它在第一次执行里），所以 `activity` 传 `null`
 *    —— 与 `OpenMain` 里 `Open_With_List[0].activity` 通常为 `null` 一致
 *    （`matchRules` 产出的 `activity` 就是 `null`，见该函数）。
 */
function launchFromClick(payload) {
    var mode = payload.act || "fullscreen";
    var type = payload.type || "url";
    var pkg = payload.pkg || "";
    var uid = parseInt(payload.uid, 10);
    if (isNaN(uid)) uid = 0;

    console.log("流体云：收到点击回传 mode=" + mode + " pkg=" + pkg + " url=" + payload.url);

    // ⚠️ **先把通知收掉，再打开。** 顺序有讲究：
    //    用户点开之后那条通知没有理由继续挂着（原来靠脚本自己 cancel，
    //    现在脚本不参与点击了 ⇒ 由这里补这一刀）。
    //    放在打开**之前**：打开可能失败（如「未找到可启动的 Activity」），
    //    而那种情况下用户已经点过了、通知留着也没意义，反而是个碍事的残留。
    cancelNotificationById(payload.nid);

    // ⚠️ 与第一次执行**同源**的配置（同一个 config.json）
    var cfg = readJsonFile(FLUID_CLOUD_DIR + "/config.json");
    launchWithMode(
        (type === "pkg") ? "intent" : type,
        payload.url,
        cfg.Window_Configuration,
        cfg.Launch_Windowing_Mode,
        mode,
        pkg,
        null,
        uid
    );
    return "已处理点击回传：" + mode;
}

/**
 * 按通知 ID 收掉通知栏里那条。
 *
 * ## ⚠️ 为什么不能静默失败
 *
 * 拿不到 ID / 收不掉都不影响**打开链接**这件正事，所以不该抛；
 * 但**必须打日志** —— 「通知点完不消失」是用户看得见的现象，
 * 而它可能来自三种完全不同的原因（ID 没传进来 / ID 解析不出来 / cancel 抛了），
 * 不留痕就分不清是哪一种。
 *
 * ## ⚠️ `NotificationManager` 的取法
 *
 * 这里没有 `showIslandNotification` 里那个局部变量（那是**上一次执行**的作用域），
 * 必须自己取一次。
 */
function cancelNotificationById(rawId) {
    if (rawId === undefined || rawId === null || String(rawId) === "") {
        console.log("流体云：载荷里没有 nid，无法收通知（点完通知栏会留一条）");
        return;
    }
    var nid = parseInt(rawId, 10);
    if (isNaN(nid)) {
        console.log("流体云：nid 不是数字（" + rawId + "），无法收通知");
        return;
    }
    try {
        var nm = context.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(nid);
        console.log("流体云：已收掉通知 id=" + nid);
    } catch (e) {
        console.log("流体云：收通知失败 id=" + nid + " —— " + e);
    }
}

// 创建启动Intent
function createLaunchIntent(openWith) {
    try {
        var Intent = android.content.Intent;
        var Uri = android.net.Uri;
        var intent;
        var launchType = openWith.type;
        var link = openWith.link;
        if (launchType === "intent") {
            intent = Intent.parseUri(openWith.urlsharme, 0);
        } else if (launchType === "url") {
            intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(openWith.urlsharme));
        } else if (launchType === "pkg") {
            intent = new Intent(Intent.ACTION_VIEW);
            intent.setData(Uri.parse(link));
        }
        if (openWith.pkg && openWith.pkg.trim() !== "") {
            intent.setPackage(openWith.pkg);
            if (openWith.activity && openWith.activity.trim() !== "") {
                intent.setClassName(openWith.pkg, openWith.activity);
            }
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        // 设置用户
        if (openWith.UserId != null && typeof openWith.UserId === "number") {
            intent.addFlags(Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
            // 对于多用户，需要特殊处理
        }
        return intent;
    } catch (e) {
        console.log("创建启动Intent失败: " + e);
        return null;
    }
}
function OpenMain(AllLinks, showfloat) {
    if (AllLinks.length === 0) {
        return 1;
    }
    var link;
    var linkNum = AllLinks.length;
    var manylink = linkNum >= 2;
    if (manylink) {
        var ManyLink_Fluid_Cloud;
        if (Fluid_Cloud_Position == "顶部") {
            ManyLink_Fluid_Cloud = {
                pkg: defaultBrowser,
                userId: 0,
                title: "多个链接",
                subtitle: "点击选择链接",
                buttonText: "重新识别",
                resultOnClick: true,
                resultOnButton: "重新识别",
                resultOnTimeout: false,
                resultOnSwipe: false,
                resultOnSwipeDown: true,
                timeout: Fluid_Cloud_timeout,
                gravity: Gravity.TOP | Gravity.CENTER,
                x: 0,
                y: Fluid_Cloud_Position_Offset
            };
        } else {
            ManyLink_Fluid_Cloud = {
                pkg: defaultBrowser,
                userId: 0,
                title: "多个链接",
                subtitle: "点击选择链接",
                buttonText: "重新识别",
                resultOnClick: true,
                resultOnButton: "重新识别",
                resultOnTimeout: false,
                resultOnSwipe: true,
                resultOnSwipeDown: false,
                timeout: Fluid_Cloud_timeout,
                gravity: Gravity.BOTTOM | Gravity.CENTER,
                x: 0,
                y: Fluid_Cloud_Position_Offset
            };
        }
        var openWith;
        var goManyLinkChoose = !showfloat ? true : showFloatingPrompt(ManyLink_Fluid_Cloud);
        if (goManyLinkChoose == true) {
            AllLinks.push("取消");
            AllLinks.push("重新识别");
            link = String(showOptionsDialog(AllLinks, "选择链接"));
        } else if (goManyLinkChoose == "重新识别") {
            Recognizeagain();
            return 1;
        } else {
            return 1;
        }
    } else {
        link = String(AllLinks[0]);
    }
    if (link == "取消") {
        return 1;
    } else if (link == "重新识别") {
        Recognizeagain();
        return 1;
    }
    var Open_With_List = matchRules(link, false);
    if (!manylink && (Open_With_List.length < 2 || getForegroundAppPackageName() != defaultBrowser) &&
        isKeyInOblist(Open_With_List, "pkg", getForegroundAppPackageName())) {
        return 1;
    }
    if (Open_With_List.length < 2 && ["QQ", "微信"].includes(tiggerTag)) return 1;
    var DialogBoxOption = [];
    for (var i = 0; i < Open_With_List.length; i++) {
        DialogBoxOption.push({
            label: getAppName(Open_With_List[i].pkg, Open_With_List[i].UserId),
            desc: "全屏",
            pkg: Open_With_List[i].pkg,
            userId: Open_With_List[i].UserId,
            value: ["fullscreen", Open_With_List[i]]
        });
        DialogBoxOption.push({
            label: getAppName(Open_With_List[i].pkg, Open_With_List[i].UserId),
            desc: "小窗",
            pkg: Open_With_List[i].pkg,
            userId: Open_With_List[i].UserId,
            value: ["window", Open_With_List[i]]
        });
    }
    DialogBoxOption.push({ label: "其他应用打开", desc: "使用其他浏览器或应用打开", icon: "➡️", value: "其他应用打开" });
    DialogBoxOption.push({ label: "系统选择框", desc: "全屏", icon: "📱", value: "选择应用打开" });
    DialogBoxOption.push({ label: "复制链接", desc: "复制清理干净的链接和提取码", icon: "📋", value: "复制链接" });
    DialogBoxOption.push({ label: "重新识别", desc: "使用其他识别模式重新识别", icon: "⤴️", value: "重新识别" });
    DialogBoxOption.push({ label: "取消", desc: "关闭指令窗口", icon: "❌", value: "取消" });
    var Fluid_Cloud_Message;
    if (Fluid_Cloud_Position == "顶部") {
        Fluid_Cloud_Message = {
            openWith: Open_With_List[0],
            pkg: Open_With_List[0].pkg,
            userId: Open_With_List[0].UserId,
            title: "打开" + getAppName(Open_With_List[0].pkg, 0),
            subtitle: "点击全屏打开" + getAppName(Open_With_List[0].pkg, 0),
            buttonText: "浮窗打开",
            resultOnClick: "fullscreen",
            resultOnButton: "window",
            resultOnTimeout: "取消",
            resultOnSwipe: "取消",
            resultOnSwipeDown: "choose",
            timeout: Fluid_Cloud_timeout,
            gravity: Gravity.TOP | Gravity.CENTER,
            x: 0,
            y: Fluid_Cloud_Position_Offset
        };
    } else {
        Fluid_Cloud_Message = {
            openWith: Open_With_List[0],
            pkg: Open_With_List[0].pkg,
            userId: Open_With_List[0].UserId,
            title: "打开" + getAppName(Open_With_List[0].pkg, 0),
            subtitle: "点击全屏打开" + getAppName(Open_With_List[0].pkg, 0),
            buttonText: "浮窗打开",
            resultOnClick: "fullscreen",
            resultOnButton: "window",
            resultOnTimeout: "取消",
            resultOnSwipe: "choose",
            resultOnSwipeDown: "取消",
            timeout: Fluid_Cloud_timeout,
            gravity: Gravity.BOTTOM | Gravity.CENTER,
            x: 0,
            y: Fluid_Cloud_Position_Offset
        };
    }
    var openWith;
    var Fluid_Cloud_choose_result = (manylink || !showfloat) ? "choose" : showFloatingPrompt(Fluid_Cloud_Message);
    if (Fluid_Cloud_choose_result === "choose" && (tiggerTag != "附加" || (tiggerTag == "附加" && extra_default_action == "询问"))) {
        var DialogBoxResult = showOptionsDialog(DialogBoxOption, "打开方式(可滚动)");
        if (!["取消", "复制链接", "其他应用打开", "选择应用打开", "重新识别"].includes(DialogBoxResult)) {
            openWith = DialogBoxResult[1];
            openWith.openact = DialogBoxResult[0];
        } else {
            if (DialogBoxResult == "取消") {
                return 1;
            } else if (DialogBoxResult == "重新识别") {
                Recognizeagain();
                return 1;
            }
            var clink = link.split(" 提取码:");
            if (clink[1] !== undefined) {
                CopyText(clink[1]);
                showToast("提取码已复制");
            } else if (openWith && openWith.clearClipboard && DialogBoxResult != "复制链接") {
                CopyText("");
            }
            var runIns = clink[0];
            if (DialogBoxResult == "复制链接") {
                RecordCopiedText(runIns);
                CopyText(runIns);
                showToast("链接已复制");
                return 1;
            } else if (DialogBoxResult == "选择应用打开") {
                /* [vflow] */ VFLOW_ADAPTER.shell("am start -d \"" + runIns + "\"");  // ← 原：ShellCommand protobuf
                return 1;
            } else if (DialogBoxResult == "其他应用打开") {
                var OtherAppOpenDialogBoxOption = [];
                var OtherAppsList = findAllBrowsers(runIns, UserIds);
                OtherAppOpenDialogBoxOption.push({ label: "取消", desc: "关闭指令窗口", icon: "❌", value: "取消" });
                for (var i = 0; i < OtherAppsList.length; i++) {
                    OtherAppOpenDialogBoxOption.push({
                        label: getAppName(OtherAppsList[i].pkg, OtherAppsList[i].UserId),
                        desc: "全屏",
                        pkg: OtherAppsList[i].pkg,
                        userId: OtherAppsList[i].UserId,
                        value: ["fullscreen", OtherAppsList[i]]
                    });
                    OtherAppOpenDialogBoxOption.push({
                        label: getAppName(OtherAppsList[i].pkg, OtherAppsList[i].UserId),
                        desc: "小窗",
                        pkg: OtherAppsList[i].pkg,
                        userId: OtherAppsList[i].UserId,
                        value: ["window", OtherAppsList[i]]
                    })
                }
                var OtherAppDialogBoxResult = showOptionsDialog(OtherAppOpenDialogBoxOption, "其他打开方式(可滚动)");
                if (OtherAppDialogBoxResult !== "取消") {
                    openWith = OtherAppDialogBoxResult[1];
                    openWith.openact = OtherAppDialogBoxResult[0];
                } else {
                    return 1;
                }
            } else {
                return 1;
            }
        }
    } else if (tiggerTag == "附加" && extra_default_action != "询问") {
        if (extra_default_action == "全屏打开") {
            openWith = Open_With_List[0];
            openWith.openact = "fullscreen";
        } else if (extra_default_action == "小窗打开") {
            openWith = Open_With_List[0];
            openWith.openact = "window";
        }
    } else if (["fullscreen", "window"].includes(Fluid_Cloud_choose_result)) {
        openWith = Open_With_List[0];
        openWith.openact = Fluid_Cloud_choose_result;
    } else {
        return 1;
    }
    if (openWith.copy != "" && openWith.copy !== undefined) {
        CopyText(openWith.copy);
        showToast("提取码已复制");
    } else if (openWith.clearClipboard) {
        CopyText("");
    }
    if (["url", "intent"].includes(openWith.type)) {
        launchWithMode(openWith.type, openWith.urlsharme, Window_Configuration, Launch_Windowing_Mode, openWith.openact, openWith.pkg, openWith.activity, openWith.UserId);
    } else if (openWith.type == "pkg") {
        launchWithMode("intent", openWith.link, Window_Configuration, Launch_Windowing_Mode, openWith.openact, openWith.pkg, openWith.activity, openWith.UserId);
    } else {
        throw new Error("未知的type：" + openWith.type);
    }
}
// ════════════════════════════════════════════════════════════════════════════
// 【vflow】顶层分派：本次执行是「点击回传」/「手动触发（设置）」/「识别」？
//
// 点击回传由工作流经广播触发器接住，再把 `data_uri` 作为 `inputs.click_uri`
// 喂回来（见 DESIGN.md §4.6 出路 ①）。那一次执行的文本**不是**分享文案，而是
// `vflowfc://click?...` 这条 URI ⇒ 必须在这里分流，**不能让它落进识别链路**
// （否则会拿 URI 去识别链接、弹一堆无意义的岛）。
//
// 「手动触发（设置）」是**上游「点指令图标 → 进设置菜单」那条路**的 vFlow 版：
// 上游靠 `{factTag}` 短变量**展开失败**来判断（见 adapter.js 的 isRunAction），
// vFlow 里没有那个机制 ⇒ 改用**手动触发器的标签**分流。
//
// ⚠️ 分流必须在**最外层**（`if (DebugMode == false && isRunAction == true)` 那个
//    大分支**之前**）—— 那个分支是上游的「设置指令」入口，与点击回传无关。
//
// ⚠️ `isRunAction` 的语义：原脚本用它表示「由用户从设置里手动跑」。
//    vFlow 里它恒为 `false`（adapter.js 固定值）⇒ 那条分支是**死路**，
//    真正生效的是下面的标签判断。保留它只为对照上游。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 手动触发器的标签 —— 与 `workflow/fluid-cloud.json` 里那个触发器的
 * `__trigger_label` **必须逐字一致**（改一处忘另一处 ⇒ 静默失效：
 * 表现为「点了执行，什么界面都没弹」）。
 *
 * ⚠️ 不用 `更新`（DESIGN.md §3.4.5 原定那个）—— 更新按钮本轮不做，
 *    见 §3.4「未实现」。等真做更新时，这里再加一个标签分支。
 */
var VFLOW_MANUAL_LABEL = "设置";

var VFLOW_CLICK_ACTION = (function () {
    try {
        var p = parseClickPayload(input);
        return p ? "click" : "";
    } catch (e) {
        // ⚠️ 是点击载荷但解析失败 —— **必须显式报错**，不能退化成识别
        //    （退化的表现是「点了按钮，反而又弹一个岛」，用户完全看不懂）
        console.log("流体云：点击载荷解析失败 —— " + e);
        throw e;
    }
})();

/**
 * 上游「点指令图标 → 执行动作」那个菜单。
 *
 * ⚠️ 三个界面都是**自绘 WindowManager View**（`showsettingsui` / `showFileEditorUI`），
 *    不是 vFlow 的 UI 积木 —— 属于 P2-11 未做的部分，这里先原样接上。
 */
function showManualActionsUI() {
    var setaction = showOptionsDialog(["设置指令", "编辑规则", "编辑无链接规则", "检查更新", "取消"], "选择操作");
    if (setaction == "设置指令") {
        showsettingsui();
    } else if (setaction == "编辑规则") {
        showFileEditorUI(/* [vflow] */ FLUID_CLOUD_DIR + "/rules.json");
    } else if (setaction == "编辑无链接规则") {
        showFileEditorUI(/* [vflow] */ FLUID_CLOUD_DIR + "/nolinkrules.json");
    } else if (setaction == "检查更新") {
        // ⚠️ 返回**哨兵**而不是在这里读文件 + eval —— 顶层分派里做那件事，
        //    与 `bootstrap.js` 读主脚本是同一个模式（「读设备文件 + eval」）。
        return "update";
    }
    return null;
}

if (VFLOW_CLICK_ACTION == "click") {
    launchFromClick(parseClickPayload(input));
} else if (tiggerTag == VFLOW_MANUAL_LABEL || (DebugMode == false && isRunAction == true)) {
    if (showManualActionsUI() === "update") {
        // ⚠️ 更新器是**独立文件**（docs/UPDATE.md §7）—— 只有「路径」一个契约，
        //    eval 进**同一作用域**后它顶层自己开跑（不自我更新，改它要手动 push）。
        // ⚠️ 变量名用 VFLOW_UPDATE_CODE 而**不是** `code`：顶层 `var` 是共享作用域，
        //    通用名有撞掉 core.js 已有全局的风险。
        // ⚠️ 这里**不加**就地标记（那 12 处标的是「相对上游的 5 类移植改动」）——
        //    本行是**新增功能**（上游没有更新器），不是移植改动点；
        //    加了会让 test/run.js 的「恰好 12 处」断言变红。
        var VFLOW_UPDATE_CODE = VFLOW_ADAPTER.readText(FLUID_CLOUD_DIR + "/update.js");
        if (VFLOW_UPDATE_CODE === null || VFLOW_UPDATE_CODE.length < 100) {
            // ⚠️ **必须显式报错**（UPDATE.md §7.4 约束 3）—— 静默的表现是
            //    「点了检查更新，什么都没发生」，用户完全无从判断。
            // ⚠️ 走 VFLOW_ADAPTER.toast 而**不是** showToast：后者受全局 `show_toast`
            //    开关控制，用户关掉提示时这条错误会被吞掉（那正是要防的静默）。
            VFLOW_ADAPTER.toast("更新器缺失或内容异常，请 push dist/update.js 到 " + FLUID_CLOUD_DIR + "/");
        } else {
            // ⚠️ 这道闸让 update.js「只加载不执行」成为可能（离线测试要用）；
            //    在这里设 true，eval 之后 update.js 末尾那道闸就会放行主流程。
            var VFLOW_UPDATE_ENABLED = true;
            eval(VFLOW_UPDATE_CODE);
        }
    }
} else {
    var showFloatingPrompts;
    if (DebugMode) {
        showFloatingPrompts = true;
    } else {
        showFloatingPrompts = ["选中", "附加"].includes(tiggerTag) ? false : true;
    }
    var config = readJsonFile(/* [vflow] */ FLUID_CLOUD_DIR + "/config.json");
    var Top_Level_Domain = config.Top_Level_Domain;
    var Email_Keyword_List = config.Email_Keyword_List;
    var link_blacklist_keywords = config.link_blacklist_keywords;
    var Fluid_Cloud_Position = config.Fluid_Cloud_Position;
    var Fluid_Cloud_Position_Offset = config.Fluid_Cloud_Position_Offset;
    var Use_https_keyword_list = config.Use_https_keyword_list;
    var Extractioncode_Keyword_list = config.Extractioncode_Keyword_list;
    var Window_Configuration = config.Window_Configuration;
    var Launch_Windowing_Mode = config.Launch_Windowing_Mode;
    var Fluid_Cloud_timeout = config.Fluid_Cloud_timeout;
    var defaultBrowser = config.browser;
    var allowChar = config.allowChar;
    var Browser_PackageName_BlackList = config.Browser_PackageName_BlackList;
    var show_Multiple_users = config.show_Multiple_users;
    var show_toast = config.show_toast;
    var extra_default_action = config.extra_default_action;
    var UserIds = getAllUserIds();
    Browser_PackageName_BlackList.push("android");
    Browser_PackageName_BlackList.push("com.nyehueh.fluidcloud");
    var CopiedText = readJsonFile(/* [vflow] */ FLUID_CLOUD_DIR + "/recordcopy.json").CopiedText;
    if (defaultBrowser == "自动" || isAppinstall(defaultBrowser, 0) == false) {
        defaultBrowser = getDefaultBrowserPackageName(context);
    }
    var RealDefaultBrowser = getDefaultBrowserPackageName(context);
    var LinkIdentified = RecognitionMain(input);
    if (CopiedText != false && LinkIdentified.length == 1 && LinkIdentified[0] == CopiedText) {
        RecordCopiedText(false);
    } else {
        RecordCopiedText(false);
        if (LinkIdentified.length > 0) {
            OpenMain(LinkIdentified, showFloatingPrompts);
        }
        else {
            nolinkMain(input, showFloatingPrompts);
        }
    }
}
