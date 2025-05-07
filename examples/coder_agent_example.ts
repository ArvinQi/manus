/**
 * CoderAgent 使用示例
 * 展示如何使用 CoderAgent 执行智能编码任务
 */

import { CoderAgent } from '../src/agent/coder.js';
import { OpenAILLM } from '../src/llm/index.js';
import { ToolCollection } from '../src/tool/tool_collection.js';
import { config } from '../src/utils/config.js';
import { Logger } from '../src/utils/logger.js';

// 创建日志记录器
const logger = new Logger('CoderAgentExample');

/**
 * 运行 CoderAgent 示例
 */
async function runCoderAgentExample() {
  try {
    logger.info('初始化 CoderAgent...');

    // 创建 LLM 实例
    const llm = new OpenAILLM({
      apiKey: process.env.OPENAI_API_KEY || config.get('openai.api_key'),
      model: 'gpt-4-turbo',
    });

    // 创建工具集合
    const tools = new ToolCollection();

    // 创建 CoderAgent 实例
    const coderAgent = new CoderAgent(llm, tools, {
      // 可选配置
      approvalMode: 'suggest', // 使用建议模式，需要用户确认
      workingDir: './examples/coder_output', // 工作目录
      recordsDir: '.codex-records', // 记录保存目录
    });

    // 检查 Codex 是否可用
    const isCodexAvailable = await coderAgent.isCodexAvailable();
    if (!isCodexAvailable) {
      logger.error('Codex 不可用，请确保已正确安装并配置');
      logger.info('可以通过 npm install -g @openai/codex 安装 Codex');
      return;
    }

    // 执行编码任务
    logger.info('开始执行编码任务...');
    const task = '创建一个简单的 Express 服务器，提供 RESTful API 接口，包含用户管理功能';

    const result = await coderAgent.code(task);

    // 输出结果
    logger.info(`任务完成，评分: ${result.evaluation.score}/100`);
    logger.info(`执行时间: ${result.evaluation.executionTime}ms`);
    logger.info(`状态: ${result.evaluation.success ? '成功' : '失败'}`);

    if (result.evaluation.errors && result.evaluation.errors.length > 0) {
      logger.warning('发现错误:');
      result.evaluation.errors.forEach((error, index) => {
        logger.warning(`${index + 1}. ${error}`);
      });
    }

    // 生成并输出评估报告
    const report = coderAgent.generateReport();
    logger.info('评估报告:');
    console.log(report);
  } catch (error) {
    logger.error(`运行 CoderAgent 示例失败: ${error}`);
  }
}

// 运行示例
runCoderAgentExample().catch((error) => {
  logger.error(`未捕获的错误: ${error}`);
  process.exit(1);
});
