"""
显示 activate API 的完整响应数据
"""
import json

with open("web_captured_apis.jsonl") as f:
    lines = f.readlines()

# 找到 activate API 的响应
for line in lines:
    d = json.loads(line)
    api = d.get("api_name", "")
    if "activate" in api:
        print(f"API: {api}")
        url = d.get("url", "")
        print(f"URL: {url[:200]}")
        print(f"Status: {d.get('status', '?')}")
        print(f"Ret: {d.get('ret', [''])}")
        print(f"Data keys: {d.get('data_keys', [])}")
        print()
        print("完整响应数据:")
        # 读取原始JSONL中保存的数据有限 - 我们需要查看Playwright捕获的原始响应
        # 幸运的是我们在URL中有请求参数
        print(f"URL params: {url.split('?')[1] if '?' in url else ''}")
        break

# 现在让我们看看数据保存的内容 - 我们的handler没有保存原始body
# 需要重新捕获，这次保存完整的activate响应
print("\n\n--- 注意 ---")
print("当前的捕获器没有保存原始响应体。")
print("需要修改脚本以保存 activate API 的完整响应。")
print()

# 显示所有有data_keys的记录，看activate的数据结构
print("所有 'activate' 相关记录:")
for i, line in enumerate(lines):
    d = json.loads(line)
    api = d.get("api_name", "")
    if "activate" in api:
        url = d.get("url", "")
        keys = d.get("data_keys", [])
        print(f"  [{i}] keys={keys}")
        print(f"       url={url[:120]}")
