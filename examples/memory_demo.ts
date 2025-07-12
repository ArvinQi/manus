/**
 * 记忆系统演示脚本
 * 展示如何使用Mem0进行智能对话记录管理
 */

import { Manus } from '../src/agent/manus.js';
import { MemoryConfig } from '../src/core/mem0_memory_manager.js';
import { Logger } from '../src/utils/logger.js';
import { config } from '../src/utils/config.js';

// 创建日志记录器
const logger = new Logger('MemoryDemo');

/**
 * 演示记忆系统功能
 */
async function demonstrateMemorySystem() {
  logger.info('开始演示记忆系统功能...');

  // 配置记忆管理
  const memoryConfig: MemoryConfig = {
    enabled: true,
    searchLimit: 5,
    searchThreshold: 0.7,
    maxContextMessages: 8,
    compressionThreshold: 20,
    autoSaveMessages: true,
  };

  // 创建具有记忆功能的Agent
  const agentWithMemory = new Manus({
    name: 'MemoryAgent',
    description: '具有记忆功能的智能助手',
    systemPrompt: `你是一个具有记忆功能的智能助手。
你能记住用户的偏好和历史对话内容。
当用户问及之前的对话时，你可以准确回忆起相关信息。
请用简洁明了的语言回答问题。`,
    memoryConfig,
    userId: 'demo_user',
    maxSteps: 5,
  });

  // 创建不具有记忆功能的Agent作为对比
  const agentWithoutMemory = new Manus({
    name: 'NoMemoryAgent',
    description: '不具有记忆功能的智能助手',
    systemPrompt: `你是一个智能助手。
请用简洁明了的语言回答问题。`,
    maxSteps: 5,
  });

  try {
    logger.info('=== 第一轮对话：建立记忆 ===');

    // 第一轮对话：建立记忆
    const conversation1 = '我叫张三，我是一名软件工程师，我喜欢Python编程，不喜欢Java。我住在北京。';

    logger.info('用户输入：' + conversation1);
    logger.info('有记忆的Agent回复：');
    const response1 = await agentWithMemory.run(conversation1);
    logger.info(response1);

    // 等待一段时间，让记忆系统处理
    await new Promise(resolve => setTimeout(resolve, 2000));

    logger.info('\n=== 第二轮对话：测试记忆回忆 ===');

    // 第二轮对话：测试记忆回忆
    const conversation2 = '你还记得我的名字和职业吗？我喜欢什么编程语言？';

    logger.info('用户输入：' + conversation2);

    // 具有记忆的Agent
    logger.info('有记忆的Agent回复：');
    const response2WithMemory = await agentWithMemory.run(conversation2);
    logger.info(response2WithMemory);

    // 没有记忆的Agent
    logger.info('没有记忆的Agent回复：');
    const response2WithoutMemory = await agentWithoutMemory.run(conversation2);
    logger.info(response2WithoutMemory);

    logger.info('\n=== 第三轮对话：复杂记忆检索 ===');

    // 第三轮对话：复杂记忆检索
    const conversation3 = '根据我的技能背景，推荐一些适合我的开源项目。';

    logger.info('用户输入：' + conversation3);

    // 具有记忆的Agent
    logger.info('有记忆的Agent回复：');
    const response3WithMemory = await agentWithMemory.run(conversation3);
    logger.info(response3WithMemory);

    // 展示记忆管理器的功能
    logger.info('\n=== 记忆管理器功能展示 ===');

    const memoryManager = agentWithMemory.getMemoryManager();
    if (memoryManager) {
      // 搜索相关记忆
      const memories = await memoryManager.searchMemories('Python 编程');
      logger.info('搜索"Python 编程"相关记忆：');
      memories.forEach((memory, index) => {
        logger.info(`${index + 1}. ${memory.memory} (相关度: ${memory.score.toFixed(2)})`);
      });

      // 获取所有记忆
      const allMemories = await memoryManager.getAllMemories();
      logger.info(`\n总共存储了 ${allMemories.length} 条记忆`);
    }

    logger.info('\n=== 演示完成 ===');
    logger.info('记忆系统成功演示了以下功能：');
    logger.info('1. 自动存储对话记录');
    logger.info('2. 基于查询的智能记忆检索');
    logger.info('3. 上下文相关的对话优化');
    logger.info('4. 减少token消耗');

  } catch (error) {
    logger.error('演示过程中发生错误：', error);
  }
}

/**
 * 主函数
 */
async function main() {
  try {
    // 验证配置
    const validation = config.validateConfig();
    if (!validation.valid) {
      logger.error('配置验证失败：', validation.errors);
      return;
    }

    if (validation.warnings.length > 0) {
      logger.warning('配置警告：', validation.warnings);
    }

    // 检查记忆配置
    const memoryConfig = config.getMemoryConfig();
    logger.info('记忆配置：', memoryConfig);

    if (!memoryConfig.enabled) {
      logger.info('记忆功能未启用，将启用进行演示...');
      config.updateMemoryConfig({ enabled: true });
    }

    // 运行演示
    await demonstrateMemorySystem();

  } catch (error) {
    logger.error('演示失败：', error);
  }
}

// 运行演示
if (import.meta.url === new URL(import.meta.url).href) {
  main().catch(console.error);
}

export { demonstrateMemorySystem };
