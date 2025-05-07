#!/usr/bin/env node

/**
 * 命令行入口文件
 */

import { main } from './main.js';

// 执行主函数
main().catch((error) => {
  console.error(`程序执行失败: ${error}`);
  process.exit(1);
});
