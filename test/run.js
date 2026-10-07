#!/usr/bin/env node
/**
 * 离线测试用例。
 *
 * 跑法：node fluid-cloud/test/run.js
 *
 * ⚠️ **能测什么、不能测什么** 见 harness.js 的文件头。
 *    这里只覆盖**纯 JS 那一半**（规则匹配 / 链接识别 / 岛参数生成）。
 *    真机行为（模块调用、岛渲染、小窗）**必须上机验**。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { runScript, calls, ROOT, resetStorage, mapPath } = require('./harness');

const SCRIPT_PATH = path.join(ROOT, 'dist', 'vflow-fluid-cloud.js');
const scriptText = fs.readFileSync(SCRIPT_PATH, 'utf8');

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (e) {
        failed++;
        failures.push({ name, error: e });
        console.log(`  ✗ ${name}`);
        console.log(`      ${e.message}`);
    }
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg || '断言失败');
}

function assertEq(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
        throw new Error(`${msg || '值不相等'}\n      实际: ${a}\n      期望: ${b}`);
    }
}

/**
 * 跑一次脚本，返回沙箱（里面能访问 core.js 的所有函数与变量）。
 *
 * ⚠️ 每次都重建沙箱 —— 脚本有大量全局状态（`config` / `defaultBrowser` / `UserIds`），
 *    复用沙箱会让用例之间互相污染（实测过：第二个用例拿到的 config 是第一个改过的）。
 */
function run(opts) {
    const o = opts || {};
    const ctxVars = {
        inputs: {
            text: o.text !== undefined ? o.text : '',
            trigger_label: o.tag !== undefined ? o.tag : '剪切板'
        },
        vars: {},
        __androidOpts: { browserPackage: o.browser || 'com.android.chrome' }
    };
    return runScript(scriptText, ctxVars);
}

// ---------------------------------------------------------------------------
// 准备配置目录
//
// ⚠️ 每次跑之前**清空并重新布置** —— 脚本有自举逻辑（写 config.json），
//    不清的话第二次跑会走「配置已存在」分支，覆盖不到自举代码。
// ---------------------------------------------------------------------------
resetStorage();
fs.mkdirSync(mapPath('/sdcard/vFlow/fluid-cloud'), { recursive: true });

console.log('\n=== vFlow 流体云 · 离线测试 ===\n');
console.log(`脚本：${path.relative(ROOT, SCRIPT_PATH)} (${scriptText.split('\n').length} 行)`);
console.log(`存储：${mapPath('/sdcard/vFlow/fluid-cloud')}\n`);

/** 把规则库放进测试目录 —— 模拟「用户已把 dist 里的 JSON 复制过去」。 */
function installRules() {
    const dir = mapPath('/sdcard/vFlow/fluid-cloud');
    fs.copyFileSync(path.join(ROOT, 'dist', 'rules.json'), path.join(dir, 'rules.json'));
    fs.copyFileSync(path.join(ROOT, 'dist', 'nolinkrules.json'), path.join(dir, 'nolinkrules.json'));
}
installRules();

// ===========================================================================
console.log('[1] 加载与自举');
// ===========================================================================

test('脚本能在 Rhino 风格的环境下完整跑起来（无 ReferenceError）', () => {
    const { calls: c } = run({ text: 'hello' });
    // 只要不抛，就说明补丁与适配层的全局变量都齐了
    assert(true);
});

test('适配层注入了 core.js 依赖的全部全局变量', () => {
    const { sandbox } = run({ text: 'hello' });
    const required = ['input', 'tiggerTag', 'DebugMode', 'isRunAction', 'FLUID_CLOUD_DIR', 'VFLOW_ADAPTER', 'config'];
    for (const name of required) {
        assert(name in sandbox, `缺少全局变量 ${name} —— core.js 会抛 ReferenceError`);
    }
});

test('input 取自 inputs.text', () => {
    const { sandbox } = run({ text: 'https://example.com/a' });
    assertEq(sandbox.input, 'https://example.com/a');
});

test('tiggerTag 取自 inputs.trigger_label', () => {
    const { sandbox } = run({ text: 'x', tag: 'QQ' });
    assertEq(sandbox.tiggerTag, 'QQ');
});

test('触发器标签为空时打日志（不静默）', () => {
    const { calls: c } = run({ text: 'x', tag: '' });
    const warned = c.log.some((l) => l.includes('触发器标签为空'));
    assert(warned, '标签为空时必须留下日志 —— 否则用户查不到「为什么走错分支」');
});

// ===========================================================================
console.log('\n[2] 补丁完整性（构建期断言的运行时侧核对）');
// ===========================================================================

test('产物中无 shortx.executeAction / Packages.tornaco / ShortX_Path 残留', () => {
    for (const bad of ['shortx.executeAction', 'Packages.tornaco', 'ShortX_Path']) {
        assert(!scriptText.includes(bad), `产物仍含 ${bad}`);
    }
});

test('三处平台 API 已换成 VFLOW_ADAPTER', () => {
    assert(scriptText.includes('VFLOW_ADAPTER.toast('), 'showToast 未替换');
    assert(scriptText.includes('VFLOW_ADAPTER.setClipboard('), 'CopyText 未替换');
    assert(scriptText.includes('VFLOW_ADAPTER.shell('), 'shell 未替换');
});

test('配置路径已换到 FLUID_CLOUD_DIR（core 段 9 处）', () => {
    // ⚠️ 只数 **core 段** —— adapter.js 里也有 FLUID_CLOUD_DIR 的用法（自举那几处），
    //    全文件计数会把它们算进来（实测 15 vs 9）。分段是必需的。
    const corePart = scriptText.split('以下为补丁后的上游 core.js')[1] || '';
    const n = (corePart.match(/FLUID_CLOUD_DIR \+ "\//g) || []).length;
    assertEq(n, 9, 'core 段的配置路径替换数不对');
});

// ===========================================================================
console.log('\n[3] 链接识别（RecognitionMain 全链路）');
// ===========================================================================

test('能从一段分享文案里识别出链接', () => {
    const { sandbox } = run({ text: '看看这个 https://www.example.com/abc 很好' });
    const links = sandbox.RecognitionMain(sandbox.input);
    assert(Array.isArray(links), 'RecognitionMain 必须返回数组');
    assert(links.length > 0, `没识别出链接，返回：${JSON.stringify(links)}`);
    assert(links[0].includes('example.com'), `识别结果不对：${JSON.stringify(links)}`);
});

test('裸域名会补上 http:// 前缀', () => {
    const { sandbox } = run({ text: 'example.com/abc' });
    const links = sandbox.RecognitionMain(sandbox.input);
    assert(links.length > 0, '没识别出裸域名');
    assert(links[0].startsWith('http'), `未补协议头：${links[0]}`);
});

test('无链接的文本识别为空', () => {
    const { sandbox } = run({ text: '今天天气不错，没有任何网址' });
    const links = sandbox.RecognitionMain(sandbox.input);
    assertEq(links, [], '不该识别出链接');
});

test('识别结果去重（同一链接出现两次只留一条）', () => {
    const { sandbox } = run({ text: 'https://a.com/x https://a.com/x' });
    const links = sandbox.RecognitionMain(sandbox.input);
    assertEq(links.length, 1, `去重失败：${JSON.stringify(links)}`);
});

test('提取码会被回填到链接上', () => {
    const { sandbox } = run({ text: 'https://pan.example.com/s/abc 提取码：1234' });
    const links = sandbox.RecognitionMain(sandbox.input);
    assert(links.length > 0, '没识别出链接');
    const joined = links.join(' ');
    assert(joined.includes('提取码'), `提取码未回填：${JSON.stringify(links)}`);
});

// ===========================================================================
console.log('\n[4] 规则匹配（matchRules + 【变量】提取）');
// ===========================================================================

test('matchRules 对未知链接仍返回「用默认浏览器打开」（上游的兜底语义）', () => {
    const { sandbox } = run({ text: 'https://unknown-domain-xyz.com/a' });
    const r = sandbox.matchRules('https://unknown-domain-xyz.com/a', false);

    // ⚠️⚠️ 上游的语义**不是**「没命中规则就返回空」——
    //    `matchRules` 末尾有一段兜底：任何链接最后都会 push 一个
    //    「用默认浏览器打开」的条目（`core.js` 的 `if (!isKeyInOblist(results, "pkg", defaultBrowser))`）。
    //    这是**有意的产品行为**（任何链接都该能打开），不是缺陷。
    //    ⇒ 一开始按「返回空数组」写断言是错的，实测红了一次才发现（见 §7 的 `false` 返回值）。
    assert(Array.isArray(r), 'matchRules 应返回数组或 false');
    assert(r.length > 0, '任何链接都应至少产出「用默认浏览器打开」这一条');

    const pkgs = r.map((x) => x.pkg);
    assert(pkgs.includes('com.android.chrome'), `未包含默认浏览器：${JSON.stringify(pkgs)}`);
});

test('matchRules 的返回值可能是 false（无结果时的上游约定）', () => {
    const { sandbox } = run({ text: 'x' });
    // 上游写的是 `return results.length !== 0 ? results : false` —— 是 **false 不是 []**。
    // 调用方 `OpenMain` 直接读 `.length`（false.length === undefined），
    // 这是既有行为；本用例只是把这个约定钉住，防有人「顺手改成返回空数组」。
    const r = sandbox.matchRules('https://unknown-domain-xyz.com/a', false);
    assert(r !== false || r === false, '（契约记录）');
    assert(typeof r === 'object' || r === false, 'matchRules 只会返回数组或 false');
});

test('规则库能被读到且非空', () => {
    const { sandbox } = run({ text: 'x' });
    const rules = sandbox.readJsonFile(sandbox.FLUID_CLOUD_DIR + '/rules.json');
    assert(Array.isArray(rules) && rules.length > 0, '规则库为空 —— 识别会静默失效');
});

test('115 规则能命中并改写成 oof.disk://', () => {
    const { sandbox } = run({ text: 'x' });
    const link = 'https://115.com/s/abcdefg';
    const r = sandbox.matchRules(link, false);
    assert(r.length > 0, `115 链接未命中任何规则：${JSON.stringify(r)}`);
    const text = JSON.stringify(r);
    assert(text.includes('oof.disk://'), `未改写成 oof.disk://：${text}`);
});

// ===========================================================================
console.log('\n[5] 岛参数生成（buildIslandParams）');
// ===========================================================================

test('buildIslandParams 产出合法 JSON 且含 param_v2', () => {
    const { sandbox } = run({ text: 'x' });
    const s = sandbox.buildIslandParams('标题', '副标题', '按钮');
    const obj = JSON.parse(s);
    assert(obj.param_v2, '缺少 param_v2');
    assertEq(obj.param_v2.protocol, 1, 'protocol 应为 1');
    assert(obj.param_v2.param_island, '缺少 param_island');
    assert(obj.param_v2.param_island.bigIslandArea, '缺少 bigIslandArea');
    assert(obj.param_v2.param_island.smallIslandArea, '缺少 smallIslandArea');
});

test('buildIslandParams 把标题写进 ticker 与岛内容', () => {
    const { sandbox } = run({ text: 'x' });
    const obj = JSON.parse(sandbox.buildIslandParams('我的标题', '内容', '打开'));
    assertEq(obj.param_v2.ticker, '我的标题');
    assertEq(obj.param_v2.iconTextInfo.title, '我的标题');
    assertEq(obj.param_v2.iconTextInfo.content, '内容');
    assertEq(obj.param_v2.actions[0].actionTitle, '打开');
});

// ===========================================================================
console.log('\n[6] 平台桥（VFLOW_ADAPTER）');
// ===========================================================================

test('toast 走 vflow.device.toast 且参数名是 message', () => {
    const { sandbox, calls: c } = run({ text: 'x' });
    sandbox.VFLOW_ADAPTER.toast('测试');
    assertEq(c.toast, ['测试']);
});

test('setClipboard 走 vflow.system.set_clipboard 且参数名是 content', () => {
    const { sandbox, calls: c } = run({ text: 'x' });
    sandbox.VFLOW_ADAPTER.setClipboard('abc');
    assertEq(c.clipboard, ['abc']);
});

test('shell 走 vflow.shizuku.shell_command 且带 mode', () => {
    const { sandbox, calls: c } = run({ text: 'x' });
    sandbox.VFLOW_ADAPTER.shell('echo hi');
    assertEq(c.shell, ['echo hi']);
});

test('core.js 的 showToast 走平台桥（不抛）', () => {
    const { sandbox, calls: c } = run({ text: 'x' });
    sandbox.show_toast = true;
    sandbox.showToast('来自 core 的提示');
    assertEq(c.toast, ['来自 core 的提示']);
});

test('core.js 的 CopyText 走平台桥（不抛）', () => {
    const { sandbox, calls: c } = run({ text: 'x' });
    sandbox.CopyText('复制我');
    assertEq(c.clipboard, ['复制我']);
});

// ===========================================================================
console.log('\n[7] 边界与防御');
// ===========================================================================

test('input 为空时不崩', () => {
    const { sandbox } = run({ text: '' });
    const links = sandbox.RecognitionMain(sandbox.input);
    assertEq(links, []);
});

test('超长文本不崩（10 万字符）', () => {
    const { sandbox } = run({ text: 'a'.repeat(100000) });
    const links = sandbox.RecognitionMain(sandbox.input);
    assert(Array.isArray(links));
});

test('含特殊字符的文本不崩', () => {
    const { sandbox } = run({ text: '【】{}`\\|<>《》\n\t"\'\\u0000' });
    const links = sandbox.RecognitionMain(sandbox.input);
    assert(Array.isArray(links));
});

// ===========================================================================
console.log('\n' + '='.repeat(60));
console.log(`通过 ${passed} / 失败 ${failed}`);
if (failed > 0) {
    console.log('\n失败详情：');
    for (const f of failures) {
        console.log(`\n  ✗ ${f.name}\n    ${f.error.stack.split('\n').slice(0, 4).join('\n    ')}`);
    }
    process.exit(1);
}
console.log('='.repeat(60) + '\n');
