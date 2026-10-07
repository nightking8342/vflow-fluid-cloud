#!/usr/bin/env node
/**
 * 把上游 core.js 补丁成 vFlow 版。
 *
 * 输入： vendor/core.js（上游原样，**不改**）
 * 输出： dist/core.vflow.js（补丁产物）
 *
 * ## 为什么用脚本而不是手工改
 *
 * 上游会持续更新（当前 3.2.3）。手工改一份 2810 行的文件，下次同步必然靠人肉 diff。
 * 这里把「vFlow 需要改什么」固化成补丁清单，每一条都带**出现次数的断言** ——
 * 上游改了这些地方而补丁没跟上时，构建**当场失败**，而不是产出一份静默半残的脚本。
 *
 * ## 补丁清单（全量）
 *
 * | # | 位置 | 原 | 改 |
 * |---|---|---|---|
 * | 1 | 3 行 importClass | `Packages.tornaco.apps.shortx...` | 删除 |
 * | 2 | `showToast` 函数体 | `shortx.executeAction(ShowToast…)` | `vflow.device.toast` |
 * | 3 | `CopyText` 函数体 | `shortx.executeAction(WriteClipboard…)` | `vflow.system.set_clipboard` |
 * | 4 | `OpenMain` 里的 shell | `shortx.executeAction(ShellCommand…)` | `vflow.shizuku.shell_command` |
 * | 5 | 9 处路径 | `ShortX_Path + "/data/Fluid_Cloud_Island"` | `FLUID_CLOUD_DIR` |
 *
 * ⚠️ **只有这 5 类**。core.js 的 2000 多行核心逻辑（规则匹配 / UI 构建 / 岛参数）
 * 是纯 JS + 公开 Android API，**一行都不用动**。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'vendor', 'core.js');
const OUT = path.join(ROOT, 'dist', 'core.vflow.js');

/** 构建期断言：某段文本必须恰好出现 N 次。 */
function expectCount(text, needle, expected, label) {
    let count = 0;
    let idx = -1;
    while ((idx = text.indexOf(needle, idx + 1)) !== -1) count++;
    if (count !== expected) {
        throw new Error(
            `[补丁失败] ${label}\n` +
            `  期望出现 ${expected} 次，实际 ${count} 次\n` +
            `  片段：${JSON.stringify(needle.slice(0, 120))}\n` +
            `  ⇒ 上游 core.js 可能已改动该处。请核对 vendor/core.js 后更新 build.js 的补丁清单。`
        );
    }
}

/**
 * 替换一次，并断言**恰好替换了一处**。
 *
 * ⚠️ 判据是「命中次数 == 1」，不是「替换后文本变了」——
 * 后者在「一处都没匹配到」时也成立不了，但在**匹配到多处**时会静默只改第一处。
 */
function replaceExactlyOne(text, from, to, label) {
    expectCount(text, from, 1, label);
    return text.replace(from, to);
}

/**
 * 折叠空行后做替换。
 *
 * ⚠️⚠️ 上游 core.js 是**每行逻辑之间都插一个空行**的风格（实测：`var command = …`
 * 与 `.setCommand(…)` 之间隔着一个空行）。按自然写法拼多行片段会**必然匹配失败**，
 * 而失败信息只会说「没匹配到」——**指不到「是空行问题」**。
 * 故先折叠连续空行（`\n\n+` → `\n`）再匹配，替换完不还原。
 *
 * ⚠️ 折叠是**全局**的，会改变产物里所有代码的排版。这是**有意的**：
 * 产物是给 Rhino 读的，排版无意义；而保持原排版会让补丁片段脆弱到无法维护。
 */
function foldBlankLines(text) {
    return text.replace(/\n[ \t]*\n+/g, '\n');
}

function patch(source) {
    let s = foldBlankLines(source);

    // ---------------------------------------------------------------- 1. 删 import
    // 三行 ShortX protobuf 类的 import。删掉后 `ShowToast` / `WriteClipboard` /
    // `ShellCommand` 这三个符号不再存在 —— 下方三处调用点会被替换掉，
    // 若漏了任何一处，脚本运行时会抛 ReferenceError（**不会静默**）。
    const imports = [
        'importClass(Packages.tornaco.apps.shortx.core.proto.action.ShellCommand);',
        'importClass(Packages.tornaco.apps.shortx.core.proto.action.WriteClipboard);',
        'importClass(Packages.tornaco.apps.shortx.core.proto.action.ShowToast);',
    ];
    for (const line of imports) {
        expectCount(s, line, 1, '删除 ShortX import');
        s = s.split(line).join('');
    }

    // ------------------------------------------------------- 2. showToast
    s = replaceExactlyOne(
        s,
        'if (show_toast) {\n' +
        '        action = ShowToast.newBuilder().setMessage(text).build();\n' +
        '        shortx.executeAction(action);\n' +
        '    }',
        'if (typeof show_toast === "undefined" || show_toast) {\n' +
        '        VFLOW_ADAPTER.toast(text);\n' +
        '    }',
        'showToast 函数体'
    );

    // ------------------------------------------------------- 3. CopyText
    s = replaceExactlyOne(
        s,
        'var action = WriteClipboard.newBuilder()\n' +
        '        .setText(text)\n' +
        '        .build();\n' +
        '    shortx.executeAction(action);',
        'VFLOW_ADAPTER.setClipboard(text);',
        'CopyText 函数体'
    );

    // ------------------------------------------------------- 4. shell
    s = replaceExactlyOne(
        s,
        'var command = ShellCommand.newBuilder()\n' +
        '                    .setCommand("am start -d \\"" + runIns + "\\"").build();\n' +
        '                shortx.executeAction(command);',
        'VFLOW_ADAPTER.shell("am start -d \\"" + runIns + "\\"");',
        'OpenMain 的 shell 调用'
    );

    // ------------------------------------------------------- 5. 路径
    // 9 处 `ShortX_Path + "/data/Fluid_Cloud_Island/xxx.json"`。
    // ShortX_Path 是原平台的**多用户目录探测结果**（/data/system/shortx*/），
    // 在 vFlow（UID 10684）下 /data/system 不可写 ⇒ 整组路径换成 vFlow 自己的目录。
    expectCount(s, 'ShortX_Path + "/data/Fluid_Cloud_Island', 9, '配置目录路径');
    s = s.split('ShortX_Path + "/data/Fluid_Cloud_Island').join('FLUID_CLOUD_DIR + "');

    // ------------------------------------------------------- 自检：不应残留
    for (const leftover of ['shortx.executeAction', 'Packages.tornaco', 'ShortX_Path']) {
        if (s.includes(leftover)) {
            throw new Error(`[补丁失败] 产物中仍残留 ${leftover} —— 补丁清单不完整`);
        }
    }

    return s;
}

function main() {
    const raw = fs.readFileSync(SRC, 'utf8');

    // ⚠️ 上游文件是 **CRLF**（作者在 Windows 上编辑，实测 2810 个 CRLF / 0 个裸 LF）。
    //    先归一成 LF，否则下方所有多行片段匹配都会失败 ——
    //    而失败信息只会说「没匹配到」，**指不到「是行尾问题」**（实测踩过一次）。
    //    产物统一用 LF 输出。
    const source = raw.replace(/\r\n/g, '\n');

    const patched = patch(source);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });

    const header =
        '// ============================================================================\n' +
        '// vFlow 流体云 · core.vflow.js\n' +
        '//\n' +
        '// ⚠️ 本文件是**构建产物，不要手改**。\n' +
        '//    源：fluid-cloud/vendor/core.js（上游 nightking8342/shortx-Fluid_Cloud_Island）\n' +
        '//    补丁：fluid-cloud/src/build.js（5 类改动，每类都有出现次数断言）\n' +
        '//    重建：node fluid-cloud/src/build.js\n' +
        '//\n' +
        '// 运行时依赖（由 bootstrap.js 预先定义）：\n' +
        '//   VFLOW_ADAPTER  —— 平台桥（toast / setClipboard / shell / 读写文件）\n' +
        '//   FLUID_CLOUD_DIR —— 配置目录（绝对路径）\n' +
        '//   input          —— 本次触发的输入文本\n' +
        '//   tiggerTag      —— 触发器标签（剪切板 / QQ / 微信 / 附加）\n' +
        '// ============================================================================\n\n';

    fs.writeFileSync(OUT, header + patched, 'utf8');

    const lines = patched.split('\n').length;
    console.log(`[ok] ${path.relative(ROOT, OUT)}  ${lines} 行`);
    console.log(`[ok] 上游 core.js ${source.split('\n').length} 行 → 补丁后 ${lines} 行`);
}

main();
