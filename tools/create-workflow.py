#!/usr/bin/env python3
"""通过 vFlow 远程 API 创建「流体云」工作流。

用法：
    python tools/create-workflow.py            # 创建
    python tools/create-workflow.py --update   # 已存在则更新（按名字找）

## 为什么用 API 而不是手点

工作流里有一步是 120 KB 的脚本，手工粘贴到手机上不现实（剪贴板/编辑器都吃不消）。
API 是唯一可行的路径。

## 前置

1. 设备上开启「远程 Web 服务」（默认 8080）
2. `dist/*.json` 与 `dist/vflow-fluid-cloud.js` 已 push 到 `/sdcard/vFlow/fluid-cloud/`
"""

import argparse
import io
import json
import pathlib
import sys
import urllib.request
import urllib.error

# ⚠️ Windows 控制台默认 GBK —— 中文与 emoji 会乱码甚至抛 UnicodeEncodeError。
#    显式改成 UTF-8（本仓库在 xposed-js-verify 的探针里踩过同款坑）。
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# ROOT = fluid-cloud/（本文件的上一级）
ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

DEVICE_ID = "claude-code-fluid-cloud"
DEVICE_NAME = "Claude Code"
WORKFLOW_NAME = "流体云"


def http(method, url, body=None, token=None, timeout=60):
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
        #    那会抛 JSONDecodeError 把**真正的 HTTP 状态**盖掉（实测踩过）。
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
    r = http("GET", base + "/api/v1/workflows", token=token)
    if r.get("code") != 0:
        return None
    for w in r["data"]["workflows"]:
        if w["name"] == name:
            return w["id"]
    return None


def build_payload(script_text):
    """构造创建工作流的请求体。

    ⚠️ 三个 id 是**我们自己定**的（API 允许传 id），不是服务端生成的 ——
    这样下面引用触发器输出时才能写出 `{{trigger.text_content}}`。
    """
    trigger_step_id = "fluid_trigger_clipboard"
    js_step_id = "fluid_js_main"

    return {
        "name": WORKFLOW_NAME,
        "description": "复制/打开分享链接 → 识别 → 超级岛提示 → 全屏或小窗打开。"
                       "由 fluid-cloud 项目生成，勿手工改脚本（见 fluid-cloud/README.md）。",
        "isEnabled": False,   # 先不启用 —— 确认能跑通再开
        "triggers": [
            {
                "id": trigger_step_id,
                "moduleId": "vflow.trigger.clipboard",
                "indentationLevel": 0,
                "isDisabled": False,
                "parameters": {
                    "mode": "standard",
                    # 触发器标签：脚本靠它判断「本次是哪条触发源」
                    # （三处同名 `__trigger_label`，见 docs/fork/trigger-label-design.md）
                    "__trigger_label": "剪切板",
                },
            }
        ],
        "steps": [
            {
                "id": js_step_id,
                "moduleId": "vflow.system.js",
                "indentationLevel": 0,
                "isDisabled": False,
                "parameters": {
                    "script": script_text,
                    "inputs": {
                        # ⚠️ 值是**字符串形式的变量引用**，由 JsModule 在 execute 时解析
                        #    （见 JsModule.kt:107-117 的 `hasVariableReference` 分支）。
                        #    不是直接把值嵌进来 —— 嵌进来的话每次执行都拿到创建时的旧值。
                        "text": "{{%s.text_content}}" % trigger_step_id,
                        "trigger_label": "[[__trigger_label]]",
                    },
                },
            }
        ],
        "tags": ["fluid-cloud"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.1.32:8080")
    ap.add_argument("--update", action="store_true", help="已存在则覆盖")
    args = ap.parse_args()

    base = "http://" + args.host

    # ⚠️⚠️ 贴进工作流的是**引导脚本**（约 2 KB），不是完整脚本（113 KB）——
    #    vFlow 远程 API 的请求体上限是 **24 KB**（`BaseHandler.readBody` 的
    #    `CharArray(contentLength)`，见 DESIGN.md §4.6）。完整脚本 POST 不进去，
    #    会被截断成非法 JSON ⇒ `parseRequestBody` 返回 null ⇒ 400 Invalid request body。
    #    引导脚本改成「从设备文件读完整脚本并 eval」，于是脚本更新只需 adb push。
    #
    # ⚠️ 引导脚本在 **src/** 下、是个**静态文件**（不是构建产物）——
    #    架构调整（DESIGN.md §3.5）删掉了它的生成器，内容就是最终要用的东西。
    script_path = ROOT / "src" / "bootstrap.js"
    full_path = DIST / "vflow-fluid-cloud.js"
    if not script_path.exists():
        print("缺少 %s" % script_path, file=sys.stderr)
        sys.exit(1)

    script_text = script_path.read_text(encoding="utf-8")
    payload_len = len(json.dumps({"script": script_text}).encode("utf-8"))
    print("引导脚本 %d 字符 / 约 %d 字节（API 上限 24 KB）" % (len(script_text), payload_len))
    if payload_len > 24000:
        print("⚠️ 引导脚本超过 API 的 24 KB 上限，会 400", file=sys.stderr)
        sys.exit(1)
    if not full_path.exists():
        print("⚠️ %s 不存在 —— 工作流能建起来，但设备上必须已有该文件" % full_path, file=sys.stderr)

    token = get_token(base)
    print("token ok")

    existing = find_workflow(base, token, WORKFLOW_NAME)
    payload = build_payload(script_text)

    if existing:
        if not args.update:
            print("工作流「%s」已存在（id=%s）。加 --update 覆盖。" % (WORKFLOW_NAME, existing))
            sys.exit(0)
        r = http("PUT", "%s/api/v1/workflows/%s" % (base, existing), payload, token)
        print("更新：", r.get("code"), r.get("message"))
    else:
        r = http("POST", base + "/api/v1/workflows", payload, token)
        print("创建：", r.get("code"), r.get("message"))
        if r.get("code") == 0:
            print("id =", r["data"]["id"])

    if r.get("code") != 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
