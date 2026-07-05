"""
平板调试工具 - 从闲鱼App提取完整5维数据
同时尝试捕获App的网络请求API端点

用法: python tablet_debug.py
"""
import uiautomator2 as u2
import time
import xml.etree.ElementTree as ET
import re
import json
import sys

d = u2.connect('192.168.1.58')
W, H = d.window_size()
print(f'✅ 平板已连接: {W}x{H}')

# 1. 打开闲鱼并确保在首页
print('\n=== 1. 回到闲鱼首页 ===')
d.app_start('com.taobao.idlefish')
time.sleep(4)
for _ in range(3):
    d.press('back')
    time.sleep(0.5)

# 2. 搜索指定商品
print(f'\n=== 2. 搜索商品 ===')
keyword = sys.argv[1] if len(sys.argv) > 1 else '沐沐工作室'

# 点击搜索区域
xml = d.dump_hierarchy()
root = ET.fromstring(xml.encode('utf-8'))
for node in root.iter('node'):
    text = (node.get('text','') or node.get('content-desc','')).strip()
    if '搜索' in text and '跳转' in text:
        bounds = node.get('bounds','')
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
        if m:
            d.click((int(m.group(1))+int(m.group(3)))//2, (int(m.group(2))+int(m.group(4)))//2)
            break
time.sleep(3)

# 输入关键词
for node in ET.fromstring(d.dump_hierarchy().encode('utf-8')).iter('node'):
    if 'EditText' in node.get('class',''):
        bounds = node.get('bounds','')
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
        if m:
            d.click((int(m.group(1))+int(m.group(3)))//2, (int(m.group(2))+int(m.group(4)))//2)
            break
time.sleep(1)

try: d.clear_text()
except: pass
time.sleep(0.5)
d.send_keys(keyword)
time.sleep(1)

# 搜索
if d(description="搜索").exists:
    d(description="搜索").click()
else:
    d.press('enter')
time.sleep(5)

# 3. 找搜索结果中的商品
print(f'\n=== 3. 搜索结果 ===')
xml = d.dump_hierarchy()
root = ET.fromstring(xml.encode('utf-8'))

# 找所有含"人想要"的商品
items = []
for node in root.iter('node'):
    text = (node.get('text','') or node.get('content-desc','')).strip()
    if '人想要' in text:
        bounds = node.get('bounds','')
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
        if m:
            x = (int(m.group(1))+int(m.group(3)))//2
            y = (int(m.group(2))+int(m.group(4)))//2
            items.append((text, x, y))
            print(f'  📦 [{bounds}] {text[:60]}')

if not items:
    print('❌ 未找到商品')
    sys.exit(1)

# 4. 打开第一个商品
print(f'\n=== 4. 打开商品详情 ===')
d.click(items[0][1], items[0][2])
time.sleep(5)

# 5. 提取完整5维数据
print(f'\n=== 5. 5维数据提取 ===')
xml = d.dump_hierarchy()
root = ET.fromstring(xml.encode('utf-8'))

texts = []
for node in root.iter('node'):
    t = (node.get('text','') or node.get('content-desc','')).strip()
    bounds = node.get('bounds','')
    if t: texts.append((t, bounds))

# 显示所有文本
print('\n详情页文本:')
for t, b in texts:
    print(f'  [{b}] {t}')

# 提取关键数据
full_text = '\n'.join([t for t,_ in texts])

print('\n=== 统计结果 ===')
stats = {
    '标题': '',
    '价格': '',
    '浏览数 👁': 0,
    '想要数 ❤️': 0,
    '收藏数 ⭐': 0,
    '留言数 💬': 0,
    '评价数 📝': 0,
}

# 标题
for t,_ in texts:
    if len(t) > 15 and '¥' not in t and '想要' not in t and '浏览' not in t:
        stats['标题'] = t[:60]
        break

# 价格
for t,_ in texts:
    m = re.search(r'[¥￥]\s*(\d+(?:\.\d{1,2})?)', t)
    if m: stats['价格'] = m.group(1); break

# 浏览数: "浏览" 后面的数字
for i, (t,_) in enumerate(texts):
    if t == '浏览' and i+1 < len(texts):
        try: stats['浏览数 👁'] = int(texts[i+1][0])
        except: pass

# 想要数: "想要" 后面的数字
for i, (t,_) in enumerate(texts):
    if t == '想要' and i+1 < len(texts):
        try: stats['想要数 ❤️'] = int(texts[i+1][0])
        except: pass

# 收藏数: "收藏按钮" 后面的数字
for i, (t,_) in enumerate(texts):
    if '收藏' in t and '按钮' in t and i+1 < len(texts):
        try: stats['收藏数 ⭐'] = int(texts[i+1][0])
        except: pass

# 留言数: "评论按钮" 后面的数字
for i, (t,_) in enumerate(texts):
    if '评论' in t and '按钮' in t and i+1 < len(texts):
        try: stats['留言数 💬'] = int(texts[i+1][0])
        except: pass

for k,v in stats.items():
    print(f'  {k}: {v}')

# 6. 如果有评论按钮，点击查看详细评论
print(f'\n=== 6. 查看评论详情 ===')
for t, bounds in texts:
    if '评论' in t and '按钮' in t:
        m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', bounds)
        if m:
            x = (int(m.group(1))+int(m.group(3)))//2
            y = (int(m.group(2))+int(m.group(4)))//2
            d.click(x, y)
            print(f'点击评论: ({x},{y})')
            time.sleep(3)
            xml2 = d.dump_hierarchy()
            root2 = ET.fromstring(xml2.encode('utf-8'))
            comment_texts = []
            for node in root2.iter('node'):
                t = (node.get('text','') or node.get('content-desc','')).strip()
                if t: comment_texts.append(t)
            print('\n评论页面文本:')
            for t in comment_texts[:30]:
                print(f'  {t}')
            break

print('\n✅ 调试完成')
