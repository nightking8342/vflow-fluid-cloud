#!/usr/bin/env node
/**
 * 拼出最终要贴进 vFlow 的脚本。
 *
 * 输入： src/adapter.js         （手写：平台桥 + 全局变量 + 自举）
 *       dist/core.vflow.js     （构建产物：补丁后的上游 core.js）
 * 输出： dist/vflow-fluid-cloud.js
 *
 * ## 为什么是一个文件
 *
 * vFlow 的 `vflow.system.js` 模块只有一个 `script` 字符串参数 —— **没有 import**。
 * 所以最终形态必须是单文件。分两个源文件是为了让「哪些是上游的、哪些是我们写的」
 * 在磁盘上就分得清（改上游时只碰 vendor/，写适配时只碰 src/adapter.js）。
 *
 * ## 顺序
 *
 * adapter **必须在前** —— 它定义 `input` / `tiggerTag` / `FLUID_CLOUD_DIR` /
 * `VFLOW_ADAPTER`，而 core.js 的顶层就用到前两个。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ADAPTER = path.join(ROOT, 'src', 'adapter.js');
const CORE = path.join(ROOT, 'dist', 'core.vflow.js');
const OUT = path.join(ROOT, 'dist', 'vflow-fluid-cloud.js');

function main() {
    for (const f of [ADAPTER, CORE]) {
        if (!fs.existsSync(f)) {
            throw new Error(`[生成失败] 缺少 ${path.relative(ROOT, f)} —— 先跑 node src/build.js`);
        }
    }

    const adapter = fs.readFileSync(ADAPTER, 'utf8').replace(/\r\n/g, '\n');
    const core = fs.readFileSync(CORE, 'utf8').replace(/\r\n/g, '\n');

    const banner =
        '// ============================================================================\n' +
        '// vFlow 流体云 · 完整脚本\n' +
        '//\n' +
        '// ⚠️ 构建产物，不要手改。重建：\n' +
        '//      node fluid-cloud/src/build.js      # 补丁上游 core.js\n' +
        '//      node fluid-cloud/src/bundle-rules.js # 合并规则库\n' +
        '//      node fluid-cloud/src/generate.js    # 拼成这一个文件\n' +
        '//\n' +
        '// 用法：整份内容粘进 vFlow 的「JavaScript脚本」模块。\n' +
        '//       模块的「脚本输入」里需要提供：\n' +
        '//         text          —— 本次触发的文本（剪贴板内容等）\n' +
        '//         trigger_label —— 触发器标签（剪切板 / QQ / 微信 / 附加）\n' +
        '// ============================================================================\n\n';

    const sep =
        '\n\n// ============================================================================\n' +
        '// ↓↓↓ 以下为补丁后的上游 core.js（构建产物，见 dist/core.vflow.js 的文件头）\n' +
        '// ============================================================================\n\n';

    const out = banner + adapter + sep + core;
    fs.writeFileSync(OUT, out, 'utf8');

    console.log(`[ok] ${path.relative(ROOT, OUT)}`);
    console.log(`     adapter ${adapter.split('\n').length} 行 + core ${core.split('\n').length} 行 = ${out.split('\n').length} 行`);
}

main();
