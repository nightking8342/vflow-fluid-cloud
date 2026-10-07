#!/usr/bin/env node
/**
 * 把 vendor/rules/ 与 vendor/nolinkrules/ 合并成运行期要读的两个 JSON 文件。
 *
 * 输入： vendor/rules/*.json       （27 个有链接规则）
 *       vendor/nolinkrules/*.json （2 个无链接规则）
 * 输出： dist/rules.json
 *       dist/nolinkrules.json
 *
 * ## 为什么需要这一步
 *
 * 上游把规则做成「一文件一规则」，靠 update.js 从 GitHub 拉下来再合并成两个大 JSON。
 * vFlow 侧 P0 不做远程更新（见 DESIGN.md §3.4），规则随包分发 ⇒ 在构建期合并。
 *
 * ## ⚠️ 合并顺序与 update.js 必须一致
 *
 * update.js 的 `processRules` 是 `zdyRules.concat(config)` —— **新的在前**。
 * 顺序会影响 `matchRules` 的命中结果（先匹配到的规则先产出结果），
 * 故这里也用「按文件名排序」这个**确定性**顺序，不用 `readdir` 的原始顺序
 *（那个顺序依赖文件系统，在不同机器上可能不同 —— 会让「本机能识别、换台机器识别不出」）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 读一个目录下所有 .json，按文件名排序（确定性顺序）。 */
function loadDir(dir, label) {
    if (!fs.existsSync(dir)) {
        throw new Error(`[合并失败] 目录不存在：${dir}`);
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) {
        throw new Error(`[合并失败] ${dir} 下没有任何 .json —— 规则库为空会让识别静默失效`);
    }

    const out = [];
    for (const file of files) {
        const full = path.join(dir, file);
        const raw = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
        let obj;
        try {
            obj = JSON.parse(raw);
        } catch (e) {
            throw new Error(`[合并失败] ${file} 不是合法 JSON：${e.message}`);
        }
        // ⚠️ 规则必须带 name —— 脚本的 `getVariablevalues` 会把它打进错误提示
        //    （「<name>规则<字段>匹配失败」）。缺了的话出错时用户看不出是哪条规则。
        if (!obj || typeof obj.name !== 'string' || obj.name === '') {
            throw new Error(`[合并失败] ${file} 缺少 name 字段`);
        }
        out.push(obj);
    }
    console.log(`[ok] ${label}: ${files.length} 条规则`);
    return out;
}

function main() {
    const rules = loadDir(path.join(ROOT, 'vendor', 'rules'), '有链接规则');
    const nolink = loadDir(path.join(ROOT, 'vendor', 'nolinkrules'), '无链接规则');

    fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'dist', 'rules.json'), JSON.stringify(rules, null, 2), 'utf8');
    fs.writeFileSync(path.join(ROOT, 'dist', 'nolinkrules.json'), JSON.stringify(nolink, null, 2), 'utf8');
    console.log('[ok] dist/rules.json / dist/nolinkrules.json');
}

main();
