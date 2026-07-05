"""
自动操作平板浏览闲鱼，捕获API流量
===================================
在平板上自动执行搜索、浏览商品详情、查看店铺等操作，
配合 mitmproxy 捕获所有 API 流量。

用法:
  python auto_browse_xianyu.py

注意: 确保 mitmproxy 已在运行 (python capture_status.py 查看状态)
"""

import uiautomator2 as u2
import time
import sys
import random


# ============================================================
#  配置
# ============================================================
DEVICE_IP = '192.168.1.58'
PACKAGE = 'com.taobao.idlefish'
SEARCH_KEYWORDS = ['手机', '耳机', '电脑', '相机', '手表', '图书']

# 操作间隔（秒）- 模拟人类操作节奏
MIN_INTERVAL = 1.5
MAX_INTERVAL = 3.0


def log(msg):
    ts = time.strftime('%H:%M:%S')
    print(f'[{ts}] {msg}')
    sys.stdout.flush()


def sleep_random():
    """随机等待，模拟人类节奏"""
    time.sleep(random.uniform(MIN_INTERVAL, MAX_INTERVAL))


def connect():
    """连接平板"""
    log(f'🔄 连接平板 {DEVICE_IP}...')
    d = u2.connect(DEVICE_IP)
    info = d.info
    log(f'✅ 已连接: {info.get("productName", "?")} '
        f'{info.get("displayWidth", "?")}x{info.get("displayHeight", "?")}')
    return d


def wait_for_app(d):
    """确保闲鱼在前台"""
    current = d.app_current()
    if current.get('package') != PACKAGE:
        log('📱 启动闲鱼...')
        d.app_start(PACKAGE)
        time.sleep(3)


def search_items(d, keyword):
    """搜索商品"""
    log(f'\n{"="*50}')
    log(f'🔍 搜索关键词: {keyword}')
    log(f'{"="*50}')
    
    # 尝试找到搜索框并点击
    search_box = d(text='搜索', className='android.widget.TextView')
    if search_box.exists:
        log('点击搜索框...')
        search_box.click()
        sleep_random()
    else:
        # 可能已经在搜索页，尝试找到搜索输入框
        search_input = d(className='android.widget.EditText')
        if search_input.exists:
            log('使用已有搜索输入框...')
            search_input.click()
            sleep_random()
        else:
            log('⚠️ 未找到搜索框，尝试点击搜索图标...')
            search_icon = d(description='搜索', className='android.widget.ImageView')
            if search_icon.exists:
                search_icon.click()
                sleep_random()
            else:
                log('❌ 无法找到搜索入口')
                return False
    
    # 输入关键词
    log(f'输入关键词: {keyword}')
    d.clear_text()
    d.send_keys(keyword)
    sleep_random()
    
    # 点击搜索按钮（键盘搜索或屏幕搜索按钮）
    search_btn = d(text='搜索', className='android.widget.Button')
    if search_btn.exists:
        log('点击搜索按钮...')
        search_btn.click()
        sleep_random()
    else:
        # 尝试按回车
        log('按回车搜索...')
        d.press('enter')
        sleep_random()
    
    # 等待搜索结果加载
    time.sleep(3)
    log('✅ 搜索结果已加载')
    return True


def scroll_and_collect(d, scroll_times=5):
    """滚动搜索结果列表，收集商品卡片"""
    log(f'\n📜 滚动搜索结果 ({scroll_times}次)...')
    
    for i in range(scroll_times):
        log(f'   第 {i+1}/{scroll_times} 次滚动...')
        # 向下滑动（从屏幕中间偏下位置滑到中间偏上）
        w = d.info.get('displayWidth', 1600)
        h = d.info.get('displayHeight', 2560)
        
        start_x = w // 2
        start_y = h * 3 // 4
        end_y = h // 4
        
        d.swipe(start_x, start_y, start_x, end_y, duration=0.3)
        time.sleep(random.uniform(1.0, 2.0))
    
    log('✅ 滚动完成')


def open_item_detail(d, index=0):
    """点击搜索结果中的商品打开详情页"""
    log(f'\n📦 打开商品详情 (第{index+1}个)...')
    
    # 尝试找到商品卡片
    # 策略1: 找带有"人想要"文本的商品
    want_texts = d(textContains='人想要')
    if want_texts.exists:
        log('找到含"人想要"的商品列表')
        # 获取所有"人想要"元素，点击其附近的可点击区域
        for i, wt in enumerate(want_texts):
            if i == index:
                bounds = wt.info.get('bounds', {})
                log(f'商品 {i+1} 位置: {bounds}')
                # 点击"人想要"文本上方区域（商品标题区域）
                cx = (bounds['left'] + bounds['right']) // 2
                cy = bounds['top'] - 100  # 向上偏移到标题区
                d.click(cx, cy)
                sleep_random()
                time.sleep(2)
                log('✅ 已打开详情页')
                return True
    
    # 策略2: 找带有价格符号的商品区域
    log('策略2: 按价格定位商品...')
    price_texts = d(textContains='¥')
    if price_texts.exists:
        for i, pt in enumerate(price_texts):
            if i == index:
                bounds = pt.info.get('bounds', {})
                cx = (bounds['left'] + bounds['right']) // 2
                cy = bounds['top'] - 150  # 点击价格上方商品区域
                d.click(cx, cy)
                sleep_random()
                time.sleep(2)
                log('✅ 已打开详情页')
                return True
    
    # 策略3: 找屏幕中间区域的商品（搜索结果中）
    log('策略3: 点击屏幕中央区域...')
    w = d.info.get('displayWidth', 1600)
    h = d.info.get('displayHeight', 2560)
    # 点击屏幕中央偏下的位置（通常第一个商品在这里）
    d.click(w // 2, h // 2)
    sleep_random()
    time.sleep(2)
    
    # 检查是否进入了新页面
    current = d.app_current()
    if 'detail' in current.get('activity', '').lower() or 'item' in current.get('activity', '').lower():
        log('✅ 已打开详情页')
        return True
    
    log('❌ 未找到可点击的商品')
    return False


def browse_detail_page(d):
    """在详情页上操作（滚动查看更多信息）"""
    log('📄 浏览详情页...')
    
    w = d.info.get('displayWidth', 1600)
    h = d.info.get('displayHeight', 2560)
    
    # 向下滚动一点查看更多详情
    start_x = w // 2
    start_y = h * 2 // 3
    end_y = h // 3
    
    for i in range(3):
        d.swipe(start_x, start_y, start_x, end_y, duration=0.3)
        time.sleep(random.uniform(0.8, 1.5))
    
    log('✅ 详情页浏览完成')
    time.sleep(1)


def go_back(d):
    """返回上一页"""
    log('⬅️ 返回...')
    d.press('back')
    sleep_random()
    time.sleep(1.5)


def visit_search_result(d, keyword, items_to_open=2):
    """搜索并浏览多个商品"""
    if not search_items(d, keyword):
        return False
    
    # 等待结果加载
    time.sleep(2)
    
    # 滚动几次以加载更多数据
    scroll_and_collect(d, scroll_times=4)
    
    # 打开几个商品详情
    for i in range(items_to_open):
        # 回到搜索结果顶部（或滚动到的位置）
        open_item_detail(d, index=i)
        sleep_random()
        
        # 浏览详情页
        browse_detail_page(d)
        
        # 返回搜索结果
        go_back(d)
        time.sleep(1)
    
    return True


def visit_home_feed(d):
    """浏览首页推荐流"""
    log(f'\n{"="*50}')
    log(f'🏠 浏览首页推荐流')
    log(f'{"="*50}')
    
    # 确保在首页
    go_back(d)
    time.sleep(2)
    
    # 滚动推荐流
    w = d.info.get('displayWidth', 1600)
    h = d.info.get('displayHeight', 2560)
    
    for i in range(8):
        start_x = w // 2
        start_y = h * 3 // 4
        end_y = h // 4
        d.swipe(start_x, start_y, start_x, end_y, duration=0.3)
        log(f'   滚动推荐流 {i+1}/8')
        time.sleep(random.uniform(1.0, 2.0))
    
    # 打开一个推荐商品
    open_item_detail(d, index=0)
    sleep_random()
    browse_detail_page(d)
    go_back(d)
    
    log('✅ 首页浏览完成')


def main():
    log('🚀 启动闲鱼自动浏览脚本')
    log('   提示: 确保 mitmproxy 正在运行捕获流量')
    log('   查看状态: python capture_status.py')
    
    # 连接平板
    d = connect()
    
    # 确保闲鱼在前台
    wait_for_app(d)
    sleep_random()
    
    log(f'\n将搜索以下关键词: {", ".join(SEARCH_KEYWORDS[:3])}')
    
    # 操作序列
    try:
        # 1. 先浏览首页推荐流
        visit_home_feed(d)
        
        # 2. 搜索并浏览前3个关键词
        for kw in SEARCH_KEYWORDS[:3]:
            visit_search_result(d, kw, items_to_open=2)
            # 每次搜索后回到首页
            go_back(d)
            time.sleep(1)
        
        log(f'\n{"="*50}')
        log('✅ 所有操作完成！')
        log('📊 现在运行分析工具查看捕获的API:')
        log('   python analyze_captured_apis.py')
        log(f'{"="*50}')
        
    except KeyboardInterrupt:
        log('\n⛔ 用户中断')
    except Exception as e:
        log(f'\n❌ 出错: {e}')
        import traceback
        traceback.print_exc()


if __name__ == '__main__':
    main()
