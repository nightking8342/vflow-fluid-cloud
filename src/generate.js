#!/usr/bin/env node
/**
 * 把 src/ 下的源文件拼成**单文件** `dist/vflow-fluid-cloud.js`。
 *
 * 输入： src/adapter.js   （手写：平台桥 + 全局变量 + 首次自举）
 *       src/core.js      （手写：核心逻辑，从上游移植后**就地维护**）
 * 输出： dist/vflow-fluid-cloud.js  （adapter + core 两段）
 *
 * ⚠️ **更新逻辑不在产物里** —— 它在 `src/bootstrap.js`（工作流里那段 script），
 *    见 docs/UPDATE.md §7：更新器搬进工作流，导入即自足。
 *    （上一版这里还有一个 `dist/update.js` 独立输出，已随该调整删除。）
 *
 * ## 为什么还要拼（不直接维护单文件）
 *
 * vFlow 的 `vflow.system.js` 只有一个 `script` 字符串参数，**没有 import** ——
 * 所以最终交付必须是单文件。而**开发时**分成两个文件更清楚：
 * 「平台适配」与「业务逻辑」是两件不同的事，混在 2700 行里不好改。
 *
 * ## 顺序不能变
 *
 * adapter **必须在前** —— 它定义 `input` / `tiggerTag` / `FLUID_CLOUD_DIR` /
 * `VFLOW_ADAPTER`，而 `core.js` 的**顶层**（非函数内）就用到前两个：
 *
 * ```javascript
 * var config = readJsonFile(FLUID_CLOUD_DIR + "/config.json")   // core.js 顶层
 * ```
 *
 * ⚠️ 这里**不做语法检查** —— 那是 `npm run check` 里 `node --check` 的事，保持单一职责。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ADAPTER = path.join(ROOT, 'src', 'adapter.js');
const CORE = path.join(ROOT, 'src', 'core.js');
const OUT = path.join(ROOT, 'dist', 'vflow-fluid-cloud.js');

function read(file) {
    if (!fs.existsSync(file)) {
        throw new Error(`[生成失败] 缺少 ${path.relative(ROOT, file)}`);
    }
    // ⚠️ 统一成 LF。源文件在 Windows 上可能是 CRLF（编辑器/上游带来），
    //    混着进产物会让任何逐行处理都变脆。
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function main() {
    const adapter = read(ADAPTER);
    const core = read(CORE);

    const banner = [
        '// ============================================================================',
        '// vFlow 流体云 · 完整脚本（构建产物）',
        '//',
        '// ⚠️ 不要手改本文件 —— 改 src/adapter.js 或 src/core.js 后重跑：',
        '//      node src/generate.js',
        '//',
        '// 部署：adb push dist/vflow-fluid-cloud.js /sdcard/vFlow/fluid-cloud/',
        '//      （工作流里放的是 dist/bootstrap.js，它会读这个文件并 eval）',
        '// ============================================================================',
        '',
        ''
    ].join('\n');

    const sep = [
        '',
        '',
        '// ============================================================================',
        '// ↓↓↓ 核心逻辑（src/core.js）',
        '// ============================================================================',
        '',
        ''
    ].join('\n');

    const out = banner + adapter + sep + core;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, out, 'utf8');

    const al = adapter.split('\n').length;
    const cl = core.split('\n').length;
    console.log(`[ok] ${path.relative(ROOT, OUT)}`);
    console.log(`     adapter ${al} 行 + core ${cl} 行 = ${out.split('\n').length} 行 / ${out.length} 字符`);
}

main();
