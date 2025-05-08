#!/usr/bin/env node

/**
 * 主程序入口文件
 */

import { Manus } from './agent/manus.js';
import { Logger } from './utils/logger.js';
import * as readline from 'readline';

// 增加process对象的最大监听器数量，避免内存泄漏警告
process.setMaxListeners(15);

// 创建日志记录器
const logger = new Logger('Main');

/**
 * 主函数
 */
export async function main() {
  // 创建并初始化 Manus 代理
  const agent = await Manus.create();

  try {
    // 获取用户输入
    const prompt = process.argv[2] || (await getUserInput('请输入你的指令: \n'));

    if (!prompt.trim()) {
      logger.warning('提供了空指令。');
      return;
    }

    logger.warning('正在处理你的请求...');
    await agent.run(prompt);
    logger.info('请求处理完成。');
  } catch (error) {
    logger.error(`操作出错: ${error}`);
  } finally {
    // 确保在退出前清理代理资源
    await agent.cleanup();
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
