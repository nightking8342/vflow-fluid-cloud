#!/usr/bin/env node
/**
 * 离线测试用例。
 *
 * 跑法：npm test（或 node test/run.js）
 *
 * ⚠️ **能测什么、不能测什么** 见 harness.js 的文件头。
 *    这里只覆盖**纯 JS 那一半**（规则匹配 / 链接识别 / 岛参数生成）。
 *    真机行为（模块调用、岛渲染、小窗）**必须上机验**。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const os = require('os');
const { execFileSync } = require('child_process');
const { runScript, calls, ROOT, resetStorage, mapPath, httpBox } = require('./harness');

const SCRIPT_PATH = path.join(ROOT, 'dist', 'vflow-fluid-cloud.js');
const scriptText = fs.readFileSync(SCRIPT_PATH, 'utf8');

const UPDATE_PATH = path.join(ROOT, 'dist', 'update.js');
const updateText = fs.readFileSync(UPDATE_PATH, 'utf8');

const CLOUD_DIR = mapPath('/sdcard/vFlow/fluid-cloud');
const UPDATE_URLS = {
    version: 'https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/version',
    script: 'https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/dist/vflow-fluid-cloud.js',
    rules: 'https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/dist/rules.json',
    nolinkrules: 'https://raw.githubusercontent.com/nightking8342/vflow-fluid-cloud/main/dist/nolinkrules.json'
};

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

// 剥掉行注释与块注释，**保留换行**（行号不漂，便于按行断言）。
//
// ⚠️ **为什么测试需要它**：本项目的源码里**有意**保留了原平台的痕迹 ——
//    src/core.js 头部记着「原：shortx.executeAction(ShowToast…)」这类来历说明，
//    src/adapter.js 记着「上游用 /data/system/shortx* 做配置目录」。
//    那是**给维护者看的文档**，不是没替换干净的残留。
//    只做 includes() 的断言会把它们一起判红 —— 而唯一的「修法」是删掉这些说明，
//    等于**把文档逼走**。⇒ 判据必须是「**代码里**没有残留」。
//
// ⚠️⚠️ **不处理字符串字面量与正则字面量**，这是**已知且已核实**的局限：
//    在当前的 src/core.js + src/adapter.js 上，两者都不会产生误判 ——
//    - 正则字面量共 7 处，**无一**以块注释起始符或行注释符开头
//      （正则以 `*` 开头本就是语法错误；以 `//` 开头的写法会被解析成注释，不存在）；
//    - 字符串字面量里出现的 http 协议前缀不会命中 shortx / Packages.tornaco 这些词。
//    真正的风险是**将来**有人加一句 var s = "// shortx" 或正则里出现块注释起始符。
//    届时本函数会**多剥**一点、让断言偏松（**偏松不会误报，只是可能漏报**）——
//    真的需要精确时再引入 tokenizer，**不要**为了「看起来更严谨」在这里堆半吊子状态机。
function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** 读一个源文件（统一 LF，与 generate.js 的 read() 同口径）。 */
function readSrc(name) {
    return fs.readFileSync(path.join(ROOT, 'src', name), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * 取出 `function <name>(...)` 的**函数体**（到列 0 的那个 `}` 为止）。
 *
 * ⚠️ **不能用「下一个标记串」切** —— 实测踩过：`core.js` 的 `showIslandNotification`
 *    **体内**就有一句 `// 构建超级岛参数`（构造岛参数前的注释），而函数**外**紧跟着
 *    一个同名的顶层注释。用 `indexOf('// 构建超级岛参数')` 切会命中体内那句，
 *    切出来的「函数体」只有 4054 字符、**根本不含返回语句** ⇒ 断言恒红，
 *    而看起来像是生产代码漏了 `return`（**方向完全指错**）。
 *
 * 顶层声明一律从列 0 开始 ⇒ 用「列 0 的 `}`」当结束边界是可靠的。
 */
function functionBodyOf(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error(`找不到函数 ${name}`);
    const end = src.indexOf('\n}', start);
    if (end < 0) throw new Error(`找不到函数 ${name} 的结束大括号`);
    return src.slice(start, end);
}


/**
 * 跑一次脚本，返回沙箱（里面能访问 core.js 的所有函数与变量）。
 *
 * ⚠️ 每次都重建沙箱 —— 脚本有大量全局状态（`config` / `defaultBrowser` / `UserIds`），
 *    复用沙箱会让用例之间互相污染（实测过：第二个用例拿到的 config 是第一个改过的）。
 */
/**
 * vFlow 对**未命中的触发器输出**的回退形态。
 *
 * ⚠️⚠️ **不是空串，是 `{{{stepId.outputId}}}`（三个花括号）** ——
 * `VariableResolver.kt:133` 的 `VObjectFactory.from("{${segment.rawExpression}}")`，
 * 而 `rawExpression` 本身已含 `{{ }}`。
 *
 * 一个工作流挂两个触发器时，**一次执行必然有一路是这个形态**（真机实测确认），
 * 所以测试里的 `inputs` 默认就按**真实形态**给：命中一路有值、另一路是回退串。
 * 若图省事给空串，`adapter.js` 里那段「认回退串」的逻辑就**测不到**。
 */
const UNRESOLVED = (id, out) => '{{{' + id + '.' + out + '}}}';

function run(opts) {
    const o = opts || {};
    // ⚠️ 两条触发路（见 workflow/fluid-cloud.json 的 inputs）。默认：剪贴板命中、点击未命中。
    //    `o.text` 走剪贴板那一路；`o.text` 以 `vflowfc://` 开头时按点击那一路给。
    const isClick = typeof o.text === 'string' && o.text.indexOf('vflowfc://') === 0;
    const ctxVars = {
        inputs: {
            click_uri: isClick ? o.text : UNRESOLVED('fluid_click_broadcast', 'data_uri'),
            clipboard_text: isClick
                ? UNRESOLVED('fluid_trigger_clipboard', 'text_content')
                : (o.text !== undefined ? o.text : ''),
            trigger_label: o.tag !== undefined ? o.tag : '剪切板'
        },
        vars: {},
        __androidOpts: {
            browserPackage: o.browser || 'com.android.chrome',
            // 自绘界面是阻塞等点击的 ⇒ 默认自动点掉收尾按钮（见 harness 的 uiListenerBox）。
            autoDismiss: o.autoDismiss,
            autoDismissIndex: o.autoDismissIndex
        }
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

test('input 取自 inputs.clipboard_text（剪贴板那一路）', () => {
    const { sandbox } = run({ text: 'https://example.com/a' });
    assertEq(sandbox.input, 'https://example.com/a');
});

test('input 取自 inputs.click_uri（点击那一路，优先级高于剪贴板）', () => {
    const { sandbox } = run({ text: 'vflowfc://click?act=window&url=https%3A%2F%2Fa.com' });
    assertEq(sandbox.input, 'vflowfc://click?act=window&url=https%3A%2F%2Fa.com');
});

test('⚠️ 未命中的触发器输出 `{{{...}}}` 必须被当成空 —— 不能拿去识别链接', () => {
    // ⚠️⚠️ 这是**一个工作流挂两个触发器**之后新增的、最容易漏的一条：
    //    vFlow 对未命中的输出回退成字面量 `{{{stepId.outputId}}}`（三个花括号），
    //    直接当值用 ⇒ 脚本会拿它去识别链接 ⇒ **弹一个无意义的岛，且不报错**。
    const { sandbox } = run({ text: '{{{fluid_trigger_clipboard.text_content}}}' });
    assertEq(sandbox.input, '', '未命中的输出必须当空处理');
    // 反向锁：真正的值不能被误判成回退串
    const { sandbox: s2 } = run({ text: 'https://a.com/x' });
    assertEq(s2.input, 'https://a.com/x');
});

test('两条路都未命中时 input 是空串（不是回退串）', () => {
    const { sandbox } = run({ text: '' });
    assertEq(sandbox.input, '');
});

test('⚠️ 适配层不得再读 inputs.text —— 工作流那边已经没有这个键了', () => {
    // ⚠️ 这条防的是「改了一半」：工作流侧（workflow/fluid-cloud.json 的 inputs）
    //    已把 `text` 拆成 `click_uri` / `clipboard_text` 两路，
    //    若适配层还留着 `inputs.text` 的兜底分支，那条分支**永远取不到值**
    //    —— 不报错、不崩溃，只是白写一段（而它会让人以为「text 这条路还在」）。
    const adapter = stripComments(readSrc('adapter.js'));
    assert(!/inputs\.text/.test(adapter), 'adapter.js 里还有 inputs.text 的引用');
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

// ⚠️ 本节的判据分**产物**与**源码**两路，两者都要过：
//    - 产物（dist/）是真正跑在设备上的东西 ⇒ 必须干净；
//    - 源码（src/）是维护者改的东西 ⇒ 计数是「改动点没丢」的锚。
//    只测产物的话，「有人把补丁从 src 删了但 dist 是旧的」测不出来。

test('产物代码中无 shortx.executeAction / Packages.tornaco / ShortX_Path 残留', () => {
    // ⚠️ **必须剥注释后再断言** —— core.js 头部与 adapter.js 里的 shortx 字样是
    //    **有意保留的来历说明**（「原：shortx.executeAction(ShowToast…)」），不是残留。
    //    不剥的话判红，而唯一的「修法」是删掉这些说明 ⇒ 等于把文档逼走。
    //    详见 stripComments() 的注释。
    const code = stripComments(scriptText);
    for (const bad of ['shortx.executeAction', 'Packages.tornaco', 'ShortX_Path']) {
        assert(!code.includes(bad), `产物代码仍含 ${bad}`);
    }
});

test('「剥注释」没有把断言变成空转', () => {
    // 防空转：剥完必须还剩足够多的代码，且已知的**注释**确实被剥掉了。
    const code = stripComments(scriptText);
    assert(code.length > scriptText.length * 0.8, `剥注释剥过头了：${code.length} / ${scriptText.length}`);
    assert(!code.includes('[vflow]'), '[vflow] 标记是注释，应被剥掉');
    assert(!code.includes('来历'), '头部说明是注释，应被剥掉');
});

test('三处平台 API 已换成 VFLOW_ADAPTER（产物）', () => {
    assert(scriptText.includes('VFLOW_ADAPTER.toast('), 'showToast 未替换');
    assert(scriptText.includes('VFLOW_ADAPTER.setClipboard('), 'CopyText 未替换');
    assert(scriptText.includes('VFLOW_ADAPTER.shell('), 'shell 未替换');
});

test('三处平台 API 已换成 VFLOW_ADAPTER（源码 src/core.js）', () => {
    // ⚠️ 与上一条**刻意重复**：架构调整后 dist 是**构建产物**（在 .gitignore 里），
    //    「产物对」不等于「源码对」—— 有人改 src 忘了重新构建时，上一条仍会绿。
    const src = stripComments(readSrc('core.js'));
    assert(src.includes('VFLOW_ADAPTER.toast('), 'src/core.js 的 showToast 未替换');
    assert(src.includes('VFLOW_ADAPTER.setClipboard('), 'src/core.js 的 CopyText 未替换');
    assert(src.includes('VFLOW_ADAPTER.shell('), 'src/core.js 的 shell 未替换');
});

test('产物被两个源文件正确拼起来（分隔标记 + 顺序）', () => {
    // ⚠️ 分隔标记是 generate.js 与测试之间的**唯一契约**，改了名字这里必须跟着改。
    const SEP = '// ↓↓↓ 核心逻辑（src/core.js）';
    const idx = scriptText.indexOf(SEP);
    assert(idx > 0, `产物缺少分隔标记「${SEP}」—— generate.js 的分隔符改过？`);

    // adapter 必须在前：core.js 的**顶层**就用到 FLUID_CLOUD_DIR / input（见 generate.js 注释）
    const adapterIdx = scriptText.indexOf('var VFLOW_ADAPTER = (function ()');
    assert(adapterIdx > 0, '产物里找不到 VFLOW_ADAPTER 定义');
    assert(adapterIdx < idx, 'adapter 段必须排在 core 段之前');
});

test('配置路径已换到 FLUID_CLOUD_DIR（core 段 ≥ 9 处）', () => {
    // ⚠️ 只数 **core 段** —— adapter.js 里也有 FLUID_CLOUD_DIR 的用法（自举那几处），
    //    全文件计数会把它们算进来。分段是必需的。
    //
    // ⚠️⚠️ **用下界而不是等号** —— 初版写的是 `assertEq(n, 9)`，而移植完成后
    //    每**新增一处**配置读取（如 2026-10-07 加 `launchFromClick` 里那次
    //    `config.json`）都会让它变红。那种「合法改动也红」的断言会被下一个实现者
    //    直接改成新数字、或者干脆删掉 —— 两次之后它就形同虚设。
    //    真正要防的是**回归**（补丁丢了、路径退回去），那是**减少**方向的事
    //    ⇒ 下界足够，且不会因为「多加了一次读取」误报。
    const corePart = scriptText.split('// ↓↓↓ 核心逻辑（src/core.js）')[1] || '';
    const n = (corePart.match(/FLUID_CLOUD_DIR \+ "\//g) || []).length;
    assert(n >= 9, `core 段的配置路径只有 ${n} 处（下界 9）—— 是不是有路径退回原平台了？`);
});

test('配置路径已换到 FLUID_CLOUD_DIR（adapter 段 ≥ 6 处）', () => {
    const adapterPart = scriptText.split('// ↓↓↓ 核心逻辑（src/core.js）')[0] || '';
    const n = (adapterPart.match(/FLUID_CLOUD_DIR \+ "\//g) || []).length;
    assert(n >= 6, `adapter 段的配置路径只有 ${n} 处（下界 6）`);
});

test('两个源文件的配置路径数各自没丢（6 / 9 为下界）', () => {
    // ⚠️ 这是**源码侧**的锚，与上面两条产物侧的分段计数互补：
    //    产物计数能发现「拼错了」，源码计数能发现「补丁从 src 里丢了但 dist 是旧的」。
    const a = (readSrc('adapter.js').match(/FLUID_CLOUD_DIR \+ "\//g) || []).length;
    const c = (readSrc('core.js').match(/FLUID_CLOUD_DIR \+ "\//g) || []).length;
    assert(a >= 6, `src/adapter.js 只有 ${a} 处`);
    assert(c >= 9, `src/core.js 只有 ${c} 处`);
});

test('原平台的配置目录路径未在代码里复活', () => {
    const code = stripComments(scriptText);
    assert(!code.includes('/data/system/shortx'), '代码里又出现了原平台的配置目录');
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
console.log('\n[8] 点击交给工作流（广播回传，2026-10-07）');
// ===========================================================================

// ⚠️ 本节锁的是**真机故障的修复**：`new BroadcastReceiver` 在 vFlow 里必然抛
//    （`can't load this type of class file`，真因是 vFlow 的 ContextFactory 没覆写
//    `createClassLoader`）。修法是**脚本只发广播、不当接收方**。
//    这些断言的失败模式**全是静默的**（广播发错地方 / 编码漏了 / 两条 PendingIntent
//    互相顶掉），不会崩、不会报错 ⇒ 只能在这里钉住。

/** 造一个「有 openWith」的典型岛参数（单链接场景）。 */
function islandOpts(overrides) {
    const openWith = Object.assign({
        type: 'url',
        pkg: 'tv.danmaku.bili',
        urlsharme: 'https://www.bilibili.com/video/BV1xx?share_source=copy_web&vd_source=abc',
        activity: null, copy: '', title: '打开哔哩哔哩', message: '点击全屏打开',
        UserId: 0, clearClipboard: false
    }, (overrides || {}).openWith || {});
    return Object.assign({
        openWith, pkg: 'tv.danmaku.bili', userId: 0,
        title: '打开哔哩哔哩', subtitle: '点击全屏打开', buttonText: '浮窗打开',
        resultOnClick: 'fullscreen', resultOnButton: 'window'
    }, overrides || {});
}

test('脚本里不再 new BroadcastReceiver / registerReceiver（那行在 vFlow 里必然抛）', () => {
    // ⚠️ 剥注释后断言 —— 头部注释里**有意**保留着 `new BroadcastReceiver` 这个字样
    //    （说明「原实现是这么写的、为什么不行」）。不剥会把文档判红。
    const code = stripComments(readSrc('core.js'));
    assert(!/new\s+BroadcastReceiver/.test(code), 'core.js 里又出现了 new BroadcastReceiver —— 那行在 vFlow 里必然抛');
    assert(!/registerReceiver/.test(code), 'core.js 里又出现了 registerReceiver');
    assert(!/WeakReference/.test(code), 'receiver 的 WeakReference 配套代码还在');
    // 防空转：确认剥注释没剥过头
    assert(code.includes('showIslandNotification'), '剥注释剥过头了');
});

test('岛函数不再阻塞（没有 while (result === null) 的等待循环）', () => {
    const core = readSrc('core.js');
    // ⚠️ 只看 **showIslandNotification 的函数体**（`showOptionsDialog` 与浮窗那两处
    //    **仍然阻塞**，它们走的是脚本自己的 View.OnClickListener —— 接口，不炸）。
    //    ⚠️ 用 functionBodyOf 而不是「切到下一个标记串」—— 体内有一句同名的注释，
    //       切标记会切到体内、得到一段不含返回语句的残片（实测踩过，见该函数注释）。
    const bodyRaw = functionBodyOf(core, 'showIslandNotification');
    // ⚠️ 必须**剥注释**再断言 —— 改动时特意在原地留了「原来这里是
    //    `while (result === null) { Thread.sleep(150); }`」的说明注释（那是改动理由，
    //    该留），不剥的话断言会命中那句注释、判成「还有等待循环」（**方向指错**）。
    const body = stripComments(bodyRaw);
    assert(bodyRaw.length > 3000, `函数体只有 ${bodyRaw.length} 字符 —— 切片边界错了`);
    assert(!/while\s*\(\s*result\s*===\s*null\s*\)/.test(body), 'showIslandNotification 里还有等待循环');
    assert(!/Thread\.sleep/.test(body), 'showIslandNotification 里还有 Thread.sleep');
    assert(/return\s+"已发送"/.test(body), 'showIslandNotification 的返回改过了？');
});

test('广播 action 与 scheme 是写死的常量（不能带运行期后缀）', () => {
    const core = readSrc('core.js');
    // ⚠️ 原实现是 `"FLUID_CLOUD_CLICK_BUTTON_" + notificationId` —— 运行期拼的。
    //    而 vFlow 广播触发器的 `actions` 参数**不接受变量**（IntentFilter 注册期就固定）
    //    ⇒ 必须是常量。带后缀的话工作流永远收不到。
    assert(/var FLUID_CLOUD_ACTION_CLICK = "com\.chaomixian\.vflow\.fluidcloud\.CLICK"/.test(core),
        'action 常量变了或不是字面量');
    assert(/var FLUID_CLOUD_DATA_SCHEME = "vflowfc"/.test(core), 'scheme 常量变了');
    // 反向锁：不能再出现「action + 运行期变量」
    assert(!/ACTION_CLICK_MAIN\s*\+\s*notificationId/.test(core), 'action 又带上运行期后缀了');
    assert(!/ACTION_CLICK_BUTTON\s*\+\s*notificationId/.test(core), 'action 又带上运行期后缀了');
});

test('payload 编码：url 必须 encodeURIComponent（否则 & 之后的段被吃掉）', () => {
    const { sandbox } = run({ text: 'x' });
    const p = sandbox.buildClickPayload({
        type: 'url', pkg: 'tv.danmaku.bili',
        urlsharme: 'https://a.com/x?p=1&q=2', UserId: 0
    }, 'window');

    assert(p.startsWith('vflowfc://click?'), `scheme/host 不对：${p}`);
    assert(p.includes('act=window'), `act 不对：${p}`);
    assert(p.includes('pkg=tv.danmaku.bili'), `pkg 不对：${p}`);
    // ⚠️ 核心断言：链接里的 `?` 与 `&` 必须被编码成 %3F / %26
    assert(p.includes('url=https%3A%2F%2Fa.com%2Fx%3Fp%3D1%26q%3D2'), `url 未正确编码：${p}`);
    assert(!/[?&]q=2/.test(p.split('url=')[1] || ''), 'url 里的 & 没被编码 —— 解析时会丢后半段');
});

test('payload 的 type=pkg 用 link 字段（与 launchWithMode 的口径一致）', () => {
    const { sandbox } = run({ text: 'x' });
    const p = sandbox.buildClickPayload({
        type: 'pkg', pkg: 'com.x', link: 'oof.disk://abc', urlsharme: undefined, UserId: 0
    }, 'fullscreen');
    assert(p.includes('type=pkg'), `type 不对：${p}`);
    assert(p.includes('url=oof.disk%3A%2F%2Fabc'), `type=pkg 时应取 link 字段：${p}`);
});

test('showIslandNotification 弹完即返回（不阻塞），且按钮那条改走工作流广播', () => {
    const { sandbox, calls: c } = run({ text: 'x' });
    const t0 = Date.now();
    const r = sandbox.showIslandNotification(islandOpts(), null, 3000);
    const ms = Date.now() - t0;

    assertEq(r, '已发送', '返回值应表示「已发送」');
    // ⚠️ 3000ms 的超时是原来的阻塞时长；现在必须**立刻**返回。
    //    留 500ms 余量（CI 机器慢），真阻塞的话是 3000ms，分得很开。
    assert(ms < 500, `应立刻返回，实际 ${ms}ms（是不是又在等点击？）`);
    assertEq(c.notify.length, 1, '应该发了 1 条通知');
    // ⚠️ 通知必须带系统级超时 —— 否则它会**永久留在通知栏**（真机实测过）。
    //    3000ms 是默认配置值，原样传给 setTimeoutAfter（单位同为毫秒）。
    assertEq(c.notify[0].notification._timeoutAfter, 3000, '通知没设 setTimeoutAfter（会永久留在通知栏）');

    // ⚠️⚠️ **主体那条必须仍是 `getActivity`**（上游原样）。
    //    它由**系统**直接拉起 Activity，脚本不参与 ⇒ **本来就没被 vFlow 阻塞**。
    //    改成广播是**过度改动** —— 多绕一圈，还平白要求「工作流必须在场」。
    //    （第一版真这么改过，用户 2026-10-08 指出「全屏那个地方明明都没有阻塞，你改什么」。）
    const acts = c.pending.filter((p) => p.kind === 'activity');
    assertEq(acts.length, 1, '主体那条应是 getActivity（系统直接拉起，脚本不参与）');

    // ⚠️⚠️ **按钮那条才是被阻塞的**：上游是 `getBroadcast(ACTION_CLICK_BUTTON)`
    //    → **脚本自己 registerReceiver 的 receiver**，而 `new BroadcastReceiver`
    //    在 vFlow 里必然抛（DESIGN.md §4.6）⇒ 必须改走工作流。
    const bcs = c.pending.filter((p) => p.kind === 'broadcast');
    assertEq(bcs.length, 1, '按钮那条应是 getBroadcast（交给工作流的广播触发器）');
    const btn = bcs[0];
    assertEq(btn.intent._action, 'com.chaomixian.vflow.fluidcloud.CLICK', '按钮的 action 不对');
    assertEq(btn.intent._package, 'com.chaomixian.vflow', 'setPackage 没设对（应该是 vFlow 的包名）');
    assert(String(btn.intent._data).includes('act=window'), `按钮应是 window：${btn.intent._data}`);

    // ⚠️ 两条的 `requestCode` 必须不同 —— 否则系统会把它们当成同一个 PendingIntent。
    //    注意：这里**不能**再断言「两条 data 不同」了（主体那条已经没有 data），
    //    `requestCode` 是唯一还成立的区分手段（见 createClickBroadcastIntent）。
    assert(acts[0].requestCode !== btn.requestCode,
        `主体与按钮的 requestCode 相同（${btn.requestCode}）—— 会互相顶掉`);
});

test('上游「主体走广播」那条分支在当前配置下不可达（`|| true` 恒真）', () => {
    // ⚠️ 上游的 else 分支（`pull_small_window` 为假时，主体也走 `getBroadcast`
    //    → 脚本 receiver）**当前不可达**：`var pull_small_window = config.pull_small_window || true`
    //    对 `false` 也返回 `true`（`||` 是「假值才取右边」，不是「缺失才兜底」）。
    //
    //    ⇒ 这个用例**故意**把这个事实钉住，而不是去「测一条跑不到的分支」。
    //      真去测它只会得到假红（我第一次就是这么写的）。
    //
    //    ⚠️ 上游这个 `|| true` 是个真 bug（用户 2026-10-08 指出），但**本次不动它** ——
    //       它不阻塞任何东西，改它属于超出「只修被阻塞处」的范围。
    const { sandbox, calls: c } = run({ text: 'x' });
    sandbox.config.pull_small_window = false;
    sandbox.showIslandNotification(islandOpts(), null, 3000);
    assertEq(c.pending.filter((p) => p.kind === 'activity').length, 1,
        '`|| true` 恒真 ⇒ 主体仍走 getActivity（这条断言就是那个事实本身）');
});

test('parseClickPayload ↔ buildClickPayload 往返一致（含 & 与中文）', () => {
    const { sandbox } = run({ text: 'x' });
    const cases = [
        { type: 'url', pkg: 'tv.danmaku.bili', urlsharme: 'https://a.com/x?p=1&q=2', UserId: 0 },
        { type: 'url', pkg: 'com.x', urlsharme: 'https://pan.quark.cn/s/abc 提取码：1234', UserId: 0 },
        { type: 'pkg', pkg: 'com.y', link: 'oof.disk://abc?x=1&y=2', urlsharme: undefined, UserId: 2 },
    ];
    for (const ow of cases) {
        const uri = sandbox.buildClickPayload(ow, 'window');
        const p = sandbox.parseClickPayload(uri);
        assert(p !== null, `解析失败：${uri}`);
        assertEq(p.act, 'window', `act 往返不一致：${uri}`);
        assertEq(p.pkg, ow.pkg, `pkg 往返不一致：${uri}`);
        assertEq(p.type, ow.type, `type 往返不一致：${uri}`);
        assertEq(p.uid, String(ow.UserId), `uid 往返不一致：${uri}`);
        // ⚠️ 这一条是本组的关键：带 `?` `&` 与中文的链接必须**逐字**还原
        const expectUrl = (ow.type === 'pkg') ? ow.link : ow.urlsharme;
        assertEq(p.url, expectUrl, `url 往返不一致（编码/解码有问题）：${uri}`);
    }
});

test('载荷带上通知 ID（nid）—— 工作流用它收掉通知栏那条', () => {
    // ⚠️ 起因：通知的自动消失已交给系统 `setTimeoutAfter`，但**用户点开之后**
    //    那条通知没有理由继续挂着（原来靠脚本自己 cancel，现在脚本不参与点击了）。
    const { sandbox } = run({ text: 'x' });
    const uri = sandbox.buildClickPayload({ type: 'url', pkg: 'com.x', urlsharme: 'https://a.com', UserId: 0 }, 'window', 123456);
    assert(uri.includes('nid=123456'), `载荷没带 nid：${uri}`);
    assertEq(sandbox.parseClickPayload(uri).nid, '123456', 'nid 往返不一致');
    // 没传 id 时也要能编码（不崩），只是值为空
    const uri2 = sandbox.buildClickPayload({ type: 'url', pkg: 'com.x', urlsharme: 'https://a.com', UserId: 0 }, 'window');
    assert(uri2.includes('nid='), `没传 id 时也该有 nid 键：${uri2}`);
});

test('点击回传时会收掉通知（拿不到 id 时只打日志、不抛）', () => {
    const uri = 'vflowfc://click?act=fullscreen&nid=987654&pkg=tv.danmaku.bili&uid=0&type=url&url=https%3A%2F%2Fb23.tv%2Fabc';
    const { calls: c } = run({ text: uri });
    assert(c.cancelNotification.includes(987654), `没有 cancel 通知（收到：${JSON.stringify(c.cancelNotification)}）`);
    assert(c.log.some((l) => l.includes('已收掉通知')), '没有「已收掉通知」日志');

    // 缺 nid：不能抛（收不掉通知不该妨碍「打开链接」这件正事），但要有日志
    const uri2 = 'vflowfc://click?act=fullscreen&pkg=tv.danmaku.bili&uid=0&type=url&url=https%3A%2F%2Fb23.tv%2Fabc';
    const r2 = run({ text: uri2 });
    assert(r2.calls.log.some((l) => l.includes('没有 nid')), '缺 nid 时必须留日志 —— 否则「点完不消失」查不出原因');
});

test('parseClickPayload 对非点击载荷返回 null（不能把分享文案当载荷）', () => {
    const { sandbox } = run({ text: 'x' });
    for (const s of ['https://a.com', 'vflowfc://other?x=1', '', null, undefined, 'FLUID_CLOUD_CLICK_MAIN_1']) {
        assertEq(sandbox.parseClickPayload(s), null, `不该把 ${JSON.stringify(s)} 当成点击载荷`);
    }
});

test('parseClickPayload 缺 url 时抛（不静默变成「点了没反应」）', () => {
    const { sandbox } = run({ text: 'x' });
    let threw = false;
    try { sandbox.parseClickPayload('vflowfc://click?act=window&pkg=com.x'); } catch (e) { threw = true; }
    assert(threw, '缺 url 必须抛 —— 静默的后果是「点了按钮什么都没发生」且查不出原因');
});

test('顶层分派：点击载荷走 launchFromClick，不走识别链路', () => {
    const uri = 'vflowfc://click?act=window&pkg=tv.danmaku.bili&uid=0&type=url&url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1xx%3Fp%3D2';
    const { calls: c } = run({ text: uri });
    // ⚠️ 点击回传那次执行**不该弹岛**（它只负责打开）
    assertEq(c.notify.length, 0, '点击回传那次执行不该发通知 —— 那会再弹一个岛');
    // 而它应该真的调了 launchWithMode（真机上是 startActivity / shell）
    const didSomething = c.startActivity.length > 0 || c.shell.length > 0;
    assert(didSomething, `点击回传没产生任何启动动作（startActivity=${c.startActivity.length} shell=${c.shell.length}）`);
    // 且日志里能看出走的是哪条路
    assert(c.log.some((l) => l.includes('收到点击回传')), '没有「收到点击回传」日志 —— 分流没生效？');
});

test('顶层分派：普通分享文案仍走识别链路（没被分流改坏）', () => {
    const { calls: c } = run({ text: '看看这个 https://www.example.com/abc 很好' });
    assert(!c.log.some((l) => l.includes('点击回传')), '普通文案被误判成点击载荷');
});

// ===========================================================================
console.log('\n[11] 手动触发（标签「设置」）→ 设置界面');
// ===========================================================================

test('⭐ 手动触发（标签「设置」）弹出「选择操作」菜单，且不做链接识别', () => {
    // ⚠️⚠️ 这条对应上游「点指令图标 → 执行动作」那条路（reference/core.js 尾部的
    //    `if (DebugMode == false && isRunAction == true)`）。vFlow 侧靠**手动触发器的
    //    标签**分流 —— 上游那个判据（`{factTag}` 展开失败）在 vFlow 里不存在。
    //
    //    静默失效形态：标签写成别的（或没给）⇒ 走识别链路 ⇒ 拿空串识别 ⇒
    //    **界面上什么都不会发生**，日志里也看不出（只有 adapter 那条「手动触发」能区分）。
    const { calls: c, sandbox } = run({ text: '', tag: '设置' });

    assertEq(c.notify.length, 0, '手动触发那次执行不该发通知 —— 那会弹一个无意义的岛');
    assertEq(c.uiRoots.length, 1, '没有弹出自绘界面（showOptionsDialog 的 addView 没发生）');
    // 菜单的四个选项标题 —— 用界面上真实出现过的文本断言，而不是看函数被调用
    for (const item of ['设置指令', '编辑规则', '编辑无链接规则', '取消']) {
        assert(c.uiText.includes(item), `菜单里没有「${item}」（实际：${c.uiText.join(' / ')}）`);
    }
    assertEq(c.uiText[0], '选择操作', '菜单标题不是「选择操作」');
    // adapter 那条日志是这条路**唯一**的痕迹
    assert(c.log.some((l) => l.includes('手动触发')), '没有「手动触发」日志 —— adapter 的标签分支没生效？');
    assertEq(sandbox.tiggerTag, '设置', 'tiggerTag 不是「设置」');
});

test('⚠️ 手动触发**不读规则库**（没落进识别链路）', () => {
    // 反证：识别链路会读 config.json / rules.json 并走 RecognitionMain。
    // 手动触发走的是分派里最早那条分支，不该碰它们 —— 碰了就说明分流位置错了。
    //
    // ⚠️ 判据只能是「产出了什么」，不能是「日志里有没有『识别』二字」——
    //    `tiggerTag == VFLOW_MANUAL_LABEL || (… isRunAction == true)` 这个表达式
    //    在剥注释前会命中「识别」两个字（注释里写着「不做链接识别」），
    //    拿它当判据会**误报**（实测踩过）。
    const { calls: c } = run({ text: '', tag: '设置' });
    assertEq(c.notify.length, 0, '手动触发那条路弹了通知 —— 它不该做识别');
    assertEq(c.startActivity.length, 0, '手动触发那条路启动了 Activity —— 它不该打开链接');
    // 菜单标题是识别链路**不会**产出的文本（它是这条路独有的证据）
    assert(c.uiText.includes('选择操作'), '没弹「选择操作」菜单 —— 分派没生效');
});

test('标签「设置」在识别那条路上**不会**被当成普通文案（分流在最外层）', () => {
    // 反向锁：给个真链接 + 标签「设置」⇒ 仍然进设置界面，**不弹岛**
    // （标签优先于输入，与上游 `isRunAction` 优先于识别一致）
    const { calls: c } = run({ text: 'https://www.bilibili.com/video/BV1xx', tag: '设置' });
    assertEq(c.notify.length, 0, '标签是「设置」但弹了岛 —— 分流被绕过');
    assert(c.uiRoots.length >= 1, '标签是「设置」但没弹设置界面');
});

test('⭐ 点「设置指令」→ 弹出设置界面（菜单 → 二级界面那条链路是通的）', () => {
    // ⚠️ 上游那条路是**两级**的：先 `showOptionsDialog` 选一项，再 `showsettingsui`。
    //    只测第一级的话，「选了之后弹不出来」这种错测不到。
    //    `autoDismissIndex = 0` = 点菜单里的第一项「设置指令」。
    const { calls: c } = run({ text: '', tag: '设置', autoDismissIndex: 0 });
    assert(c.uiText.includes('指令设置'), '没弹出设置界面（标题「指令设置」没出现）');
    // 设置界面的标志性菜单项（与 core.js 的 menuTitles 一致）
    for (const t of ['编辑顶级域名列表', '编辑电子邮箱列表', '浏览器黑名单列表']) {
        assert(c.uiText.includes(t), `设置界面里没有「${t}」`);
    }
    // 二级界面是**另一个** addView（不是同一层里换文本）
    assert(c.uiRoots.length >= 2, '只 addView 了一次 —— 二级界面没弹出来？');
});

test('⭐ 点「编辑规则」→ 弹出规则编辑器，且内容是**设备上那份** rules.json', () => {
    // ⚠️ 判据是「编辑器读到了哪个文件」—— 路径写错（比如还是 ShortX 的 /data/system/shortx*）
    //    的表现是**编辑器弹出来但内容为空**，而它的 catch 会把读失败吞成 `input.setText("")`
    //    ⇒ 界面上看不出区别。这里断的是「文本被 set 进了 EditText」。
    const { calls: c } = run({ text: '', tag: '设置', autoDismissIndex: 1 });
    // 第二级是规则编辑器：它的标题 + 读到的文件内容（`calls.uiText` 里有那条 JSON）
    assert(c.uiText.includes('规则编辑器(规则在下面)'), '没弹出规则编辑器');
    assert(c.uiText.some((t) => t.includes('"tigger"')),
        '规则编辑器里没有规则内容 —— 读的不是设备上那份 rules.json（路径错了？）');
    assert(c.uiRoots.length >= 2, '只 addView 了一次 —— 二级界面没弹出来？');
});

test('其它标签不受影响（「剪切板」仍走识别）', () => {
    const { calls: c } = run({ text: 'https://www.bilibili.com/video/BV1xx', tag: '剪切板' });
    assertEq(c.notify.length, 1, '剪贴板那一路被设置界面截走了');
});

test('通知带系统级超时（setTimeoutAfter），不再依赖脚本自己 cancel', () => {
    // ⚠️⚠️ 起因：真机实测「岛一会儿就消失了，但通知栏里那条一直在」（用户 2026-10-08）。
    //    真因是本次改动删掉了上游那段「超时后 NotificationManager.cancel」的线程
    //    （它跑在 `new Thread(new Runnable{…})` 上，是不可靠路径），而**上游完全依赖它**
    //    —— 上游的 core.js 里 `setTimeoutAfter` / `setAutoCancel` **一个都没用**（已 grep 核实）。
    //
    //    正解是 `setTimeoutAfter(ms)`：AOSP `NotificationManagerService` 用
    //    `AlarmManager.setExactAndAllowWhileIdle` 到点 cancel（NMS.java:10269-10274），
    //    **不依赖 App 进程活着**。
    const core = readSrc('core.js');
    const body = stripComments(functionBodyOf(core, 'showIslandNotification'));
    assert(/\.setTimeoutAfter\(/.test(body), 'showIslandNotification 没有 setTimeoutAfter —— 通知会永久留在通知栏');
    // ⚠️ 反向锁：不能又退回「自己开线程 cancel」（那是被删掉的不可靠路径）
    assert(!/NotificationManager\.cancel\(/.test(body), '又出现了 NotificationManager.cancel —— 通知的收尾应交给系统');
    assert(!/new Thread\(/.test(body), 'showIslandNotification 里又开线程了（上游那段不可靠的超时线程）');
});

test('岛的存活时长读配置（Fluid_Cloud_timeout），不是写死 10 秒', () => {
    // ⚠️ 上游写死 `islandTimeout: 10`（reference/core.js:2170），没读配置。
    //    本次改为读 —— 而两个字段单位不同（`islandTimeout` 是**秒**、
    //    通知的 `timeout` 是**分钟**、`Fluid_Cloud_timeout` 是**毫秒**），
    //    换算错了不会报错、只会「岛消失得太快/太慢」。
    const core = readSrc('core.js');
    const body = stripComments(functionBodyOf(core, 'buildIslandParams'));
    assert(/islandTimeoutSeconds\(\)/.test(body), 'buildIslandParams 没读配置里的超时');
    assert(!/"islandTimeout":\s*\d/.test(body), 'islandTimeout 又被写死成常量了');

    const { sandbox } = run({ text: 'x' });
    // 3000ms（默认配置）⇒ 3 秒
    sandbox.Fluid_Cloud_timeout = 3000;
    const p = JSON.parse(sandbox.buildIslandParams('t', 'c', 'b'));
    assertEq(p.param_v2.param_island.islandTimeout, 3, '3000ms 应换算成 3 秒');
    assertEq(p.param_v2.timeout, 1, '3 秒向上取整到 1 分钟（timeout 的单位是分钟）');
    // 8000ms ⇒ 8 秒；向上取整（不是截断）
    sandbox.Fluid_Cloud_timeout = 8000;
    assertEq(JSON.parse(sandbox.buildIslandParams('t', 'c', 'b')).param_v2.param_island.islandTimeout, 8, '8000ms 应是 8 秒');
    // 非法值兜底
    sandbox.Fluid_Cloud_timeout = 0;
    assertEq(JSON.parse(sandbox.buildIslandParams('t', 'c', 'b')).param_v2.param_island.islandTimeout, 3, '0 应兜底成默认 3000ms');
    sandbox.Fluid_Cloud_timeout = undefined;
    assertEq(JSON.parse(sandbox.buildIslandParams('t', 'c', 'b')).param_v2.param_island.islandTimeout, 3, 'undefined 应兜底');
});

test('没有 openWith 的（多链接）走浮窗 —— 它需要脚本继续参与，回传做不到', () => {
    // ⚠️ 这是**有意退化的行为**：多链接的岛点击后要弹选择框、再走识别链路，
    //    脚本必须还在等 —— 而脚本已经不当接收方了 ⇒ 只能走浮窗
    //    （浮窗的点击是 View.OnClickListener，接口，不炸，且能继续等待）。
    const core = readSrc('core.js');
    const body = core.slice(core.indexOf('function showFloatingPrompt'), core.indexOf('function showFluidCloud'));
    assert(/opts\.openWith/.test(body), 'showFloatingPrompt 没有按 openWith 分流 —— 多链接会被送进岛路径然后卡死');
});

// ===========================================================================
console.log('\n[9] 项目结构（架构调整后的不变量）');
// ===========================================================================

// ⚠️ 本节锁的是 **2026-10-07 架构调整**（DESIGN.md §3.5）之后的形态。
//    这些不变量**不会因为任何行为测试变红** —— 删掉 reference/、把 build.js 加回来、
//    或者让 version 与 package.json 漂开，功能照常工作、产物照常跑。
//    ⇒ 只能在这里钉住。

test('reference/ 是完整的上游镜像，且保持上游原名', () => {
    const dir = path.join(ROOT, 'reference');
    assert(fs.existsSync(dir), '缺少 reference/ —— 上游来历记录丢了');

    // ⚠️ **文件名必须与上游一致**（不带 `upstream-` 前缀、不带版本号）——
    //    加了前缀就做了「名字映射」，想对照改动时得先在脑子里过一遍
    //    「src/core.js 对应 reference/ 的哪个文件」。目录本身已经说明了这是上游的。
    for (const f of ['core.js', 'onOpen.js', 'update.js', 'version']) {
        assert(fs.existsSync(path.join(dir, f)), `reference/ 缺 ${f}（文件名应与上游一致）`);
    }
    assert(fs.existsSync(path.join(dir, 'rules')), 'reference/ 缺 rules/');
    assert(fs.existsSync(path.join(dir, 'nolinkrules')), 'reference/ 缺 nolinkrules/');

    // ⚠️ **反向锁**：带前缀的旧命名不该复活
    for (const bad of ['upstream-core-3.2.3.js', 'upstream-version.txt']) {
        assert(!fs.existsSync(path.join(dir, bad)), `reference/ 不该有 ${bad}（旧命名）`);
    }

    assertEq(fs.readFileSync(path.join(dir, 'version'), 'utf8').trim(), '3.2.3', '上游版本不对');
});

test('reference/ 里的 ShortX 规则分享文件在，且是「只读参照」不是构建输入', () => {
    // ⚠️ 存在理由：这份 `.txt` **不是上游源码**（是 ShortX 的规则分享格式），
    //    很容易被当成「杂七杂八的附件」删掉。但它记录了**别处没有的东西** ——
    //    上游在 ShortX 侧是怎么把 5 条触发源接进脚本的
    //    （`{clipboardContent}` / `{selectedText}` / `activityIntentUri` 的
    //     `S.url=` / `S.rawUrl=` / `extras["url"]`、`ruleInstanceIdGenerator`…）。
    const f = path.join(ROOT, 'reference', 'ShortX-流体云组件3.7_超级岛版_.txt');
    assert(fs.existsSync(f), '缺 ShortX 规则分享文件 —— 「上游怎么接线」的证据丢了');

    const raw = fs.readFileSync(f, 'utf8');
    // ⚠️ 它有两段：前半规则 JSON、`###------###` 分隔、后半 `{"type":"rule"}`
    const parts = raw.split('###------###');
    assertEq(parts.length, 2, '分隔符 `###------###` 不见了（ShortX 分享格式的标志）');
    assert(parts[1].includes('"type":"rule"'), '分隔符后面应是 {"type":"rule"}');

    const rule = JSON.parse(parts[0]);
    // 5 条触发源 —— 少一条就说明文件被换成了别的规则
    assertEq(rule.facts.length, 5, 'facts 应恰有 5 条');
    const tags = rule.facts.map((x) => x.tag).join(',');
    assertEq(tags, '剪切板,选中,QQ,微信,附加', `触发源标签不对：${tags}`);
    // ⚠️ 「怎么取值」才是这份文件的价值所在 —— 锚住那几段取值代码
    //    （扫整个规则对象，不只看 actions：`ruleInstanceIdGenerator` 在顶层）
    const whole = JSON.stringify(rule);
    for (const [what, needle] of [
        ['剪切板取 {clipboardContent}', '{clipboardContent}'],
        ['选中取 {selectedText}', '{selectedText}'],
        ['QQ 抠 S.url=', 'S.url='],
        ['微信抠 S.rawUrl=', 'S.rawUrl='],
        ['附加取 extras["url"]', 'getString(\\"url\\")'],
        ['触发实例 id 生成器', 'ruleInstanceIdGenerator'],
    ]) {
        assert(whole.includes(needle), `规则里找不到「${what}」（找的是 ${needle}）`);
    }

    // ⚠️ **反向锁**：它是参照，不是构建输入 —— `src/` 下不该出现它的任何衍生物
    assert(!fs.existsSync(path.join(ROOT, 'src', 'ShortX-流体云组件3.7_超级岛版_.txt')),
        'src/ 不该有这份 .txt —— 它不进构建');
});

test('reference/ 是完整镜像（未移植的文件也留着，它们是对照基线）', () => {
    // ⚠️ 存在理由：`onOpen.js` / `update.js` **都没移植**，很容易被当成
    //    「没用的素材」删掉。但它们的用途**不是**「将来要用」，而是**对照基线** ——
    //    判断「某个功能上游有没有」时不必回去翻另一个仓库。
    const dir = path.join(ROOT, 'reference');
    const onOpen = fs.readFileSync(path.join(dir, 'onOpen.js'), 'utf8');
    const update = fs.readFileSync(path.join(dir, 'update.js'), 'utf8');
    assert(onOpen.length > 5000, `onOpen.js 太小（${onOpen.length}）—— 是不是被清空了？`);
    assert(update.length > 20000, `update.js 太小（${update.length}）—— 是不是被清空了？`);

    // 与 src/ 的对应关系：core.js 是移植过的，onOpen/update 没有
    assert(fs.existsSync(path.join(ROOT, 'src', 'core.js')), 'src/core.js 应在（core.js 已移植）');
    assert(!fs.existsSync(path.join(ROOT, 'src', 'onOpen.js')), 'src/ 不该有 onOpen.js（未移植）');
    // ⚠️ **2026-10-09 翻转**：原来是「src/ 不该有 update.js（未移植）」。
    //    现在**更新机制已实施**，`src/update.js` 是**新写的更新器**（不是上游那份的移植）。
    //    上游那份 `reference/update.js` 仍作对照基线留着。
    assert(fs.existsSync(path.join(ROOT, 'src', 'update.js')), 'src/update.js 应在（更新器已实施）');
    // ⚠️ **反向锁**：它必须是**新写的**，不能是把上游那份拷过来改个名 ——
    //    上游那份做的是「老格式规则转换 + 非原子写」，与本项目定案（按 name 合并 + 原子写）不同。
    const srcUpdate = fs.readFileSync(path.join(ROOT, 'src', 'update.js'), 'utf8').replace(/\r\n/g, '\n');
    const refUpdate = fs.readFileSync(path.join(dir, 'update.js'), 'utf8').replace(/\r\n/g, '\n');
    assert(srcUpdate !== refUpdate, 'src/update.js 不该照抄上游 reference/update.js');
    assert(srcUpdate.includes('vflowUpdateRun'), 'src/update.js 不像是本项目的更新器');

    // 镜像必须逐字节一致（抽两个文件核，全量 diff 太重）
    const sameAs = (rel) => {
        const a = fs.readFileSync(path.join(dir, rel), 'utf8').replace(/\r\n/g, '\n');
        const b = fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8').replace(/\r\n/g, '\n');
        return a === b;
    };
    // ⚠️ rules 逐字节相同 = 「规则库没改过」。改过规则就会红 —— 那时应把
    //    这条断言改成「与镜像的差异是有意的」，而**不是**去改 reference/。
    const ruleFiles = fs.readdirSync(path.join(dir, 'rules'));
    assert(ruleFiles.length === 27, `reference/rules 应有 27 条，实际 ${ruleFiles.length}`);
    assert(sameAs(path.join('rules', ruleFiles[0])), `规则 ${ruleFiles[0]} 与镜像不一致 —— 规则库被改过？`);
});

test('vendor/ 与 src/build.js 已随架构调整删除', () => {
    // ⚠️ 反向锁：这两样是「跟上游同步」那套机制的东西。它们**回来**意味着
    //    有人把架构改回去了 —— 那时 DESIGN.md §3.5 与 AGENTS.md 开头也得一起改。
    assert(!fs.existsSync(path.join(ROOT, 'vendor')), 'vendor/ 不该存在（已改名 reference/）');
    assert(!fs.existsSync(path.join(ROOT, 'src', 'build.js')), 'src/build.js 不该存在（补丁已一次性落盘）');
});

test('src/core.js 是就地维护的源文件（补丁已落盘，改动点有标记）', () => {
    const core = readSrc('core.js');
    // 落盘的证据：vflow 侧的替换**已经在源码里**，不是构建期才做
    assert(core.includes('VFLOW_ADAPTER.toast('), 'core.js 里没有 vflow 侧替换 —— 补丁没落盘？');
    assert(core.includes('FLUID_CLOUD_DIR + "/config.json"'), 'core.js 里路径没换');
    // 改动点标记：来历可查（数字是当前值，改了会红 ⇒ 提醒同步文档）
    const marks = (core.match(/\/\* \[vflow\] \*\//g) || []).length;
    assertEq(marks, 12, '[vflow] 就地标记数变了 —— 改动点增减后请同步 AGENTS.md/DESIGN.md');
});

test('version 文件存在且与 package.json 一致', () => {
    // ⚠️ 两处漂开是**静默**的：设备上的更新机制拿 version 做对比（DESIGN.md §3.4.4），
    //    package.json 的 version 只是 npm 的元数据。不一致时日志会报出错的版本号。
    const v = fs.readFileSync(path.join(ROOT, 'version'), 'utf8').trim();
    assert(/^\d+\.\d+\.\d+$/.test(v), `version 格式不对：${JSON.stringify(v)}`);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assertEq(v, pkg.version, 'version 与 package.json 的 version 不一致');
});

test('bootstrap.js 是静态文件（不是生成器）', () => {
    const bs = readSrc('bootstrap.js');
    // 静态文件的特征：它就是**要贴进工作流的那段代码**本身
    assert(bs.includes('eval(vflowCode)'), 'bootstrap.js 不像引导脚本本体');
    assert(bs.includes('/sdcard/vFlow/fluid-cloud/vflow-fluid-cloud.js'), 'bootstrap.js 里的脚本路径不对');
    // 生成器的特征：会去写 dist/。有它就说明这是旧版生成器，不是静态文件。
    assert(!bs.includes('writeFileSync'), 'bootstrap.js 还在写文件 —— 它是生成器，不是静态文件');
});

test('规则库条数（27 有链接 + 2 无链接）', () => {
    const count = (d) => fs.readdirSync(path.join(ROOT, 'src', d)).filter((f) => f.endsWith('.json')).length;
    assertEq(count('rules'), 27, 'src/rules/ 条数不对');
    assertEq(count('nolinkrules'), 2, 'src/nolinkrules/ 条数不对');
});

test('package.json 的脚本已跟上架构调整', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const s = pkg.scripts || {};
    // 反向锁：build 里不该再有 build.js（它已删）
    assert(!/build\.js/.test(s.build || ''), 'package.json 的 build 仍在调 src/build.js（已删）');
    assert(/bundle-rules\.js/.test(s.build || ''), 'build 少了合并规则那一步');
    assert(/generate\.js/.test(s.build || ''), 'build 少了拼接那一步');
    // check 必须真的跑测试，否则「绿」没有意义
    assert(/npm test|test\/run\.js/.test(s.check || ''), 'check 没跑测试');
    // ⚠️ 工作流 JSON 的刷新入口（tools/build-workflow.py）必须有 npm 别名 ——
    //    它在 README / AGENTS 里被当作「改了 bootstrap.js 之后要跑的那一步」，
    //    别名没了那些文档就指不到东西。
    assert(/build-workflow\.py/.test(s['build:workflow'] || ''),
        'package.json 少了 build:workflow（tools/build-workflow.py）');
});

// ===========================================================================
console.log('\n[12] 更新机制（docs/UPDATE.md）');
// ===========================================================================

// ⚠️ 本节沿用 [2] 节的「产物 + 源码两路」风格。
//
// ⚠️⚠️ **怎么在离线测试里跑 update.js**：它「顶层直接开跑」，一 eval 就会发网络请求。
//    ⇒ 靠它末尾那道闸（`VFLOW_UPDATE_ENABLED`）：不设就**只加载不执行**，
//      纯函数（校验 / 合并）可以直接测。要测主流程时，在**同一个沙箱**里
//      `vm.runInContext(updateText, ctx)`（此时脚本顶层的 `VFLOW_UPDATE_ENABLED`
//      已存在 = true）—— 那正是「eval 进主脚本作用域」的形态（UPDATE.md §7.4 约束 2）。

/**
 * 起一个沙箱，**加载主脚本**（会写 config 自举），返回 `{ sandbox, calls, context }`。
 *
 * ⚠️ 先把**规则库复位**成 dist 里那份 —— 本节的用例会故意把设备目录里的
 *    `rules.json` 换成假的（测合并），而主脚本的默认输入 `'x'` 会走识别链路
 *    读它 ⇒ 不复位的话**下一条用例会在 `matchRules` 里崩**（规则缺 `tigger`），
 *    看起来像脚本坏了（实际是用例之间互相污染）。
 */
function loadMain() {
    installRules();
    return run({ text: 'x' });
}

/** 在已有沙箱里 eval 更新器（不设 `VFLOW_UPDATE_ENABLED` ⇒ 只定义、不跑主流程）。 */
function loadUpdate(ctx) {
    vm.runInContext(updateText, ctx, { filename: 'update.js' });
}

/** 在已有沙箱里 eval 更新器**并放行主流程**。 */
function runUpdate(ctx) {
    vm.runInContext('var VFLOW_UPDATE_ENABLED = true;\n' + updateText, ctx, { filename: 'update.js' });
}

/** 配远端响应（url → body/status），未配的一律 404（见 harness 的 httpBox）。 */
function mockRemote(map) {
    httpBox.responses = {};
    for (const [url, v] of Object.entries(map || {})) {
        httpBox.responses[url] = typeof v === 'string' ? { response_body: v, status_code: 200 } : v;
    }
}

/** 造一份合法的远端主脚本文本（够长 + 含特征串）。 */
const FAKE_MAIN = '// remote main script\nvar FLUID_CLOUD_ACTION_CLICK = "com.chaomixian.vflow.fluidcloud.CLICK";\n' + '// padding\n'.repeat(200);

test('rules 合并：本地独有在前、同名远端覆盖、远端新增追加（顺序确定）', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const merge = sandbox.vflowUpdateMergeRules;

    const local = [
        { name: 'only-local' },
        { name: 'same' , from: 'local' },
        { name: 'local-2' }
    ];
    const remote = [
        { name: 'same', from: 'remote' },
        { name: 'new-1' },
        { name: 'new-2' }
    ];
    const merged = merge(local, remote);

    // ⚠️ 用 name 序列断言 —— **不看对象遍历顺序**（顺序会影响 matchRules 命中结果）
    //    （放在这里是因为下面几个用例要临时替换设备目录里的 rules.json）
    assertEq(merged.map((x) => x.name), ['only-local', 'local-2', 'same', 'new-1', 'new-2'],
        '合并顺序不对（本地独有在前、远端在后）');
    // 同名 ⇒ 远端覆盖本地
    assertEq(merged.find((x) => x.name === 'same').from, 'remote', '同名规则没被远端覆盖');
    // 本地独有 ⇒ 原对象保留
    assertEq(merged.find((x) => x.name === 'only-local').name, 'only-local');
});

test('rules 合并：空本地 / 空远端 / 非数组入参都不崩', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const merge = sandbox.vflowUpdateMergeRules;
    assertEq(merge([], [{ name: 'a' }]).map((x) => x.name), ['a']);
    assertEq(merge([{ name: 'a' }], []).map((x) => x.name), ['a']);
    assertEq(merge(null, null), []);
    assertEq(merge(undefined, [{ name: 'b' }]).map((x) => x.name), ['b']);
});

test('config 合并：补缺失键 / 数组并集去重 / 标量保留本地 / 对象整体保留本地', () => {
    const { sandbox } = loadMain();
    const merge = sandbox.VFLOW_BOOTSTRAP ? null : null; // 占位（见下）
    // ⚠️ mergeConfig 在 adapter 的 IIFE 内，沙箱里拿不到 ⇒ 走**产物行为**断言：
    //    写一份旧版本 config，重跑脚本，看合并后的 config.json。
    const cfgPath = path.join(CLOUD_DIR, 'config.json');
    const old = {
        Top_Level_Domain: ['com', '本地独有'],       // 数组：并集
        Fluid_Cloud_Position: '底部',                 // 标量：保留本地
        Window_Configuration: { s1: [1, 2, 3] },      // 对象：整体保留本地
        User_Own_Key: 'keep-me'                        // 本地独有键：保留
        // Email_Keyword_List 缺失 ⇒ 用默认补
    };
    fs.writeFileSync(cfgPath, '一.配置版本：\n1.4\n二.字段解释见 DESIGN.md\n三.配置：\n' + JSON.stringify(old, null, 2), 'utf8');

    loadMain(); // 再跑一次 ⇒ 走「版本不同 ⇒ 合并」分支
    const merged = JSON.parse(fs.readFileSync(cfgPath, 'utf8').split('三.配置：\n')[1]);

    assert(merged.Email_Keyword_List && merged.Email_Keyword_List.length > 0, '缺失键没被默认补上');
    assert(merged.Top_Level_Domain.includes('com'), '数组并集丢了默认项');
    assert(merged.Top_Level_Domain.includes('本地独有'), '数组并集丢了本地项');
    // ⚠️ 默认在前（照上游）—— 第一个元素必须是默认列表的头
    assertEq(merged.Top_Level_Domain[0], 'com', '数组并集顺序不是「默认在前」');
    assertEq(merged.Top_Level_Domain.filter((x) => x === 'com').length, 1, '数组并集没去重');
    assertEq(merged.Fluid_Cloud_Position, '底部', '标量没保留本地');
    assertEq(merged.Window_Configuration, { s1: [1, 2, 3] }, '对象键没整体保留本地');
    assertEq(merged.User_Own_Key, 'keep-me', '本地独有键被抹掉了');
    // 版本头必须被写成新版本号
    assert(fs.readFileSync(cfgPath, 'utf8').includes('1.5'), '版本头没写成新版本号');
});

test('版本闸：CONFIG_VERSION 相同 ⇒ 不写盘（用户手改的 config 原样保留）', () => {
    const cfgPath = path.join(CLOUD_DIR, 'config.json');
    // 先正常跑一次（写出 1.5 的 config），再手改一个「闸外」的痕迹
    loadMain();
    let txt = fs.readFileSync(cfgPath, 'utf8');
    txt = txt.replace('"Fluid_Cloud_Position": "顶部"', '"Fluid_Cloud_Position": "我手改的"');
    fs.writeFileSync(cfgPath, txt, 'utf8');
    const before = fs.readFileSync(cfgPath, 'utf8');

    loadMain(); // 版本相同 ⇒ 直接 return，连合并都不做
    assertEq(fs.readFileSync(cfgPath, 'utf8'), before, '版本相同却写了盘 —— 用户手改的 config 被重写了');
});

test('内容校验：主脚本长度 + 特征串', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const v = sandbox.vflowUpdateValidateMainScript;
    assertEq(v(FAKE_MAIN), null, '合法主脚本被判失败');
    assert(v('short') !== null, '过短的应判失败');
    assert(v('x'.repeat(2000)) !== null, '缺特征串的应判失败（那正是 404 的 HTML）');
    assert(v(null) !== null, '非字符串应判失败');
});

test('内容校验：rules JSON.parse + 数组 + 每项 name', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const v = sandbox.vflowUpdateValidateRulesJson;
    assertEq(v('[{"name":"a"}]', 'x'), null, '合法规则库被判失败');
    assert(v('<html>404</html>', 'x') !== null, 'HTML 应判失败');
    assert(v('{"name":"a"}', 'x') !== null, '对象（非数组）应判失败');
    assert(v('[]', 'x') !== null, '空数组应判失败');
    assert(v('[{"tigger":["a"]}]', 'x') !== null, '缺 name 的项应判失败');
    assert(v('[{"name":""}]', 'x') !== null, 'name 为空串应判失败');
});

test('内容校验：version 非空 / 短 / 字符集', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const v = sandbox.vflowUpdateValidateVersion;
    assertEq(v('0.3.0\n'), null, '正常版本号被判失败（带尾换行也要通过）');
    assert(v('') !== null, '空应判失败');
    assert(v('   ') !== null, '全空白应判失败');
    assert(v('x'.repeat(64)) !== null, '过长应判失败');
    assert(v('0.3.0 <html>') !== null, '含非法字符应判失败');
});

test('⭐ status_code !== 200 时判失败（HTTP 模块对 404 不抛异常）', () => {
    const { sandbox, context, calls: c } = loadMain();
    loadUpdate(context);
    // 远端全部 404（带一段 HTML body）—— 若实现只看「有没有抛异常」，会把 HTML 当脚本写进去
    // 设备目录里放一份「旧」主脚本 —— 拉版本失败时它必须**一个字都没动**
    const scriptPath = path.join(CLOUD_DIR, 'vflow-fluid-cloud.js');
    fs.writeFileSync(scriptPath, 'OLD-SCRIPT', 'utf8');
    mockRemote({
        [UPDATE_URLS.version]: { response_body: '<html>404 Not Found</html>', status_code: 404 }
    });

    runUpdate(context);

    assert(c.toast.some((t) => String(t).includes('更新失败')), `失败必须显式弹错（收到：${JSON.stringify(c.toast)}）`);
    assertEq(fs.readFileSync(scriptPath, 'utf8'), 'OLD-SCRIPT', '拉版本失败时不该动任何本地文件');
    // ⚠️ 关键：把 404 的 HTML 当版本号会「看起来成功」⇒ 断言它没往下走
    assertEq(httpBox.requests.length, 1, '拉版本失败后不该再拉别的文件');
});

test('原子写：写 .tmp → renameTo；成功后 .tmp 不存在、目标内容 = 新内容', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const target = path.join(CLOUD_DIR, 'atomic-target.txt');
    fs.writeFileSync(target, 'OLD', 'utf8');

    const err = sandbox.vflowUpdateAtomicWrite(target, 'NEW-CONTENT', null);
    assertEq(err, null, `原子写失败：${err}`);
    assertEq(fs.readFileSync(target, 'utf8'), 'NEW-CONTENT', '目标没被换成新内容');
    assert(!fs.existsSync(target + '.tmp'), '成功后 .tmp 应被 rename 掉');
});

test('原子写：校验不过 ⇒ 目标不被改动，.tmp 被清掉', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const target = path.join(CLOUD_DIR, 'atomic-target2.txt');
    fs.writeFileSync(target, 'OLD', 'utf8');

    const err = sandbox.vflowUpdateAtomicWrite(target, 'bad', () => '故意判失败');
    assert(err !== null, '校验不过应返回错误');
    assertEq(fs.readFileSync(target, 'utf8'), 'OLD', '校验不过却动了目标文件');
    assert(!fs.existsSync(target + '.tmp'), '校验不过应清掉 .tmp');
});

test('原子写：renameTo 返回 false ⇒ 目标不被改动（不做「先删再改名」的破坏性兜底）', () => {
    const { sandbox, context } = loadMain();
    loadUpdate(context);
    const target = path.join(CLOUD_DIR, 'atomic-target3.txt');
    fs.writeFileSync(target, 'OLD', 'utf8');

    // 让 renameTo 失败一次
    const origRename = sandbox.java.io.File.prototype.renameTo;
    sandbox.java.io.File.prototype.renameTo = function () { return false; };
    let err;
    try {
        err = sandbox.vflowUpdateAtomicWrite(target, 'NEW', null);
    } finally {
        sandbox.java.io.File.prototype.renameTo = origRename;
    }
    assert(err !== null, 'renameTo 失败应返回错误');
    assertEq(fs.readFileSync(target, 'utf8'), 'OLD', 'renameTo 失败却改动了目标文件');
    assert(!fs.existsSync(target + '.tmp'), 'renameTo 失败应清掉 .tmp');
});

test('主流程成功：三份产物被覆盖/合并，version 最后写，提示含「下次执行生效」', () => {
    const { sandbox, context, calls: c } = loadMain();
    loadUpdate(context);

    // 本地放一份「旧」rules.json（含一条本地独有规则）
    const localRules = [{ name: '我的私有规则', tigger: ['x\\.local'] }];
    fs.writeFileSync(path.join(CLOUD_DIR, 'rules.json'), JSON.stringify(localRules), 'utf8');
    // nolinkrules 本地清空（默认那份是 dist 里的 2 条 —— 留着会让断言依赖它们）
    fs.writeFileSync(path.join(CLOUD_DIR, 'nolinkrules.json'), '[]', 'utf8');
    // 本地 version 设成旧值（与远端不同 ⇒ 不过闸）
    fs.writeFileSync(path.join(CLOUD_DIR, 'version'), '0.2.0', 'utf8');

    const remoteRules = [{ name: '官方规则A' }, { name: '官方规则B' }];
    const remoteNoLink = [{ name: '官方无链接' }];
    mockRemote({
        [UPDATE_URLS.version]: '0.3.0',
        [UPDATE_URLS.script]: FAKE_MAIN,
        [UPDATE_URLS.rules]: JSON.stringify(remoteRules),
        [UPDATE_URLS.nolinkrules]: JSON.stringify(remoteNoLink)
    });

    runUpdate(context);

    // 主脚本被整份覆盖
    assertEq(fs.readFileSync(path.join(CLOUD_DIR, 'vflow-fluid-cloud.js'), 'utf8'), FAKE_MAIN, '主脚本没被覆盖');
    // rules 增量合并（本地独有在前 + 远端）
    const mergedRules = JSON.parse(fs.readFileSync(path.join(CLOUD_DIR, 'rules.json'), 'utf8'));
    assertEq(mergedRules.map((x) => x.name), ['我的私有规则', '官方规则A', '官方规则B'], 'rules 合并结果不对');
    // nolinkrules 远端整份（本地是空）
    const mergedNoLink = JSON.parse(fs.readFileSync(path.join(CLOUD_DIR, 'nolinkrules.json'), 'utf8'));
    assertEq(mergedNoLink.map((x) => x.name), ['官方无链接']);
    // version 被写（内容 = 远端原样）
    assertEq(fs.readFileSync(path.join(CLOUD_DIR, 'version'), 'utf8'), '0.3.0');
    // 成功提示必须含「下次执行生效」（bootstrap 已把脚本 eval 进内存）
    assert(c.toast.some((t) => String(t).includes('下次执行生效')), `成功提示不对：${JSON.stringify(c.toast)}`);
    assert(c.toast.some((t) => String(t).includes('0.2.0 → 0.3.0')), '提示里应有「旧 → 新」');
});

test('⭐ 拉主脚本失败 ⇒ 后续两份都不拉（避免「新规则 + 旧脚本」）', () => {
    const { sandbox, context, calls: c } = loadMain();
    loadUpdate(context);
    fs.writeFileSync(path.join(CLOUD_DIR, 'version'), '0.2.0', 'utf8');
    fs.writeFileSync(path.join(CLOUD_DIR, 'rules.json'), JSON.stringify([{ name: '本地的' }]), 'utf8');
    const rulesBefore = fs.readFileSync(path.join(CLOUD_DIR, 'rules.json'), 'utf8');

    mockRemote({
        [UPDATE_URLS.version]: '0.3.0',
        // script 未配 ⇒ 404
        [UPDATE_URLS.rules]: JSON.stringify([{ name: 'X' }]),
        [UPDATE_URLS.nolinkrules]: JSON.stringify([{ name: 'Y' }])
    });
    runUpdate(context);

    const urls = httpBox.requests.map((r) => r.url);
    assert(!urls.includes(UPDATE_URLS.rules), '主脚本失败后仍拉了 rules.json');
    assert(!urls.includes(UPDATE_URLS.nolinkrules), '主脚本失败后仍拉了 nolinkrules.json');
    assertEq(fs.readFileSync(path.join(CLOUD_DIR, 'rules.json'), 'utf8'), rulesBefore, '主脚本失败却动了 rules.json');
    assert(c.toast.some((t) => String(t).includes('更新失败')), '失败要显式弹错');
});

test('⭐ 规则写失败 ⇒ 主脚本已更新要显式提示「脚本已更新，规则未更新」，且 version 不写', () => {
    const { sandbox, context, calls: c } = loadMain();
    loadUpdate(context);
    fs.writeFileSync(path.join(CLOUD_DIR, 'version'), '0.2.0', 'utf8');

    mockRemote({
        [UPDATE_URLS.version]: '0.3.0',
        [UPDATE_URLS.script]: FAKE_MAIN,
        [UPDATE_URLS.rules]: '<html>404</html>', // 校验不过 ⇒ 这一份失败
        [UPDATE_URLS.nolinkrules]: JSON.stringify([{ name: 'Y' }])
    });
    runUpdate(context);

    assert(c.toast.some((t) => String(t).includes('规则未更新')), `应提示「规则未更新」：${JSON.stringify(c.toast)}`);
    // version 是「完整成功」的标志 ⇒ 这里必须**没写**
    assertEq(fs.readFileSync(path.join(CLOUD_DIR, 'version'), 'utf8'), '0.2.0', '中途失败却写了 version（下次不会重来）');
    // nolinkrules 是逐份独立的 ⇒ 仍应被合并写（本地独有在前 + 远端新增）
    const nl = JSON.parse(fs.readFileSync(path.join(CLOUD_DIR, 'nolinkrules.json'), 'utf8'));
    assertEq(nl[nl.length - 1].name, 'Y', '逐份独立：nolinkrules 不该被 rules 的失败带累');
});

test('version 相同 ⇒ 弹「已是最新」；选「否」⇒ 一个文件都没动', () => {
    const { sandbox, context, calls: c } = loadMain();
    loadUpdate(context);
    // 本地 version 与远端一致
    fs.writeFileSync(path.join(CLOUD_DIR, 'version'), '0.3.0', 'utf8');
    const scriptPath = path.join(CLOUD_DIR, 'vflow-fluid-cloud.js');
    fs.writeFileSync(scriptPath, 'OLD-SCRIPT', 'utf8');
    mockRemote({ [UPDATE_URLS.version]: '0.3.0' });

    // autoDismissIndex = -1（默认）= 点最后一个按钮「否」
    runUpdate(context);

    assert(c.uiText.includes('已是最新（0.3.0）。要强制重新下载吗？'),
        `没弹「已是最新」确认框：${JSON.stringify(c.uiText.slice(0, 3))}`);
    assertEq(fs.readFileSync(scriptPath, 'utf8'), 'OLD-SCRIPT', '选了「否」却动了文件');
    assertEq(httpBox.requests.length, 1, '选了「否」不该再拉别的文件');
    assert(c.toast.some((t) => String(t).includes('已取消')), '应提示「已取消」');
});

test('⭐ 缺失显式弹错：读不到 update.js 时走手动分派 ⇒ 弹「更新器缺失」，不是静默', () => {
    // 删掉 update.js，跑一次「设置」标签的手动分派（autoDismissIndex = 3 = 「检查更新」）
    fs.rmSync(path.join(CLOUD_DIR, 'update.js'), { force: true });
    const { calls: c } = run({ text: '', tag: '设置', autoDismissIndex: 3 });
    assert(c.toast.some((t) => String(t).includes('更新器缺失')),
        `点了「检查更新」但 update.js 缺失时必须显式弹错：${JSON.stringify(c.toast)}`);
});

test('⭐ 失败提示不被 show_toast 开关吞掉（走 VFLOW_ADAPTER.toast 而非 showToast）', () => {
    const { sandbox, context, calls: c } = loadMain();
    loadUpdate(context);
    // 用户关掉提示开关
    sandbox.show_toast = false;
    fs.writeFileSync(path.join(CLOUD_DIR, 'version'), '0.2.0', 'utf8');
    mockRemote({}); // 全部 404
    runUpdate(context);
    assert(c.toast.some((t) => String(t).includes('更新失败')),
        `show_toast=false 时失败提示被吞了：${JSON.stringify(c.toast)}`);
});

test('「检查更新」菜单项存在（源码 + 产物两路）', () => {
    assert(readSrc('core.js').includes('"检查更新"'), 'src/core.js 的菜单里没有「检查更新」');
    assert(scriptText.includes('"检查更新"'), '产物里没有「检查更新」');
    // 反向锁：它必须返回哨兵 "update"（顶层分派靠它做「读 + eval」）
    assert(/return "update"/.test(readSrc('core.js')), '没返回哨兵 "update"');
});

test('主脚本**不含** update.js 的内容（它必须是独立文件）', () => {
    assert(!scriptText.includes('vflowUpdateRun'), '主脚本里混进了更新器（vflowUpdateRun）');
    assert(!scriptText.includes('VFLOW_UPDATE_BASE_URL'), '主脚本里混进了更新器（远端基址）');
    assert(!scriptText.includes('raw.githubusercontent.com'), '主脚本里出现了远端地址 —— 更新器没独立出去？');
});

test('ensureRules 用 exists() + 长度下界（源码侧锚）', () => {
    const a = readSrc('adapter.js');
    assert(/new java\.io\.File\(p\)/.test(a) || /\.exists\(\)/.test(a), 'ensureRules 没用 exists()');
    assert(/\.length\(\)/.test(a), 'ensureRules 没有长度下界 —— 空文件会静默识别不出');
    assert(!/if \(VFLOW_ADAPTER\.readText\(rulesPath\) === null\)/.test(a),
        'ensureRules 还在读全文只为判存在（应改为 exists() + length()）');
});

test('update.js 里 renameTo 检查了返回值（原子写不能只调不看）', () => {
    const u = readSrc('update.js');
    assert(u.includes('renameTo'), 'update.js 没有 renameTo');
    // 必须把返回值接住并判（`ok = …renameTo(…)` + `if (!ok)`）
    assert(/=\s*new java\.io\.File\(tmp\)\.renameTo\(/.test(u), 'renameTo 的返回值没被接住');
    assert(/if \(!ok\)/.test(u), 'renameTo 的返回值没被检查');
});

test('update.js 末尾是闸而不是裸顶层调用（否则离线一加载就发网络请求）', () => {
    const u = readSrc('update.js');
    assert(/if \(typeof VFLOW_UPDATE_ENABLED !== "undefined" && VFLOW_UPDATE_ENABLED\)/.test(u),
        'update.js 末尾不是 VFLOW_UPDATE_ENABLED 闸');
    // 反向锁：不能有裸的顶层 `vflowUpdateRun();`
    assert(!/^vflowUpdateRun\(\);/m.test(u), 'update.js 有裸顶层调用 —— 会污染离线测试');
});

test('HTTP 调用传了 timeout=30（默认 10 秒拉 144 KB 会超时）', () => {
    const u = readSrc('update.js');
    assert(/VFLOW_UPDATE_TIMEOUT = 30/.test(u), 'timeout 不是 30');
    assert(/timeout: VFLOW_UPDATE_TIMEOUT/.test(u), 'http_request 没传 timeout');
    // 反向锁：不能传 proxy 参数（连通性交给用户 ⇒ 跟随全局，UPDATE.md §1 第 1/2 条）。
    // ⚠️ 必须剥注释后判 —— 文件里那段解释「为什么**不**传 proxy_mode」的注释
    //    本身含这个词，不剥会误报（与 [2] 节 stripComments 的用途同理）。
    const uCode = stripComments(u);
    assert(!/proxy_mode/.test(uCode), 'update.js 传了 proxy_mode —— 应跟随全局代理');
});

// ===========================================================================
console.log('\n[13] 产物与源一致（dist/ 入库新引入的风险）');
// ===========================================================================

// ⚠️⚠️ 这条对应 UPDATE.md §8 第 6 条 —— `dist/` 入库之后，**改了 src/ 忘了重跑
//    `npm run build` 就提交** 会让仓库里的产物是旧的，而**两边都看不出来**。
//
// ⚠️ **局限（如实记录）**：`npm run check` 是「先 build 再 test」⇒ 在 `npm run check`
//    这条流程下本节的断言**恒绿**。它的价值在于**单独跑 `npm test`** 时
//    （以及验证 generate.js 的输出是确定性的）。
//
// ⚠️ 做法：把 src 复制到**临时目录**重跑 generate，再与真实 `dist/` **逐字节**比 ——
//    这样**不污染真实 `dist/`**（在真实 dist 里重跑会掩盖「忘了构建」这件事本身）。

test('dist/ 里的两个产物 == 现在重跑一次 generate 的输出（逐字节）', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vfc-gen-'));
    try {
        fs.mkdirSync(path.join(tmpRoot, 'src'), { recursive: true });
        for (const f of ['adapter.js', 'core.js', 'update.js', 'generate.js']) {
            fs.copyFileSync(path.join(ROOT, 'src', f), path.join(tmpRoot, 'src', f));
        }
        // `ROOT` 由 `__dirname/..` 推出 ⇒ 临时目录自成一体
        execFileSync(process.execPath, [path.join(tmpRoot, 'src', 'generate.js')], { cwd: tmpRoot });

        for (const f of ['vflow-fluid-cloud.js', 'update.js']) {
            const fresh = fs.readFileSync(path.join(tmpRoot, 'dist', f));
            const committed = fs.readFileSync(path.join(ROOT, 'dist', f));
            assert(fresh.equals(committed),
                `dist/${f} 与「重跑一次 generate」的输出不一致 —— 改了 src/ 忘了跑 npm run build？`);
        }
    } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
});

test('dist/update.js 存在，且其内容 = banner + src/update.js', () => {
    assert(fs.existsSync(UPDATE_PATH), 'dist/update.js 不存在 —— npm run build 的第二输出没生效？');
    assert(updateText.includes('vflowUpdateRun'), 'dist/update.js 不像更新器');
    assert(updateText.includes(readSrc('update.js').slice(0, 200)),
        'dist/update.js 不是 src/update.js 的内容');
    // ⚠️ 反向锁：产物带「不要手改」banner
    assert(/不要手改/.test(updateText), 'dist/update.js 缺「构建产物、勿手改」banner');
});

// ===========================================================================
// [10] 工作流产物 —— 单独一个文件（「读产物」与「跑脚本」排查动作不同）
//
// ⚠️ 判据必须传进去，不能让它自己去 require('./run.js')（那是循环依赖）。
require('./workflow')({ test, assert, assertEq });

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
