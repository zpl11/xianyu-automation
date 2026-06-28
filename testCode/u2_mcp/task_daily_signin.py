import uiautomator2 as u2
import time
import xml.etree.ElementTree as ET
import sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = u2.connect('192.168.1.58:5555')

def log(msg):
    print(f"[签到助手] {msg}")

log("回到首页")
d.app_start('com.taobao.idlefish')
time.sleep(3)

# 确保在首页
if d(descriptionContains="首页").exists:
    d(descriptionContains="首页").click()
elif d(text="闲鱼").exists:
    d(text="闲鱼").click()
time.sleep(2)

log("寻找首页签到/领红包入口")
if d(textContains="领红包").exists:
    d(textContains="领红包").click()
    log("点击了【领红包】入口")
    time.sleep(5)
elif d(textContains="签到").exists:
    d(textContains="签到").click()
    log("点击了【签到】入口")
    time.sleep(5)
else:
    log("首页未找到明显签到入口，尝试进入【我的】页面")
    if d(text="我的").exists:
        d(text="我的").click()
        time.sleep(3)
        if d(textContains="闲鱼币").exists:
            d(textContains="闲鱼币").click()
            log("点击了【我的-闲鱼币】入口")
            time.sleep(5)
        elif d(textContains="签到").exists:
            d(textContains="签到").click()
            log("点击了【我的-签到】入口")
            time.sleep(5)

log("尝试在当前活动页面寻找并点击【签到】或【领取】按钮")
# 签到页面通常是 H5，或者有很多活动元素
signed_in = False
for keyword in ["立即签到", "去签到", "签到", "立即领取", "领取", "开心收下"]:
    if d(text=keyword).exists:
        d(text=keyword).click()
        log(f"成功点击了【{keyword}】按钮")
        signed_in = True
        time.sleep(2)
        break
    elif d(description=keyword).exists:
        d(description=keyword).click()
        log(f"成功点击了【{keyword}】(desc)按钮")
        signed_in = True
        time.sleep(2)
        break

if not signed_in:
    # 尝试盲点中心区域（有时签到弹窗在中央）
    log("未找到文字匹配的签到按钮，尝试盲点屏幕中央（签到弹窗/浮窗常见位置）")
    d.click(800, 1500)
    time.sleep(2)
    
log("签到流程执行完毕，打印当前状态验证:")
try:
    xml_str = d.dump_hierarchy()
    root = ET.fromstring(xml_str.encode('utf-8'))
    texts = [node.get('text', '') for node in root.iter('node') if node.get('text')]
    # 打印前 20 个文本节点以供确认
    print([t for t in texts if t][:20])
except Exception as e:
    log(f"Dump error: {e}")

# 无论如何，最后回到首页保持环境整洁
d.app_start('com.taobao.idlefish')
time.sleep(2)
d(text="闲鱼").click()
log("已切回首页，任务结束")
