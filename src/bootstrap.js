// ============================================================================
// vFlow 流体云 · 引导脚本（贴进工作流的就是这一整段）
//
// 两件事：
//   1. **首次自足**：设备上缺产物（或主脚本坏了）⇒ 从 GitHub 官方 raw 拉全套
//      ⇒ **导入工作流 + 跑一次，就全就位**，不需要手动 push 任何文件。
//   2. **eval 主脚本**：完整脚本在 /sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js
//
// 更新逻辑（拉取 / 校验 / 原子写 / 增量合并）就**在本文件里**（见下半部分）：
// 用户 2026-10-09 定的形态 —— 放在工作流内部，导入即自足。
// ⚠️ 代价：**改更新逻辑要重新导入工作流**（不是 `adb push` 一个文件），
//    详见 docs/UPDATE.md §7。
//
// ⚠️ **本文件顶层直接跑**（末尾那道闸：自足检查 → 读主脚本 → **在顶层** eval 它），
//    不能包 IIFE —— 理由与文件末尾 `eval(VFLOW_MAIN_CODE)` 那段注释相同。
// ============================================================================

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

var VFLOW_SCRIPT_PATH = "/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js";

/** 配置目录 —— 与 `src/adapter.js` 的 `FLUID_CLOUD_DIR` **必须逐字一致**。 */
var VFLOW_CLOUD_DIR = "/sdcard/vFlow/fluid-cloud";

/** 远端基址 —— **只走 GitHub 官方 raw**，无镜像、无连通性探针（UPDATE.md §1 第 1/2 条）。 */
var VFLOW_UPDATE_BASE_URL = "https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/";

var VFLOW_UPDATE_URLS = {
    version: VFLOW_UPDATE_BASE_URL + "version",
    script: VFLOW_UPDATE_BASE_URL + "dist/vflow-fluid-cloud.js",
    rules: VFLOW_UPDATE_BASE_URL + "dist/rules.json",
    nolinkrules: VFLOW_UPDATE_BASE_URL + "dist/nolinkrules.json"
};

/**
 * HTTP 超时（**秒**）。
 * ⚠️ `vflow.network.http_request` 的 `timeout` 默认 **10 秒**，且它被同时用到
 *    connect / read / write / call 四个 OkHttp 超时上（`HttpRequestModule.kt:227-243`）
 *    ⇒ 拉 150 KB 主脚本时慢网会超时。这里显式给 30（UPDATE.md §6.3）。
 */
var VFLOW_UPDATE_TIMEOUT = 30;

/** 主脚本特征串 —— 校验「拿到/下载到的确实是我们的脚本」而不是 404 的 HTML。 */
var VFLOW_UPDATE_MAIN_MARK = "var FLUID_CLOUD_ACTION_CLICK";

/** 主脚本长度下界（与 `src/adapter.js` / 旧 bootstrap 的判据一致）。 */
var VFLOW_UPDATE_MAIN_MIN_LEN = 1000;

/** 「已是最新，要强制重新下载吗？」的两个选项。 */
var VFLOW_UPDATE_YES = "是";
var VFLOW_UPDATE_NO = "否";

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** 去首尾空白。手写而不用 String.prototype.trim —— 少一个引擎特性假设。 */
function vflowUpdateTrim(s) {
    return String(s).replace(/^\s+/, "").replace(/\s+$/, "");
}

/**
 * 读设备上的文本文件；不存在 / 读不了返回 null。
 *
 * ⚠️⚠️ **用 `BufferedReader` + `StringBuilder`，不要用 `java.util.Scanner`。**
 *    真机实测（2026-10-09）：`Scanner` + `useDelimiter("\\Z")` 读 148 KB 的主脚本
 *    **读不全**（`Scanner` 内部缓冲区有上限，超长 token 会被截断）——
 *    表现是「刚下载并写盘成功，回读却只有一小段 ⇒ 判成『脚本被截断』」。
 *    `core.js` 的 `readJsonFile` 用的就是 `BufferedReader`，那套**在真机上是好的**。
 */
function vflowUpdateReadLocal(path) {
    try {
        var file = new java.io.File(path);
        if (!file.exists()) return null;
        var reader = new java.io.BufferedReader(new java.io.InputStreamReader(
            new java.io.FileInputStream(file), "UTF-8"));
        var sb = new java.lang.StringBuilder();
        var chunk;
        var first = true;
        while ((chunk = reader.readLine()) !== null) {
            // ⚠️ 用 flag 而不是 `sb.length()` —— 少一个引擎/桩上的方法假设
            //    （离线 harness 的 StringBuilder 桩就没实现 length()）。
            if (!first) sb.append("\n");
            sb.append(chunk);
            first = false;
        }
        reader.close();
        return String(sb.toString());
    } catch (e) {
        return null;
    }
}

/** 写文本文件（自动建父目录）。**不是原子写** —— 原子写见 `vflowUpdateAtomicWrite`。 */
function vflowUpdateWriteLocal(path, text) {
    try {
        var file = new java.io.File(path);
        var parent = file.getParentFile();
        if (parent && !parent.exists()) parent.mkdirs();
        var writer = new java.io.FileWriter(file);
        writer.write(String(text));
        writer.close();
        return true;
    } catch (e) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// 纯函数（离线可测：不碰 IO、不碰网络）
// ---------------------------------------------------------------------------

/**
 * 主脚本内容校验。
 * @returns {string|null} null = 通过；否则是错误说明
 */
function vflowUpdateValidateMainScript(text) {
    if (typeof text !== "string") return "内容不是文本";
    if (text.length <= VFLOW_UPDATE_MAIN_MIN_LEN) return "内容过短（" + text.length + " 字符）";
    if (text.indexOf(VFLOW_UPDATE_MAIN_MARK) === -1) return "缺少特征串 " + VFLOW_UPDATE_MAIN_MARK;
    return null;
}

/**
 * 规则库 JSON 校验：合法 JSON + 是数组 + 非空 + 每项有非空 name。
 * @param {string} text
 * @param {string} label 用于错误文案（rules.json / nolinkrules.json）
 * @returns {string|null}
 */
function vflowUpdateValidateRulesJson(text, label) {
    var what = label || "规则库";
    if (typeof text !== "string" || text.length === 0) return what + "内容为空";
    var arr;
    try {
        arr = JSON.parse(text);
    } catch (e) {
        return what + "不是合法 JSON：" + e;
    }
    if (!Array.isArray(arr)) return what + "不是数组";
    if (arr.length === 0) return what + "是空数组";
    for (var i = 0; i < arr.length; i++) {
        var it = arr[i];
        if (it === null || typeof it !== "object" || Array.isArray(it) ||
            typeof it.name !== "string" || it.name === "") {
            return what + "第 " + (i + 1) + " 条缺少 name";
        }
    }
    return null;
}

/**
 * 版本号校验：非空、短（< 64 字符）、只含版本号字符。
 * @returns {string|null}
 */
function vflowUpdateValidateVersion(text) {
    if (typeof text !== "string") return "版本号不是文本";
    var v = vflowUpdateTrim(text);
    if (v.length === 0) return "版本号为空";
    if (v.length >= 64) return "版本号过长（" + v.length + " 字符）";
    if (!/^[0-9A-Za-z._+-]+$/.test(v)) return "版本号含非法字符：" + v;
    return null;
}

/**
 * 规则库增量合并（**按 name**，UPDATE.md §5.2）。
 *
 * 顺序（照上游 `reference/update.js:503-572` 的语义，必须确定 ——
 * 顺序会影响 `matchRules` 的命中结果）：
 *   1. **本地独有**的规则在前（`name` 不在远端里的），**顺序照本地原序**；
 *   2. **全部远端**规则在后（同名覆盖本地、远端新增追加），**顺序照远端原序**。
 *
 * ⚠️ **不做**上游那套「老格式规则转换」（`processRules` 里的字符串 → 新格式）——
 *    我们的 `src/rules/*.json` 已是新格式（UPDATE.md §5.2）。
 */
function vflowUpdateMergeRules(localArr, remoteArr) {
    var local = Array.isArray(localArr) ? localArr : [];
    var remote = Array.isArray(remoteArr) ? remoteArr : [];

    var remoteNames = {};
    for (var i = 0; i < remote.length; i++) {
        var rn = remote[i] && remote[i].name;
        if (typeof rn === "string") remoteNames[rn] = true;
    }

    var out = [];
    for (var j = 0; j < local.length; j++) {
        var ln = local[j] && local[j].name;
        if (typeof ln === "string" && !remoteNames[ln]) out.push(local[j]);
    }
    for (var k = 0; k < remote.length; k++) out.push(remote[k]);
    return out;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * HTTP GET —— 只走官方 raw，**不传任何代理参数**（= `proxy_mode` 默认 `follow_global`）。
 * ⚠️ `vflow.network.http_request` 对 **404 不抛异常**（任何状态码都返回 Success，
 *    `HttpRequestModule.kt:268-279`）⇒ **必须自己判 `status_code === 200`**（UPDATE.md §5.5）。
 *
 * @returns {{ok:boolean, status:number, body:string, error:string}}
 */
function vflowUpdateHttpGet(url) {
    var r;
    try {
        r = vflow.network.http_request({
            url: url,
            method: "GET",
            timeout: VFLOW_UPDATE_TIMEOUT
        });
    } catch (e) {
        return { ok: false, status: 0, body: "", error: "调用 HTTP 模块异常：" + e };
    }
    if (r === null || typeof r === "undefined") {
        return { ok: false, status: 0, body: "", error: "HTTP 模块没有返回" };
    }
    var status = Number(r.status_code);
    var body = (r.response_body === null || typeof r.response_body === "undefined")
        ? "" : String(r.response_body);
    if (status !== 200) {
        return { ok: false, status: status, body: body, error: "HTTP " + status };
    }
    return { ok: true, status: 200, body: body, error: "" };
}

// ---------------------------------------------------------------------------
// 原子写
// ---------------------------------------------------------------------------

/**
 * 原子写：写 `<目标>.tmp` → 校验 → `renameTo` 覆盖目标（UPDATE.md §5.3）。
 *
 * ⚠️ **不用 `vflow.data.file_operation`**：它是 `FileOutputStream(file, !overwrite)`
 *    **直接截断原文件**，且**没有 rename 操作**（UPDATE.md §5.3）。
 * ⚠️ **任何失败都不动 `target`**：只删掉 `.tmp`、返回错误说明。
 *    特别是 `renameTo` 返回 false 时 —— **不**做「先 delete 再 rename」那种
 *    破坏原子的兜底（UPDATE.md 里明确不要）。
 *
 * @param {string} target
 * @param {string} content
 * @param {function(string):(string|null)} [validateFn]
 * @returns {string|null} null = 成功；否则是错误说明
 */
function vflowUpdateAtomicWrite(target, content, validateFn) {
    var tmp = target + ".tmp";

    if (!vflowUpdateWriteLocal(tmp, content)) return "写临时文件失败：" + tmp;

    if (typeof validateFn === "function") {
        var err = validateFn(content);
        if (err !== null) {
            try { new java.io.File(tmp).delete(); } catch (e) { /* 尽力而为 */ }
            return err;
        }
    }

    var ok = false;
    try {
        ok = new java.io.File(tmp).renameTo(new java.io.File(target));
    } catch (e) {
        ok = false;
    }
    if (!ok) {
        try { new java.io.File(tmp).delete(); } catch (e) { /* 尽力而为 */ }
        return "重命名失败（原文件未改动）：" + target;
    }
    return null;
}

// ---------------------------------------------------------------------------
// 更新主流程
// ---------------------------------------------------------------------------

/**
 * 失败提示 —— **必须显式弹**，且走 `vflow.device.toast`。
 *
 * ⚠️ 这里**不能**用主脚本的 `showToast`：它受全局 `show_toast` 开关控制，
 *    用户把提示关掉时**失败信息会被吞**（那正是 UPDATE.md §8 第 11 条要防的
 *    「点了检查更新什么都没发生」）。也**不能**用 `VFLOW_ADAPTER.toast` ——
 *    那要等主脚本加载之后才存在，而首次自足失败时主脚本**还没有**。
 *    ⇒ 直接调 `vflow.device.toast`（它是模块桥，最早可用）。
 */
function vflowUpdateFail(msg) {
    var text = "流体云更新失败：" + msg;
    try { console.log("[fluid-cloud] " + text); } catch (e) { /* 忽略 */ }
    try {
        vflow.device.toast({ message: text });
    } catch (e) { /* 提示不出来也不能让脚本崩在这里 */ }
}

/**
 * 同步一份规则库：拉 → 校验 → 与本地按 name 合并 → 原子写。
 * @returns {string} "" = 成功；否则是错误说明（供调用方汇总成一条提示）
 */
function vflowUpdateSyncRulesFile(url, fileName, label) {
    var r = vflowUpdateHttpGet(url);
    if (!r.ok) return label + "拉取失败（" + r.error + "）";

    var verr = vflowUpdateValidateRulesJson(r.body, label);
    if (verr !== null) return verr;

    var remoteArr;
    try {
        remoteArr = JSON.parse(r.body);
    } catch (e) {
        return label + "解析失败：" + e;
    }

    var localText = vflowUpdateReadLocal(VFLOW_CLOUD_DIR + "/" + fileName);
    var localArr = [];
    if (localText !== null) {
        try {
            var parsed = JSON.parse(localText);
            if (Array.isArray(parsed)) localArr = parsed;
        } catch (e) {
            // 本地读坏了 ⇒ 当空（远端整份写进去）。这不是失败：规则库本来就可能不存在
            // （首装），而远端那份是权威的。
            localArr = [];
        }
    }

    var merged = vflowUpdateMergeRules(localArr, remoteArr);
    var w = vflowUpdateAtomicWrite(VFLOW_CLOUD_DIR + "/" + fileName, JSON.stringify(merged, null, 2), function (t) {
        return vflowUpdateValidateRulesJson(t, label);
    });
    if (w !== null) return label + "写入失败（" + w + "）";
    return "";
}

/**
 * 手动「检查更新」主流程（UPDATE.md §4.1 / §4.2）。
 *
 * 顺序要点：
 *   - **拉主脚本失败 ⇒ 后面两份都不拉**（避免「新规则 + 旧脚本」）；
 *   - 规则两份**逐份独立**，失败**不整体回滚**（半新半旧的代价只是「下次再点一次」）；
 *   - **`version` 最后写** —— 它是「本次完整成功」的标志，中途失败 ⇒ 下次重来，幂等。
 */
function vflowUpdateRun() {
    var dir = VFLOW_CLOUD_DIR;

    // 1. 本地版本
    var localVer = vflowUpdateTrim(vflowUpdateReadLocal(dir + "/version") || "");

    // 2. 远端版本
    var rv = vflowUpdateHttpGet(VFLOW_UPDATE_URLS.version);
    if (!rv.ok) {
        vflowUpdateFail("拉取版本号失败（" + rv.error + "）—— 本地文件未改动");
        return;
    }
    var vErr = vflowUpdateValidateVersion(rv.body);
    if (vErr !== null) {
        vflowUpdateFail("远端版本号异常（" + vErr + "）—— 本地文件未改动");
        return;
    }
    var remoteVer = vflowUpdateTrim(rv.body);

    // 3. 版本闸（只做**字符串相等**比较，不解析版本段 —— UPDATE.md §4.3）
    //    ⚠️ 两边都 trim 后比：本机（core.autocrlf=true）推上去的 version 带 CRLF，
    //       而 GitHub raw 给的是 LF ⇒ 不 trim 会**永远不相等**（实现时发现）。
    if (remoteVer === localVer) {
        var answer = vflowUpdateAsk(
            [VFLOW_UPDATE_YES, VFLOW_UPDATE_NO],
            "已是最新（" + localVer + "）。要强制重新下载吗？"
        );
        if (answer !== VFLOW_UPDATE_YES) {
            vflowUpdateInfo("已取消，未做任何改动");
            return;
        }
    }

    // 4. 主脚本（整份覆盖）
    var rs = vflowUpdateHttpGet(VFLOW_UPDATE_URLS.script);
    if (!rs.ok) {
        vflowUpdateFail("拉取主脚本失败（" + rs.error + "）—— 本地文件未改动");
        return;
    }
    var sErr = vflowUpdateAtomicWrite(
        dir + "/vflow-fluid-cloud.js", rs.body, vflowUpdateValidateMainScript
    );
    if (sErr !== null) {
        vflowUpdateFail("主脚本写入失败（" + sErr + "）—— 本地文件未改动");
        return;
    }

    // 5/6. 规则两份（逐份独立；失败不中断、不回滚）
    var rulesErr = vflowUpdateSyncRulesFile(VFLOW_UPDATE_URLS.rules, "rules.json", "rules.json");
    var nolinkErr = vflowUpdateSyncRulesFile(VFLOW_UPDATE_URLS.nolinkrules, "nolinkrules.json", "nolinkrules.json");

    var from = localVer === "" ? "（无）" : localVer;
    var failed = [];
    if (rulesErr !== "") failed.push(rulesErr);
    if (nolinkErr !== "") failed.push(nolinkErr);

    // ⚠️⚠️ 规则有失败 ⇒ **不写 version**（UPDATE.md §4.2）：version 是「本次完整成功」
    //    的标志，不写 ⇒ 下次点更新仍走完整流程 ⇒ **幂等**。
    if (failed.length > 0) {
        // ⚠️ 主脚本**已经覆盖了** ⇒ 必须显式说清「半新半旧」，否则用户以为全好了
        vflowUpdateFail("脚本已更新，但规则未更新：" + failed.join("；") + "，请重试");
        return;
    }

    // 7. 版本号 —— **最后写**（本次完整成功的标志）
    var vw = vflowUpdateAtomicWrite(dir + "/version", rv.body, vflowUpdateValidateVersion);

    // 8. 结果提示
    if (vw !== null) {
        // ⚠️ 版本号没写上 ⇒ 下次会重复更新一遍（幂等，无害）
        vflowUpdateFail("更新完成但版本号没写上（" + vw + "），下次会重来");
        return;
    }
    // ⚠️ 「下次执行生效」必须打：主脚本已经被 eval 进内存了
    //    ⇒ 覆盖文件**不影响本次执行**。不说清楚用户会以为「点了更新没生效」。
    vflowUpdateInfo("更新完成（" + from + " → " + remoteVer + "），下次执行生效");
}

// ---------------------------------------------------------------------------
// 与主脚本的接口（**只有这一处依赖**）
//
// `vflowUpdateInfo` / `vflowUpdateAsk` 优先用主脚本的 `showToast` / `showOptionsDialog`，
// 主脚本还没加载（首次自足阶段）时**自己兜底** —— 那时 `VFLOW_ADAPTER` 还不存在。
//
// ⚠️ 这两个名字**必须在主脚本里存在**（`src/core.js` 定义）。它们被改名 ⇒
//    这里静默退化到 `vflow.device.toast`（功能还在，只是少了「不显示提示」的开关）。
// ---------------------------------------------------------------------------

function vflowUpdateInfo(msg) {
    if (typeof showToast === "function") {
        showToast(msg);
        return;
    }
    try { vflow.device.toast({ message: msg }); } catch (e) { /* 忽略 */ }
}

function vflowUpdateAsk(options, title) {
    if (typeof showOptionsDialog === "function") {
        return showOptionsDialog(options, title);
    }
    // 兜底：没有主脚本的界面时，不阻塞、按「否」处理（安全方向：什么都不做）
    try { vflow.device.toast({ message: title + "（" + options.join(" / ") + "）" }); } catch (e) { /* 忽略 */ }
    return options[options.length - 1];
}

// ---------------------------------------------------------------------------
// 首次自足
// ---------------------------------------------------------------------------

/** 主脚本是否可用（存在 **且** 内容校验通过）。 */
function vflowBootstrapMainOk() {
    var text = vflowUpdateReadLocal(VFLOW_SCRIPT_PATH);
    return vflowUpdateValidateMainScript(text) === null;
}

/** 某份规则库是否可用（存在 **且** 非空）。⚠️ 不能只看「文件在不在」（UPDATE.md §5.4）。 */
function vflowBootstrapRulesOk(path) {
    try {
        var f = new java.io.File(path);
        return f.exists() && f.length() > 0;
    } catch (e) {
        return false;
    }
}

/**
 * 首次自足：缺什么拉什么（**整组**拉，见下）。
 *
 * ⚠️⚠️ **判据不能只看「文件在不在」**：主脚本存在但被截断/写坏时，直接 eval 会
 *    语法错误 ⇒ **整个工作流从此崩**。这里用 `vflowUpdateValidateMainScript` 判，
 *    于是 bootstrap 成了**主脚本之外的那一层** —— 主脚本坏掉时它仍能跑并修好它。
 *    （这正是把更新逻辑搬进工作流的**主要收益**，见 UPDATE.md §7。）
 *
 * ⚠️ **要拉就整组拉**（四份都拉）：主脚本与两份规则库必须**同一版**
 *    （新脚本读旧规则格式会静默识别不出）。缺一份却只补一份，会造出「半新半旧」。
 *
 * @returns {string} "" = 已经可用或已修好；否则是错误说明（调用方据此中止）
 */
function vflowBootstrapEnsureFiles() {
    var scriptOk = vflowBootstrapMainOk();
    var rulesOk = vflowBootstrapRulesOk(VFLOW_CLOUD_DIR + "/rules.json");
    var nolinkOk = vflowBootstrapRulesOk(VFLOW_CLOUD_DIR + "/nolinkrules.json");

    if (scriptOk && rulesOk && nolinkOk) return ""; // 齐全 ⇒ 不联网

    var missing = [];
    if (!scriptOk) missing.push("主脚本");
    if (!rulesOk) missing.push("rules.json");
    if (!nolinkOk) missing.push("nolinkrules.json");

    var rs = vflowUpdateHttpGet(VFLOW_UPDATE_URLS.script);
    if (!rs.ok) return "拉取主脚本失败（" + rs.error + "）";
    // ⚠️ 打长度：148 KB 的响应体经 JS 桥**可能被截断**（UPDATE.md §10 第 3 项）。
    //    不打这一条，截断的表现就是「下载成功但校验不过」，看不出是哪种。
    try {
        console.log("[fluid-cloud] 远端主脚本 " + rs.body.length + " 字符（本地产物 "
            + (vflowUpdateReadLocal(VFLOW_SCRIPT_PATH) || "").length + " 字符）");
    } catch (e) { /* 忽略 */ }
    var sErr = vflowUpdateValidateMainScript(rs.body);
    if (sErr !== null) return "远端主脚本校验不过：" + sErr;

    var rv = vflowUpdateHttpGet(VFLOW_UPDATE_URLS.version);
    if (!rv.ok) return "拉取版本号失败（" + rv.error + "）";
    var vErr = vflowUpdateValidateVersion(rv.body);
    if (vErr !== null) return "远端版本号异常：" + vErr;

    var rr = vflowUpdateHttpGet(VFLOW_UPDATE_URLS.rules);
    if (!rr.ok) return "拉取 rules.json 失败（" + rr.error + "）";
    var rrErr = vflowUpdateValidateRulesJson(rr.body, "rules.json");
    if (rrErr !== null) return rrErr;

    var rn = vflowUpdateHttpGet(VFLOW_UPDATE_URLS.nolinkrules);
    if (!rn.ok) return "拉取 nolinkrules.json 失败（" + rn.error + "）";
    var rnErr = vflowUpdateValidateRulesJson(rn.body, "nolinkrules.json");
    if (rnErr !== null) return rnErr;

    // 四份都拿到了 ⇒ 逐份原子写（每份失败都不动原文件；此时一律中止并报错）
    var e1 = vflowUpdateAtomicWrite(VFLOW_CLOUD_DIR + "/vflow-fluid-cloud.js", rs.body, vflowUpdateValidateMainScript);
    if (e1 !== null) return "主脚本写入失败：" + e1;
    // ⚠️ 写盘后**回读一遍**：`renameTo` 在 /sdcard（sdcardfs）上的行为未实测
    //    （UPDATE.md §10 第 1 项），而这里正是它的第一现场 —— 回读长度不符
    //    要**立刻**报出来，别等到「脚本被截断」那句。
    try {
        var backLen = (vflowUpdateReadLocal(VFLOW_SCRIPT_PATH) || "").length;
        console.log("[fluid-cloud] 回读主脚本 " + backLen + " 字符");
        if (backLen !== rs.body.length) {
            return "写入后回读长度不符（" + backLen + " ≠ " + rs.body.length + "）—— 可能是 /sdcard 上的写入/改名问题";
        }
    } catch (e) { /* 忽略 */ }

    // ⚠️ 规则库这里**整份覆盖**（不按 name 合并）：本分支的前提是「本地不可用」
    //    （不存在或为空）⇒ 没有「本地独有规则」要保留。手动「检查更新」那条路
    //    才做增量合并（`vflowUpdateSyncRulesFile`）。
    var e2 = vflowUpdateAtomicWrite(VFLOW_CLOUD_DIR + "/rules.json", rr.body, function (t) {
        return vflowUpdateValidateRulesJson(t, "rules.json");
    });
    if (e2 !== null) return "rules.json 写入失败：" + e2;

    var e3 = vflowUpdateAtomicWrite(VFLOW_CLOUD_DIR + "/nolinkrules.json", rn.body, function (t) {
        return vflowUpdateValidateRulesJson(t, "nolinkrules.json");
    });
    if (e3 !== null) return "nolinkrules.json 写入失败：" + e3;

    var e4 = vflowUpdateAtomicWrite(VFLOW_CLOUD_DIR + "/version", rv.body, vflowUpdateValidateVersion);
    if (e4 !== null) return "版本号写入失败：" + e4;

    try {
        console.log("[fluid-cloud] 首次初始化完成（缺 " + missing.join(" / ") + "）");
    } catch (e) { /* 忽略 */ }
    return "";
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 自足检查 → 读主脚本 → 返回它的全文。
 *
 * ⚠️⚠️ **只返回，不 eval** —— eval 必须发生在**本文件的顶层**（见下面那道闸）。
 *    把它放进函数里，`var` 会落在**函数作用域** ⇒ 主脚本的顶层声明
 *    （`input` / `tiggerTag` / `core.js` 的一堆全局）**出不去**，
 *    表现是「脚本加载了但什么都没发生」（**静默**）。
 *    （离线测试的 Node `vm` 与真机 Rhino 在这一点上行为一致，两者都测得到。）
 *
 * ⚠️⚠️ **失败一律显式报错并中止**（`throw`）：静默的表现是
 *    「复制了链接，什么都没发生」，用户完全无从判断是脚本没加载、规则没命中、
 *    还是功能坏了（UPDATE.md §8）。
 */
function vflowBootstrapLoad() {
    var ensureErr = vflowBootstrapEnsureFiles();
    if (ensureErr !== "") {
        vflowUpdateFail("首次初始化失败：" + ensureErr);
        throw new Error(
            "流体云：首次初始化失败 —— " + ensureErr + "\n" +
            "请检查网络/代理，或手动把 dist/ 下的产物复制到 " + VFLOW_CLOUD_DIR + "/"
        );
    }

    var code = vflowUpdateReadLocal(VFLOW_SCRIPT_PATH);
    if (vflowUpdateValidateMainScript(code) !== null) {
        vflowUpdateFail("脚本文件异常（可能被截断）：" + VFLOW_SCRIPT_PATH);
        throw new Error("流体云：脚本文件异常 " + VFLOW_SCRIPT_PATH + " —— 可能被截断");
    }
    return code;
}

// ---------------------------------------------------------------------------
// 闸
//
// ⚠️⚠️ **默认执行**（工作流里那段就是要跑）；离线测试要在**不联网、不 eval** 的
//    前提下单独测纯函数 ⇒ 测试侧先设 `VFLOW_BOOTSTRAP_DISABLED = true`。
//
//    ⚠️ 语义与上一版的 `VFLOW_UPDATE_ENABLED` **相反**（那个是「设 true 才跑」）——
//       别搞混：bootstrap 是**入口**，默认就跑；update 逻辑是**被调用的**。
// ---------------------------------------------------------------------------
if (typeof VFLOW_BOOTSTRAP_DISABLED === "undefined" || !VFLOW_BOOTSTRAP_DISABLED) {
    var VFLOW_MAIN_CODE = vflowBootstrapLoad();

    // ⚠️⚠️ **eval 必须在脚本顶层**（不能包 IIFE、不能放进函数）——
    //    core.js 的主入口是它自己的**顶层代码**（那一段 if (DebugMode == false ...)），
    //    直接 eval 会让它在**当前作用域**里跑，var 声明也落在脚本全局，
    //    与「整份脚本直接粘贴」的行为**完全一致**。
    //    包一层函数会让 eval 变成在那个函数作用域里求值 ⇒ 主脚本的全局**出不去**
    //    （见 `vflowBootstrapLoad` 的注释）；换成 new Function(code)() 则**会坏**
    //    （访问不到 JsExecutor 注入的 inputs / vars / context）。
    //
    // ⚠️ 由此形成**双向可见**：主脚本能读到本文件的 `vflowUpdate*`（core.js 的
    //    「检查更新」直接调 `vflowUpdateRun()`），本文件也能读到主脚本的
    //    `showToast` / `showOptionsDialog`（见上面的 vflowUpdateInfo/Ask）。
    eval(VFLOW_MAIN_CODE);
}
