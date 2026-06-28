import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const execAsync = promisify(exec);

// Initialize Express for SSE network transport
const app = express();
app.use(express.json());

// Initialize the MCP Server
const mcpServer = new McpServer({
    name: 'termux-native-server',
    version: '1.0.0'
});

// ==========================================
// Define MCP Tools mapped to Termux API
// ==========================================

// Tool 1: Get Battery Status
mcpServer.tool('get_battery', '获取平板当前电池状态', {}, async () => {
    try {
        const { stdout } = await execAsync('termux-battery-status');
        return { content: [{ type: 'text', text: stdout }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `Failed to get battery: ${e.message}` }] };
    }
});

// Tool 2: Get Clipboard Content
mcpServer.tool('get_clipboard', '获取平板当前的剪贴板文本', {}, async () => {
    try {
        const { stdout } = await execAsync('termux-clipboard-get');
        return { content: [{ type: 'text', text: stdout || '(empty)' }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `Failed to get clipboard: ${e.message}` }] };
    }
});

// Tool 3: Vibrate Device
mcpServer.tool('vibrate', '让平板震动指定的时间', { 
    duration: z.number().default(500).describe('震动时长(毫秒)') 
}, async ({ duration }) => {
    try {
        await execAsync(`termux-vibrate -d ${duration}`);
        return { content: [{ type: 'text', text: `平板已震动 ${duration} 毫秒` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `Failed to vibrate: ${e.message}` }] };
    }
});

// Tool 4: Show Toast Message
mcpServer.tool('show_toast', '在平板屏幕上显示 Toast 提示框', { 
    message: z.string().describe('要提示的文本内容') 
}, async ({ message }) => {
    try {
        await execAsync(`termux-toast "${message}"`);
        return { content: [{ type: 'text', text: `Toast sent: ${message}` }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `Failed to show toast: ${e.message}` }] };
    }
});

// ==========================================
// Setup SSE Endpoint for Network Connection
// ==========================================

let globalTransport;

app.get('/sse', async (req, res) => {
    console.log('[SSE] 新的连接已建立');
    globalTransport = new SSEServerTransport('/message', res);
    await mcpServer.connect(globalTransport);
});

app.post('/message', async (req, res) => {
    if (globalTransport) {
        await globalTransport.handlePostMessage(req, res);
    } else {
        res.status(500).send('SSE Transport not initialized');
    }
});

// Start Server on all network interfaces
const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 Termux MCP Server is running!`);
    console.log(`📡 SSE Endpoint: http://0.0.0.0:${PORT}/sse`);
    console.log(`=========================================`);
    console.log(`Waiting for connection from your AI Client...`);
});
