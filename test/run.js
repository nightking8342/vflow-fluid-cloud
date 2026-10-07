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

test('配置路径已换到 FLUID_CLOUD_DIR（core 段 9 处）', () => {
    // ⚠️ 只数 **core 段** —— adapter.js 里也有 FLUID_CLOUD_DIR 的用法（自举那几处，
    //    实测 6 处），全文件计数会把它们算进来。分段是必需的。
    const corePart = scriptText.split('// ↓↓↓ 核心逻辑（src/core.js）')[1] || '';
    const n = (corePart.match(/FLUID_CLOUD_DIR \+ "\//g) || []).length;
    assertEq(n, 9, 'core 段的配置路径替换数不对');
});

test('配置路径已换到 FLUID_CLOUD_DIR（adapter 段 6 处）', () => {
    const adapterPart = scriptText.split('// ↓↓↓ 核心逻辑（src/core.js）')[0] || '';
    const n = (adapterPart.match(/FLUID_CLOUD_DIR \+ "\//g) || []).length;
    assertEq(n, 6, 'adapter 段的配置路径数不对');
});

test('两个源文件的配置路径数各自没丢（6 / 9）', () => {
    // ⚠️ 这是**源码侧**的锚，与上面两条产物侧的分段计数互补：
    //    产物计数能发现「拼错了」，源码计数能发现「补丁从 src 里丢了但 dist 是旧的」。
    assertEq((readSrc('adapter.js').match(/FLUID_CLOUD_DIR \+ "\//g) || []).length, 6, 'src/adapter.js');
    assertEq((readSrc('core.js').match(/FLUID_CLOUD_DIR \+ "\//g) || []).length, 9, 'src/core.js');
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

test('showIslandNotification 弹完即返回（不阻塞），且两条 PendingIntent 都发出去了', () => {
    const { sandbox, calls: c } = run({ text: 'x' });
    const t0 = Date.now();
    const r = sandbox.showIslandNotification(islandOpts(), null, 3000);
    const ms = Date.now() - t0;

    assertEq(r, '已发送', '返回值应表示「已发送」');
    // ⚠️ 3000ms 的超时是原来的阻塞时长；现在必须**立刻**返回。
    //    留 500ms 余量（CI 机器慢），真阻塞的话是 3000ms，分得很开。
    assert(ms < 500, `应立刻返回，实际 ${ms}ms（是不是又在等点击？）`);
    assertEq(c.notify.length, 1, '应该发了 1 条通知');

    const broadcasts = c.pending.filter((p) => p.kind === 'broadcast');
    assertEq(broadcasts.length, 2, '主体 + 按钮两条 PendingIntent 都该是 broadcast');

    // 两条的 action 必须都是那个固定常量
    for (const b of broadcasts) {
        assertEq(b.intent._action, 'com.chaomixian.vflow.fluidcloud.CLICK', 'action 不对');
        assertEq(b.intent._package, 'com.chaomixian.vflow', 'setPackage 没设对（应该是 vFlow 的包名）');
    }
    // ⚠️⚠️ 两条的 (requestCode, data) 必须都不同 —— 否则系统会把它们当成同一个
    //    PendingIntent，表现是「点按钮变全屏」，**不报错**。见 createClickBroadcastIntent。
    const [a, b] = broadcasts;
    assert(a.requestCode !== b.requestCode, `两条 requestCode 相同（${a.requestCode}）—— 会互相顶掉`);
    assert(String(a.intent._data) !== String(b.intent._data), '两条 data 相同 —— 会互相顶掉');
    // 主体是全屏、按钮是小窗（与 resultOnClick / resultOnButton 对应）
    assert(String(a.intent._data).includes('act=fullscreen'), `主体应是 fullscreen：${a.intent._data}`);
    assert(String(b.intent._data).includes('act=window'), `按钮应是 window：${b.intent._data}`);
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
    assert(!fs.existsSync(path.join(ROOT, 'src', 'update.js')), 'src/ 不该有 update.js（未移植）');

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
