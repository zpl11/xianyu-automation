import sys
import os
import re
import time
import argparse

# Reconfigure stdout to use UTF-8 to prevent console encoding issues
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

# Setup path to import atomic_tools (one level up)
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'atomic_tools'))
# Setup path to import sibling files in business_scenarios
sys.path.append(os.path.dirname(__file__))

try:
    import xianyu_atomic_tools as tools
    import uiautomator2 as u2
    from check_wifi_connection import check_wifi_connection
except ImportError as e:
    print(f"[!] 导入依赖失败: {e}。请确保在项目根目录下运行。")
    sys.exit(1)

def run_publish_workflow(title: str, description: str, price: float, auto_enable_wifi: bool = True) -> bool:
    """
    业务场景: 自动化发布产品状态机
    :param title: 商品标题
    :param description: 商品描述
    :param price: 商品售价 (例如 99.00)
    :param auto_enable_wifi: 是否在网络不通时尝试自动修复 WiFi
    :return: 发布是否成功
    """
    print("[*] ===============================================")
    # 强制执行第一个业务场景：WiFi 连接自检
    print("[*] [前置依赖检测] 启动 WiFi 网络健康度自检...")
    wifi_ok, wifi_details = check_wifi_connection(auto_enable=auto_enable_wifi)
    if not wifi_ok:
        print("[!] 严重阻断: WiFi 自检未通过，网络受限或断开。无法继续执行发布业务。")
        return False
    print("[+] [前置依赖检测] WiFi 校验畅通。准备进入发品事务流...")
    print("[*] ===============================================")

    # 建立 U2 设备实例
    d = tools._get_device()
    if not d:
        print("[!] 异常: 无法获取连接设备指针。")
        return False

    try:
        # Step 1: 定向至基址一级发布页 (Sell Tab)
        target = "卖闲置"
        print(f"[*] 步骤 1: 扫描一级视图，寻找交互节点: '{target}'")
        elem_text = d(text=target)
        elem_desc = d(description=target)
        if elem_text.exists:
            elem_text.click()
        elif elem_desc.exists:
            elem_desc.click()
        else:
            elem_contains = d(textContains=target)
            if elem_contains.exists:
                elem_contains.click()
            else:
                print(f"[!] 未定位到 '{target}' 按钮。")
                return False
        time.sleep(2.0)

        # Step 2: 唤醒媒体载入服务引擎 (Post Idle Button)
        target = "发闲置"
        print(f"[*] 步骤 2: 寻址二级发布入口: '{target}'")
        elem_desc_contains = d(descriptionContains=target)
        if elem_desc_contains.exists:
            elem_desc_contains.click()
        else:
            print(f"[!] 未定位到 '{target}' 按钮。")
            return False
        time.sleep(3.0)

        # Step 3: 触发相册媒体选择器 (Add Image)
        target = "添加图片"
        print(f"[*] 步骤 3: 寻找媒体占位区域: '{target}'")
        node = d(descriptionContains=target)
        if not node.exists:
            node = d(textContains=target)
        if node.exists:
            node.click()
            print("[+] 命中 '添加图片'，跳转相册选择器。")
            time.sleep(2.0)
        else:
            print("[*] 提示: 当前视口未发现显示声明的 '添加图片' 节点，可能已处于直接展示相册状态。")

        # Step 4: 定位并标记网格资源首对象 (First Media)
        print("[*] 步骤 4: 锁定相册媒体资源首对象...")
        select_nodes = d(description="选择")
        if select_nodes.exists and len(select_nodes) > 0:
            print(f"[+] 解析到 {len(select_nodes)} 个媒体元素，正在选取首个项目...")
            select_nodes[0].click()
            time.sleep(2.0)
        else:
            print("[!] 错误: 未能在相册视图中解析到任何 '选择' 标记的媒体。")
            return False

        # Step 5: 强制状态机分页推演 (Next Step)
        target = "下一步"
        print(f"[*] 步骤 5: 驱动分页推演: '{target}'")
        elem_text = d(textContains=target)
        elem_desc = d(descriptionContains=target)
        if elem_text.exists:
            elem_text.click()
        elif elem_desc.exists:
            elem_desc.click()
        else:
            print("[!] 未定位到 '下一步' 按钮。")
            return False
        time.sleep(2.0)

        # Step 6: 视觉数据预处理约束提交 (Done)
        target = "完成"
        print(f"[*] 步骤 6: 视觉编辑器数据确认: '{target}'")
        elem_text = d(text=target)
        elem_desc = d(description=target)
        if elem_text.exists:
            elem_text.click()
        elif elem_desc.exists:
            elem_desc.click()
        else:
            print("[!] 未定位到 '完成' 按钮。")
            return False
        time.sleep(3.0)

        # Step 7: 内存流载荷注入: 标题与详描 (Context Menu Paste)
        print("[*] 步骤 7: 载荷数据整合注入...")
        payload_text = f"{title}\n\n{description}"
        print(f"[*] 注入文本字数: {len(payload_text)}，写入剪贴板...")
        d.set_clipboard(payload_text)
        time.sleep(0.5)

        # 点击输入法/编辑框焦点区域，模拟长按唤出上下文菜单
        print("[*] 长按输入区以唤出系统粘贴选项...")
        d.click(150, 800)
        time.sleep(1.0)
        d.long_click(150, 800, 1.5)
        time.sleep(1.0)

        paste_node = d(textContains="粘贴")
        if not paste_node.exists:
            paste_node = d(descriptionContains="粘贴")
        if paste_node.exists:
            paste_node.click()
            print("[+] 成功执行文本粘贴注入。")
            time.sleep(2.0)
            
            # 点击 "完成" 退出详情编辑页面
            print("[*] 寻找并点击 '完成' 按钮以退出详情编辑界面...")
            done_clicked = False
            for done_target in ["完成", "确定"]:
                done_node = d(text=done_target)
                if not done_node.exists:
                    done_node = d(description=done_target)
                if done_node.exists:
                    done_node.click()
                    print(f"[+] 成功点击 '{done_target}'，保存并退出编辑界面。")
                    done_clicked = True
                    break
            if not done_clicked:
                done_contains = d(textContains="完成")
                if not done_contains.exists:
                    done_contains = d(descriptionContains="完成")
                if done_contains.exists:
                    done_contains.click()
                    print("[+] 成功模糊点击 '完成'，保存并退出编辑界面。")
                else:
                    print("[!] 未能定位到 '完成' 按钮。尝试物理返回以关闭键盘/输入层...")
                    d.press("back")
            time.sleep(2.0)
        else:
            print("[!] 未检测到 '粘贴' 菜单项。备份当前 UI 用于故障分析。")
            with open("publish_failed_paste_dump.xml", "w", encoding="utf-8") as f:
                f.write(d.dump_hierarchy())
            return False

        # Step 8: 智能分类选择与配置 (Category Fix)
        print("[*] 步骤 8: 开启智能分类匹配引擎...")
        # 强匹配目标分类：【Ai设计工具\服务】（支持正斜杠与反斜杠，不区分 AI 大小写）
        target_pattern = r".*(可选|已选中).*[aA][iI]设计工具[\\/]服务.*"
        cat_node = d(descriptionMatches=target_pattern)
        
        found_category = False
        if cat_node.exists:
            desc = cat_node.info.get('contentDescription', '')
            if "已选中" in desc:
                print("[+] 目标分类【Ai设计工具\\服务】已处于选中状态，跳过点击。")
            else:
                print("[+] 自动选中目标分类项【Ai设计工具\\服务】。")
                cat_node.click()
                time.sleep(1.5)
            found_category = True
        else:
            # 备选模糊匹配
            xpath_query = '//*[contains(@content-desc, "设计工具") and (contains(@content-desc, "服务") or contains(@content-desc, "工具"))]'
            xpath_nodes = d.xpath(xpath_query).all()
            for node in xpath_nodes:
                desc = node.info.get('contentDescription', '')
                if "可选" in desc or "已选中" in desc:
                    if "已选中" in desc:
                        print(f"[+] 目标分类【{desc}】已处于选中状态，跳过点击。")
                    else:
                        print(f"[+] 自动选中命中的分类项: {desc}")
                        node.click()
                        time.sleep(1.5)
                    found_category = True
                    break
                    
        if not found_category:
            print("[!] 致命阻断: 未能在当前视口发现【Ai设计工具\\服务】分类。停止发品任务。")
            return False

        # 智能工期选择
        if d(descriptionContains="预计工期").exists:
            if d(descriptionMatches=".*可选.*1-5天.*").exists:
                d(descriptionMatches=".*可选.*1-5天.*").click()
            elif d(descriptionMatches=".*可选.*待议.*").exists:
                d(descriptionMatches=".*可选.*待议.*").click()
            time.sleep(0.5)

        # 智能计价方式
        if d(descriptionContains="计价方式").exists:
            if d(descriptionMatches=".*可选.*元/次.*").exists:
                d(descriptionMatches=".*可选.*元/次.*").click()
            elif d(descriptionMatches=".*可选.*元/起.*").exists:
                d(descriptionMatches=".*可选.*元/起.*").click()
            time.sleep(0.5)

        # Step 9: 驱动价格浮动控制台展开 (Price Panel)
        print("[*] 步骤 9: 移位露出并展开价格控制台...")
        # 从下往上滑动，滑动半屏
        d.swipe(800, 2000, 800, 500, 0.5)
        time.sleep(1.0)

        price_node = d(descriptionContains="价格")
        if not price_node.exists:
            price_node = d(textContains="价格")
        if price_node.exists:
            price_node.click()
            time.sleep(1.5)
        else:
            print("[!] 未在当前视口内命中 '价格' 特征。")
            return False

        # Step 10: 键盘指令向量脉冲注入 (Keypad Input)
        print(f"[*] 步骤 10: 通过底层虚拟键盘注入价格: {price}...")
        # 清理价格为字符串数字
        price_str = str(int(price)) # 暂不支持小数输入，取整
        for char in price_str:
            key_node = d(description=char)
            if key_node.exists:
                key_node.click()
                time.sleep(0.3)
            else:
                print(f"[!] 错误: 未能在键盘上找到键位 '{char}'。")
                return False

        confirm_node = d(description="确定")
        if confirm_node.exists:
            confirm_node.click()
            print("[+] 价格注入完成。")
            time.sleep(1.5)
        else:
            print("[!] 未找到价格键盘 '确定' 确认节点。")
            return False

        # Step 11: 远端数据提交总调度 (Final Publish)
        target = "发布"
        print(f"[*] 步骤 11: 锁定发布通道总调度: '{target}'")
        publish_node = d(description=target)
        if not publish_node.exists:
            publish_node = d(text=target)
        if publish_node.exists:
            publish_node.click()
            print("[+] 发起发布指令...")
        else:
            print("[!] 错误: 未能锁定 '发布' 按钮。")
            return False

        # Step 12: 终结反馈响应与自愈机制 (Close Success Modal & Self-Heal)
        print("[*] 步骤 12: 等待结果反馈与自愈检测...")
        publish_completed = False
        max_retries = 3
        
        for attempt in range(max_retries):
            print(f"[*] 第 {attempt + 1} 次轮询确认发布状态...")
            time.sleep(3.0)

            # 检查是否成功
            success_node = d(descriptionContains="发布成功")
            if not success_node.exists:
                success_node = d(textContains="发布成功")
            if success_node.exists:
                print("[+] 检测到 '发布成功' 状态反馈，正在销毁成功提示模态框...")
                # 针对 1600x2560 屏幕进行坐标销毁，或寻找关闭按钮
                d.click(1480, 1335)
                publish_completed = True
                break

            # 检查属性缺失阻断弹窗
            error_node = d(descriptionContains="必须选择属性")
            if error_node.exists:
                err_text = error_node.info['contentDescription']
                print(f"[!] 捕获业务阻断拦截: {err_text}")
                
                m = re.search(r'必须选择属性:([^\n]+)', err_text)
                if m:
                    missing_attr = m.group(1).strip()
                    print(f"[!] 启动自愈: 尝试补全缺失的属性: '{missing_attr}'")
                    
                    ok_node = d(descriptionContains="我知道了")
                    if ok_node.exists:
                        ok_node.click()
                    time.sleep(1.0)
                    
                    # 寻找属性并填充
                    xpath_query = f'//android.view.View[@content-desc="{missing_attr}"]//android.view.View[contains(@content-desc, "可选")]'
                    elements = d.xpath(xpath_query).all()
                    
                    if len(elements) == 0:
                        print(f"[*] 当前视口未发现，执行向下滚动以展开属性列表...")
                        d.swipe(800, 2000, 800, 800)
                        time.sleep(1.0)
                        elements = d.xpath(xpath_query).all()
                        
                    if len(elements) > 0:
                        print(f"[+] 自动选中首个可选属性项: {elements[0].info.get('contentDescription')}")
                        elements[0].click()
                        time.sleep(1.0)
                        
                        # 重新提交发布
                        re_pub_btn = d(description="发布")
                        if not re_pub_btn.exists:
                            re_pub_btn = d(text="发布")
                        if re_pub_btn.exists:
                            re_pub_btn.click()
                            print("[*] 重新发起发布事务...")
                    else:
                        print(f"[!] 属性自愈异常: 无法定位到 '{missing_attr}' 的可选选项，阻断流程。")
                        return False
                else:
                    print("[!] 无法解析缺失属性名称，阻断流程。")
                    return False

        if not publish_completed:
            print("[!] 重试结束，状态超时或无法自愈，发品判定失败。")
            return False

        # Step 13: 销毁上下文并返回首页 (Return Home)
        print("[*] 步骤 13: 清理活跃环境，回拨首页...")
        back_clicked = False
        
        # 尝试使用多种特征属性寻找返回按钮（包含 "返回"、"<"、"Back"）
        for target in ["返回", "<", "Back"]:
            back_node = d(descriptionContains=target)
            if not back_node.exists:
                back_node = d(textContains=target)
            if back_node.exists:
                print(f"[+] 锁定返回标志 '{target}'，执行点击返回...")
                back_node.click()
                back_clicked = True
                break
                
        if not back_clicked:
            # 尝试通过 XPath 锁定可能没有文本的左上角返回/关闭图标
            xpath_back = d.xpath('//android.widget.ImageButton[contains(@content-desc, "返回")] | //android.widget.ImageView[contains(@content-desc, "返回")] | //android.widget.ImageView[contains(@content-desc, "<")]')
            if xpath_back.exists:
                print("[+] 通过 XPath 锁定返回组件，执行点击...")
                xpath_back.click()
                back_clicked = True
                
        if not back_clicked:
            print("[!] 未命中视觉级返回字符锚点。触发硬件返回键 (d.press('back'))...")
            d.press("back")
            
        time.sleep(2.0)
        
        print("[+] 状态机顺利归档。商品发布任务成功！")
        return True

    except Exception as e:
        print(f"[!] 状态机异常崩塌: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="自动在闲鱼上发布指定的商品")
    parser.add_argument("--title", required=True, help="商品标题")
    parser.add_argument("--desc", required=True, help="商品描述")
    parser.add_argument("--price", type=float, required=True, help="商品价格 (元)")
    parser.add_argument("--no-wifi-fix", action="store_false", dest="wifi_fix", help="网络异常时不自动开启 WiFi")
    args = parser.parse_args()

    success = run_publish_workflow(
        title=args.title,
        description=args.desc,
        price=args.price,
        auto_enable_wifi=args.wifi_fix
    )
    
    if success:
        sys.exit(0)
    else:
        sys.exit(1)
