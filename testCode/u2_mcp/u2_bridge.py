import sys
import json
import uiautomator2 as u2
import base64
import os
import logging
import urllib3

# 针对 Windows 的全局代理导致 urllib3 崩溃的问题，强制禁用所有代理，直接连接百度云下载模型
os.environ["HTTP_PROXY"] = ""
os.environ["HTTPS_PROXY"] = ""
os.environ["NO_PROXY"] = "*"
# 关闭 MKLDNN，确保 Windows CPU 稳定运行
os.environ["FLAGS_use_mkldnn"] = "0"
urllib3.disable_warnings()

from paddleocr import PaddleOCR

# 关闭 OCR 的繁杂日志输出
logging.disable(logging.DEBUG)
logging.disable(logging.WARNING)

def main():
    try:
        payload = json.loads(sys.argv[1])
        action = payload.get("action")
        
        # Connect to the tablet via the existing Wi-Fi ADB connection
        d = u2.connect("192.168.1.58:5555")
        
        result = {"status": "success"}
        
        if action == "vision_click":
            target_text = payload.get("text")
            image_path = "temp_screen.png"
            
            # 1. 截图
            d.screenshot(image_path)
            
            # 2. 初始化 OCR (使用 ch 语言，关闭角度分类器提速)
            ocr = PaddleOCR(use_angle_cls=False, lang="ch")
            # 在 2.6.2 稳定版中，恢复使用标准的 ocr.ocr(..., cls=False)
            ocr_result = ocr.ocr(image_path, cls=False)
            
            clicked = False
            if ocr_result and ocr_result[0]:
                for line in ocr_result[0]:
                    box = line[0]        # 坐标: [[左上], [右上], [右下], [左下]]
                    text = line[1][0]    # 识别出的文字
                    
                    if target_text in text:
                        # 3. 计算中心点并点击
                        center_x = (box[0][0] + box[2][0]) / 2
                        center_y = (box[0][1] + box[2][1]) / 2
                        d.click(center_x, center_y)
                        result["data"] = f"成功点击 '{text}'，坐标: ({center_x}, {center_y})"
                        clicked = True
                        break
            
            if not clicked:
                result = {"status": "error", "error": f"屏幕上未找到文字: '{target_text}'"}
            
            # 删掉临时截图
            if os.path.exists(image_path):
                os.remove(image_path)

        elif action == "info":
            result["data"] = d.info
        elif action == "click":
            d.click(payload["x"], payload["y"])
        elif action == "swipe":
            d.swipe(payload["sx"], payload["sy"], payload["ex"], payload["ey"])
        elif action == "dump_hierarchy":
            result["data"] = d.dump_hierarchy()
        elif action == "app_start":
            d.app_start(payload["package"])
        elif action == "shell":
            out = d.shell(payload["command"]).output
            result["data"] = out
        elif action == "screenshot":
            img = d.screenshot()
            import io
            buf = io.BytesIO()
            img.save(buf, format='PNG')
            b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
            result["data"] = b64
        else:
            result = {"status": "error", "error": "Unknown action"}
            
    except Exception as e:
        result = {"status": "error", "error": str(e)}
        
    print(json.dumps(result))

if __name__ == "__main__":
    main()
