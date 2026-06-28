import os
import sys
import json
import logging
import xml.etree.ElementTree as ET
from typing import Dict, Any

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from llm_client import InferenceEngine

# 实装物理挂载点
from atomic_tools.xianyu_atomic_tools import (
    dump_ui_hierarchy, 
    click_by_text, 
    scroll_screen_bezier,
    scroll_safe, 
    set_clipboard
)
from business_scenarios.auto_publish_product import run_publish_workflow

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

class AgentControlLoop:
    def __init__(self):
        self.inference_engine = InferenceEngine()
        self.state_history = []
        self.system_prompt = self._compile_system_prompt()
        
    def _compile_system_prompt(self) -> str:
        return """
你是一个底层保活漫游引擎 (Liveness Daemon)。
目标：通过无规律但极其深度的点击与滑动操作，模拟高频真实用户的在线特征，最大化目标账户在平台分发引擎中的活跃度权重 (Liveness Vector)。
约束：
1. 观察当前提取到的节点数据（nodes）。
2. 从中随机且连续地选取有效的商品卡片、文章或全局级按钮（如“首页”、“消息”、“我的”）并调用 TapNode 进行下探。
3. 若当前视口节点数量过少或长时间处于同一拓扑，必须调用 KinematicSwipe 进行上下空间偏移。
4. 若判断已下探至无进一步交互价值的局部子节点（如某具体商品的详情底端），必须调用 HardwareKey 传入 key_name: "back" 以执行状态栈回滚，防止陷入死锁状态。
5. 单次输出必须包含 1 到 2 个不冲突的物理函数调用指令。
"""

    def _acquire_observation_vector(self) -> str:
        """
        Phase 1: 捕获真实 UI 帧并进行拓扑降维。
        """
        try:
            xml_dom = dump_ui_hierarchy()
            root = ET.fromstring(xml_dom)
            nodes = []
            
            # 拓扑层遍历与启发式过滤
            for elem in root.iter():
                text = elem.attrib.get('text', '').strip()
                desc = elem.attrib.get('content-desc', '').strip()
                bounds = elem.attrib.get('bounds', '')
                
                if text or desc:
                    nodes.append({
                        "text": text,
                        "desc": desc,
                        "bounds": bounds
                    })
            
            # 状态截断，避免超出上下文窗口
            compact_obs = json.dumps({"nodes": nodes[:80]}, ensure_ascii=False)
            logging.info(f"状态增量提取完成: 捕获节点数 {len(nodes)}")
            return compact_obs
        except Exception as e:
            logging.error(f"UI 树遍历异常: {str(e)}")
            return json.dumps({"error": "Failed to parse UI hierarchy"})
        
    def _execute_tool_call(self, tool_call: Dict[str, Any]) -> str:
        """
        物理路由映射矩阵。
        """
        function_name = tool_call["function"]["name"]
        arguments = json.loads(tool_call["function"]["arguments"])
        
        logging.info(f"硬件指令下发 -> {function_name}({arguments})")
        
        try:
            if function_name == "TapNode":
                target = arguments.get('target_identifier', '')
                # 模糊匹配调用
                res = click_by_text(target, exact=False)
                return json.dumps({"status": "success" if res else "failed", "action": "TapNode"})
                
            elif function_name == "KinematicSwipe":
                direction = arguments.get('direction', 'up')
                curve_type = arguments.get('curve_type', 'bezier')
                if curve_type == "safe_zone":
                    scroll_safe(direction)
                else:
                    scroll_screen_bezier(direction)
                return json.dumps({"status": "success", "action": "KinematicSwipe"})
                
            elif function_name == "BufferInject":
                set_clipboard(arguments.get('payload', ''))
                return json.dumps({"status": "success", "action": "BufferInject"})
                
            elif function_name == "ExecuteScenario":
                scenario_id = arguments.get('scenario_id', '')
                payload = arguments.get('payload', {})
                if scenario_id == "auto_publish_product":
                    title = payload.get("title", "测试商品")
                    desc = payload.get("description", "商品描述")
                    price = float(payload.get("price", 9.9))
                    logging.info(f"[*] 宏观控制流接管: 启动自动化发品 [Title: {title}, Price: {price}]")
                    res = run_publish_workflow(title=title, description=desc, price=price, auto_enable_wifi=False)
                    return json.dumps({"status": "success" if res else "failed", "action": "ExecuteScenario", "scenario_id": scenario_id})
                return json.dumps({"status": "success", "action": "ExecuteScenario", "scenario_id": scenario_id})
                
            elif function_name == "RecordMarketData":
                item_title = arguments.get('item_title', '')
                metric_data = arguments.get('metric_data', '')
                logging.info(f"[+] Agent 数据捕获 -> 商品: '{item_title}' | 市场指标: '{metric_data}'")
                
                # 落地追加到文件
                out_path = os.path.join(os.path.dirname(__file__), "agent_market_analysis.jsonl")
                with open(out_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps({"title": item_title, "metric": metric_data}, ensure_ascii=False) + "\n")
                    
                return json.dumps({"status": "success", "action": "RecordMarketData"})
                
            elif function_name == "HardwareKey":
                key = arguments.get('key_name', 'back')
                logging.info(f"[!] 状态图深度回滚 -> HardwareKey({key})")
                from atomic_tools.xianyu_atomic_tools import _get_device
                _get_device().press(key)
                return json.dumps({"status": "success", "action": "HardwareKey"})
                
            return json.dumps({"status": "error", "message": "指令在映射矩阵中未命中"})
        except Exception as e:
            return json.dumps({"status": "error", "message": str(e)})

    def run_orav_loop(self, max_iterations: int = 2):
        """
        全量 Observation -> Reasoning -> Action -> Validation 闭环。
        """
        for i in range(max_iterations):
            logging.info(f"=== 控制帧迭代 [{i}] ===")
            
            # [O]bservation
            observation = self._acquire_observation_vector()
            
            # [R]easoning
            try:
                response = self.inference_engine.compute_action(
                    self.system_prompt, 
                    observation, 
                    self.state_history
                )
            except Exception as e:
                logging.error(f"API 推理引擎异常: {str(e)}")
                break
            
            message = response["choices"][0]["message"]
            self.state_history.append({
                "role": "assistant", 
                "content": message.get("content", ""), 
                "tool_calls": message.get("tool_calls", [])
            })
            
            if not message.get("tool_calls"):
                logging.warning("未检出约束向量，控制图截断。")
                break
                
            # [A]ction
            for tool_call in message["tool_calls"]:
                result = self._execute_tool_call(tool_call)
                # 不再将 tool result 注入历史记录以节约上下文，Agent 表现为无状态马尔可夫链 (只依赖当前观测)
                
            # [V]alidation
            # 缩减内存占用：清空历史，强制每一帧作为独立决策空间，避免死循环及 Token 爆炸
            self.state_history = []
            
            import time
            time.sleep(3.5)

if __name__ == "__main__":
    engine = AgentControlLoop()
    engine.run_orav_loop(50)
