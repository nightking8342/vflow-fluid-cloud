// ============================================================================
// vFlow 流体云 · 更新器（构建产物，独立文件）
//
// ⚠️ 不要手改本文件 —— 改 src/update.js 后重跑：
//      node src/generate.js
//
// ⚠️ 它**不并进主脚本**（dist/vflow-fluid-cloud.js 只有 adapter + core）。
//    由 core.js 的「检查更新」菜单项读它并 eval。
// ⚠️ **更新流程不会更新它自己** —— 改了它要手动推：
//      adb push dist/update.js /sdcard/vFlow/fluid-cloud/
// ============================================================================

// ============================================================================
// vFlow 流体云 · 更新器（**独立文件**，不并进主脚本）
//
// 谁来跑：`src/core.js` 的「设置」菜单点【检查更新】→ 读设备上的
//         `/sdcard/vFlow/fluid-cloud/update.js` → `eval`。
//         ⇒ 本文件**顶层直接开跑**（`vflowUpdateRun()` 由末尾那道闸调用），
//           没有「入口函数名」这种契约 —— 契约只有「路径」一个（见 docs/UPDATE.md §7.4）。
//
// ⚠️⚠️ **本文件被 eval 进与 core.js 同一个作用域**（UPDATE.md §7.4 约束 2）。
//    顶层 `var` / `function` 会落到**同一份全局** ⇒ 一律加 `vflowUpdate` 前缀，
//    免得用 `code` / `validate` 这种通用名把 core.js 的同名全局**悄悄覆盖**掉。
//
// ⚠️ **它更新不了自己**（UPDATE.md §7.3，用户定）：更新流程**不拉、不写**本文件。
//    要改它 ⇒ 手动 `adb push dist/update.js /sdcard/vFlow/fluid-cloud/`。
//
// 允许引用的主脚本全局（白名单，见 UPDATE.md §7.4 与 docs/DESIGN.md）：
//   FLUID_CLOUD_DIR / VFLOW_ADAPTER / readJsonFile / showToast / showOptionsDialog
//
// ⚠️ **失败路径用 `VFLOW_ADAPTER.toast`，成功路径用 `showToast`**：
//    前者不经过全局 `show_toast` 开关（core.js 的 showToast 受它控制）——
//    用户把 `show_toast` 关掉时，失败提示**不能**被吞掉（否则正是 UPDATE.md §8 第 11 条
//    要防的「点了检查更新什么都没发生」）。这条是**实现时定**的（见 docs/UPDATE.md §3.1）。
//
// 决策来源见 docs/UPDATE.md §1（「谁定的」逐条标注）。
// ============================================================================

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

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
 *    ⇒ 拉 144 KB 主脚本时慢网会超时。这里显式给 30（UPDATE.md §6.3）。
 */
var VFLOW_UPDATE_TIMEOUT = 30;

/** 主脚本特征串 —— 校验「下下来的确实是我们的脚本」而不是 404 的 HTML（UPDATE.md §5.5）。 */
var VFLOW_UPDATE_MAIN_MARK = "var FLUID_CLOUD_ACTION_CLICK";

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

// ---------------------------------------------------------------------------
// 纯函数（离线可测：不碰 IO、不碰网络）
// ---------------------------------------------------------------------------

/**
 * 主脚本内容校验。
 * @returns {string|null} null = 通过；否则是错误说明
 */
function vflowUpdateValidateMainScript(text) {
    if (typeof text !== "string") return "内容不是文本";
    if (text.length <= 1000) return "内容过短（" + text.length + " 字符）";
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
// IO
// ---------------------------------------------------------------------------

/**
 * 读设备上的文本文件（薄封装，方便测试与统一 null 语义）。
 * @returns {string|null}
 */
function vflowUpdateReadLocal(path) {
    try {
        return VFLOW_ADAPTER.readText(path);
    } catch (e) {
        return null;
    }
}

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

    if (typeof VFLOW_ADAPTER === "undefined" || !VFLOW_ADAPTER) return "平台桥不可用";
    if (!VFLOW_ADAPTER.writeText(tmp, content)) return "写临时文件失败：" + tmp;

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
// 主流程
// ---------------------------------------------------------------------------

/** 失败提示 —— **必须显式弹**，且走 `VFLOW_ADAPTER.toast`（不受 `show_toast` 开关影响）。 */
function vflowUpdateFail(msg) {
    if (typeof VFLOW_ADAPTER !== "undefined" && VFLOW_ADAPTER) {
        VFLOW_ADAPTER.toast("流体云更新失败：" + msg);
        VFLOW_ADAPTER.log("更新失败：" + msg);
    }
}

/**
 * 同步一份规则库：拉 → 校验 → 与本地按 name 合并 → 原子写。
 * @returns {string} "" = 成功；否则是错误说明（供调用方汇总成一条提示）
 */
function vflowUpdateSyncRulesFile(dir, url, fileName, label) {
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

    var localArr = null;
    try {
        localArr = readJsonFile(dir + "/" + fileName);
    } catch (e) {
        // 本地读不到 / 读坏了 ⇒ 当空数组（远端整份写进去）。这不是失败：
        // 规则库本来就可能不存在（首装），而远端那份是权威的。
        localArr = null;
    }

    var merged = vflowUpdateMergeRules(Array.isArray(localArr) ? localArr : [], remoteArr);
    var w = vflowUpdateAtomicWrite(dir + "/" + fileName, JSON.stringify(merged, null, 2), function (t) {
        return vflowUpdateValidateRulesJson(t, label);
    });
    if (w !== null) return label + "写入失败（" + w + "）";
    return "";
}

/**
 * 更新主流程（UPDATE.md §4.1 / §4.2）。
 *
 * 顺序要点：
 *   - **拉主脚本失败 ⇒ 后面两份都不拉**（避免「新规则 + 旧脚本」）；
 *   - 规则两份**逐份独立**，失败**不整体回滚**（半新半旧的代价只是「下次再点一次」）；
 *   - **`version` 最后写** —— 它是「本次完整成功」的标志，中途失败 ⇒ 下次重来，幂等。
 */
function vflowUpdateRun() {
    var dir = FLUID_CLOUD_DIR;

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
    //       而 GitHub raw 给的是 LF ⇒ 不 trim 会**永远不相等**（实现时发现，见交付说明）。
    if (remoteVer === localVer) {
        var answer = showOptionsDialog(
            [VFLOW_UPDATE_YES, VFLOW_UPDATE_NO],
            "已是最新（" + localVer + "）。要强制重新下载吗？"
        );
        if (answer !== VFLOW_UPDATE_YES) {
            showToast("已取消，未做任何改动");
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
    var rulesErr = vflowUpdateSyncRulesFile(
        dir, VFLOW_UPDATE_URLS.rules, "rules.json", "rules.json"
    );
    var nolinkErr = vflowUpdateSyncRulesFile(
        dir, VFLOW_UPDATE_URLS.nolinkrules, "nolinkrules.json", "nolinkrules.json"
    );

    var from = localVer === "" ? "（无）" : localVer;
    var failed = [];
    if (rulesErr !== "") failed.push(rulesErr);
    if (nolinkErr !== "") failed.push(nolinkErr);

    // ⚠️⚠️ 规则有失败 ⇒ **不写 version**（UPDATE.md §4.2）：version 是「本次完整成功」
    //    的标志，不写 ⇒ 下次点更新仍走完整流程 ⇒ **幂等**。
    //    （第一版漏了这一步，把 version 无条件写了 —— 下次就不会重来，测试抓到了。）
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
    // ⚠️ 「下次执行生效」必须打：bootstrap 已把整份主脚本 eval 进内存了
    //    ⇒ 覆盖文件**不影响本次执行**。不说清楚用户会以为「点了更新没生效」。
    showToast("更新完成（" + from + " → " + remoteVer + "），下次执行生效");
}

// ---------------------------------------------------------------------------
// 闸
//
// ⚠️⚠️ 必须是**闸**而不是裸顶层语句 —— 否则离线测试一 `require` / `eval` 本文件
//    就会去发网络请求（UPDATE.md §7.4 那段「代价」里点名的）。
//    core.js 侧在 eval 前设 `VFLOW_UPDATE_ENABLED = true`（同一作用域，直接可见）。
// ---------------------------------------------------------------------------
if (typeof VFLOW_UPDATE_ENABLED !== "undefined" && VFLOW_UPDATE_ENABLED) {
    vflowUpdateRun();
}
