// ============================================================================
// vFlow 流体云 · 引导脚本（贴进工作流的就是这一小段）
//
// 完整脚本在设备上：/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js
//
// 更新脚本（**不需要**重新创建工作流）：
//     adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/
//
// 工作流里放**本文件全文**；`vflow-fluid-cloud.js` 是 push 到设备的。
// ============================================================================

var VFLOW_SCRIPT_PATH = "/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js";

// 读完整脚本。用 java.io 而不是 vflow 模块 —— 这一段必须在
// 任何 vflow.* 可用之前就能跑，且少一层依赖。
var vflowCode;
try {
    var vflowFile = new java.io.File(VFLOW_SCRIPT_PATH);
    if (!vflowFile.exists()) {
        throw new Error("脚本文件不存在：" + VFLOW_SCRIPT_PATH);
    }
    var vflowScanner = new java.util.Scanner(vflowFile, "UTF-8").useDelimiter("\\Z");
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
