import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Logger } from '../utils/logger.js';

// 导入工具
import { BashTool } from '../tool/bash.js';
import { AskHumanTool } from '../tool/ask_human.js';
import { CreateChatCompletionTool } from '../tool/create_chat_completion.js';
import { FileOperatorsTool } from '../tool/file_operators.js';
import { PlanningTool } from '../tool/planning.js';
import { StrReplaceEditorTool } from '../tool/str_replace_editor.js';
import { SystemInfoTool } from '../tool/system_info.js';
import { Terminate } from '../tool/terminate.js';
// import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// 创建日志记录器 - 禁用控制台输出，只写入到文件
const logger = new Logger('MCPServer', { useConsole: true });

// 创建 MCP Server
const server = new McpServer({ name: 'manus', version: '1.0.0' });

// 注册 bash 工具
server.tool(
  'bash',
  { command: z.string().describe('要执行的 shell 命令') },
  async ({ command }) => {
    logger.info(`执行 bash 命令: ${command}`);
    const bashTool = new BashTool();
    const result = await bashTool.run({ command });
    return {
      content: [
        {
          type: 'text',
          text: result.output
            ? String(result.output)
            : result.error
              ? `错误: ${result.error}`
              : '命令执行完成',
        },
      ],
    };
  }
);

// 注册 ask_human 工具
server.tool(
  'ask_human',
  {
    question: z.string().describe('要向人类用户提出的问题'),
    options: z.array(z.string()).optional().describe('可选的选项列表'),
    default_value: z.string().optional().describe('默认值'),
    timeout: z.number().optional().describe('超时时间(毫秒)'),
  },
  async ({ question, options, default_value, timeout }) => {
    logger.info(`向用户提问: ${question}`);
    const askHumanTool = new AskHumanTool();
    const result = await askHumanTool.run({ question, options, default_value, timeout });
    return {
      content: [
        {
          type: 'text',
          text: result.output
            ? String(result.output)
            : result.error
              ? `错误: ${result.error}`
              : '用户未回答',
        },
      ],
    };
  }
);

// 注册 file_operators 工具
server.tool(
  'file_operators',
  {
    operation: z.enum(['read', 'write', 'list', 'exists', 'mkdir']).describe('文件操作类型'),
    path: z.string().describe('文件或目录路径'),
    content: z.string().optional().describe('写入内容'),
    encoding: z.string().optional().describe('文件编码'),
    recursive: z.boolean().optional().describe('是否递归创建目录'),
  },
  async ({ operation, path, content, encoding, recursive }) => {
    logger.info(`执行文件操作: ${operation} ${path}`);
    const fileOperatorsTool = new FileOperatorsTool();
    const result = await fileOperatorsTool.run({ operation, path, content, encoding, recursive });
    return {
      content: [
        {
          type: 'text',
          text: result.output
            ? JSON.stringify(result.output)
            : result.error
              ? `错误: ${result.error}`
              : '操作完成',
        },
      ],
    };
  }
);

// 注册 str_replace_editor 工具
server.tool(
  'editor',
  {
    file: z.string().describe('文件路径'),
    find: z.string().describe('查找内容'),
    replace: z.string().describe('替换内容'),
  },
  async ({ file, find, replace }) => {
    logger.info(`编辑文件: ${file}`);
    const editorTool = new StrReplaceEditorTool();
    // 先读取文件内容
    const fileOperatorsTool = new FileOperatorsTool();
    const readResult = await fileOperatorsTool.run({ operation: 'read', path: file });

    if (readResult.error) {
      return { content: [{ type: 'text', text: `读取文件失败: ${readResult.error}` }] };
    }

    // 执行替换
    const content = String(readResult.output);
    const result = await editorTool.run({ content, pattern: find, replacement: replace });

    // 写回文件
    if (!result.error && result.output) {
      const writeResult = await fileOperatorsTool.run({
        operation: 'write',
        path: file,
        content: String(result.output),
      });

      if (writeResult.error) {
        return { content: [{ type: 'text', text: `写入文件失败: ${writeResult.error}` }] };
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: result.output ? '编辑完成' : result.error ? `错误: ${result.error}` : '编辑完成',
        },
      ],
    };
  }
);

// 注册 system_info 工具
server.tool(
  'system_info',
  {
    info_type: z
      .enum(['os', 'arch', 'platform', 'env', 'cpu', 'memory', 'network', 'all'])
      .optional()
      .default('all')
      .describe('系统信息类型'),
    env_var: z.string().optional().describe('要获取的特定环境变量名称'),
  },
  async ({ info_type = 'all', env_var }) => {
    logger.info(`获取系统信息: ${info_type}`);
    const systemInfoTool = new SystemInfoTool();
    const result = await systemInfoTool.run({ info_type, env_var });
    return {
      content: [
        {
          type: 'text',
          text: result.output
            ? JSON.stringify(result.output)
            : result.error
              ? `错误: ${result.error}`
              : '获取系统信息完成',
        },
      ],
    };
  }
);

// 注册 planning 工具
server.tool(
  'planning',
  {
    task: z.string().describe('任务描述'),
    context: z.string().optional().describe('任务上下文'),
  },
  async ({ task, context }) => {
    logger.info(`规划任务: ${task}`);
    const planningTool = new PlanningTool();
    const result = await planningTool.run({ task, context });
    return {
      content: [
        {
          type: 'text',
          text: result.output
            ? JSON.stringify(result.output)
            : result.error
              ? `错误: ${result.error}`
              : '规划完成',
        },
      ],
    };
  }
);

// 注册 create_chat_completion 工具
server.tool(
  'create_chat_completion',
  { response: z.string().describe('应该传递给用户的响应文本') },
  async ({ response }) => {
    logger.info(`创建聊天完成: ${response.substring(0, 50)}...`);
    const chatCompletionTool = new CreateChatCompletionTool();
    const result = await chatCompletionTool.run({ response });
    return {
      content: [
        {
          type: 'text',
          text: result.output
            ? String(result.output)
            : result.error
              ? `错误: ${result.error}`
              : '聊天完成',
        },
      ],
    };
  }
);

// 注册 terminate 工具
server.tool('terminate', { reason: z.string().describe('终止执行的原因') }, async ({ reason }) => {
  logger.info(`终止操作: ${reason}`);
  const terminateTool = new Terminate();
  await terminateTool.run({ reason });
  return { content: [{ type: 'text', text: `操作已终止: ${reason}` }] };
});

// 启动 MCP Server，使用 stdio 作为 transport
const transport = new StdioServerTransport();
// const transport = new StreamableHTTPClientTransport(
//   new URL(process.env.MCP_SERVER_URL || 'http://localhost:41741')
// );

server
  .connect(transport)
  .then(() => {
    logger.info('MCP Server started (stdio mode)');
  })
  .catch((error) => {
    logger.error(`MCP Server 启动失败: ${error}`);
  });
