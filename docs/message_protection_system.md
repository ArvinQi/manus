# 用户首次任务消息保护机制

## 概述

用户首次任务消息保护机制确保重要消息（特别是用户的首次任务创建消息）在对话上下文压缩时不会丢失。这个机制通过智能识别、优先级保护和特殊处理来维护关键对话信息的连续性。

## 核心功能

### 1. 智能消息分类

系统自动将消息分为以下类型：

- **`task_creation`**: 任务创建消息
- **`task_instruction`**: 任务指令消息
- **`important_user_input`**: 重要用户输入
- **`normal`**: 普通消息

### 2. 保护级别

每条消息都有以下保护属性：

```typescript
interface MessageContext {
  isProtected?: boolean;           // 是否受保护
  messageType?: MessageType;       // 消息类型
  importance: number;              // 重要性分数 (0-1)
  relevanceScore?: number;         // 相关性分数
}
```

### 3. 自动保护规则

#### 首次任务消息保护
- 检测包含任务创建关键词的消息
- 自动标记第一个任务为高优先级保护
- 长度超过200字符的用户消息自动保护

#### 关键词触发保护
消息包含以下关键词时自动保护：
```
- 创建任务、新任务、开始任务
- 第一个任务、首次任务、初始任务
- 重要、关键、必须、一定要、注意
```

#### 会话开始保护
- 每个会话开始的前2条用户消息自动保护
- 确保初始对话上下文不会丢失

## 使用方法

### 基础使用

```typescript
import { Manus } from '../src/agent/manus.js';

// 创建代理实例
const manus = await Manus.create({
  name: 'TaskAgent',
  maxSteps: 50,
});

// 用户消息会被自动检测和保护
const taskId = manus.createTask(
  '我的第一个任务',
  '这是一个重要的项目分析任务',
  ['分析代码', '生成报告', '优化建议']
);
```

### 手动保护重要消息

```typescript
// 手动标记重要消息
await manus.markMessageAsProtected(
  "这是一个非常重要的业务需求描述...",
  "关键业务需求"
);
```

### 配置对话上下文

```typescript
// 更新保护相关配置
manus.updateConversationConfig({
  maxContextMessages: 20,          // 最大上下文消息数
  importanceThreshold: 0.7,        // 重要性阈值
  relevanceThreshold: 0.6,         // 相关性阈值
});
```

## 保护机制工作流程

### 1. 消息添加阶段

```
用户消息 → 消息类型检测 → 保护级别判断 → 重要性计算 → 添加到上下文
```

### 2. 上下文压缩阶段

```
分离保护消息 → 选择重要普通消息 → 确保最近消息 → 按时间排序 → 返回最终上下文
```

### 3. 保护优先级

1. **最高优先级**: 手动标记的保护消息
2. **高优先级**: 首次任务创建消息
3. **中优先级**: 包含重要关键词的消息
4. **基础优先级**: 长消息和会话开始消息

## 配置选项

### ConversationConfig

```typescript
interface ConversationConfig {
  maxContextMessages: number;      // 最大保留消息数量 (默认: 20)
  maxTokenLimit: number;          // 最大令牌限制 (默认: 8000)
  relevanceThreshold: number;     // 相关性阈值 (默认: 0.6)
  importanceThreshold: number;    // 重要性阈值 (默认: 0.7)
  sessionTimeoutMs: number;       // 会话超时时间 (默认: 30分钟)
  summarizationThreshold: number; // 摘要化阈值 (默认: 50)
}
```

## API 方法

### 核心保护方法

```typescript
// 手动标记保护消息
await manus.markMessageAsProtected(
  messageContent: string,
  reason?: string
): Promise<void>

// 获取相关对话上下文
await manus.getRelevantConversationContext(
  query: string,
  maxMessages?: number
): Promise<Message[]>

// 获取对话统计信息
manus.getConversationStats(): ConversationStats

// 更新配置
manus.updateConversationConfig(
  config: Partial<ConversationConfig>
): void
```

### 任务相关方法

```typescript
// 创建任务（自动保护创建消息）
manus.createTask(
  title: string,
  description: string,
  steps: string[]
): string

// 获取任务状态
manus.getTaskStatus(): TaskStatus

// 获取任务历史
manus.getTaskHistory(limit?: number): TaskHistory[]
```

## 实际应用场景

### 场景1: 长期项目管理

```typescript
// 用户创建项目初始需求
const manus = await Manus.create({ maxSteps: 100 });

// 这条消息会被自动保护（首次任务 + 长消息）
const projectRequest = `
请帮我创建一个企业级Web应用项目：
- 用户管理系统
- 权限控制
- 数据分析面板
- 移动端适配
这是我们公司的核心项目，需要特别注意安全性和性能。
`;

await manus.markMessageAsProtected(projectRequest, "项目初始需求");
```

### 场景2: 多轮对话中的关键信息保护

```typescript
// 在长时间对话中保护关键指令
await manus.markMessageAsProtected(
  "重要更新：客户要求必须支持GDPR合规，这是强制要求",
  "GDPR合规要求"
);

// 后续即使有大量对话，这条重要信息也会被保留
```

### 场景3: 任务恢复场景

```typescript
// 系统中断后恢复任务
const manus = await Manus.create({ continueTask: true });

// 获取包含原始需求的保护消息
const context = await manus.getRelevantConversationContext(
  "原始任务需求",
  15
);

// 保护的首次任务消息确保任务可以准确恢复
```

## 监控和调试

### 对话状态监控

```typescript
const stats = manus.getConversationStats();
console.log(`
总会话数: ${stats.totalSessions}
活跃会话数: ${stats.activeSessions}
总消息数: ${stats.totalMessages}
当前会话: ${stats.currentSessionId}
`);
```

### 详细会话信息

```typescript
const detailedStats = manus.getDetailedSessionStats();
detailedStats.sessionList.forEach(session => {
  console.log(`
会话 ${session.sessionId}:
- 主题: ${session.topic}
- 消息数: ${session.messageCount}
- 存活时间: ${session.age}ms
- 状态: ${session.isActive ? '活跃' : '非活跃'}
  `);
});
```

## 最佳实践

### 1. 任务创建最佳实践

```typescript
// ✅ 好的做法：清晰的任务描述
const taskId = manus.createTask(
  "数据分析项目",
  "分析销售数据，生成月度报告，识别趋势模式",
  ["数据收集", "清理处理", "统计分析", "可视化", "报告生成"]
);

// ❌ 避免：过于简单的描述
const taskId = manus.createTask("分析", "分析数据", ["分析"]);
```

### 2. 重要信息保护

```typescript
// ✅ 主动保护关键业务信息
await manus.markMessageAsProtected(
  "客户要求必须在本月底前完成，延期会影响合同续签",
  "关键截止日期"
);

// ✅ 保护详细技术要求
await manus.markMessageAsProtected(
  "技术栈必须使用：React 18 + TypeScript + Node.js + PostgreSQL",
  "技术栈要求"
);
```

### 3. 配置优化

```typescript
// 为长期项目优化配置
manus.updateConversationConfig({
  maxContextMessages: 30,        // 增加保留消息数
  importanceThreshold: 0.6,      // 降低重要性阈值以保留更多信息
  sessionTimeoutMs: 60 * 60 * 1000, // 延长会话超时到1小时
});
```

## 性能考虑

### 内存使用

- 保护消息会占用额外内存
- 建议定期清理过期会话
- 对于长期运行的应用，考虑设置合理的消息上限

### 处理效率

- 消息保护机制增加了处理开销
- 大量保护消息可能影响检索速度
- 建议根据实际需求调整保护策略

## 故障排除

### 常见问题

1. **保护消息过多导致内存不足**
   ```typescript
   // 清理过期会话
   manus.clearConversationSessions();

   // 调整配置
   manus.updateConversationConfig({
     maxContextMessages: 15,
     sessionTimeoutMs: 30 * 60 * 1000
   });
   ```

2. **重要消息未被保护**
   ```typescript
   // 手动标记保护
   await manus.markMessageAsProtected(message, "手动保护");

   // 检查消息内容是否包含保护关键词
   ```

3. **上下文检索不准确**
   ```typescript
   // 调整相关性阈值
   manus.updateConversationConfig({
     relevanceThreshold: 0.5 // 降低阈值获取更多相关消息
   });
   ```

## 总结

用户首次任务消息保护机制通过多层保护策略确保关键对话信息不会在系统压缩过程中丢失。这个机制特别适用于长期项目管理、复杂任务执行和需要维护对话连续性的场景。

合理配置和使用这个机制可以显著提升用户体验，确保重要信息的持久性和可访问性。
