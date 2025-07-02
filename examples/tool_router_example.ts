/**
 * 工具路由器使用示例
 * 展示如何使用智能工具路由器来避免硬编码工具解析
 */

import { MultiAgentSystem } from '../src/core/multi_agent_system';
import { Manus } from '../src/agent/manus';
import { Logger } from '../src/utils/logger';
import { ToolRouter, ToolRoutingStrategy } from '../src/core/tool_router';

// 配置日志
const logger = new Logger('ToolRouterExample');

/**
 * 示例：使用工具路由器执行工具调用
 */
async function demonstrateToolRouting() {
  try {
    // 1. 初始化多智能体系统
    const multiAgentSystem = new MultiAgentSystem({
      mcp_services: [
        {
          name: 'file-operations',
          command: 'mcp-server-filesystem',
          args: ['--root', '/tmp'],
          capabilities: ['file_read', 'file_write', 'directory_list']
        },
        {
          name: 'web-search',
          command: 'mcp-server-brave-search',
          args: [],
          capabilities: ['web_search', 'information_retrieval']
        }
      ],
      a2a_agents: [
        {
          name: 'code-analyzer',
          endpoint: 'http://localhost:8001',
          capabilities: ['code_analysis', 'syntax_check', 'refactoring']
        },
        {
          name: 'data-processor',
          endpoint: 'http://localhost:8002',
          capabilities: ['data_processing', 'csv_analysis', 'json_transform']
        }
      ]
    });

    // 2. 启动系统
    await multiAgentSystem.start();
    logger.info('多智能体系统已启动');

    // 3. 创建Manus代理实例
    const manus = new Manus({
      name: 'SmartManus',
      multiAgentSystem,
      enableTaskContinuity: true
    });

    // 4. 获取工具路由器
    const toolRouter = multiAgentSystem.getToolRouter();

    // 5. 演示不同的路由策略
    await demonstrateRoutingStrategies(toolRouter);

    // 6. 演示通过Manus执行工具调用
    await demonstrateManusToolCalls(manus);

    // 7. 演示工具路由统计
    displayRoutingStatistics(toolRouter);

  } catch (error) {
    logger.error(`示例执行失败: ${error}`);
  }
}

/**
 * 演示不同的路由策略
 */
async function demonstrateRoutingStrategies(toolRouter: ToolRouter) {
  logger.info('=== 演示不同的路由策略 ===');

  const testCalls = [
    {
      name: 'read_file',
      arguments: { path: '/tmp/test.txt' },
      context: { task: 'file_operation_demo' }
    },
    {
      name: 'web_search',
      arguments: { query: 'TypeScript best practices' },
      context: { task: 'information_gathering' }
    },
    {
      name: 'analyze_code',
      arguments: { code: 'function hello() { return "world"; }' },
      context: { task: 'code_review' }
    }
  ];

  const strategies: ToolRoutingStrategy[] = ['mcp_first', 'a2a_first', 'capability_based', 'load_balanced', 'hybrid'];

  for (const strategy of strategies) {
    logger.info(`\n--- 使用策略: ${strategy} ---`);

    // 更新路由策略
    toolRouter.updateConfig({ strategy });

    for (const call of testCalls) {
      try {
        const result = await toolRouter.executeToolCall(call);
        logger.info(`工具 ${call.name} 执行结果:`, {
          success: result.success,
          executedBy: result.executedBy,
          executionTime: result.executionTime
        });
      } catch (error) {
        logger.warn(`工具 ${call.name} 执行失败: ${error}`);
      }
    }
  }
}

/**
 * 演示通过Manus执行工具调用
 */
async function demonstrateManusToolCalls(manus: Manus) {
  logger.info('\n=== 演示通过Manus执行工具调用 ===');

  const tasks = [
    '请帮我读取 /tmp/example.txt 文件的内容',
    '搜索关于 "Node.js 性能优化" 的最新信息',
    '分析这段代码的质量：const data = [1,2,3]; data.map(x => x * 2)'
  ];

  for (const task of tasks) {
    try {
      logger.info(`\n执行任务: ${task}`);
      const response = await manus.run(task);
      logger.info('任务执行结果:', response.substring(0, 200) + '...');
    } catch (error) {
      logger.error(`任务执行失败: ${error}`);
    }
  }
}

/**
 * 显示路由统计信息
 */
function displayRoutingStatistics(toolRouter: ToolRouter) {
  logger.info('\n=== 工具路由统计信息 ===');

  const stats = toolRouter.getStatistics();

  logger.info('总体统计:', {
    totalCalls: stats.totalCalls,
    successfulCalls: stats.successfulCalls,
    failedCalls: stats.failedCalls,
    averageExecutionTime: stats.averageExecutionTime
  });

  logger.info('MCP服务统计:', stats.mcpStats);
  logger.info('A2A代理统计:', stats.a2aStats);
  logger.info('工具使用统计:', stats.toolUsage);
}

/**
 * 演示工具能力分析
 */
async function demonstrateCapabilityAnalysis(toolRouter: ToolRouter) {
  logger.info('\n=== 演示工具能力分析 ===');

  const testTools = [
    'read_file',
    'write_file',
    'web_search',
    'analyze_code',
    'process_data',
    'unknown_tool'
  ];

  for (const toolName of testTools) {
    const capabilities = await toolRouter.analyzeToolCapabilities(toolName);
    logger.info(`工具 ${toolName} 的能力分析:`, capabilities);
  }
}

/**
 * 演示负载均衡
 */
async function demonstrateLoadBalancing(toolRouter: ToolRouter) {
  logger.info('\n=== 演示负载均衡 ===');

  // 设置负载均衡策略
  toolRouter.updateConfig({
    strategy: 'load_balanced',
    loadBalanceThreshold: 0.5
  });

  // 并发执行多个相同的工具调用
  const concurrentCalls = Array(10).fill(null).map((_, index) => ({
    name: 'web_search',
    arguments: { query: `test query ${index}` },
    context: { task: `concurrent_test_${index}` }
  }));

  const promises = concurrentCalls.map(call =>
    toolRouter.executeToolCall(call).catch(error => ({ error: error.message }))
  );

  const results = await Promise.all(promises);

  // 分析负载分布
  const executionDistribution = results.reduce((acc: any, result: any) => {
    if (result.executedBy) {
      acc[result.executedBy] = (acc[result.executedBy] || 0) + 1;
    }
    return acc;
  }, {});

  logger.info('负载分布结果:', executionDistribution);
}

// 主函数
async function main() {
  logger.info('开始工具路由器示例演示');

  try {
    await demonstrateToolRouting();
    logger.info('示例演示完成');
  } catch (error) {
    logger.error(`示例演示失败: ${error}`);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (require.main === module) {
  main();
}

export {
  demonstrateToolRouting,
  demonstrateRoutingStrategies,
  demonstrateManusToolCalls,
  displayRoutingStatistics,
  demonstrateCapabilityAnalysis,
  demonstrateLoadBalancing
};
