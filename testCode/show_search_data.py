"""
显示搜索结果API的数据详情
"""
import json

with open("web_captured_apis.jsonl") as f:
    lines = f.readlines()

# 找到 pc.search (非 shade 和 activate) 的数据
for line in lines:
    d = json.loads(line)
    api = d.get("api_name", "")
    if api == "mtop.taobao.idlemtopsearch.pc.search":
        print(f"API: {api}")
        print(f"Ret: {d.get('ret', [''])}")
        print(f"Data keys: {d.get('data_keys', [])}")
        url = d.get("url", "")
        print(f"URL: {url[:200]}")
        break

# 找到 activate 的数据
print("\n\n--- pc.search.activate ---")
for line in lines:
    d = json.loads(line)
    api = d.get("api_name", "")
    if "item.search.activate" in api:
        print(f"API: {api}")
        print(f"Ret: {d.get('ret', [''])}")
        print(f"Data keys: {d.get('data_keys', [])}")
        break

# 找到 index.get 的数据
print("\n\n--- index.get ---")
for line in lines:
    d = json.loads(line)
    api = d.get("api_name", "")
    if "index.get" in api:
        print(f"API: {api}")
        print(f"Ret: {d.get('ret', [''])}")
        print(f"Data keys: {d.get('data_keys', [])}")
        break
