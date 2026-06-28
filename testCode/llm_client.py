import os
import json
import requests
from typing import Dict, Any, List, Optional

# 尝试加载环境文件
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))
    load_dotenv()
except ImportError:
    pass

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
BASE_URL = "https://api.deepseek.com/v1/chat/completions"
MODEL = "deepseek-chat"

def generate_tool_schema() -> List[Dict[str, Any]]:
    """
    定义代理动作空间的 JSON Schema (Phase 0)。
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "TapNode",
                "description": "执行精确或模糊文本匹配寻址并触发点击事件。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "target_identifier": {
                            "type": "string",
                            "description": "目标节点的文本、content-desc或逻辑索引"
                        },
                        "match_mode": {
                            "type": "string",
                            "enum": ["exact", "fuzzy", "regex"],
                            "description": "寻址匹配模式"
                        }
                    },
                    "required": ["target_identifier"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "KinematicSwipe",
                "description": "调用运动学仿真引擎执行非线性轨迹滑动。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "direction": {
                            "type": "string",
                            "enum": ["up", "down", "left", "right"],
                            "description": "滑动矢量方向"
                        },
                        "curve_type": {
                            "type": "string",
                            "enum": ["bezier", "safe_zone"],
                            "description": "轨迹计算内核"
                        }
                    },
                    "required": ["direction"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "BufferInject",
                "description": "执行高速 I/O 数据流覆写及内存缓冲区替换（剪贴板接管）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "payload": {
                            "type": "string",
                            "description": "需注入的字符缓冲数据"
                        }
                    },
                    "required": ["payload"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "ExecuteScenario",
                "description": "触发业务场景域内的高韧性状态机流转。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scenario_id": {
                            "type": "string",
                            "enum": ["auto_publish_product", "click_avatar", "check_wifi_connection", "get_search_suggestions"],
                            "description": "预定义状态机标识符"
                        },
                        "payload": {
                            "type": "object",
                            "description": "传递给状态机的动态参数字典 (例如: title, description, price)",
                            "additionalProperties": True
                        }
                    },
                    "required": ["scenario_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "RecordMarketData",
                "description": "识别并记录界面上的商品市场数据（如标题、价格、想要人数等）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "item_title": {
                            "type": "string",
                            "description": "商品的完整标题"
                        },
                        "metric_data": {
                            "type": "string",
                            "description": "相关的市场指标（如 价格、多少人想要）"
                        }
                    },
                    "required": ["item_title", "metric_data"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "HardwareKey",
                "description": "触发底层物理按键映射，用于脱离局部死锁或执行空间回退。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "key_name": {
                            "type": "string",
                            "enum": ["back", "home", "enter"],
                            "description": "物理键标识"
                        }
                    },
                    "required": ["key_name"]
                }
            }
        }
    ]

class InferenceEngine:
    def __init__(self):
        self.headers = {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        }

    def compute_action(self, system_prompt: str, observation_vector: str, history: List[Dict] = None) -> Dict[str, Any]:
        """
        通过 DeepSeek API 计算状态转移指令。
        """
        messages = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": f"当前观测状态:\n{observation_vector}"})

        payload = {
            "model": MODEL,
            "messages": messages,
            "tools": generate_tool_schema(),
            "tool_choice": "auto",
            "temperature": 0.1 # 保持输出的确定性映射
        }

        response = requests.post(BASE_URL, headers=self.headers, json=payload, proxies={"http": None, "https": None})
        response.raise_for_status()
        return response.json()
