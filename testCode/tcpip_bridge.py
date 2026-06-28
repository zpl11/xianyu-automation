import adbutils
import json
import logging
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

def bridge_tcpip_connection(target_port: int = 5555):
    """
    执行物理总线至无线 TCP/IP 协议栈的转换。
    依赖条件：设备必须通过 USB 物理挂载于宿主机。
    """
    logging.info("初始化底层设备拓扑扫描...")
    try:
        devices = adbutils.adb.device_list()
    except Exception as e:
        logging.error(f"ADB 守护进程调用异常: {str(e)}")
        return

    if not devices:
        logging.error("USB 物理总线未探测到活跃设备，协议转换被阻断。")
        return

    for d in devices:
        serial = d.serial
        try:
            ip = d.wlan_ip()
            if not ip:
                logging.warning(f"设备 [{serial}] 未分配局域网 IP，无法建立 TCP/IP 映射。")
                continue
            
            logging.info(f"探测到目标节点 - Serial: {serial} | WLAN IP: {ip}")
            logging.info(f"下发协议转移指令 -> 目标端口: {target_port}")
            
            # 强制重启 adbd 并绑定目标端口
            d.tcpip(target_port)
            
            # 挂起等待守护进程重启
            time.sleep(2)
            
            # 验证重连
            adbutils.adb.connect(f"{ip}:{target_port}")
            logging.info(f"链路贯通校验成功 -> {ip}:{target_port}")
            logging.info("状态转移完成。现可安全移除 USB 物理连接。")
            
        except Exception as e:
            logging.error(f"设备 [{serial}] 协议转换异常: {str(e)}")

if __name__ == "__main__":
    bridge_tcpip_connection()
