#!/usr/bin/env python3
"""把 `src/bootstrap.js` 刷进 `workflow/流体云.json`（工作流产物的**唯一刷新入口**）。

用法：
    python tools/build-workflow.py            # 就地刷新
    python tools/build-workflow.py --check    # 只检查是否同步（不一致 ⇒ 退出码 1）

## 这是什么

工作流的产物是**一份 JSON 文件**（`workflow/流体云.json`），不是 API 调用。
它由用户在 vFlow 里「导出工作流」得到，此后**以文件为准**：
要改脚本 / 触发器 / 卡片样式，都改这份 JSON，再导入回设备（`tools/deploy-workflow.py`）。

其中**只有两个键是派生的**，其余（名字 / 描述 / 卡片颜色 / 触发器 / 标签）是
**人维护**的 —— 本脚本只刷这两个，**不碰其它任何字节**：

| 键 | 来源 |
|---|---|
| `steps[0].parameters.script` | `src/bootstrap.js` 全文 |
| `steps[0].parameters.inputs` | 下面的 `INPUTS` 常量 |

⚠️ **为什么必须自动刷，不能手改**：`bootstrap.js` 改了却忘了同步 JSON，
表现是「导入之后设备上跑的还是旧脚本」—— **两边都看不出来**。
（这正是本项目一直靠 `install-workflows.py --force` 人工记住的那件事。）

## ⚠️⚠️ 为什么是 Python 而不是 Node（别顺手改回去）

JSON 由 **Gson** 写出（vFlow 的 `WorkflowJsonCodec.toExportJson`），它有两个
Node 的 `JSON` **做不到**的保形特征：

1. **区分 int 与 float**：`cooldown_ms` 是 `0.0`（Double），而 JS 只有一种 number
   ⇒ `JSON.parse` + `JSON.stringify` 会写成 `0`，**diff 里就多一处噪声**。
   Python 的 `json` 天然区分 `int` / `float`。
2. **HTML-safe 转义**：Gson 默认把 `< > & = '` 转义成 `\\u003c` 之类
   （本文件里 `=` 出现 **158** 次、`<` 1 次），而 `JSON.stringify` 原样输出。

⇒ 两处都靠 `gson_dumps()` 复刻。**并且脚本每次运行都做一次保形自检**
（读原文 → 立刻重序列化 → 与原文逐字节比），不相同就**拒绝写盘**：
那说明 JSON 不是这个形状（换了导出路径、或 Gson 改了转义规则），
此时盲写会把整个文件重排成一行噪声，而**功能上完全看不出来**。

## 与 `tools/install-workflows.py` 的关系

那个脚本（走 API `POST /api/v1/workflows` 建工作流）**已被本套取代**，原因见
`docs/DESIGN.md`：API 那条路**写不全字段**（`SimpleCreateWorkflowRequest`
没有 `reentryBehavior` / `silentExecution` / `logLevel` / `cardIconRes` …），
而导出/导入这条路**字段是完整的**（2026-10-08 vFlow 侧的
`WorkflowJsonCodec` 收敛之后）。
"""

import argparse
import io
import json
import pathlib
import sys

# ⚠️ Windows 控制台默认 GBK —— 中文会乱码甚至抛 UnicodeEncodeError。
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOOTSTRAP = ROOT / "src" / "bootstrap.js"
WORKFLOW = ROOT / "workflow" / "fluid-cloud.json"

# `steps[0].parameters.inputs` —— 两个触发器各一路 + 触发器标签。
#
# ⚠️ 这三个键是 `src/adapter.js` 的 `input` / `tiggerTag` 读的
#    （`inputs.click_uri` / `inputs.clipboard_text` / `inputs.trigger_label`），
#    改名必须两边一起改，否则脚本读不到 → **静默走空**（表现为「点了没反应」）。
#
# ⚠️ 触发器 id（`fluid_click_broadcast` / `fluid_trigger_clipboard`）必须与
#    JSON 里 `triggers[].id` **逐字一致** —— 改了一处忘另一处，同样是静默失效。
#
# ⚠️ `trigger_label` 写成**规范化后**的 `{{vars.__trigger_label}}`：
#    服务端 `WorkflowNormalizer` 会把 `[[__trigger_label]]` 也归一成这个形态，
#    写归一后的值才能让「设备导出」与「仓库这份」**逐字节可比**。
INPUTS = {
    "click_uri": "{{fluid_click_broadcast.data_uri}}",
    "clipboard_text": "{{fluid_trigger_clipboard.text_content}}",
    "trigger_label": "{{vars.__trigger_label}}",
}

# Gson 的 HTML-safe 转义集合（`JsonWriter.HTML_SAFE_REPLACEMENT_CHARS`）。
HTML_SAFE = "<>&='"


def gson_dumps(obj):
    """复刻 Gson 的紧凑序列化：单行、无空格、HTML-safe 转义、保留 int/float 之别。

    ⚠️ 全局替换这 5 个字符是安全的 —— JSON 语法本身不用它们，
    出现只可能在字符串字面量内部。
    """
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    for ch in HTML_SAFE:
        s = s.replace(ch, "\\u%04x" % ord(ch))
    return s


def first_difference(a, b):
    """返回首个差异的可读描述（用于保形自检失败时定位）。"""
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            lo = max(0, i - 60)
            return ("@%d\n      重新序列化 %r\n      原文       %r"
                    % (i, a[lo:i + 60], b[lo:i + 60]))
    return "长度不同：%d vs %d（前 %d 字符相同）" % (len(a), len(b), n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="只检查是否已同步，不改文件（不一致时退出码 1）")
    args = ap.parse_args()

    if not WORKFLOW.exists():
        print("缺少 %s" % WORKFLOW, file=sys.stderr)
        sys.exit(1)
    if not BOOTSTRAP.exists():
        print("缺少 %s" % BOOTSTRAP, file=sys.stderr)
        sys.exit(1)

    raw = WORKFLOW.read_text(encoding="utf-8")
    doc = json.loads(raw)

    # ── 保形自检 ──────────────────────────────────────────────────────────
    # 解析后立刻重序列化，必须与原文逐字节相同。不相同 ⇒ **拒绝写盘**。
    reser = gson_dumps(doc)
    if reser != raw:
        print("⚠️ 保形自检失败 —— %s 不是 Gson 写出的形状，拒绝改写。" % WORKFLOW.name,
              file=sys.stderr)
        print("   首个差异 %s" % first_difference(reser, raw), file=sys.stderr)
        print("   （若确属预期，请先查清 Gson 的转义/数值规则，再更新本脚本的 gson_dumps）",
              file=sys.stderr)
        sys.exit(2)

    # ── 定位派生键 ────────────────────────────────────────────────────────
    steps = doc.get("steps") or []
    if len(steps) != 1:
        print("⚠️ 期望恰好 1 个步骤（vflow.system.js），实际 %d 个" % len(steps), file=sys.stderr)
        sys.exit(1)
    params = steps[0].setdefault("parameters", {})

    script = BOOTSTRAP.read_text(encoding="utf-8").replace("\r\n", "\n")

    changes = []

    old_script = params.get("script")
    if old_script != script:
        changes.append("script：%s 字符 → %s 字符"
                       % (len(old_script) if isinstance(old_script, str) else "缺失", len(script)))
        params["script"] = script

    if params.get("inputs") != INPUTS:
        changes.append("inputs：%s → %s"
                       % (json.dumps(params.get("inputs"), ensure_ascii=False),
                          json.dumps(INPUTS, ensure_ascii=False)))
        # ⚠️ 整体替换而不是逐个 setdefault：INPUTS 的键序与文件里的一致
        #    （click_uri / clipboard_text / trigger_label），故不会打乱。
        params["inputs"] = dict(INPUTS)

    if not changes:
        print("✓ %s 已是最新（script %d 字符、inputs %d 键）"
              % (WORKFLOW.name, len(script), len(INPUTS)))
        return

    if args.check:
        print("⚠️ %s 与 src/bootstrap.js 不同步：" % WORKFLOW.name, file=sys.stderr)
        for c in changes:
            print("   - %s" % c, file=sys.stderr)
        print("   跑 `python tools/build-workflow.py` 刷新，再导入设备。", file=sys.stderr)
        sys.exit(1)

    out = gson_dumps(doc)
    WORKFLOW.write_text(out, encoding="utf-8", newline="\n")

    print("✓ 已刷新 %s" % WORKFLOW.name)
    for c in changes:
        print("   - %s" % c)
    print("   ⇒ 下一步：python tools/deploy-workflow.py（推到设备并导入）")


if __name__ == "__main__":
    main()
