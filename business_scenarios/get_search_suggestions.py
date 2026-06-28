import sys
import os
import re
import time
import argparse
import xml.etree.ElementTree as ET

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

def get_search_suggestions(keyword: str, auto_enable_wifi: bool = True) -> list:
    """
    业务场景: 输入关键词获取联想词列表（不回车）
    :param keyword: 搜索关键词 (例如 "workbuddy")
    :param auto_enable_wifi: 是否自动激活 WiFi
    :return: 联想词字符串列表
    """
    print("[*] ===============================================")
    print("[*] [前置依赖检测] 启动 WiFi 网络健康度自检...")
    wifi_ok, wifi_details = check_wifi_connection(auto_enable=auto_enable_wifi)
    if not wifi_ok:
        print("[!] 严重阻断: WiFi 自检未通过，网络受限或断开。无法获取联想词。")
        return []
    print("[+] [前置依赖检测] WiFi 校验畅通。准备进入搜索联想词提取流...")
    print("[*] ===============================================")

    # 建立 U2 设备实例
    d = tools._get_device()
    if not d:
        print("[!] 异常: 无法获取连接设备指针。")
        return []

    try:
        # Step 1: 寻找搜索框并点击进入搜索输入页面
        print("[*] 步骤 1: 定位首页搜索入口并点击...")
        search_box = d(resourceId="com.taobao.idlefish:id/keyword_container")
        if not search_box.exists:
            # 备用方案：寻找包含“搜索”的 clickable 节点
            search_box = d(descriptionContains="搜索", clickable=True)
            if not search_box.exists:
                search_box = d(textContains="搜索", clickable=True)
                
        if search_box.exists:
            search_box.click()
            print("[+] 已点击首页搜索框。")
            time.sleep(2.0)
        else:
            print("[!] 未在当前界面定位到搜索框入口。")
            return []

        # Step 2: 确保输入框获得焦点
        print("[*] 步骤 2: 激活搜索输入框焦点...")
        edit_field = d(className="android.widget.EditText")
        if edit_field.exists:
            edit_field.click()
            time.sleep(1.0)
        else:
            print("[*] 提示: 未检测到 EditText 输入框，直接尝试写入...")

        # Step 3: 输入关键词但不回车
        print(f"[*] 步骤 3: 注入搜索关键词: '{keyword}'...")
        d.set_input_ime(True)
        # 清理旧文本并输入新文本
        try:
            d.send_keys(keyword)
            time.sleep(3.0)  # 等待联想词列表从服务端加载
            d.set_input_ime(False)
        except Exception as e:
            print(f"[!] 虚拟键盘输入异常: {e}，尝试 adb shell 备用输入模式...")
            d.shell(f"input text {keyword}")
            time.sleep(3.0)

        # Step 4: 提取当前的 UI 拓扑以解析联想词
        print("[*] 步骤 4: 采集当前联想词视口 UI 拓扑并分析...")
        xml_data = d.dump_hierarchy()
        root = ET.fromstring(xml_data)
        
        suggestions = set()
        keyword_lower = keyword.lower()
        
        # 遍历所有节点，提取潜在联想词
        for node in root.iter('node'):
            text = node.attrib.get('text', '').strip()
            desc = node.attrib.get('content-desc', '').strip()
            cls = node.attrib.get('class', '').strip()
            
            # 排除输入框本身
            if cls == "android.widget.EditText":
                continue
                
            val = text if text else desc
            if val:
                # 联想词通常包含关键词（不区分大小写）
                if keyword_lower in val.lower():
                    # 清理隐藏的换行或多余空格
                    cleaned_val = re.sub(r'\s+', ' ', val).strip()
                    # 排除完全等于关键词本身且属于搜索框描述的节点，排除无关的大段文本
                    if cleaned_val.lower() != keyword_lower and len(cleaned_val) < 40:
                        suggestions.add(cleaned_val)
        
        # 如果集合为空，可能是联想词的表示方式没有带上原词，我们捞取常见的列表节点
        if not suggestions:
            print("[*] 提示: 未能通过关键词前缀规则捕获联想词。尝试通用列表节点捞取...")
            for node in root.iter('node'):
                text = node.attrib.get('text', '').strip()
                desc = node.attrib.get('content-desc', '').strip()
                cls = node.attrib.get('class', '').strip()
                val = text if text else desc
                if val and cls in ["android.view.View", "android.widget.ImageView", "android.widget.TextView"]:
                    # 简单过滤常见非联想词系统词
                    if val not in ["搜索", "确定", "取消", "返回", keyword] and len(val) < 25:
                        suggestions.add(val)

        suggestion_list = sorted(list(suggestions))
        
        print("\n" + "="*40)
        print(f"    关键词 【{keyword}】 的联想词提取结果")
        print("="*40)
        if suggestion_list:
            for index, item in enumerate(suggestion_list, 1):
                print(f"  {index}. {item}")
        else:
            print("  (无联想词或未成功加载)")
        print("="*40 + "\n")
        
        # Step 5: 清空输入框并退回首页，恢复设备状态
        print("[*] 步骤 5: 清理输入内容，回拨首页...")
        back_node = d(descriptionContains="返回")
        if not back_node.exists:
            back_node = d(textContains="返回")
        if back_node.exists:
            back_node.click()
        else:
            d.press("back")
        time.sleep(2.0)
        
        return suggestion_list

    except Exception as e:
        print(f"[!] 联想词提取场景异常终止: {e}")
        import traceback
        traceback.print_exc()
        return []

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="在闲鱼搜索框中输入关键词，提取当前系统的联想词汇")
    parser.add_argument("--keyword", default="workbuddy", help="搜索关键词 (默认: workbuddy)")
    parser.add_argument("--no-wifi-fix", action="store_false", dest="wifi_fix", help="网络异常时不自动开启 WiFi")
    args = parser.parse_args()

    get_search_suggestions(keyword=args.keyword, auto_enable_wifi=args.wifi_fix)
