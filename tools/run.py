#!/usr/bin/env python3
"""通过 vFlow 远程 API 跑一次「流体云」工作流，并取执行日志。

用法：
    python tools/run.py                      # 用剪贴板当前内容
    python tools/run.py --text "分享文案"     # 指定输入文本
    python tools/run.py --tag QQ              # 指定触发器标签

## 为什么要有它

真机上验证时，`adb logcat` 读不到工作流内部的脚本输出（vFlow 把脚本日志写进
工作流日志，不是 logcat）。API 的 `/logs` 端点是唯一能拿到脚本 `console.log` 的路径。

⚠️ **前提**：工作流里的脚本用的是**剪贴板触发器的输出**（`{{trigger.text_content}}`）。
   用 `--text` 时我们**先写剪贴板**再执行 —— 这样走的是与真机完全相同的那条数据通路，
   而不是绕过触发器塞变量（后者测不出触发器接线是否正确）。
"""

import argparse
import io
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

DEVICE_ID = "claude-code-fluid-cloud"
WORKFLOW_NAME = "流体云"


def http(method, url, body=None, token=None, timeout=90):
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
        try:
            return json.loads(raw)
        except Exception:
            return {"code": e.code, "message": "HTTP %d: %s" % (e.code, raw[:400])}
    except Exception as e:
        return {"code": -1, "message": "%s: %s" % (type(e).__name__, e)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="192.168.1.32:8080")
    ap.add_argument("--text", default=None, help="写进剪贴板的文本（模拟「复制分享文案」）")
    ap.add_argument("--tag", default=None, help="触发器标签覆盖（默认不动，用工作流里配的）")
    ap.add_argument("--wait", type=float, default=20.0, help="等执行结束的秒数")
    args = ap.parse_args()

    base = "http://" + args.host

    tok = http("POST", base + "/api/v1/auth/token",
               {"deviceId": DEVICE_ID, "deviceName": "Claude Code"})
    if tok.get("code") != 0:
        print("取 token 失败：", tok, file=sys.stderr)
        sys.exit(1)
    token = tok["data"]["token"]

    # 找工作流
    r = http("GET", base + "/api/v1/workflows", token=token)
    wf_id = None
    for w in r.get("data", {}).get("workflows", []):
        if w["name"] == WORKFLOW_NAME:
            wf_id = w["id"]
            break
    if not wf_id:
        print("没找到工作流「%s」—— 先跑 tools/deploy-workflow.py 把它导入设备" % WORKFLOW_NAME,
              file=sys.stderr)
        sys.exit(1)
    print("工作流 id =", wf_id)

    # 写剪贴板（走真实数据通路）
    if args.text is not None:
        try:
            import subprocess
            # adb shell 里中文/引号很麻烦 —— 用 base64 传，设备侧解码
            import base64
            b64 = base64.b64encode(args.text.encode("utf-8")).decode("ascii")
            subprocess.run(
                ["adb", "shell",
                 "echo %s | base64 -d > /data/local/tmp/_fc_clip.txt && "
                 "am broadcast -a clipper.set -e text \"$(cat /data/local/tmp/_fc_clip.txt)\" >/dev/null 2>&1 || true"
                 % b64],
                check=False)
            print("⚠️ 写剪贴板这一步依赖设备上有 clipper 之类的工具；"
                  "没有的话请手动复制文本到剪贴板后重跑（不加 --text）")
        except Exception as e:
            print("写剪贴板失败：", e, file=sys.stderr)

    # 执行
    ex = http("POST", "%s/api/v1/workflows/%s/execute" % (base, wf_id),
              {"async": False, "timeout": int(args.wait) + 10}, token)
    print("执行：", ex.get("code"), ex.get("message"))
    exec_id = ex.get("data", {}).get("execution_id") or ex.get("data", {}).get("id")
    if not exec_id:
        print(json.dumps(ex, ensure_ascii=False, indent=2)[:2000])
        sys.exit(1)
    print("execution_id =", exec_id)

    time.sleep(args.wait)

    # 取日志
    logs = http("GET", "%s/api/v1/executions/%s/logs" % (base, exec_id), token=token)
    print("\n=== 执行日志 ===")
    data = logs.get("data") or {}
    entries = data.get("logs") or data.get("entries") or []
    if isinstance(entries, list) and entries:
        for line in entries:
            if isinstance(line, dict):
                print(line.get("message") or json.dumps(line, ensure_ascii=False))
            else:
                print(line)
    else:
        print(json.dumps(logs, ensure_ascii=False, indent=2)[:4000])


if __name__ == "__main__":
    main()
