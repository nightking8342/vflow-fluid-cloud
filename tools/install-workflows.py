#!/usr/bin/env python3
"""把「流体云」工作流在设备上建好（**一个工作流，两个触发器**）。

用法：
    python tools/install-workflows.py                 # 建缺失的；已存在则跳过
    python tools/install-workflows.py --force         # 删掉重建（⚠️ 卡片颜色会重新随机）
    python tools/install-workflows.py --dry-run       # 只打印打算做什么
    python tools/install-workflows.py --host X:8080

## 为什么需要它

「流体云」这个工作流**必须在设备上存在**（两个触发器都靠它），而它的 script 参数
是 `src/bootstrap.js` 的**全文**。手点粘贴不现实（脚本约 2 KB、还要逐字符对齐），
⇒ 只能走 API。

## 为什么是【一个】工作流挂【两个】触发器

两个触发源（剪贴板 / 岛按钮广播）跑的是**同一份脚本**，且脚本内部靠
`parseClickPayload(input)` 顶层分派，**不需要两个工作流**。
挂在一起还顺带解决了一件事：改 `bootstrap.js` 只需刷**一处**，
不存在「只更新了其中一个、两边行为不一致且不报错」。

⚠️ **代价（必须知道）**：vFlow 的 `VariableResolver` 对**未命中的触发器输出**
不是给空串，而是回退成字面量 `{{{stepId.outputId}}}`（**三个花括号**）——
`VariableResolver.kt:133` 的 `VObjectFactory.from("{${segment.rawExpression}}")`，
而 `rawExpression` 本身已含 `{{ }}`。
⇒ 一次执行里**必然有一路是 `{{{...}}}`**，脚本侧必须在 `src/adapter.js` 的
`input` 里显式认出来并当空处理（已实现，见那里的注释）。

## ⚠️⚠️ 为什么只能用 POST，不能用 PUT（实测，不是推断）

远程 API 的两个端点用的是**两个不同的请求模型**，形状要求相反：

| 端点 | 请求类 | `parameters` 的类型 | 裸值 | `{"type","value"}` 形状 |
|---|---|---|---|---|
| `POST /api/v1/workflows` | `SimpleCreateWorkflowRequest` | `Map<String, Any?>` | ✅ **正确** | ❌ **DTO 被原样落盘** |
| `PUT /api/v1/workflows/{id}` | `UpdateWorkflowRequest` | `Map<String, VObjectDto>` | ❌ **400** | ✅ 反序列化能过 |

（`WorkflowModels.kt:36` vs `:121`。）

**两个坑各踩一次才知道**：

1. `PUT` 传裸值 ⇒ `parseRequestBody` 返回 null ⇒ **400 Invalid request body**。
   报错信息完全不提是哪个字段，二分起来像大海捞针。
2. 于是改用 `{"type":"string","value":"..."}` 形状喂 `PUT` ⇒ **返回 0 success，
   但工作流一个字节都没变**（`handleUpdateWorkflow` 只回 `successResponse`，
   `WorkflowHandler.kt:247-252`，**从头到尾没调 `saveWorkflow`**）。
   这一条最危险 —— 脚本会兴高采烈地打印「更新成功」。

⇒ **本工具只用 POST**，并且把 `parameters` 写成**裸值**。
**不要**为了「统一形状」把这里改成 DTO —— 那会把工作流参数写成
`{"script": {"type":"string","value":"..."}}` 原样存进去，脚本从此读不到内容，
**且不报任何错**。

## ⚠️ `reentryBehavior` 无法通过 API 设置

`SimpleCreateWorkflowRequest`（`WorkflowModels.kt:49-60`）**没有这个字段**，
`UpdateWorkflowRequest` 也没有，`WorkflowJsonImportParser` 那条路也不吃它
（`handleImportWorkflow` 构造 `Workflow` 时没传）。实测：POST 里带上它，
返回 0，落盘仍是默认的 `block_new`。

`block_new` 是**可接受**的（执行链很短：收广播 → 启动 Activity → 结束），
用户 2026-10-07 的真机验证就是在 `block_new` 下通过的。
若将来确实需要改，只能在 App 的工作流编辑器里手工设。
"""

import argparse
import io
import json
import pathlib
import sys
import urllib.error
import urllib.request

# ⚠️ Windows 控制台默认 GBK —— 中文会乱码甚至抛 UnicodeEncodeError。
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOOTSTRAP = ROOT / "src" / "bootstrap.js"

DEVICE_ID = "claude-code-fluid-cloud"
DEVICE_NAME = "Claude Code"

TAG = "fluid-cloud"

WORKFLOW_NAME = "流体云"

# ⚠️ 曾经是**两个**工作流（「流体云」+「流体云·点击」）。用户 2026-10-08 指出
#    「既然用的都是一个脚本，其实不用分成两个工作流」⇒ 合并成一个。
#    这个名字留在这里是为了**清理旧的那个**（见 `remove_legacy_workflow`）。
LEGACY_CLICK_NAME = "流体云·点击"

# 触发器 id 被 `inputs` 引用 ⇒ 必须是**固定值**，不能交给服务端生成
CLIPBOARD_TRIGGER_ID = "fluid_trigger_clipboard"
BROADCAST_TRIGGER_ID = "fluid_click_broadcast"
JS_STEP_ID = "fluid_js_main"

# ⚠️ 这三个 key 是 `src/adapter.js` 里读的（`inputs.click_uri` / `.clipboard_text`），
#    改名必须两边一起改，否则脚本读不到 → **静默走空**（表现为「点了没反应」）。
#
# ⚠️⚠️ `trigger_label` 的值必须是 `[[__trigger_label]]`，**不能写成 `{{vars.__trigger_label}}`**：
#    服务端 `WorkflowNormalizer.normalizeParameters` → `VariablePathParser.canonicalizeVariableReference`
#    会把 `{{vars.xxx}}` **规范化成 `[[xxx]]`**，而 `[[ ]]` 形式**不受**这一步影响、原样落盘。
#    ⇒ 回读核对必须按**规范化后的形态**比，否则永远报「不一致」（实测踩过）。
INPUTS = {
    # 点击回传：广播触发器的 data_uri（形如 `vflowfc://click?act=…&url=…`）
    "click_uri": "{{%s.data_uri}}" % BROADCAST_TRIGGER_ID,
    # 剪贴板内容
    "clipboard_text": "{{%s.text_content}}" % CLIPBOARD_TRIGGER_ID,
    # 触发器标签（命名变量，未设置时是空串）
    "trigger_label": "[[__trigger_label]]",
}

# 回读时期望的 `inputs`（= INPUTS 经服务端规范化之后的样子）。
EXPECTED_INPUTS = dict(INPUTS, trigger_label="{{vars.__trigger_label}}")


def build_payload(script_text):
    """构造 POST 的请求体。

    ⚠️ `parameters` 一律用**裸值**（不是 `{"type","value"}` 形状）——
    理由见文件头。写成 DTO 形状会**静默落盘成 DTO**，脚本从此读不到内容。
    """
    return {
        "name": WORKFLOW_NAME,
        "description": "复制/打开分享链接 → 识别 → 超级岛提示 → 全屏或小窗打开；"
                       "以及接收岛/浮窗按钮的点击广播并执行打开。"
                       "由 fluid-cloud 项目生成，勿手工改脚本（见 fluid-cloud/README.md）。",
        "isEnabled": True,
        "triggers": [
            {
                "id": CLIPBOARD_TRIGGER_ID,
                "moduleId": "vflow.trigger.clipboard",
                "indentationLevel": 0,
                "isDisabled": False,
                "parameters": {
                    "mode": "core",               # core / standard（见 ClipboardTriggerModule）
                    "__trigger_label": "剪切板",   # 命名变量 [[__trigger_label]] 的来源
                },
            },
            {
                "id": BROADCAST_TRIGGER_ID,
                "moduleId": "vflow.trigger.broadcast",
                "indentationLevel": 0,
                "isDisabled": False,
                "parameters": {
                    # ⚠️ action 必须与 core.js 的 FLUID_CLOUD_ACTION_CLICK **逐字一致**
                    "actions": ["com.chaomixian.vflow.fluidcloud.CLICK"],
                    # ⚠️ scheme 必须声明：IntentFilter 里未声明 scheme 时，
                    #    带 data 的 intent 直接判 NO_MATCH_DATA（见广播触发器设计文档）
                    "data_schemes": ["vflowfc"],
                    "categories": [],
                    "match_mode": "exact",
                    "cooldown_ms": 0,
                    # 标签：这条路径**不读** tiggerTag（顶层分派靠 input 的形态），
                    # 填上是为了在编辑器里一眼看清哪个是哪个。
                    "__trigger_label": "点击",
                },
            },
        ],
        "steps": [{
            "id": JS_STEP_ID,
            "moduleId": "vflow.system.js",
            "indentationLevel": 0,
            "isDisabled": False,
            "parameters": {"script": script_text, "inputs": INPUTS},
        }],
        "tags": [TAG],
    }


def http(method, url, body=None, token=None, timeout=40):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        # ⚠️ 不能直接 json.loads —— 服务端出错时可能回 HTML/空体，
        #    那会抛 JSONDecodeError 把**真正的 HTTP 状态**盖掉。
        try:
            return json.loads(raw)
        except Exception:
            return {"code": e.code, "message": "HTTP %d: %s" % (e.code, raw[:400])}


def get_token(base):
    r = http("POST", base + "/api/v1/auth/token",
             {"deviceId": DEVICE_ID, "deviceName": DEVICE_NAME})
    if r.get("code") != 0:
        print("获取 token 失败：", r, file=sys.stderr)
        sys.exit(1)
    return r["data"]["token"]


def find_workflow(base, token, name):
    """按名字找。返回 (id, 摘要对象) 或 (None, None)。"""
    r = http("GET", base + "/api/v1/workflows", token=token)
    if r.get("code") != 0:
        return None, None
    for w in r["data"]["workflows"]:
        if w["name"] == name:
            return w["id"], w
    return None, None


def remove_legacy_workflow(base, token, dry):
    """删掉旧的「流体云·点击」（合并成一个工作流之后它不再需要）。

    ⚠️ 不删的后果是**两个工作流都监听同一个广播** ⇒ 一次点击跑两遍，
    第二遍大概率撞 `block_new` 被忽略，但**看起来像随机不触发**。
    """
    wid, _ = find_workflow(base, token, LEGACY_CLICK_NAME)
    if not wid:
        return True
    if dry:
        print("「%s」是旧的两工作流方案的遗留 —— 将删除（dry-run）" % LEGACY_CLICK_NAME)
        return True
    d = http("DELETE", "%s/api/v1/workflows/%s" % (base, wid), None, token)
    if d.get("code") != 0:
        print("删除旧的「%s」失败：%s %s"
              % (LEGACY_CLICK_NAME, d.get("code"), d.get("message")), file=sys.stderr)
        return False
    print("已删除旧的「%s」（id=%s）—— 它已并入「%s」" % (LEGACY_CLICK_NAME, wid, WORKFLOW_NAME))
    return True


def install(base, token, script_text, force, dry):
    payload = build_payload(script_text)
    existing, _ = find_workflow(base, token, WORKFLOW_NAME)

    if existing and not force:
        print("「%s」已存在（id=%s）—— 跳过。要刷新脚本用 --force。"
              % (WORKFLOW_NAME, existing))
        return True

    if dry:
        print("「%s」%s（dry-run）" % (WORKFLOW_NAME, "将删除重建" if existing else "将创建"))
        return True

    if existing:
        d = http("DELETE", "%s/api/v1/workflows/%s" % (base, existing), None, token)
        if d.get("code") != 0:
            print("删除「%s」失败：%s %s" % (WORKFLOW_NAME, d.get("code"), d.get("message")),
                  file=sys.stderr)
            return False
        print("已删除旧的「%s」（id=%s）" % (WORKFLOW_NAME, existing))

    r = http("POST", base + "/api/v1/workflows", payload, token)
    if r.get("code") == 0:
        print("创建「%s」成功，id = %s" % (WORKFLOW_NAME, r["data"]["id"]))
        return True
    print("创建「%s」失败：%s %s" % (WORKFLOW_NAME, r.get("code"), r.get("message")),
          file=sys.stderr)
    return False


def verify(base, token, script_text):
    """创建后回读，确认 script / 两个触发器 / inputs 都对。

    ⚠️ 这一步不是多余的：`parameters` 形状写错时**服务端返回 0**，
    只有回读才看得出来（DTO 形状会把 `{"type":"string","value":"..."}` 原样存进去）。
    """
    wid, _ = find_workflow(base, token, WORKFLOW_NAME)
    if not wid:
        print("  ⚠️ 回读不到「%s」" % WORKFLOW_NAME, file=sys.stderr)
        return False
    w = http("GET", "%s/api/v1/workflows/%s" % (base, wid), token=token)
    if w.get("code") != 0:
        print("  ⚠️ 回读失败" % (), file=sys.stderr)
        return False
    data = w["data"]
    ok = True

    got = (data.get("steps") or [{}])[0].get("parameters", {}).get("script")
    if got != script_text:
        ok = False
        print("  ⚠️ script 与 src/bootstrap.js 不一致（落盘 %s 字符）"
              % (len(got) if isinstance(got, str) else type(got).__name__), file=sys.stderr)

    mods = [t.get("moduleId") for t in (data.get("triggers") or [])]
    for want in ("vflow.trigger.clipboard", "vflow.trigger.broadcast"):
        if want not in mods:
            ok = False
            print("  ⚠️ 缺触发器 %s（实际 %s）" % (want, mods), file=sys.stderr)

    got_inputs = (data.get("steps") or [{}])[0].get("parameters", {}).get("inputs") or {}
    if got_inputs != EXPECTED_INPUTS:
        ok = False
        print("  ⚠️ inputs 不一致：\n      期望 %s\n      实际 %s"
              % (json.dumps(EXPECTED_INPUTS, ensure_ascii=False),
                 json.dumps(got_inputs, ensure_ascii=False)), file=sys.stderr)

    if ok:
        print("  ✓ 回读核对通过（script %d 字符、触发器 %d 个、inputs 3 键）"
              % (len(script_text), len(mods)))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.1.32:8080")
    ap.add_argument("--force", action="store_true",
                    help="已存在也删掉重建（⚠️ 卡片颜色会重新随机）")
    ap.add_argument("--dry-run", action="store_true", help="只打印打算做什么")
    args = ap.parse_args()

    base = "http://" + args.host

    if not BOOTSTRAP.exists():
        print("缺少 %s" % BOOTSTRAP, file=sys.stderr)
        sys.exit(1)
    script_text = BOOTSTRAP.read_text(encoding="utf-8")

    # ⚠️ 24 KB 是 `BaseHandler.readBody` 的硬上限（见 docs/DESIGN.md §7.2）。
    #    引导脚本约 3.4 KB，离上限很远 —— 这个检查是防「将来有人把完整脚本塞进来」。
    n = len(json.dumps({"script": script_text}).encode("utf-8"))
    print("引导脚本 %d 字符 / 约 %d 字节（API 上限 24 KB）" % (len(script_text), n))
    if n > 24000:
        print("⚠️ 引导脚本超过 API 的 24 KB 上限，会 400", file=sys.stderr)
        sys.exit(1)

    token = get_token(base)
    print("token ok")

    ok = install(base, token, script_text, args.force, args.dry_run)
    # ⚠️ 清理旧工作流要**排在安装之后**：安装失败时先别动旧的，免得两头空。
    if ok:
        ok = remove_legacy_workflow(base, token, args.dry_run) and ok

    if ok and not args.dry_run:
        print("\n回读核对：")
        ok = verify(base, token, script_text) and ok

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
