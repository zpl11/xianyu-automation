import uiautomator2 as u2
import time
import xml.etree.ElementTree as ET
import sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = u2.connect('192.168.1.58:5555')

print("1. 确保在搜索激活页，定位输入框...")
# 寻找当前输入框的内容节点（可能包含 gemini）
search_input = None
for elem in d(className="android.widget.EditText"):
    search_input = elem
    break
    
if not search_input:
    # 盲点顶部输入框区域以激活焦点
    d.click(300, 150)

time.sleep(1)

print("2. 强制清空并输入 workbuddy")
# 先模拟删除几次防止有遗留内容
for _ in range(10):
    d.press("del")
d.send_keys("workbuddy", clear=True)
time.sleep(2)

print("3. 点击搜索")
if d(description="搜索").exists:
    d(description="搜索").click()
elif d(text="搜索").exists:
    d(text="搜索").click()
else:
    d.click(1450, 150) # 盲点右上角搜索按钮位置

time.sleep(5)

print("4. 开始抓取...")
max_items = 30
collected_items = {}

scrolls = 0
while len(collected_items) < max_items and scrolls < 15:
    try:
        xml_str = d.dump_hierarchy()
    except Exception as e:
        print(f"Dump hierarchy failed: {e}")
        time.sleep(2)
        continue

    root = ET.fromstring(xml_str.encode('utf-8'))
    
    nodes = []
    for node in root.iter('node'):
        val = (node.get('text', '') or node.get('content-desc', '')).strip()
        if val:
            nodes.append(val)
            
    for i, val in enumerate(nodes):
        if val == '¥' and i + 1 < len(nodes):
            price = nodes[i+1]
            if price == '0' and i + 3 < len(nodes) and nodes[i+2] == '.01':
                 price = '0.01'
            elif '.' not in price and i + 2 < len(nodes) and nodes[i+2].startswith('.'):
                 price = price + nodes[i+2]
                 
            title = ""
            for j in range(i-1, max(-1, i-15), -1):
                t = nodes[j]
                if len(t) > 10 and "发布" not in t and "浏览" not in t and "小时前" not in t:
                    title = t.replace('\n', ' ')
                    if len(title) > 40:
                        title = title[:40] + "..."
                    break
                    
            sales = ""
            for j in range(i+2, min(len(nodes), i+6)):
                t = nodes[j]
                if "想要" in t or "已售" in t:
                    sales = t
                    break
            
            if title and title not in collected_items:
                collected_items[title] = {
                    'price': price,
                    'sales': sales
                }
                print(f"[{len(collected_items)}/{max_items}] 💰 ¥{price} | 📊 {sales} | 📦 {title}")
                sys.stdout.flush()
                
    if len(collected_items) >= max_items:
        break
        
    d.swipe(0.5, 0.8, 0.5, 0.2, 0.2)
    time.sleep(2)
    scrolls += 1

print("\n=== [Workbuddy] 数据聚合分析报告 ===")
print(f"共抓取 {len(collected_items)} 个相关商品数据：")
for t, info in collected_items.items():
    print(f"价格: ¥{str(info['price']).ljust(6)} | 销量热度: {str(info['sales']).ljust(8)} | 标题: {t}")
