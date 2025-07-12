# Manus 记忆系统使用指南

## 概述

Manus 已经集成了基于 Mem0 的智能记忆管理系统，可以帮助AI Agent：

- 🧠 **智能记忆存储**：自动提取和存储重要的对话信息
- 🔍 **语义化检索**：基于语义相似性检索相关记忆
- 💰 **Token优化**：减少传递给LLM的消息数量，降低成本
- 🔄 **上下文连续性**：在多轮对话中保持上下文一致性

## 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Agent层       │    │   LLM层         │    │   记忆管理层     │
│                 │    │                 │    │                 │
│ BaseAgent       │◄──►│ LLM Class       │◄──►│ Mem0MemoryMgr   │
│ ReActAgent      │    │                 │    │                 │
│ Manus           │    │ - 智能上下文     │    │ - Mem0 SDK      │
│                 │    │ - 记忆集成       │    │ - 语义搜索       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                ▲
                                │
                       ┌─────────────────┐
                       │   配置系统       │
                       │                 │
                       │ - MemoryConfig  │
                       │ - JSON/TOML     │
                       └─────────────────┘
```

## 配置说明

### 1. 环境变量设置

```bash
# 必需：OpenAI API Key (Mem0需要)
export OPENAI_API_KEY=your_openai_api_key

# 可选：Mem0 API Key (如果使用Mem0云服务)
export MEM0_API_KEY=your_mem0_api_key
```

### 2. 配置文件设置

在 `config/config.json` 中添加记忆配置：

```json
{
  "llm": {
    "default": {
      "model": "gpt-4",
      "api_key": "${OPENAI_API_KEY}",
      // ... 其他LLM配置
    }
  },
  "memory": {
    "enabled": true,                    // 是否启用记忆功能
    "searchLimit": 5,                   // 搜索返回的记忆数量限制
    "searchThreshold": 0.7,             // 语义相似度阈值
    "maxContextMessages": 10,           // 最大上下文消息数
    "compressionThreshold": 50,         // 触发压缩的消息数阈值
    "autoSaveMessages": true            // 是否自动保存消息
  }
}
```

### 3. TOML配置支持

在 `config/config.toml` 中：

```toml
[memory]
enabled = true
searchLimit = 5
searchThreshold = 0.7
maxContextMessages = 10
compressionThreshold = 50
autoSaveMessages = true
```

## 使用方式

### 1. 基础使用

```typescript
import { Manus } from './src/agent/manus.js';
import { MemoryConfig } from './src/core/mem0_memory_manager.js';

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
const agent = new Manus({
  name: 'MemoryAgent',
  systemPrompt: '你是一个具有记忆功能的智能助手',
  memoryConfig,
  userId: 'user_123',  // 用户标识
});

// 开始对话
const response = await agent.run('我叫张三，我喜欢Python编程');
console.log(response);

// 后续对话会自动使用记忆
const response2 = await agent.run('你还记得我的名字吗？');
console.log(response2);
```

### 2. 高级用法 - 直接使用记忆管理器

```typescript
import { Mem0MemoryManager } from './src/core/mem0_memory_manager.js';

// 创建记忆管理器
const memoryManager = new Mem0MemoryManager(memoryConfig, 'user_123');

// 添加记忆
await memoryManager.addMemory('用户喜欢Python编程', {
  category: 'preference',
  timestamp: new Date().toISOString()
});

// 搜索相关记忆
const memories = await memoryManager.searchMemories('编程语言');
console.log('相关记忆:', memories);

// 获取所有记忆
const allMemories = await memoryManager.getAllMemories();
console.log('所有记忆:', allMemories);
```

### 3. 在自定义Agent中使用

```typescript
import { BaseAgent } from './src/agent/base.js';
import { LLM } from './src/llm/index.js';

class CustomAgent extends BaseAgent {
  private llm: LLM;

  constructor(options: {
    name: string;
    memoryConfig?: MemoryConfig;
    userId?: string;
  }) {
    super({
      ...options,
      memoryConfig: options.memoryConfig,
      userId: options.userId
    });

    // LLM会自动获得记忆管理功能
    this.llm = new LLM('default', options.memoryConfig, options.userId);
  }

  async step(): Promise<string> {
    // 获取智能上下文消息（会自动应用记忆优化）
    const contextMessages = await this.getContextualMessages();

    // 发送请求
    const response = await this.llm.ask({
      messages: contextMessages
    });

    return response;
  }
}
```

## 核心功能

### 1. 自动记忆存储
- 每次LLM调用后自动保存对话记录
- 智能提取重要信息
- 支持元数据标记

### 2. 语义化检索
- 基于Mem0的向量相似度搜索
- 可配置相似度阈值
- 支持模糊匹配和语义理解

### 3. 智能上下文管理
- 根据当前查询检索相关记忆
- 自动组合系统消息、记忆和最近消息
- 控制上下文长度，优化token使用

### 4. Token优化
- 减少传递给LLM的消息数量
- 详细的token使用统计
- 自动记录优化效果

## 监控和调试

### 1. 日志记录

系统会自动记录详细的记忆管理日志：

```
[MemoryDemo] 开始演示记忆系统功能...
[Mem0MemoryManager] Mem0 Memory Manager initialized successfully
[LLM] Message optimization: 15 → 8 messages
[Mem0MemoryManager] Added conversation to memory: 3 memories created
```

### 2. Token使用统计

在 `.manus/token_usage.jsonl` 中查看token使用统计：

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "model": "gpt-4",
  "prompt_tokens": 1200,
  "completion_tokens": 300,
  "total_tokens": 1500,
  "memoryEnabled": true,
  "messageOptimization": {
    "original": 15,
    "contextual": 8,
    "savedMessages": 7
  }
}
```

### 3. 任务执行日志

在 `.manus/task_log.jsonl` 中查看详细的执行日志。

## 最佳实践

### 1. 用户标识管理
```typescript
// 为每个用户使用唯一标识
const userId = `user_${sessionId}`;

const agent = new Manus({
  name: 'Agent',
  memoryConfig,
  userId
});
```

### 2. 记忆配置优化
```typescript
// 根据应用场景调整配置
const memoryConfig: MemoryConfig = {
  enabled: true,
  searchLimit: 3,           // 短对话使用较少记忆
  searchThreshold: 0.8,     // 高阈值保证相关性
  maxContextMessages: 6,    // 控制上下文长度
  compressionThreshold: 30,
  autoSaveMessages: true
};
```

### 3. 错误处理
```typescript
try {
  const response = await agent.run(userInput);
  console.log(response);
} catch (error) {
  console.error('对话失败:', error);
  // 记忆系统错误不会影响基础功能
}
```

## 演示脚本

运行记忆系统演示：

```bash
# 编译项目
npm run build

# 运行演示
node dist/examples/memory_demo.js
```

演示包括：
1. 记忆建立和存储
2. 记忆检索和回忆
3. 有记忆vs无记忆Agent对比
4. 记忆管理器功能展示

## 常见问题

### Q: 记忆功能需要额外的API费用吗？
A: Mem0 OSS版本免费，但需要OpenAI API用于向量嵌入。费用主要来自embedding API调用。

### Q: 如何清空用户记忆？
```typescript
const memoryManager = agent.getMemoryManager();
await memoryManager.clearAllMemories();
```

### Q: 记忆数据存储在哪里？
A: 默认使用Mem0的本地向量存储，数据存储在内存中。可以配置持久化存储。

### Q: 如何禁用记忆功能？
A: 在配置中设置 `memory.enabled = false` 或不传递 `memoryConfig`。

### Q: 记忆系统支持多语言吗？
A: 是的，Mem0支持多语言语义搜索，但建议在同一用户会话中使用一致的语言。

## 技术细节

### 记忆存储格式
```typescript
interface MemoryAddResult {
  success: boolean;
  memoryId?: string;
  error?: string;
}

interface MemorySearchResult {
  memory: string;
  score: number;
  metadata?: Record<string, any>;
}
```

### 集成点
1. `LLM.sendRequest()` - 智能上下文处理
2. `BaseAgent.updateMemory()` - 自动记忆存储
3. `Mem0MemoryManager.getRelevantContext()` - 记忆检索

### 性能优化
- 异步记忆操作
- 缓存常用记忆
- 批量处理记忆更新
- 智能阈值控制

---

通过集成Mem0记忆系统，Manus能够提供更智能、更个性化的对话体验，同时有效控制API成本。
