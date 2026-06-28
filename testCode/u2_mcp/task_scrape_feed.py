import sys
import io
import time
import xml.etree.ElementTree as ET
import uiautomator2 as u2

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

d = u2.connect('192.168.1.58:5555')
collected_items = {} 
max_items = 50

print(f"🚀 启动自动化滑屏抓取，目标: {max_items} 个商品...")

scrolls = 0
while len(collected_items) < max_items and scrolls < 40:
    try:
        xml_str = d.dump_hierarchy()
    except Exception as e:
        print(f"[网络断连保护] 获取屏幕节点失败，重试中... 错误: {e}")
        time.sleep(3)
        # 尝试重新连接
        d = u2.connect('192.168.1.58:5555')
        continue
        
    root = ET.fromstring(xml_str.encode('utf-8'))
    
    nodes = []
    for node in root.iter('node'):
        val = (node.get('text', '') or node.get('content-desc', '')).strip()
        if val:
            nodes.append(val)
            
    # 分析当前屏幕节点
    for i, val in enumerate(nodes):
        if val == '¥' and i + 1 < len(nodes):
            price = nodes[i+1]
            
            # 找到前文中最长的一段文字作为标题
            title = ""
            for j in range(i-1, max(-1, i-20), -1):
                t = nodes[j]
                if len(t) > 6 and t not in ['推荐', '附近', '关注', '消息', '首页']:
                    title = t.replace('\n', ' ')
                    if len(title) > 35:
                        title = title[:35] + "..."
                    break
            
            if title and title not in collected_items:
                collected_items[title] = price
                print(f"[{len(collected_items)}/{max_items}] 💰 ¥{price} | 📦 {title}")
                sys.stdout.flush()
                
    if len(collected_items) >= max_items:
        break
        
    d.swipe(0.5, 0.8, 0.5, 0.2, 0.2)
    time.sleep(2)
    scrolls += 1

print("\n=== 数据聚合分析 ===")
for t, p in collected_items.items():
    print(f"价格: ¥{p.ljust(6)} | {t}")
