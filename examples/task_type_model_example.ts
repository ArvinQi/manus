/**
 * 任务类型模型选择示例
 * 演示如何根据不同任务类型自动选择合适的 LLM 模型
 */

import { LLM, TaskType } from '../src/llm/index.js';
import { llmFactory } from '../src/llm/factory.js';
import { CoderAgent } from '../src/agent/coder.js';
import { ToolCollection } from '../src/tool/tool_collection.js';
import { BashTool } from '../src/tool/bash.js';
import { FileOperatorsTool } from '../src/tool/file_operators.js';

async function main() {
  console.log('🚀 Manus 任务类型模型选择示例');
  console.log('=====================================');
  console.log('');

  // 1. 展示不同任务类型的模型选择
  console.log('📋 1. 不同任务类型的模型选择');
  console.log('----------------------------');

  const taskTypes = [
    { type: TaskType.DEFAULT, name: '默认任务' },
    { type: TaskType.CODING, name: '编码任务' },
    { type: TaskType.VISION, name: '视觉任务' },
    { type: TaskType.PLANNING, name: '规划任务' },
  ];

  for (const { type, name } of taskTypes) {
    const llm = LLM.createForTask(type);
    const modelInfo = llm.getModelInfo();
    console.log(`${name}:`);
    console.log(`  ✓ 配置: ${modelInfo.configName}`);
    console.log(`  ✓ 模型: ${modelInfo.model}`);
    console.log(`  ✓ 基础URL: ${modelInfo.baseUrl}`);
    console.log('');
  }

  // 2. 展示 LLM Factory 的缓存功能
  console.log('🏭 2. LLM Factory 缓存管理');
  console.log('------------------------');

  const factory = llmFactory;
  console.log('初始缓存统计:', factory.getCacheStats());

  // 获取多个相同类型的 LLM 实例
  const codingLLM1 = factory.getLLM(TaskType.CODING, undefined, 'user1');
  const codingLLM2 = factory.getLLM(TaskType.CODING, undefined, 'user1'); // 应该从缓存获取
  const codingLLM3 = factory.getLLM(TaskType.CODING, undefined, 'user2'); // 不同用户，新建实例

  console.log('获取 LLM 实例后的缓存统计:', factory.getCacheStats());
  console.log('user1 的两次获取是否为同一实例:', codingLLM1 === codingLLM2);
  console.log('');

  // 3. 展示 CoderAgent 的专用模型使用
  console.log('💻 3. CoderAgent 专用模型');
  console.log('---------------------');

  const tools = new ToolCollection();
  tools.addTool(new BashTool());
  tools.addTool(new FileOperatorsTool());

  const coderAgent = new CoderAgent(tools, {}, 'coding_user');
  const coderModel = coderAgent.llm.getModelInfo();

  console.log('CoderAgent 使用的模型:');
  console.log(`  ✓ 配置: ${coderModel.configName}`);
  console.log(`  ✓ 模型: ${coderModel.model}`);
  console.log(`  ✓ 基础URL: ${coderModel.baseUrl}`);
  console.log('');

  // 4. 展示记忆管理的任务类型隔离
  console.log('🧠 4. 记忆管理的任务类型隔离');
  console.log('------------------------');

  const defaultLLM = factory.getLLM(TaskType.DEFAULT, undefined, 'test_user');
  const codingLLM = factory.getLLM(TaskType.CODING, undefined, 'test_user');

  const defaultMemory = defaultLLM.getMemoryManager();
  const codingMemory = codingLLM.getMemoryManager();

  if (defaultMemory && codingMemory) {
    console.log('默认任务记忆管理器配置:');
    console.log(`  ✓ 启用状态: ${defaultMemory.isEnabled()}`);
    console.log(`  ✓ 用户ID: ${defaultMemory.getUserId()}`);

    console.log('编码任务记忆管理器配置:');
    console.log(`  ✓ 启用状态: ${codingMemory.isEnabled()}`);
    console.log(`  ✓ 用户ID: ${codingMemory.getUserId()}`);

    console.log('✓ 不同任务类型使用独立的记忆集合（collection）');
  }
  console.log('');

  // 5. 展示性能优化
  console.log('⚡ 5. 性能优化特性');
  console.log('----------------');

  console.log('✓ 模型实例缓存：复用相同任务类型的 LLM 实例');
  console.log('✓ 预加载常用模型：系统启动时预加载 DEFAULT 和 CODING 模型');
  console.log('✓ 记忆隔离：不同任务类型使用独立的记忆集合');
  console.log('✓ 智能选择：根据任务类型自动选择最合适的模型');
  console.log('');

  // 6. 使用建议
  console.log('💡 6. 使用建议');
  console.log('------------');

  console.log('• 编码任务：使用 TaskType.CODING 获得优化的编程体验');
  console.log('• 视觉任务：使用 TaskType.VISION 处理图像和视觉内容');
  console.log('• 常规任务：使用 TaskType.DEFAULT 或直接使用 LLM 默认构造函数');
  console.log('• 代理开发：参考 CoderAgent 的实现方式');
  console.log('');

  console.log('🎉 示例完成！');
  console.log('=====================================');
  console.log('');
  console.log('现在您可以根据任务类型自动选择最合适的模型：');
  console.log('- 编码任务 → coder 模型（针对编程优化）');
  console.log('- 视觉任务 → vision 模型（支持图像处理）');
  console.log('- 其他任务 → default 模型（通用能力）');
  console.log('');
  console.log('享受更高效的 AI 助手体验！ 🚀');
}

// 运行示例
main().catch(console.error);
