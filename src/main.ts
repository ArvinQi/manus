#!/usr/bin/env node

/**
 * 主程序入口文件
 */

import { Manus } from './agent/manus.js';
import { PlanningAgent } from './agent/planning.js';
import { FlowFactory, FlowType } from './flow/flow_factory.js';
import { Logger } from './utils/logger.js';
import * as readline from 'readline';
import * as fs from 'fs';
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
  // const useMcpServer = process.argv.includes('--use-mcp-server');

  // --max-steps 最大步骤数
  const maxStepsArgIndex = process.argv.indexOf('--max-steps');
  const maxSteps = maxStepsArgIndex !== -1 ? parseInt(process.argv[maxStepsArgIndex + 1], 10) : 30;

  // 检查是否指定了MD文件
  const fileArgIndex = process.argv.indexOf('--file');
  const taskFile = fileArgIndex !== -1 ? process.argv[fileArgIndex + 1] : null;

  // 创建并初始化代理
  const agents: Record<string, any> = {
    manus: await Manus.create({
      maxSteps,
      // useMcpServer,
      continueTask,
    }),
  };

  // 等待1秒
  if (!process.argv[2]) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  try {
    // 获取用户输入或从文件读取
    let prompt: string;

    if (taskFile) {
      // 从MD文件读取任务描述
      if (!fs.existsSync(taskFile)) {
        logger.error(`指定的任务文件不存在: ${taskFile}`);
        return;
      }

      try {
        prompt = fs.readFileSync(taskFile, 'utf-8');
        logger.info(`从文件读取任务描述: ${taskFile}`);
      } catch (error) {
        logger.error(`读取任务文件失败: ${error}`);
        return;
      }
    } else {
      // 从命令行参数或交互式输入获取
      prompt = process.argv[2] || (await getUserInput('请输入你的指令: \n'));
    }

    if (!prompt.trim()) {
      logger.warn('提供了空指令。');
      return;
    }

    logger.info(
      '请求内容：' +
        (taskFile ? `[来自文件: ${taskFile}]` : '') +
        prompt.substring(0, 100) +
        (prompt.length > 100 ? '...' : '')
    );
    logger.warn('正在处理你的请求...');

    // 使用流程工厂创建规划流程
    // const flow = FlowFactory.createFlow({
    //   flowType: FlowType.PLANNING,
    //   agents: agents,
    // });

    try {
      // 记录开始时间
      const startTime = Date.now();

      // 检查是否需要继续执行已有任务
      if (continueTask) {
        const canContinue = agents.manus.continueTaskExecution();
        if (canContinue) {
          logger.info('继续执行已保存的任务计划...');
          const taskProgress = agents.manus.getTaskProgress();
          logger.info(
            `任务进度: ${taskProgress.completedSteps}/${taskProgress.totalSteps} (${taskProgress.progress.toFixed(1)}%)`
          );
        }
      }

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
