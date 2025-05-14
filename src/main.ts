#!/usr/bin/env node

/**
 * 主程序入口文件
 */

import { Manus } from './agent/manus.js';
import { PlanningAgent } from './agent/planning.js';
import { FlowFactory, FlowType } from './flow/flow_factory.js';
import { Logger } from './utils/logger.js';
import * as readline from 'readline';
import path from 'path';

// 增加process对象的最大监听器数量，避免内存泄漏警告
process.setMaxListeners(15);

// 创建日志记录器
const logger = new Logger('Main');

/**
 * 主函数
 */
export async function main() {
  const continueTask = process.argv.includes('--continue');
  const useMcpServer = process.argv.includes('--use-mcp-server') || true;
  const maxSteps = parseInt(process.argv[3], 10) || 30;

  // 创建并初始化代理
  const agents: Record<string, any> = {
    manus: await Manus.create({ maxSteps, useMcpServer, continueTask }),
  };

  // 等待1秒
  if (!process.argv[2]) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  try {
    // 获取用户输入
    const prompt = process.argv[2] || (await getUserInput('请输入你的指令: \n'));

    if (!prompt.trim()) {
      logger.warning('提供了空指令。');
      return;
    }

    logger.info('请求内容：' + prompt);
    logger.warning('正在处理你的请求...');

    // 使用流程工厂创建规划流程
    // const flow = FlowFactory.createFlow({
    //   flowType: FlowType.PLANNING,
    //   agents: agents,
    // });

    try {
      // 记录开始时间
      const startTime = Date.now();

      // 执行流程
      // const result = await flow.execute(prompt);
      const result = await agents.manus.run(prompt);

      // 计算耗时
      const elapsedTime = (Date.now() - startTime) / 1000;
      logger.info(`请求处理完成，耗时 ${elapsedTime.toFixed(2)} 秒`);
      logger.info(result);
    } catch (error) {
      logger.error('请求处理超时');
      logger.info('由于超时，操作已终止。请尝试一个更简单的请求。');
    }
  } catch (error: any) {
    if (error?.name === 'KeyboardInterrupt') {
      logger.info('操作被用户取消。');
    } else {
      logger.error(`操作出错: ${error}`);
    }
  } finally {
    // 清理代理资源
    for (const agentName in agents) {
      if (typeof agents[agentName].cleanup === 'function') {
        await agents[agentName].cleanup();
      }
    }
  }
}

/**
 * 获取用户输入
 * @param question 提示问题
 */
async function getUserInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      resolve(answer);
      rl.close();
    });
  });
}

// 如果直接运行此文件，则执行主函数
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error(`程序执行失败: ${error}`);
    process.exit(1);
  });
}
