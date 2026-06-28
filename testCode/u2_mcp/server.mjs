import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { exec } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const server = new McpServer({
    name: "tablet-host-mcp",
    version: "1.0.0"
});

// 封装调用 Python 桥接脚本的辅助函数
async function callU2(action, params = {}) {
    const payload = JSON.stringify({ action, ...params });
    // 转义双引号以防止命令行解析错误
    const escapedPayload = payload.replace(/"/g, '\\"');
    const pyScript = path.join(__dirname, 'u2_bridge.py');
    
    // 执行 python 脚本
    const { stdout, stderr } = await execAsync(`python "${pyScript}" "${escapedPayload}"`);
    
    try {
        const result = JSON.parse(stdout.trim());
        if (result.status === "error") {
            throw new Error(result.error);
        }
        return result.data;
    } catch (e) {
        throw new Error(`Python script error: ${e.message}\nRaw Output: ${stdout}\nStderr: ${stderr}`);
    }
}

// ==========================
// Tools Registration
// ==========================

server.tool("vision_click_by_text", "利用视觉 OCR 寻找屏幕上的文字并精确点击（最强大的非标 UI 点击方案）", {
    text: z.string().describe("需要点击的精确文字内容，例如 '发布'、'购买' 或 '确认'")
}, async ({ text }) => {
    try {
        const data = await callU2("vision_click", { text });
        return { content: [{ type: "text", text: data }] };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

server.tool("get_tablet_info", "获取平板的基本信息（分辨率、包名等）", {}, async () => {
    try {
        const data = await callU2("info");
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

server.tool("click_screen", "点击平板屏幕上的指定坐标", {
    x: z.number().describe("X 坐标"),
    y: z.number().describe("Y 坐标")
}, async ({ x, y }) => {
    try {
        await callU2("click", { x, y });
        return { content: [{ type: "text", text: `Clicked at (${x}, ${y})` }] };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

server.tool("swipe_screen", "在平板屏幕上滑动", {
    sx: z.number().describe("起点 X 坐标"),
    sy: z.number().describe("起点 Y 坐标"),
    ex: z.number().describe("终点 X 坐标"),
    ey: z.number().describe("终点 Y 坐标")
}, async ({ sx, sy, ex, ey }) => {
    try {
        await callU2("swipe", { sx, sy, ex, ey });
        return { content: [{ type: "text", text: `Swiped from (${sx}, ${sy}) to (${ex}, ${ey})` }] };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

server.tool("get_ui_hierarchy", "获取当前屏幕的 UI 节点树（XML 格式），可用于分析界面元素坐标", {}, async () => {
    try {
        const data = await callU2("dump_hierarchy");
        return { content: [{ type: "text", text: data }] };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

server.tool("start_app", "根据包名启动 App", {
    package: z.string().describe("应用的包名，例如 com.taobao.idlefish")
}, async ({ package: pkg }) => {
    try {
        await callU2("app_start", { package: pkg });
        return { content: [{ type: "text", text: `Launched ${pkg}` }] };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

server.tool("run_adb_shell", "在平板上执行底层 ADB Shell 命令", {
    command: z.string().describe("Shell 命令内容，例如 ls /sdcard")
}, async ({ command }) => {
    try {
        const data = await callU2("shell", { command });
        return { content: [{ type: "text", text: data || "(no output)" }] };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

server.tool("screenshot", "截取平板当前屏幕", {}, async () => {
    try {
        const b64 = await callU2("screenshot");
        return {
            content: [{
                type: "image",
                data: b64,
                mimeType: "image/png"
            }]
        };
    } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }] };
    }
});

// ==========================
// Server Initialization
// ==========================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Tablet Host-side MCP Server running on stdio");
}

main().catch(console.error);
