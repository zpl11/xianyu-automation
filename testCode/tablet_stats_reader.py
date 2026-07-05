"""
读取平板闲鱼App上的商品统计数据（浏览/想要/收藏/留言/评价）
用 URL Scheme 直接打开商品页，然后从 UI 提取数据
"""
import uiautomator2 as u2
import time
import re
import sys

d = u2.connect("192.168.1.58")

def read_stats(item_id):
    """打开商品页并读取统计数字"""
    
    # 通过 scheme 直接打开
    d.shell(["am", "start", "-a", "android.intent.action.VIEW",
             "-d", f"https://www.goofish.com/item/{item_id}"])
    time.sleep(5)
    
    # 获取页面所有文本
    xml = d.dump_hierarchy()
    
    stats = {}
    
    # 方法1：找特定格式的文本
    for pattern, name in [
        (r'(\d+)\s*次?浏览', 'views'),
        (r'(\d+)\s*人?想要', 'wants'),
        (r'(\d+)\s*人?收藏', 'favs'),
        (r'(\d+)\s*条?留言', 'comments'),
        (r'(\d+)\s*条?评价', 'reviews'),
    ]:
        m = re.search(pattern, xml)
        if m:
            stats[name] = int(m.group(1))
    
    # 方法2：搜关键词附近找数字
    for kw, name in [("浏览", "views"), ("想要", "wants"), ("收藏", "favs"),
                     ("留言", "comments"), ("评价", "reviews")]:
        if name in stats:
            continue
        idx = xml.find(kw)
        if idx >= 0:
            chunk = xml[max(0, idx-50):idx+50]
            nums = re.findall(r'>(\d+)<', chunk)
            if nums:
                stats[name] = int(nums[-1])
    
    return stats

if __name__ == "__main__":
    item_id = sys.argv[1] if len(sys.argv) > 1 else "1054944275429"
    s = read_stats(item_id)
    print(json.dumps(s, ensure_ascii=False))
