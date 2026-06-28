import uiautomator2 as u2
import time
import math
import random

# =====================================================================
# 原子化控制域核心库 (Xianyu Atomic Tools Core)
# 严格遵循: 单一状态变更、决策权上浮、入参出参去黑盒化
# =====================================================================

_DEVICE = None

def _get_device():
    global _DEVICE
    if _DEVICE is None:
        _DEVICE = u2.connect("192.168.1.58")
    return _DEVICE

def dump_ui_hierarchy() -> str:
    """获取当前渲染帧的完整布局 XML 拓扑"""
    return _get_device().dump_hierarchy()

def click_by_text(text: str, exact: bool = True) -> bool:
    """通过文本属性发起唯一点击事件"""
    d = _get_device()
    elem = d(text=text) if exact else d(textContains=text)
    if elem.exists:
        elem.click()
        return True
    return False

def click_by_desc(desc: str, exact: bool = True) -> bool:
    """通过内容描述发起唯一点击事件"""
    d = _get_device()
    elem = d(description=desc) if exact else d(descriptionContains=desc)
    if elem.exists:
        elem.click()
        return True
    return False

def click_coordinate(x: int, y: int) -> bool:
    """对屏幕绝对坐标发起一次点按"""
    _get_device().click(x, y)
    return True

def long_click_coordinate(x: int, y: int, duration: float = 1.5) -> bool:
    """对屏幕绝对坐标发起一次物理长按"""
    _get_device().long_click(x, y, duration)
    return True

def set_clipboard(content: str) -> bool:
    """覆写系统剪贴板内存"""
    _get_device().set_clipboard(content)
    return True

def input_text_fast(text: str) -> bool:
    """通过 fastinput 强行向当前焦点输入流注入文本"""
    d = _get_device()
    d.set_fastinput_ime(True)
    d.send_keys(text, clear=True)
    time.sleep(0.5)
    d.set_fastinput_ime(False)
    return True

def _get_bezier_curve(start, end, cp1, cp2, num=15):
    points = [start, cp1, cp2, end]
    n = len(points) - 1
    curve = []
    for i in range(num):
        t = i / (num - 1)
        x, y = 0.0, 0.0
        for j, p in enumerate(points):
            b = math.comb(n, j) * (t ** j) * ((1 - t) ** (n - j))
            x += p[0] * b
            y += p[1] * b
        curve.append((int(x), int(y)))
    return curve

def scroll_screen_bezier(direction: str = "up") -> bool:
    """执行基于贝塞尔引擎的物理滑动，扰乱防刷特征检测"""
    d = _get_device()
    width, height = d.window_size()
    
    start_x = int(width * 0.5 + random.randint(-50, 50))
    end_x = int(width * 0.5 + random.randint(-50, 50))
    
    if direction == "up":
        start_y = int(height * 0.8 + random.randint(-20, 20))
        end_y = int(height * 0.25 + random.randint(-20, 20))
    else:
        start_y = int(height * 0.25 + random.randint(-20, 20))
        end_y = int(height * 0.8 + random.randint(-20, 20))
        
    cp1_x = int(start_x + random.randint(-200, 200))
    cp1_y = int(start_y - (start_y - end_y) * 0.3)
    cp2_x = int(end_x + random.randint(-200, 200))
    cp2_y = int(end_y + (start_y - end_y) * 0.3)
    
    curve = _get_bezier_curve((start_x, start_y), (end_x, end_y), (cp1_x, cp1_y), (cp2_x, cp2_y), num=15)
    d.swipe_points(curve, 0.15)
    return True

def scroll_safe(direction: str = "up", scale: float = 0.2) -> bool:
    """
    基于 Android 底层 InputManager 的微距安全物理滚动原子操作。
    采用 X 轴 12%-16% 的左侧安全空白轨道，融入微幅随机扰动，模拟人类真实划屏以规避风控特征检测，防漏检。
    """
    d = _get_device()
    width, height = d.window_size()
    
    # 注入微小随机噪声模拟人工行为，锁定左侧边缘安全区
    x_track = int(width * (0.12 + random.uniform(0.0, 0.04)))
    
    # 计算带有扰动因子的起点与终点坐标
    if direction == "up":
        # 页面内容上移（手指向上划）
        y_start = int(height * (0.62 + random.uniform(0.0, 0.05)))
        y_end = int(height * max(0.1, (0.62 - scale) + random.uniform(0.0, 0.05)))
    else:
        # 页面内容下移（手指向下划）
        y_start = int(height * (0.42 + random.uniform(0.0, 0.05)))
        y_end = int(height * min(0.9, (0.42 + scale) + random.uniform(0.0, 0.05)))
        
    duration = random.randint(350, 480)
    
    try:
        cmd = f"input swipe {x_track} {y_start} {x_track} {y_end} {duration}"
        d.shell(cmd)
    except Exception:
        # 兜底物理 swipe (uiautomator2 接口)
        d.swipe(
            0.12 + random.uniform(0.0, 0.03), 
            0.65 + random.uniform(-0.02, 0.02) if direction == "up" else 0.45 + random.uniform(-0.02, 0.02),
            0.12 + random.uniform(0.0, 0.03), 
            0.45 + random.uniform(-0.02, 0.02) if direction == "up" else 0.65 + random.uniform(-0.02, 0.02),
            duration=duration / 1000.0
        )
    return True
