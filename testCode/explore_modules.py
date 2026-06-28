import sys
import os
import time
import xml.etree.ElementTree as ET

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from atomic_tools.xianyu_atomic_tools import _get_device, dump_ui_hierarchy

def explore_module(module_name):
    d = _get_device()
    print(f"[*] 开始探索模块: {module_name}")
    
    # 返回主页的最上层（简单粗暴按几次返回，确保在主页）
    for _ in range(3):
        d.press("back")
        time.sleep(1)
        
    # 尝试在界面上寻找入口
    clicked = False
    for _ in range(3): # 最多滑动找3次
        elem = d(textContains=module_name)
        if not elem.exists:
            elem = d(descriptionContains=module_name)
            
        if elem.exists:
            elem.click()
            clicked = True
            print(f"[+] 成功点击进入: {module_name}")
            break
        else:
            d.swipe(0.5, 0.3, 0.5, 0.7, 0.2) # 向下滑动（页面往上走，回到顶部附近）
            time.sleep(1.5)
            
    if not clicked:
        print(f"[-] 经过尝试，未能在当前主页发现 '{module_name}' 的明显入口。")
        return
        
    time.sleep(5) # 等待新页面完全渲染
    
    xml_dom = dump_ui_hierarchy()
    root = ET.fromstring(xml_dom)
    
    ui_texts = []
    for elem in root.iter():
        text = elem.attrib.get('text', '').strip()
        desc = elem.attrib.get('content-desc', '').strip()
        val = text if text else desc
        if val and val not in ui_texts:
            ui_texts.append(val)
            
    out_file = os.path.join(os.path.dirname(__file__), f"ui_dump_{module_name}.txt")
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(ui_texts))
        
    print(f"[+] {module_name} 模块 UI 拓扑数据已落地: {out_file} (捕获节点数: {len(ui_texts)})")

if __name__ == "__main__":
    targets = ["圈子", "市集", "回收", "省心卖"]
    for t in targets:
        explore_module(t)
