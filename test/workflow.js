#!/usr/bin/env node
/**
 * 工作流产物（`workflow/fluid-cloud.json`）的一致性检查。
 *
 * 跑法：npm test（或 node test/run.js，本文件被它 require）
 *
 * ⚠️ **为什么单独一个文件**：`test/run.js` 是「跑脚本、看行为」，
 *    这里是「读产物、看形状」—— 两者失败时的排查动作完全不同
 *    （前者去看 `src/`，后者去看工作流 JSON / vFlow 侧）。
 *
 * ⚠️⚠️ **为什么要有这一组断言**：工作流 JSON 里的**每一个键都是「写错了不报错」**的形态 ——
 *    触发器 id 改了 ⇒ `inputs` 里的 `{{<id>.xxx}}` 解析不到（脚本拿到 `{{{...}}}`，当空处理）；
 *    `inputs` 键改了 ⇒ 脚本读不到（走空）；`moduleId` 改了 ⇒ 工作流根本跑不起来但**能存能显示**。
 *    这些在离线测试里**全都测不到**（离线测试直接构造 `inputs`，不读工作流 JSON）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = path.join(ROOT, 'workflow', 'fluid-cloud.json');

/** 读原始文本（**不 JSON.parse** —— 下面有两条断言必须看原文）。 */
function rawText() {
    return fs.readFileSync(WORKFLOW, 'utf8');
}

function doc() {
    return JSON.parse(rawText());
}

/**
 * 复刻 Gson 的紧凑序列化（`tools/build-workflow.py` 的 `gson_dumps` 的 JS 版）。
 *
 * ⚠️ 保留 int / float 之别靠 JS **做不到**（只有一种 number）——
 *    所以这里只用来验**转义**那一半，数值形态由 Python 那边保证。
 */
function gsonLike(obj) {
    return JSON.stringify(obj).replace(/[<>&=']/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

module.exports = function registerWorkflowChecks({ test, assert, assertEq }) {
    console.log('\n[10] 工作流产物（workflow/fluid-cloud.json）');

    test('工作流 JSON 存在且可解析', () => {
        assert(fs.existsSync(WORKFLOW), `缺少 ${path.relative(ROOT, WORKFLOW)}`);
        const d = doc();
        assertEq(d.name, '流体云', '工作流名字变了（deploy/run 脚本按名字找它）');
        assertEq(d.tags, ['fluid-cloud'], 'tags 变了（用于在 App 里认出来）');
    });

    test('⭐ 恰好一个步骤，且是 vflow.system.js', () => {
        const steps = doc().steps || [];
        assertEq(steps.length, 1, '步骤数不是 1 —— bootstrap 只有一个 JS 步骤');
        assertEq(steps[0].moduleId, 'vflow.system.js', '步骤模块不是 JS 脚本模块');
        assertEq(steps[0].id, 'fluid_js_main', '步骤 id 变了');
    });

    test('⭐ 恰好三个触发器：剪贴板 + 广播 + 手动', () => {
        const triggers = doc().triggers || [];
        assertEq(triggers.map((t) => t.moduleId).sort(),
            ['vflow.trigger.broadcast', 'vflow.trigger.clipboard', 'vflow.trigger.manual'],
            '触发器集合变了 —— 三条触发路各一个，少一个就少一条触发路');
        // ⚠️ 触发器 id 被 `inputs` 引用 ⇒ 必须是固定值，不能交给服务端生成
        assertEq(triggers.map((t) => t.id).sort(),
            ['fluid_click_broadcast', 'fluid_trigger_clipboard', 'fluid_trigger_manual'],
            '触发器 id 变了 —— inputs 里的引用会解析不到（静默走空）');
    });

    test('⭐ 手动触发器带标签「设置」，且与 core.js 的常量逐字一致', () => {
        const manual = (doc().triggers || []).find((t) => t.moduleId === 'vflow.trigger.manual');
        assert(manual, '没有手动触发器');
        // ⚠️⚠️ 必须是**触发器**而不是步骤：vFlow 手动执行时
        //    `triggerStepId = workflow.manualTrigger()?.id`，而 `TriggerLabel.labelFor`
        //    只在 `workflow.triggers` 里找 ⇒ 写成步骤的话标签恒为空串，
        //    core.js 拿不到「设置」⇒ **点了执行什么都没发生**（静默）。
        assertEq(manual.parameters.__trigger_label, '设置',
            '手动触发器的标签变了 —— core.js 靠它分流到设置界面');

        // 与源码常量逐字对齐（两处字面量必须一致）
        const core = fs.readFileSync(path.join(ROOT, 'src', 'core.js'), 'utf8');
        const m = /var VFLOW_MANUAL_LABEL = "([^"]+)"/.exec(core);
        assert(m, 'core.js 里找不到 VFLOW_MANUAL_LABEL');
        assertEq(manual.parameters.__trigger_label, m[1],
            '工作流里手动触发器的标签与 core.js 的 VFLOW_MANUAL_LABEL 不一致 —— 静默失效');

        // 与其它标签不能撞车（撞了会让识别那条路误进设置界面）
        const others = (doc().triggers || [])
            .filter((t) => t.moduleId !== 'vflow.trigger.manual')
            .map((t) => t.parameters.__trigger_label);
        assert(!others.includes(manual.parameters.__trigger_label),
            `手动触发器的标签与其它触发器撞车了（${others.join(' / ')}）`);
    });

    test('⭐ script 是 src/bootstrap.js 全文（逐字节）', () => {
        const bs = fs.readFileSync(path.join(ROOT, 'src', 'bootstrap.js'), 'utf8')
            .replace(/\r\n/g, '\n');
        const script = doc().steps[0].parameters.script;
        assertEq(script, bs,
            '工作流里的 script 与 src/bootstrap.js 不一致 —— 跑 `python tools/build-workflow.py` 刷新');
    });

    test('⭐ inputs 三键，键名与 adapter.js 读的逐字一致', () => {
        const inputs = doc().steps[0].parameters.inputs || {};
        assertEq(Object.keys(inputs).sort(),
            ['click_uri', 'clipboard_text', 'trigger_label'],
            'inputs 的键变了 —— adapter.js 的 input / tiggerTag 会读不到（静默走空）');
        // ⚠️ 值必须引用**存在的**触发器 id（上面已断言 id 集合，这里断引用指向它们）。
        //    ⚠️ 例外：`trigger_label` 是**命名变量** `{{vars.__trigger_label}}`，
        //    它的来源是触发器的 `__trigger_label` 参数，**不是**某个触发器的输出
        //    ⇒ `vars.` 命名空间合法，其余必须落在触发器 id 上。
        const ids = (doc().triggers || []).map((t) => t.id);
        for (const [key, ref] of Object.entries(inputs)) {
            const m = /^\{\{([^.}]+)\./.exec(ref);
            assert(m, `inputs.${key} 不是 {{<来源>.<字段>}} 形态：${JSON.stringify(ref)}`);
            if (m[1] === 'vars') continue;   // 命名变量，不是触发器输出
            assert(ids.includes(m[1]),
                `inputs.${key} 引用了不存在的触发器 id「${m[1]}」（实际有 ${ids.join(' / ')}）`);
        }
        // 反向锁：`trigger_label` 必须是命名变量形态 —— 写成某个触发器的输出
        // 会在「另一个触发器命中」时解析不到（静默走空，标签判断全部 false）。
        assert(/^\{\{vars\./.test(inputs.trigger_label),
            'inputs.trigger_label 必须是 {{vars.__trigger_label}}（命名变量），而不是触发器输出');
    });

    test('⚠️ 广播触发器声明了 scheme —— 不声明则带 data 的 intent 直接 NO_MATCH_DATA', () => {
        const bc = (doc().triggers || []).find((t) => t.moduleId === 'vflow.trigger.broadcast');
        assert(bc, '没有广播触发器');
        assertEq(bc.parameters.actions, ['com.chaomixian.vflow.fluidcloud.CLICK'],
            'action 变了 —— 必须与 src/core.js 的 FLUID_CLOUD_ACTION_CLICK 逐字一致');
        assertEq(bc.parameters.data_schemes, ['vflowfc'], 'scheme 变了');
    });

    test('⭐ 工作流 JSON 是 Gson 写出的形状（HTML-safe 转义）', () => {
        // ⚠️ 这条防的是「有人用 JS/手写工具重排了这个文件」：Gson 默认把 < > & = '
        //    转义成 \uXXXX（本文件里 = 有 158 处），而 JSON.stringify 不转义。
        //    重排之后**功能完全正常**，但 diff 会变成整个文件一行噪声。
        const raw = rawText();
        assert(raw.indexOf('\n') === -1, '工作流 JSON 不该有换行（Gson 输出是单行）');
        for (const ch of '<>&=\'') {
            assert(raw.indexOf(ch) === -1,
                `原文里有裸的 ${JSON.stringify(ch)} —— 这不是 Gson 写出的形状`);
        }
        assert(/\\u003d/.test(raw), '没有 \\u003d 转义 —— 形状与 Gson 输出不符');
        // 整份文档重序列化后必须与原文**逐字节相同**（数值形态除外，那个由 Python 侧保证）
        const again = gsonLike(doc());
        // ⚠️ int/float 的差异（cooldown_ms: 0.0 → 0）会让这一条**必然不同**，
        //    故只比「去掉数字尾随 .0 之后」的形态。
        const normalize = (s) => s.replace(/(\d)\.0(?=[,\]])/g, '$1');
        assertEq(normalize(again), normalize(raw),
            '工作流 JSON 重序列化后与原文不同 —— 形状被改过');
    });

    test('⚠️ 工作流 JSON 声明了「不做行尾转换」（.gitattributes）', () => {
        // ⚠️⚠️ 本机 `core.autocrlf=true`（Windows 默认），没有这条规则的话
        //    克隆到别处时工作流 JSON 会被检出成 CRLF ⇒ 保形自检失败（**拒绝写盘**）、
        //    本文件的「不该有换行」断言变红。而**本机（工作区是 LF）完全测不出来**。
        //    本仓库已踩过同形的坑（见 vFlow 主仓库 FORK.md：谱文件被写成 CRLF）。
        const ga = path.join(ROOT, '.gitattributes');
        assert(fs.existsSync(ga), '缺少 .gitattributes —— workflow/*.json 会被 CRLF 化');
        const text = fs.readFileSync(ga, 'utf8');
        assert(/^workflow\/\*\.json\s+-text\s*$/m.test(text),
            '.gitattributes 里少了 `workflow/*.json -text`（用 -text 而不是 eol=lf，' +
            '因为保形自检要求逐字节一致）');
    });

    test('脚本侧不引用已被删除的工具（防文档漂移）', () => {
        // ⚠️ `tools/install-workflows.py` 已删除（改走导入导出）。留着引用会让人
        //    去找一个不存在的文件。
        for (const rel of ['src/adapter.js', 'test/run.js', 'tools/run.py']) {
            const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            assert(!/install-workflows/.test(text),
                `${rel} 仍在引用已删除的 tools/install-workflows.py`);
        }
    });
};
