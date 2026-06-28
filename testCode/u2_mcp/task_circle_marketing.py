import uiautomator2 as u2
import time
import xml.etree.ElementTree as ET
import sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = u2.connect('192.168.1.58:5555')

def log(msg):
    print(f"[圈子营销] {msg}")

log("初始化，启动闲鱼并重置状态...")
d.app_start('com.taobao.idlefish')
time.sleep(4)

# 确保在首页
if d(text="闲鱼").exists:
    d(text="闲鱼").click()
    time.sleep(2)

log("1. 导航进入【圈子】主阵地")
if d(text="圈子").exists:
    d(text="圈子").click()
    time.sleep(4)
else:
    log("未找到圈子标签，可能是 UI 滑动问题")
    sys.exit(1)

log("2. 寻找高价值目标圈子 (AI圈 / 副业圈)")
target_circle = None
for circle_name in ["AI圈", "副业圈", "数码圈"]:
    if d(textContains=circle_name).exists:
        target_circle = circle_name
        d(textContains=circle_name).click()
        break

if not target_circle:
    log("首页推荐中未直接找到目标圈子，尝试点击【全部圈子】或盲点...")
    if d(textContains="全部").exists:
        d(textContains="全部").click()
        time.sleep(2)
        if d(textContains="副业").exists:
             d(textContains="副业").click()
             target_circle = "副业圈"
    
    if not target_circle:
        d.click(300, 500) # 盲点第一个推荐圈子
        target_circle = "随机推荐圈子"

log(f"3. 成功潜入目标区域: 【{target_circle}】，开始执行自动化活跃任务")
time.sleep(5) # 等待圈子内容加载

likes_count = 0
max_likes = 5

for i in range(5):
    log(f"--- 正在巡逻第 {i+1} 屏信息流 ---")
    try:
        xml_str = d.dump_hierarchy()
        root = ET.fromstring(xml_str.encode('utf-8'))
        
        # 提取当前屏幕的用户和内容片段供分析
        texts = [node.get('text', '').strip() for node in root.iter('node') if node.get('text')]
        content_preview = [t for t in texts if len(t) > 10][:3]
        if content_preview:
            log(f"捕获到圈内情报: {content_preview}")

        # 尝试寻找点赞按钮 (通常是 desc="赞" 或包含 "赞")
        like_buttons = d(descriptionContains="赞")
        if not like_buttons.exists:
             like_buttons = d(textContains="赞")
             
        if like_buttons.exists:
            # 点击屏幕上看到的点赞按钮
            for btn in like_buttons:
                btn.click()
                likes_count += 1
                log(f"👍 成功为一篇同行帖子点赞 (累计: {likes_count})")
                time.sleep(1)
                if likes_count >= max_likes:
                    break
        else:
            log("当前屏幕未发现明显点赞按钮")
            
    except Exception as e:
        log(f"巡逻异常: {e}")
        
    if likes_count >= max_likes:
        log("达到单次营销任务上限，为避免风控主动撤退")
        break
        
    log("向下滑动获取新情报...")
    d.swipe(0.5, 0.8, 0.5, 0.2, 0.5)
    time.sleep(3)

log(f"任务圆满结束。共计点赞 {likes_count} 次。这些操作将向系统证明我们是高活跃真实用户，并通过点赞消息将流量反向吸引到我们的定制服务主页！")
