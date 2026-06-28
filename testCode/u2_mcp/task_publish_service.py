import uiautomator2 as u2
import sys, io, time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = u2.connect('192.168.1.58:5555')

print("回到首页")
d.app_start('com.taobao.idlefish')
time.sleep(3)
if d(description="首页").exists:
    d(description="首页").click()
    time.sleep(1)

print("1. 点击卖闲置")
if d(description="卖闲置").exists:
    d(description="卖闲置").click()
    time.sleep(2)
else:
    print("没有找到【卖闲置】")
    sys.exit(1)

print("2. 点击发闲置")
if d(descriptionContains="发闲置").exists:
    d(descriptionContains="发闲置").click()
    time.sleep(2)

print("3. 点击添加图片")
if d(description="添加图片").exists:
    d(description="添加图片").click()
    time.sleep(2)
else:
    d.click(310, 490)
    time.sleep(2)

print("4. 选择图片并确认")
if d(description="选择").exists:
    d(description="选择")[0].click()
    time.sleep(1)
    if d(descriptionContains="下一步").exists:
        d(descriptionContains="下一步").click()
    else:
        d.click(1450, 100) # blind top right
    time.sleep(5)
    
    if d(description="完成").exists:
        d(description="完成").click()
    else:
        d.click(1450, 2500) # blind bottom right
    time.sleep(3)

print("5. 填入定制文案")
desc = """🚀【Workbuddy 全能 AI 工作台技能一对一定制服务】🚀
在这个 AI 爆发的时代，你是否觉得现有的标准 AI 工具无法完美契合你独特的业务流？
我们提供针对 Workbuddy 全能 AI 工作台的【一对一定制化技能开发】！
无论你是做跨境电商、自媒体矩阵运营、还是自动数据抓取分析，我们都可以为你量身打造专属的自动化 Workflow 技能节点。
✅ 深度洞察你的业务痛点，将重复劳动 100% 交给 AI。
✅ 支持 API 极速打通，让你的 Workbuddy 成为真正的超级数字员工。
✅ 交付后提供完整的技能使用说明和长期售后保障。
从“会用 AI”到“掌控 AI”，只差这一个定制技能！欢迎带需求带图私聊，快来定制你的专属生产力利器吧！"""

desc_node = d(descriptionContains="描述一下")
if desc_node.exists:
    desc_node.click()
    time.sleep(1)
    d.send_keys(desc, clear=True)
else:
    d.click(800, 1560)
    time.sleep(1)
    d.send_keys(desc, clear=True)

time.sleep(2)

print("6. 处理分类/属性（副业容易被拦截）")
# 如果出现了分类选择，确保它不是被卡住
# 我们直接点击发布
if d(description="发布").exists:
    d(description="发布").click()
else:
    d.click(1500, 100)

time.sleep(3)

# 价格未填弹窗
if d(description="不填，继续发布").exists:
    print("遇到价格私聊提示，强制发布")
    d(description="不填，继续发布").click()
    time.sleep(2)

# 副业必填“工期”弹窗
if d(description="我知道了").exists:
    print("遇到副业工期提示，点击我知道了")
    d(description="我知道了").click()
    time.sleep(2)
    # 尝试点选工期
    # 盲点通常出现的工期按钮位置，或者直接用文字定位
    if d(descriptionContains="预计工期").exists:
        d(descriptionContains="预计工期").click()
        time.sleep(1)
        # 弹出的选项中，选择“1-3天”
        if d(descriptionContains="天").exists:
            d(descriptionContains="天")[0].click()
            time.sleep(1)
    elif d(descriptionContains="服务方式").exists:
        d(descriptionContains="服务方式").click()
        time.sleep(1)
        if d(descriptionContains="线上").exists:
            d(descriptionContains="线上").click()
            time.sleep(1)
            
    # 再次发布
    d(description="发布").click()
    time.sleep(2)
    if d(description="不填，继续发布").exists:
        d(description="不填，继续发布").click()
        
print("执行完成！")
