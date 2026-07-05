"""
显示捕获的 Web API 数据详情
"""
import json

with open("web_captured_apis.jsonl") as f:
    lines = f.readlines()

print(f"总记录数: {len(lines)}\n")

# 按API分类
from collections import Counter
api_counter = Counter()

for line in lines:
    d = json.loads(line)
    api = d.get("api_name", "")
    if not api:
        api = "(unknown)"
    api_counter[api] += 1

print("API端点列表:")
for api, count in api_counter.most_common():
    print(f"  {api:60s} x{count}")

# 显示搜索API的data keys
print("\n\n搜索API的数据结构:")
for line in lines:
    d = json.loads(line)
    if "pc.search" in d.get("api_name", ""):
        print(f"\nAPI: {d['api_name']}")
        print(f"Ret: {d.get('ret', [''])[:80]}")
        keys = d.get("data_keys", [])
        print(f"Data keys: {keys}")
        # Check if resultList exists
        url = d.get("url", "")
        print(f"URL: {url[:150]}")
        break

# 检查是否有详情页数据
print("\n\n详情API检查:")
for line in lines:
    d = json.loads(line)
    if "detail" in d.get("api_name", "").lower():
        print(f"Found detail API: {d['api_name']}")
        print(f"  data_keys: {d.get('data_keys', [])}")
        print(f"  5dim: {d.get('5dim', {})}")
        break
else:
    print("(没有详情API - 需要先打开商品详情页)")
