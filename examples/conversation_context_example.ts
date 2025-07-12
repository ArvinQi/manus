/**
 * 智能对话上下文管理器示例
 * 演示如何只传递相关对话记录，而不是完整的对话历史
 */

import { ConversationContextManager, ConversationConfig } from '../src/core/conversation_context_manager.js';
import { MemoryManager } from '../src/core/memory_manager.js';
import { LLM } from '../src/llm/index.js';
import { Manus } from '../src/agent/manus.js';
import { Message, Role } from '../src/schema/index.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('ConversationContextExample');

/**
 * 演示基本的对话上下文管理功能
 */
async function demonstrateBasicContextManagement() {
  logger.info('=== 演示基本对话上下文管理 ===');

  // 创建配置
  const config: ConversationConfig = {
    maxContextMessages: 5,
    maxTokenLimit: 2000,
    relevanceThreshold: 0.5,
    importanceThreshold: 0.6,
    sessionTimeoutMs: 10 * 60 * 1000, // 10分钟
    summarizationThreshold: 15,
  };

  // 创建对话上下文管理器
  const contextManager = new ConversationContextManager(config);

  // 模拟一系列对话
  const conversations = [
    { role: Role.USER, content: '请帮我创建一个JavaScript函数来计算斐波那契数列' },
    { role: Role.ASSISTANT, content: '我来帮你创建一个计算斐波那契数列的JavaScript函数...' },
    { role: Role.USER, content: '这个函数的时间复杂度是多少？' },
    { role: Role.ASSISTANT, content: '这个递归实现的时间复杂度是O(2^n)，效率不高...' },
    { role: Role.USER, content: '能否优化一下这个函数？' },
    { role: Role.ASSISTANT, content: '当然可以！我们可以使用动态规划来优化...' },
    { role: Role.USER, content: '现在请帮我写一个网页爬虫程序' },
    { role: Role.ASSISTANT, content: '我来帮你创建一个网页爬虫程序...' },
    { role: Role.USER, content: '爬虫如何处理反爬虫机制？' },
    { role: Role.ASSISTANT, content: '处理反爬虫机制有几种常见方法...' },
    { role: Role.USER, content: '回到斐波那契函数，能否用迭代方式实现？' },
  ];

  // 添加对话到管理器
  for (const conv of conversations) {
    const message = new Message({ role: conv.role, content: conv.content });
    await contextManager.addMessage(message);
  }

  // 测试相关性检索
  const lastQuery = '回到斐波那契函数，能否用迭代方式实现？';
  logger.info(`当前查询: ${lastQuery}`);

  // 获取相关上下文
  const relevantContext = await contextManager.getRelevantContext(lastQuery, 5);

  logger.info(`从 ${conversations.length} 条消息中筛选出 ${relevantContext.length} 条相关消息:`);
  relevantContext.forEach((msg, index) => {
    logger.info(`  ${index + 1}. [${msg.role}] ${msg.content?.substring(0, 50)}...`);
  });

  // 获取会话统计
  const stats = contextManager.getSessionStats();
  logger.info(`会话统计:`, stats);
}

/**
 * 演示与LLM集成的智能上下文管理
 */
async function demonstrateLLMIntegration() {
  logger.info('\n=== 演示LLM集成的智能上下文管理 ===');

  try {
    // 创建对话上下文配置
    const conversationConfig: ConversationConfig = {
      maxContextMessages: 8,
      maxTokenLimit: 3000,
      relevanceThreshold: 0.4,
      importanceThreshold: 0.5,
      sessionTimeoutMs: 20 * 60 * 1000, // 20分钟
      summarizationThreshold: 12,
    };

    // 创建LLM实例（带智能上下文管理）
    const llm = new LLM('default', undefined, 'test_user', conversationConfig);

    // 模拟多轮对话
    const messages: Message[] = [];

    // 第一轮：讨论编程
    messages.push(Message.userMessage('请解释什么是递归算法'));
    let response = await llm.ask({ messages });
    messages.push(Message.assistantMessage(response));
    logger.info(`AI回复: ${response.substring(0, 100)}...`);

    // 第二轮：继续编程话题
    messages.push(Message.userMessage('递归算法有什么缺点？'));
    response = await llm.ask({ messages });
    messages.push(Message.assistantMessage(response));
    logger.info(`AI回复: ${response.substring(0, 100)}...`);

    // 第三轮：切换到其他话题
    messages.push(Message.userMessage('请介绍一下机器学习的基本概念'));
    response = await llm.ask({ messages });
    messages.push(Message.assistantMessage(response));
    logger.info(`AI回复: ${response.substring(0, 100)}...`);

    // 第四轮：再次切换
    messages.push(Message.userMessage('如何设计一个数据库架构？'));
    response = await llm.ask({ messages });
    messages.push(Message.assistantMessage(response));
    logger.info(`AI回复: ${response.substring(0, 100)}...`);

    // 第五轮：回到之前的话题
    messages.push(Message.userMessage('回到递归算法，能否给个具体的例子？'));
    response = await llm.ask({ messages });
    logger.info(`AI回复: ${response.substring(0, 100)}...`);

    // 检查上下文管理器的状态
    const contextManager = llm.getConversationManager();
    if (contextManager) {
      const stats = contextManager.getSessionStats();
      logger.info(`对话管理统计:`, stats);
    }

  } catch (error) {
    logger.error(`LLM集成演示失败: ${error}`);
  }
}

/**
 * 演示与Manus Agent集成的智能上下文管理
 */
async function demonstrateAgentIntegration() {
  logger.info('\n=== 演示Agent集成的智能上下文管理 ===');

  try {
    // 创建对话上下文配置
    const conversationConfig: ConversationConfig = {
      maxContextMessages: 6,
      maxTokenLimit: 2500,
      relevanceThreshold: 0.3,
      importanceThreshold: 0.4,
      sessionTimeoutMs: 15 * 60 * 1000, // 15分钟
      summarizationThreshold: 10,
    };

    // 创建Manus agent实例
    const agent = new Manus({
      name: 'SmartContextAgent',
      systemPrompt: '你是一个智能助手，擅长根据上下文提供相关的回答。',
      conversationConfig,
    });

    // 模拟多轮交互
    agent.updateMemory(Role.USER, '请创建一个Python程序来处理CSV文件');
    agent.updateMemory(Role.ASSISTANT, '我来帮你创建一个Python程序来处理CSV文件...');

    agent.updateMemory(Role.USER, '如何优化这个程序的性能？');
    agent.updateMemory(Role.ASSISTANT, '可以通过以下几种方式优化性能...');

    agent.updateMemory(Role.USER, '现在我需要一个网页界面来展示数据');
    agent.updateMemory(Role.ASSISTANT, '我可以帮你创建一个网页界面...');

    agent.updateMemory(Role.USER, '回到CSV处理，如何处理大文件？');

    // 获取智能上下文
    const contextMessages = await agent.getContextualMessages('回到CSV处理，如何处理大文件？');

    logger.info(`从 ${agent.messages.length} 条消息中筛选出 ${contextMessages.length} 条相关上下文:`);
    contextMessages.forEach((msg, index) => {
      logger.info(`  ${index + 1}. [${msg.role}] ${msg.content?.substring(0, 60)}...`);
    });

    // 检查agent的对话管理器状态
    if (agent.isConversationContextEnabled()) {
      const contextManager = agent.getConversationManager();
      if (contextManager) {
        const stats = contextManager.getSessionStats();
        logger.info(`Agent对话管理统计:`, stats);
      }
    }

  } catch (error) {
    logger.error(`Agent集成演示失败: ${error}`);
  }
}

/**
 * 演示主题检测和会话管理
 */
async function demonstrateTopicDetectionAndSessions() {
  logger.info('\n=== 演示主题检测和会话管理 ===');

  const config: ConversationConfig = {
    maxContextMessages: 4,
    maxTokenLimit: 1500,
    relevanceThreshold: 0.5,
    importanceThreshold: 0.6,
    sessionTimeoutMs: 5 * 60 * 1000, // 5分钟
    summarizationThreshold: 8,
  };

  const contextManager = new ConversationContextManager(config);

  // 不同主题的对话
  const topicConversations = [
    // 编程话题
    { role: Role.USER, content: '如何用JavaScript创建一个异步函数？', topic: 'coding' },
    { role: Role.ASSISTANT, content: '可以使用async/await语法创建异步函数...', topic: 'coding' },

    // 文件操作话题
    { role: Role.USER, content: '如何读取本地文件的内容？', topic: 'file_ops' },
    { role: Role.ASSISTANT, content: '可以使用fs模块来读取文件...', topic: 'file_ops' },

    // 系统话题
    { role: Role.USER, content: '如何配置环境变量？', topic: 'system' },
    { role: Role.ASSISTANT, content: '环境变量可以通过多种方式配置...', topic: 'system' },

    // 回到编程话题
    { role: Role.USER, content: '异步函数的错误处理怎么做？', topic: 'coding' },
  ];

  // 添加对话并观察主题检测
  for (const conv of topicConversations) {
    const message = new Message({ role: conv.role, content: conv.content });
    await contextManager.addMessage(message);
    logger.info(`添加消息: [${conv.topic}] ${conv.content.substring(0, 40)}...`);
  }

  // 测试针对不同主题的查询
  const queries = [
    '异步函数的最佳实践是什么？',  // 应该匹配编程话题
    '如何删除文件？',              // 应该匹配文件操作话题
    '系统性能如何优化？',          // 应该匹配系统话题
  ];

  for (const query of queries) {
    logger.info(`\n查询: ${query}`);
    const relevantContext = await contextManager.getRelevantContext(query, 3);
    logger.info(`相关上下文 (${relevantContext.length} 条):`);
    relevantContext.forEach((msg, index) => {
      logger.info(`  ${index + 1}. [${msg.role}] ${msg.content?.substring(0, 50)}...`);
    });
  }

  // 显示最终统计
  const finalStats = contextManager.getSessionStats();
  logger.info(`\n最终统计:`, finalStats);
}

/**
 * 运行所有演示
 */
async function runAllDemonstrations() {
  try {
    await demonstrateBasicContextManagement();
    await demonstrateLLMIntegration();
    await demonstrateAgentIntegration();
    await demonstrateTopicDetectionAndSessions();

    logger.info('\n=== 所有演示完成 ===');
    logger.info('智能对话上下文管理器可以有效地：');
    logger.info('1. 根据相关性筛选对话历史');
    logger.info('2. 按主题组织会话');
    logger.info('3. 减少传递给LLM的消息数量');
    logger.info('4. 提高对话的连贯性和相关性');
    logger.info('5. 自动处理长对话的摘要');

  } catch (error) {
    logger.error(`演示过程中发生错误: ${error}`);
  }
}

// 运行演示
if (require.main === module) {
  runAllDemonstrations().catch(console.error);
}

export {
  demonstrateBasicContextManagement,
  demonstrateLLMIntegration,
  demonstrateAgentIntegration,
  demonstrateTopicDetectionAndSessions
};
