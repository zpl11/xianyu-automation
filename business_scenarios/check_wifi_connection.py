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

try:
    import xianyu_atomic_tools as tools
    import uiautomator2 as u2
except ImportError as e:
    print(f"[!] 导入依赖失败: {e}。请确保已安装 uiautomator2 并在项目根目录下运行。")
    sys.exit(1)

def connect_device():
    """连接到 Android 设备"""
    print("[*] 正在初始化设备连接...")
    # 尝试连接默认 WiFi 调试 IP
    try:
        tools._DEVICE = u2.connect("192.168.1.58:5555")
        d = tools._get_device()
        # 验证连接是否有效
        d.info
        print("[+] 成功连接至指定 IP 设备: 192.168.1.58:5555")
        return d
    except Exception:
        pass

    # 尝试默认连接 (USB 或本地 ADB 运行实例)
    try:
        tools._DEVICE = u2.connect()
        d = tools._get_device()
        d.info
        print("[+] 成功通过默认 ADB 通道连接到设备")
        return d
    except Exception as e:
        print("\n[!] ========================================================")
        print("[!] 无法连接到 Android 设备！")
        print(f"[!] 错误信息: {e}")
        print("[!] 请检查：")
        print("[!] 1. 设备是否已通过 USB 连接并开启 USB 调试。")
        print("[!] 2. 如果是无线连接，请确保 IP 地址正确且在同一局域网下。")
        print("[!] ========================================================\n")
        return None

def check_wifi_connection(auto_enable=False):
    """
    业务场景: 检测 WiFi 连接状态
    :param auto_enable: 如果 WiFi 未开启，是否尝试自动开启
    :return: (is_connected, info_dict)
    """
    d = connect_device()
    if not d:
        return False, {"error": "Device not connected"}

    print("[*] 开始检测 WiFi 业务场景状态...")
    status = {
        "wifi_enabled": False,
        "wifi_connected": False,
        "ssid": "Unknown",
        "ip_address": None,
        "rssi": None,
        "link_speed": None,
        "internet_accessible": False,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    }

    # 1. 检测 WiFi 开关状态
    try:
        wifi_on_out = d.shell("settings get global wifi_on").output.strip()
        status["wifi_enabled"] = (wifi_on_out == "1")
    except Exception as e:
        print(f"[!] 无法获取 WiFi 开关状态: {e}")

    # 2. 如果 WiFi 关闭且要求自动开启，尝试开启
    if not status["wifi_enabled"] and auto_enable:
        print("[!] 检测到 WiFi 处于关闭状态，正在尝试自动开启 WiFi...")
        try:
            d.shell("svc wifi enable")
            # 等待 WiFi 芯片启动并寻找可用网络
            for i in range(10):
                time.sleep(1.0)
                wifi_on_out = d.shell("settings get global wifi_on").output.strip()
                if wifi_on_out == "1":
                    status["wifi_enabled"] = True
                    print("[+] WiFi 开关已成功开启，等待网络关联...")
                    time.sleep(4.0)  # 给一些时间关联路由器
                    break
            if not status["wifi_enabled"]:
                print("[!] 尝试开启 WiFi 失败，可能需要手动操作。")
        except Exception as e:
            print(f"[!] 尝试执行开启 WiFi 命令失败: {e}")

    if not status["wifi_enabled"]:
        print("[!] 状态评估: WiFi 开关已关闭，无法继续检测连接状态。")
        return False, status

    # 3. 检测 WiFi 关联状态与网络详情
    try:
        # 获取 WLAN IP
        status["ip_address"] = d.wlan_ip
    except Exception as e:
        print(f"[!] 获取 IP 地址异常: {e}")

    try:
        # 获取 dumpsys wifi
        wifi_dump = d.shell("dumpsys wifi").output
        
        # 尝试匹配已连接的 mWifiInfo 行
        # 例：mWifiInfo SSID: "2903-5G", Security type: 2, Supplicant state: COMPLETED, Wi-Fi standard: 6, RSSI: -48, Link speed: 1200Mbps...
        mwifi_infos = re.findall(r'mWifiInfo SSID: "([^"]+)",.*Supplicant state: COMPLETED,.*RSSI: (-?\d+), Link speed: ([^\s,]+)', wifi_dump)
        if mwifi_infos:
            ssid, rssi, link_speed = mwifi_infos[0]
            status["ssid"] = ssid
            status["rssi"] = int(rssi)
            status["link_speed"] = link_speed
            status["wifi_connected"] = True
        else:
            # 备用匹配方案 1: 模糊匹配 SSID
            ssid_match = re.search(r'mWifiInfo SSID: "([^"]+)"', wifi_dump)
            if ssid_match and ssid_match.group(1) != "<unknown ssid>":
                status["ssid"] = ssid_match.group(1)
                status["wifi_connected"] = True
                
                rssi_match = re.search(r'RSSI: (-?\d+)', wifi_dump)
                if rssi_match:
                    status["rssi"] = int(rssi_match.group(1))
                
                speed_match = re.search(r'Link speed: ([^\s,]+)', wifi_dump)
                if speed_match:
                    status["link_speed"] = speed_match.group(1)
            else:
                # 备用匹配方案 2: 使用 dumpsys connectivity 判断
                conn_dump = d.shell("dumpsys connectivity").output
                # 匹配 NetworkAgentInfo 中的 type: WIFI
                wifi_conn_match = re.search(r'NetworkAgentInfo\{ni\{NetworkInfo: type: WIFI\[\], state: CONNECTED/CONNECTED,.*extra: "([^"]+)"', conn_dump)
                if wifi_conn_match:
                    status["ssid"] = wifi_conn_match.group(1)
                    status["wifi_connected"] = True

    except Exception as e:
        print(f"[!] 解析 WiFi 关联详情失败: {e}")

    # 4. 如果有 IP 地址，我们认为已经完成了底层网络关联，但需要验证是否可以访问互联网
    if status["wifi_connected"] or status["ip_address"]:
        status["wifi_connected"] = True  # 纠正或补全关联状态
        print(f"[+] WiFi 已连接，SSID: 【{status['ssid']}】，分配的 IP: {status['ip_address']}")
        if status["rssi"] is not None:
            print(f"[+] 信号强度 (RSSI): {status['rssi']} dBm | 协商速率: {status['link_speed']}")
            
        print("[*] 正在执行互联网连通性测试 (ICMP Ping)...")
        try:
            # 往 114.114.114.114 发送 1 个 ping 包，限时 3 秒
            ping_out = d.shell("ping -c 1 -w 3 114.114.114.114").output
            if "1 packets transmitted, 1 received" in ping_out or "1 received" in ping_out:
                status["internet_accessible"] = True
                print("[+] 连通性测试通过！互联网连接正常。")
            else:
                # 尝试备用 Ping 域名 (可能某些局域网仅能解析 DNS)
                ping_out_dns = d.shell("ping -c 1 -w 3 www.baidu.com").output
                if "1 received" in ping_out_dns:
                    status["internet_accessible"] = True
                    print("[+] 连通性测试通过！互联网连接正常 (通过域名解析测试)。")
                else:
                    print("[!] 连通性测试失败！无法 ping 通外网，请检查宽带或网络配置。")
        except Exception as e:
            print(f"[!] 互联网连通性测试发生异常: {e}")
    else:
        print("[!] WiFi 未连接到任何网络。")

    # 5. 输出最终总结
    print("\n" + "="*40)
    print("         WiFi 状态检测报告")
    print("="*40)
    print(f"检测时间:      {status['timestamp']}")
    print(f"WiFi 开关:     {'【开启】' if status['wifi_enabled'] else '【关闭】'}")
    print(f"WiFi 连接:     {'【已连接】' if status['wifi_connected'] else '【未连接】'}")
    if status['wifi_connected']:
        print(f"连接 SSID:    {status['ssid']}")
        print(f"设备 IP 地址:  {status['ip_address']}")
        if status['rssi'] is not None:
            print(f"信号强度:      {status['rssi']} dBm")
        print(f"互联网外网:    {'【畅通】' if status['internet_accessible'] else '【受限/无连接】'}")
    print("="*40 + "\n")

    overall_success = status["wifi_connected"] and status["internet_accessible"]
    return overall_success, status

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="检测 Android 设备的 WiFi 连接状态")
    parser.add_argument("--auto-enable", action="store_true", help="若 WiFi 开关关闭，尝试自动开启")
    args = parser.parse_args()

    success, result = check_wifi_connection(auto_enable=args.auto_enable)
    if success:
        print("[*] 状态自检完成: WiFi 场景一切正常！")
        sys.exit(0)
    else:
        print("[!] 状态自检完成: WiFi 场景异常，请根据报告排查。")
        sys.exit(1)
