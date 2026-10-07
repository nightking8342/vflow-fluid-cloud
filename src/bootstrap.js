#!/usr/bin/env node
/**
 * 生成「引导脚本」（bootstrap）—— 真正贴进 vFlow 工作流的那一小段。
 *
 * ## 为什么需要它
 *
 * vFlow 的远程 API 有 **24 KB 的请求体上限**（`BaseHandler.readBody` 的
 * `CharArray(contentLength)` —— 见 DESIGN.md §4.6），而完整脚本是 **113 KB**。
 * 直接 POST 进不去。
 *
 * ⇒ 引导脚本只做一件事：**从设备上的文件读完整脚本并 eval**。
 *   工作流 JSON 因此只有几百字节，而脚本改动用 `adb push` 更新，
 *   **不用重新调 API、不用改工作流**。
 *
 * ## ⚠️ eval 的作用域（这是本方案成立的关键）
 *
 * `eval(code)` 是**直接 eval** —— 代码在**调用点的作用域**里求值。
 * 在脚本顶层调用时，`code` 里的 `var` 声明进入**脚本全局作用域**，
 * 于是 core.js 的 `RecognitionMain` 等函数、以及 adapter 定义的 `input` /
 * `tiggerTag` 全部成为全局，core.js 自己那份 `if (DebugMode == false …)` 主入口
 * 也照常执行。**与整份脚本直接粘贴的行为一致。**
 *
 * ⚠️ 若换成**间接 eval**（`(0, eval)(code)` 或 `var e = eval; e(code)`），
 *    code 会在**全局作用域**（而非当前作用域）求值 —— 本场景下结果相同，
 *    但**不要改成 `new Function(code)()`**：那样 code 里访问不到
 *    JsExecutor 注入的 `inputs` / `vars` / `context`（它们在脚本作用域上，不在真全局上），
 *    报错是 `ReferenceError: inputs is not defined`，而位置在 core.js 深处。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'bootstrap.js');

/** 设备上完整脚本的路径（与 adapter.js 的 FLUID_CLOUD_DIR 同源）。 */
const SCRIPT_PATH = '/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js';

const BOOTSTRAP = `// ============================================================================
// vFlow 流体云 · 引导脚本（贴进工作流的就是这一小段）
//
// 完整脚本在设备上：${SCRIPT_PATH}
// 更新脚本：adb push fluid-cloud/dist/vflow-fluid-cloud.js ${SCRIPT_PATH}
//          （**不需要**重新创建工作流）
//
// ⚠️ 本文件是构建产物，由 fluid-cloud/src/bootstrap.js 生成。
// ============================================================================

var VFLOW_SCRIPT_PATH = ${JSON.stringify(SCRIPT_PATH)};

// 读完整脚本。用 java.io 而不是 vflow 模块 —— 这一段必须在
// 任何 vflow.* 可用之前就能跑，且少一层依赖。
var vflowCode;
try {
    var vflowFile = new java.io.File(VFLOW_SCRIPT_PATH);
    if (!vflowFile.exists()) {
        throw new Error("脚本文件不存在：" + VFLOW_SCRIPT_PATH);
    }
    var vflowScanner = new java.util.Scanner(vflowFile, "UTF-8").useDelimiter("\\\\Z");
    vflowCode = vflowScanner.hasNext() ? String(vflowScanner.next()) : "";
    vflowScanner.close();
} catch (e) {
    // ⚠️ 这里必须显式报错。静默失败的表现是「复制了链接，什么都没发生」——
    //    用户完全无从判断是脚本没加载、规则没命中、还是模块调不通。
    throw new Error("流体云：读取脚本失败 " + VFLOW_SCRIPT_PATH + " —— " + e);
}

if (!vflowCode || vflowCode.length < 1000) {
    throw new Error("流体云：脚本文件内容异常（" + (vflowCode ? vflowCode.length : 0) + " 字符）—— 可能 push 时被截断");
}

// ⚠️⚠️ **直接 eval，且必须在脚本顶层**（不能包 IIFE）——
//    core.js 的主入口是它自己的**顶层代码**（那一段 if (DebugMode == false ...)），
//    直接 eval 会让它在**当前作用域**里跑，var 声明也落在脚本全局，
//    与「整份脚本直接粘贴」的行为**完全一致**。
//    包一层函数会让 eval 变成在那个函数作用域里求值，虽然本场景结果相同，
//    但多一层不必要的间接；换成 new Function(code)() 则**会坏**
//    （访问不到 JsExecutor 注入的 inputs / vars / context）。
eval(vflowCode);
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, BOOTSTRAP, 'utf8');
console.log(`[ok] ${path.relative(ROOT, OUT)}  ${BOOTSTRAP.split('\n').length} 行 / ${BOOTSTRAP.length} 字符`);
