/**
 * 系统内置工具测试示例
 */

import { MultiMcpManager } from '../src/mcp/multi_mcp_manager.js';
import { McpServiceConfig } from '../src/schema/multi_agent_config.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('SystemToolsTest');

async function testSystemTools() {
  logger.info('开始测试系统内置工具集成');

  // 创建 MCP 管理器
  const mcpManager = new MultiMcpManager();

  // 测试配置（空配置，只依赖系统内置工具）
  const configs: McpServiceConfig[] = [];

  try {
    // 初始化（这会自动添加系统内置工具）
    await mcpManager.initialize(configs);

    // 获取所有可用服务
    const services = await mcpManager.getAvailableServices();
    logger.info('可用服务:', services);

    // 检查系统工具服务是否可用
    const systemToolsAvailable = await mcpManager.isServiceAvailable('system_tools');
    logger.info('系统工具服务可用:', systemToolsAvailable);

    // 获取所有工具
    const allTools = mcpManager.getAllAvailableTools();
    logger.info('所有可用工具:', allTools);

    // 测试调用系统工具
    logger.info('测试调用bash工具...');
    const bashResult = await mcpManager.callTool('system_tools', 'bash', {
      command: 'echo "Hello from system tools!"'
    });
    logger.info('bash工具调用结果:', bashResult);

    // 测试调用文件操作工具
    logger.info('测试调用文件操作工具...');
    const fileResult = await mcpManager.callTool('system_tools', 'file_operators', {
      operation: 'exists',
      path: './package.json'
    });
    logger.info('文件操作工具调用结果:', fileResult);

    // 测试调用系统信息工具
    logger.info('测试调用系统信息工具...');
    const systemInfoResult = await mcpManager.callTool('system_tools', 'system_info', {
      info_type: 'platform'
    });
    logger.info('系统信息工具调用结果:', systemInfoResult);

    // 测试规划工具
    logger.info('测试调用规划工具...');
    const planningResult = await mcpManager.callTool('system_tools', 'planning', {
      command: 'create',
      title: 'Test Plan',
      steps: ['Step 1', 'Step 2', 'Step 3']
    });
    logger.info('规划工具调用结果:', planningResult);

    logger.info('所有测试完成！');

  } catch (error) {
    logger.error('测试失败:', error);
  } finally {
    // 关闭管理器
    await mcpManager.shutdown();
  }
}

// 运行测试
if (require.main === module) {
  testSystemTools().catch(console.error);
}

export { testSystemTools };
