"""
从平板闲鱼App获取商品的完整统计数据（包括留言数）
在 App 界面直接读取显示的数字
"""
import uiautomator2 as u2
import time
import re
import sys
import json

d = u2.connect("192.168.1.58")

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}')
    sys.stdout.flush()

def get_item_stats_from_tablet(item_id):
    """通过平板App获取商品的完整统计数据"""
    
    # 确保闲鱼在前台
    d.app_start("com.taobao.idlefish")
    time.sleep(2)
    
    # 通过搜索打开商品
    search = d(text="搜索", className="android.widget.TextView")
    if search.exists:
        search.click()
        time.sleep(1)
    else:
        # 可能已在搜索页
        search_input = d(className="android.widget.EditText")
        if search_input.exists:
            search_input.click()
            time.sleep(1)
        else:
            log("找不到搜索框")
            return None
    
    d.clear_text()
    d.send_keys(item_id)
    time.sleep(1)
    d.press("enter")
    time.sleep(4)
    
    # 点击第一个结果
    cards = d(className="android.widget.FrameLayout", clickable=True)
    clicked = False
    for card in cards:
        text = card.info.get("contentDescription", "") or ""
        if item_id in text or "¥" in text:
            card.click()
            clicked = True
            time.sleep(3)
            break
    
    if not clicked:
        # 点屏幕中央尝试
        w = d.info.get("displayWidth", 1600)
        h = d.info.get("displayHeight", 2560)
        d.click(w // 2, h // 3)
        time.sleep(3)
    
    # 提取界面中的统计数据
    xml = d.dump_hierarchy()
    
    # 搜索统计关键词
    patterns = {
        "浏览": r"(\d+)\s*次浏览",
        "想要": r"(\d+)\s*人想要",
        "收藏": r"(\d+)\s*人收藏",
        "留言": r"(\d+)\s*条留言",
        "评价": r"(\d+)\s*条评价",
    }
    
    stats = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, xml)
        if match:
            stats[key] = int(match.group(1))
            log(f"  {key}: {match.group(1)}")
    
    # 也搜索数值+关键词的模式（不紧挨着的）
    if "留言" not in stats:
        for line in xml.split("<"):
            m = re.search(r'text="([^"]*)"', line)
            if m:
                text = m.group(1)
                if "留言" in text:
                    nums = re.findall(r'\d+', text)
                    if nums:
                        stats["留言"] = int(nums[0])
                        log(f"  留言(备选): {nums[0]}")
    
    return stats

def main():
    item_id = sys.argv[1] if len(sys.argv) > 1 else "1054944275429"
    log(f"开始获取商品 {item_id} 的统计数据...\n")
    
    stats = get_item_stats_from_tablet(item_id)
    
    if stats:
        print(f"\n✅ 商品 {item_id} 的统计数据:")
        for k, v in stats.items():
            print(f"   {k}: {v}")
    else:
        print("\n❌ 未获取到数据")

if __name__ == "__main__":
    main()
