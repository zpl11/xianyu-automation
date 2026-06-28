import sys
import os
import time
import json
import re
import xml.etree.ElementTree as ET

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from atomic_tools.xianyu_atomic_tools import dump_ui_hierarchy, scroll_safe, _get_device

def execute_market_scan(target_capacity=50):
    """
    物理层爬虫状态机：执行非线性滚动并抽取首页商品节点数据向量。
    """
    _get_device() # 初始化连接
    collected_signatures = set()
    dataset = []
    
    print("[*] 启动前端数据流嗅探引擎...")
    
    # 限制最大滚动迭代栈，防死循环
    for iteration in range(25):
        try:
            xml_dom = dump_ui_hierarchy()
            root = ET.fromstring(xml_dom)
            
            node_texts = []
            for elem in root.iter():
                text_attr = elem.attrib.get('text', '').strip()
                desc_attr = elem.attrib.get('content-desc', '').strip()
                val = text_attr if text_attr else desc_attr
                if val:
                    node_texts.append(val)
            
            # 采用特征向量启发式匹配：价格锚点 或 需求锚点
            new_items_in_frame = 0
            for idx, text_val in enumerate(node_texts):
                is_price = re.match(r'^¥?\s*\d+(\.\d+)?$', text_val) is not None
                is_demand = "人想要" in text_val or "刚刚想要" in text_val
                
                if is_price or is_demand:
                    # 回溯寻找字符串长度 > 4 的文本作为商品标题基准
                    title_candidate = "Unknown"
                    for offset in range(1, 5):
                        if idx - offset >= 0:
                            candidate = node_texts[idx - offset]
                            if len(candidate) >= 4 and "¥" not in candidate and "想要" not in candidate:
                                title_candidate = candidate
                                break
                    
                    # 避免去重碰撞
                    if title_candidate not in collected_signatures and title_candidate != "Unknown":
                        collected_signatures.add(title_candidate)
                        dataset.append({
                            "title": title_candidate,
                            "metric_anchor": text_val
                        })
                        new_items_in_frame += 1
                        
            print(f"[*] 迭代栈 [{iteration}] -> 帧内新增独立商品: {new_items_in_frame} | 总聚合量: {len(dataset)}")
            
            if len(dataset) >= target_capacity:
                print(f"[+] 达到容量截断阈值 ({target_capacity})，终止嗅探。")
                break
                
            # 采用绝对稳定的基础滑动，规避 scroll_safe 算法在特定机型上的边界锁死
            d = _get_device()
            d.swipe(0.5, 0.8, 0.5, 0.2, 0.2)
            time.sleep(3.5) # 延长重绘等待时间
            
        except Exception as e:
            print(f"[!] 嗅探循环出现异常突变: {str(e)}")
            time.sleep(1)
            
    # 数据序列化落地
    out_path = os.path.join(os.path.dirname(__file__), "market_dataset.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(dataset[:target_capacity], f, ensure_ascii=False, indent=2)
        
    print(f"[+] 数据拓扑固化完成 -> {out_path}")

if __name__ == "__main__":
    execute_market_scan(50)
