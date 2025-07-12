/**
 * 多智能体配置系统使用示例
 * 演示如何使用JSON配置文件来配置和启动MCP和A2A代理
 */

import { Manus } from '../src/agent/manus.js';
import { config } from '../src/utils/config.js';
import { Logger } from '../src/utils/logger.js';
import { MultiAgentSystem } from '../src/core/multi_agent_system.js';

// 创建日志记录器
const logger = new Logger('MultiAgentExample');

/**
 * 演示配置验证
 */
async function validateConfiguration() {
  logger.info('=== 配置验证示例 ===');

  // 验证配置
  const validation = config.validateConfig();

  logger.info(`配置有效性: ${validation.valid}`);

  if (validation.errors.length > 0) {
    logger.error('配置错误:');
    validation.errors.forEach((error) => logger.error(`  - ${error}`));
  }

  if (validation.warnings.length > 0) {
    logger.warning('配置警告:');
    validation.warnings.forEach((warning) => logger.warning(`  - ${warning}`));
  }

  // 显示多智能体系统状态
  if (config.isMultiAgentEnabled()) {
    logger.info('多智能体系统已启用');
    const mcpServices = config.getMcpServices();
    const a2aAgents = config.getA2AAgents();

    logger.info(`配置的MCP服务数量: ${mcpServices.length}`);
    mcpServices.forEach((service) => {
      logger.info(`  - ${service.name} (${service.type}): ${service.enabled ? '启用' : '禁用'}`);
    });

    logger.info(`配置的A2A代理数量: ${a2aAgents.length}`);
    a2aAgents.forEach((agent) => {
      logger.info(`  - ${agent.name} (${agent.type}): ${agent.enabled ? '启用' : '禁用'}`);
    });
  } else {
    logger.info('多智能体系统未启用');
  }
}

/**
 * 演示传统模式创建Manus实例
 */
async function createTraditionalManus() {
  logger.info('\n=== 传统模式Manus实例创建 ===');

  const manus = await Manus.create({
    name: 'TraditionalManus',
    description: '传统模式的Manus实例',
    maxSteps: 10,
    enableMultiAgent: false,
  });

  logger.info('传统模式Manus实例创建成功');

  // 清理资源
  await manus.cleanup();

  return manus;
}

/**
 * 演示多智能体模式创建Manus实例
 */
async function createMultiAgentManus() {
  logger.info('\n=== 多智能体模式Manus实例创建 ===');

  if (!config.isMultiAgentEnabled()) {
    logger.warning('多智能体配置不可用，跳过此示例');
    return null;
  }

  try {
    const manus = await Manus.create({
      name: 'MultiAgentManus',
      description: '支持多智能体系统的Manus实例',
      maxSteps: 20,
      enableMultiAgent: true,
    });

    logger.info('多智能体模式Manus实例创建成功');

    // 检查多智能体系统状态
    if (manus.multiAgentSystem) {
      const system = manus.multiAgentSystem;
      const metrics = await system.getSystemMetrics();

      logger.info('多智能体系统指标:');
      logger.info(`  - 系统运行时间: ${Math.round(metrics.uptime / 1000)}秒`);
      logger.info(
        `  - MCP服务状态: ${metrics.mcpServices.active}/${metrics.mcpServices.total} 活跃`
      );
      logger.info(`  - A2A代理状态: ${metrics.agents.active}/${metrics.agents.total} 活跃`);
      logger.info(`  - 当前活跃任务: ${metrics.activeTasks}`);
    }

    // 清理资源
    await manus.cleanup();
    if (manus.multiAgentSystem) {
      await manus.multiAgentSystem.stop();
    }

    return manus;
  } catch (error) {
    logger.error(`创建多智能体Manus实例失败: ${error}`);
    return null;
  }
}

/**
 * 演示直接使用多智能体系统
 */
async function useMultiAgentSystemDirectly() {
  logger.info('\n=== 直接使用多智能体系统 ===');

  if (!config.isMultiAgentEnabled()) {
    logger.warning('多智能体配置不可用，跳过此示例');
    return;
  }

  try {
    const multiAgentConfig = config.getMultiAgentConfig();
    if (!multiAgentConfig) {
      logger.warning('无法获取多智能体配置');
      return;
    }

    // 创建多智能体系统
    const system = new MultiAgentSystem(multiAgentConfig);

    // 启动系统
    await system.start();
    logger.info('多智能体系统启动成功');

    // 提交一个测试任务
    const taskId = await system.submitTask('这是一个测试任务', {
      type: 'test',
      priority: 'medium',
      requiredCapabilities: ['memory_management'],
    });

    logger.info(`提交测试任务，ID: ${taskId}`);

    // 等待一段时间
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 检查任务状态
    const taskStatus = system.getTaskStatus(taskId);
    logger.info(`任务状态: ${taskStatus || '未找到'}`);

    // 停止系统
    await system.stop();
    logger.info('多智能体系统已停止');
  } catch (error) {
    logger.error(`使用多智能体系统失败: ${error}`);
  }
}

/**
 * 演示配置动态更新
 */
async function demonstrateConfigUpdate() {
  logger.info('\n=== 配置动态更新示例 ===');

  try {
    // 显示当前配置
    const currentConfig = config.getMultiAgentConfig();
    if (currentConfig) {
      logger.info('当前配置:');
      logger.info(`  - 系统名称: ${currentConfig.system.name}`);
      logger.info(`  - 调试模式: ${currentConfig.system.debug_mode}`);
      logger.info(`  - 日志级别: ${currentConfig.system.log_level}`);
    }

    // 更新配置（仅作为示例，实际使用中要谨慎）
    await config.updateMultiAgentConfig({
      system: {
        ...currentConfig?.system,
        debug_mode: true,
        log_level: 'debug',
      },
    });

    logger.info('配置更新成功');

    // 验证更新后的配置
    const updatedConfig = config.getMultiAgentConfig();
    if (updatedConfig) {
      logger.info('更新后的配置:');
      logger.info(`  - 调试模式: ${updatedConfig.system.debug_mode}`);
      logger.info(`  - 日志级别: ${updatedConfig.system.log_level}`);
    }
  } catch (error) {
    logger.error(`配置更新失败: ${error}`);
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    logger.info('多智能体配置系统示例开始');

    // 1. 验证配置
    await validateConfiguration();

    // 2. 创建传统模式Manus实例
    await createTraditionalManus();

    // 3. 创建多智能体模式Manus实例
    await createMultiAgentManus();

    // 4. 直接使用多智能体系统
    await useMultiAgentSystemDirectly();

    // 5. 演示配置动态更新
    await demonstrateConfigUpdate();

    logger.info('\n示例执行完成');
  } catch (error) {
    logger.error(`示例执行失败: ${error}`);
    process.exit(1);
  }
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('示例执行出错:', error);
    process.exit(1);
  });
}

export {
  validateConfiguration,
  createTraditionalManus,
  createMultiAgentManus,
  useMultiAgentSystemDirectly,
  demonstrateConfigUpdate,
};
