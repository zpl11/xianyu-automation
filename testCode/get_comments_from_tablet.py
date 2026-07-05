"""
通过操作平板闲鱼 App 获取商品的留言/互动/评价数据
直接从 App 界面读取显示的数字
"""
import uiautomator2 as u2
import time
import re
import sys

d = u2.connect("192.168.1.58")
PACKAGE = "com.taobao.idlefish"

def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}')
    sys.stdout.flush()

def open_item(item_id):
    """在闲鱼 App 中打开商品详情页"""
    log(f'打开商品: {item_id}')
    
    # 先确保闲鱼在前台
    current = d.app_current()
    if current.get('package') != PACKAGE:
        d.app_start(PACKAGE)
        time.sleep(3)
    
    # 通过搜索打开该商品
    # 先找搜索框
    search = d(text="搜索", className="android.widget.TextView")
    if search.exists:
        search.click()
        time.sleep(1)
    else:
        # 可能已经有搜索框
        search_input = d(className="android.widget.EditText")
        if search_input.exists:
            search_input.click()
            time.sleep(1)
        else:
            log('找不到搜索入口')
            return False
    
    # 输入商品ID
    d.clear_text()
    d.send_keys(item_id)
    time.sleep(1)
    
    # 按回车搜索
    d.press("enter")
    time.sleep(3)
    
    # 点击搜索结果中的第一个商品
    # 找 "人想要" 或价格标签
    result = d(textContains="人想要")
    if result.exists:
        result[0].click()
        time.sleep(3)
        return True
    
    # 备选：直接打开URL（通过浏览器）
    log('搜索结果未找到，尝试通过浏览器打开')
    return False

def extract_stats():
    """从商品详情页提取统计数据"""
    time.sleep(2)
    
    # 获取页面所有文本
    xml = d.dump_hierarchy()
    texts = []
    for line in xml.split("<"):
        m = re.search(r'text="([^"]*)"', line)
        if m and m.group(1).strip():
            texts.append(m.group(1).strip())
    
    log(f'页面文本元素: {len(texts)}个')
    
    # 查找统计相关的关键词
    stats = {
        '浏览': None,
        '想要': None,
        '收藏': None,
        '留言': None,
        '评价': None,
    }
    
    for keyword in stats.keys():
        # 找包含关键词的文本
        for text in texts:
            if keyword in text:
                # 尝试提取数字
                nums = re.findall(r'(\d+)', text)
                if nums:
                    stats[keyword] = int(nums[0])
                    log(f'  {keyword}: {nums[0]}')
                    break
    
    return stats

def main():
    item_id = sys.argv[1] if len(sys.argv) > 1 else "1054944275429"
    
    log(f'连接平板...')
    info = d.info
    log(f'已连接: {info.get("displayWidth", "?")}x{info.get("displayHeight", "?")}')
    
    success = open_item(item_id)
    if not success:
        log('无法通过搜索打开商品')
        return
    
    stats = extract_stats()
    
    log(f'\n商品 {item_id} 的统计数据:')
    for key, val in stats.items():
        if val is not None:
            log(f'  {key}: {val}')
        else:
            log(f'  {key}: (未找到)')

if __name__ == '__main__':
    main()
