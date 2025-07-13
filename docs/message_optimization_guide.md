# 消息优化指南

## 概述

消息优化系统是为了解决在与语言模型交互时消息列表冗余、重复和无关信息过多的问题。通过智能的去重、压缩、过滤和合并策略，可以显著提高对话质量，减少 token 消耗，并提高模型响应的相关性。

## 主要功能

### 1. 基础去重 (Deduplication)
- **功能**: 移除完全相同的消息
- **识别标准**: 基于消息角色、内容和工具调用的组合
- **效果**: 避免发送重复的对话内容

### 2. 语义去重 (Semantic Deduplication)
- **功能**: 识别并移除语义相似的消息
- **算法**: 基于词汇交集的文本相似度计算
- **优先级**: 保留用户消息优于助手消息
- **配置参数**: `similarityThreshold` (默认: 0.85)

### 3. 内容压缩 (Content Compression)
- **功能**: 压缩过长的消息内容
- **策略**: 保留开头和结尾，提取中间关键信息
- **关键词提取**: 自动识别包含重要关键词的句子
- **配置参数**:
  - `maxContentLength` (默认: 1000)
  - `compressionRatio` (默认: 0.6)

### 4. 相关性过滤 (Relevance Filtering)
- **功能**: 基于当前查询过滤无关消息
- **保护机制**: 始终保留系统消息、工具调用消息和最近的消息
- **计算方法**: 基于查询词汇匹配的相关性分数
- **配置参数**: `relevanceThreshold` (默认: 0.2)

### 5. 智能合并 (Smart Merging)
- **功能**: 合并来自同一角色的相关连续消息
- **限制条件**:
  - 不合并工具调用消息
  - 只合并内容相关且较短的消息
  - 限制合并数量
- **配置参数**: `maxMergeCount` (默认: 3)

### 6. 重要消息保护 (Important Message Preservation)
- **功能**: 确保关键消息不被过度优化
- **保护内容**:
  - 包含重要关键词的消息
  - 最新的用户消息
  - 错误和警告信息
- **配置参数**:
  - `preserveRecentCount` (默认: 3)
  - `keywordsForImportance` (可自定义关键词列表)

## 配置选项

### MessageOptimizationConfig 接口

```typescript
interface MessageOptimizationConfig {
  enabled: boolean;                    // 是否启用优化
  maxContentLength: number;            // 最大内容长度
  compressionRatio: number;            // 压缩比例 (0-1)
  similarityThreshold: number;         // 语义相似度阈值 (0-1)
  relevanceThreshold: number;          // 相关性阈值 (0-1)
  maxMergeCount: number;              // 最多合并消息数量
  preserveRecentCount: number;         // 保留最近消息数量
  keywordsForImportance: string[];     // 重要性关键词列表
}
```

### 默认配置

```typescript
const DEFAULT_CONFIG = {
  enabled: true,
  maxContentLength: 1000,
  compressionRatio: 0.6,
  similarityThreshold: 0.85,
  relevanceThreshold: 0.2,
  maxMergeCount: 3,
  preserveRecentCount: 3,
  keywordsForImportance: [
    '错误', '问题', '重要', '关键', '注意', '警告', '成功', '失败',
    'error', 'warning', 'important', 'key', 'critical', 'urgent'
  ]
};
```

## 使用方法

### 1. 基础使用

```typescript
import { LLM, TaskType } from '../src/llm/index.js';

// 使用默认优化配置
const llm = LLM.createForTask(TaskType.CODING);

const response = await llm.ask({
  messages: yourMessages,
  currentQuery: '当前查询内容'
});
```

### 2. 自定义优化配置

```typescript
import { LLM, TaskType, MessageOptimizationConfig } from '../src/llm/index.js';

const customConfig: Partial<MessageOptimizationConfig> = {
  maxContentLength: 500,
  compressionRatio: 0.4,
  relevanceThreshold: 0.3,
  keywordsForImportance: ['自定义', '关键词', 'custom', 'keywords']
};

const llm = LLM.createForTask(
  TaskType.ANALYSIS,
  undefined,
  undefined,
  undefined,
  customConfig
);
```

### 3. 动态调整配置

```typescript
// 查看当前配置
const currentConfig = llm.getOptimizationConfig();

// 更新部分配置
llm.updateOptimizationConfig({
  maxContentLength: 800,
  relevanceThreshold: 0.25
});

// 启用/禁用优化
llm.setOptimizationEnabled(false);
```

## 配置建议

### 按任务类型优化

#### 编程任务 (CODING)
```typescript
{
  maxContentLength: 1200,
  keywordsForImportance: [
    'error', 'bug', 'function', 'class', 'import', 'export',
    '错误', '函数', '类', '导入', '导出'
  ]
}
```

#### 分析任务 (ANALYSIS)
```typescript
{
  maxContentLength: 1500,
  compressionRatio: 0.7,
  keywordsForImportance: [
    'analysis', 'data', 'result', 'conclusion', 'important',
    '分析', '数据', '结果', '结论', '重要'
  ]
}
```

#### 对话任务 (DEFAULT)
```typescript
{
  maxContentLength: 800,
  similarityThreshold: 0.8,
  maxMergeCount: 4
}
```

### 性能调优建议

#### 高 Token 消耗场景
```typescript
{
  enabled: true,
  maxContentLength: 600,
  compressionRatio: 0.5,
  similarityThreshold: 0.75,
  relevanceThreshold: 0.3,
  maxMergeCount: 5
}
```

#### 高精度要求场景
```typescript
{
  enabled: true,
  maxContentLength: 1500,
  compressionRatio: 0.8,
  similarityThreshold: 0.9,
  relevanceThreshold: 0.1,
  preserveRecentCount: 5
}
```

## 优化效果监控

### 日志信息
系统会输出详细的优化日志：

```
[LLM] Using Mem0MemoryManager: 8 optimized messages (from 15 contextual)
[LLM] Message optimization: 15 → 8 messages (46.7% reduction)
```

### 配置 .manus 目录
优化信息会记录在以下文件中：
- `.manus/task_log.jsonl` - 任务执行日志
- `.manus/token_usage.jsonl` - Token 使用情况

## 最佳实践

### 1. 根据场景选择配置
- **实时对话**: 使用较激进的优化设置
- **重要任务**: 使用保守的优化设置
- **批量处理**: 启用强力压缩和合并

### 2. 关键词维护
定期更新 `keywordsForImportance` 列表，包含：
- 业务相关的重要术语
- 错误和警告关键词
- 特定领域的专业词汇

### 3. 性能监控
- 定期检查优化日志
- 监控 token 使用量变化
- 评估响应质量是否受影响

### 4. 渐进式优化
- 从保守的配置开始
- 逐步调整参数
- 测试不同场景下的效果

## 故障排除

### 常见问题

1. **优化过度导致信息丢失**
   - 降低 `compressionRatio`
   - 提高 `preserveRecentCount`
   - 添加更多重要关键词

2. **优化效果不明显**
   - 降低 `similarityThreshold`
   - 降低 `relevanceThreshold`
   - 增加 `maxMergeCount`

3. **响应质量下降**
   - 暂时禁用优化进行对比
   - 调整相关性过滤阈值
   - 检查重要消息是否被误删

### 调试建议
- 使用 `llm.setOptimizationEnabled(false)` 对比效果
- 检查日志中的优化统计信息
- 逐个启用/禁用优化功能进行测试

## 示例代码

完整的使用示例请参考 `examples/message_optimization_example.ts` 文件。

## 总结

消息优化系统通过多层次的智能处理，有效解决了消息冗余和无关信息问题。通过合理的配置和使用，可以：

- 显著减少 token 消耗（通常可减少 30-60%）
- 提高对话相关性和质量
- 保持重要信息不丢失
- 支持不同场景的个性化配置

建议在实际使用中根据具体需求调整配置参数，并持续监控优化效果。
