# 工具路由器指南

## 概述

工具路由器（ToolRouter）是Manus系统的核心组件，它实现了智能工具调用路由，避免了硬编码的工具解析。通过工具路由器，系统可以动态地选择最合适的MCP服务或A2A代理来执行工具调用。

## 架构设计

### 核心组件

```
┌─────────────────┐
│   ToolRouter    │
├─────────────────┤
│ - 路由策略管理   │
│ - 能力分析      │
│ - 负载均衡      │
│ - 回退机制      │
│ - 统计监控      │
└─────────────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌──▼──┐
│  MCP  │ │ A2A │
│Manager│ │Agent│
│       │ │Mgr  │
└───────┘ └─────┘
```

### 路由策略

1. **MCP优先** (`mcp_first`)
   - 优先使用MCP服务
   - 失败时回退到A2A代理

2. **A2A优先** (`a2a_first`)
   - 优先使用A2A代理
   - 失败时回退到MCP服务

3. **能力匹配** (`capability_based`)
   - 基于工具能力进行匹配
   - 使用决策引擎评分

4. **负载均衡** (`load_balanced`)
   - 考虑服务负载情况
   - 动态分配工具调用

5. **混合策略** (`hybrid`)
   - 综合考虑能力和负载
   - 默认推荐策略

## 使用方法

### 基本配置

```typescript
import { ToolRouter } from '../src/core/tool_router';
import { MultiAgentSystem } from '../src/core/multi_agent_system';

// 创建多智能体系统
const multiAgentSystem = new MultiAgentSystem({
  mcp_services: [
    {
      name: 'file-ops',
      command: 'mcp-server-filesystem',
      capabilities: ['file_read', 'file_write']
    }
  ],
  a2a_agents: [
    {
      name: 'code-analyzer',
      endpoint: 'http://localhost:8001',
      capabilities: ['code_analysis']
    }
  ]
});

// 获取工具路由器
const toolRouter = multiAgentSystem.getToolRouter();
```

### 执行工具调用

```typescript
// 基本工具调用
const result = await toolRouter.executeToolCall({
  name: 'read_file',
  arguments: { path: '/path/to/file.txt' },
  context: { task: 'file_processing' }
});

if (result.success) {
  console.log('执行成功:', result.result);
  console.log('执行者:', result.executedBy);
  console.log('执行时间:', result.executionTime);
} else {
  console.error('执行失败:', result.error);
}
```

### 配置路由策略

```typescript
// 更新路由配置
toolRouter.updateConfig({
  strategy: 'hybrid',
  mcpPriority: 0.7,
  a2aPriority: 0.3,
  loadBalanceThreshold: 0.8,
  enableFallback: true,
  maxRetries: 3,
  timeoutMs: 30000
});
```

### 在Manus中使用

```typescript
import { Manus } from '../src/agent/manus';

// 创建Manus实例
const manus = new Manus({
  name: 'SmartAgent',
  multiAgentSystem, // 传入多智能体系统
  enableTaskContinuity: true
});

// 工具调用会自动通过路由器处理
const response = await manus.run('请帮我读取文件内容');
```

## 能力分析

工具路由器会自动分析工具的能力匹配度：

```typescript
// 分析工具能力
const capabilities = await toolRouter.analyzeToolCapabilities('read_file');
console.log('能力分析结果:', capabilities);

// 输出示例:
// {
//   toolName: 'read_file',
//   mcpMatches: [
//     { serviceName: 'file-ops', score: 0.95, capabilities: ['file_read'] }
//   ],
//   a2aMatches: [],
//   recommendedExecutor: 'mcp:file-ops'
// }
```

## 统计监控

```typescript
// 获取路由统计
const stats = toolRouter.getStatistics();
console.log('路由统计:', {
  totalCalls: stats.totalCalls,
  successRate: stats.successfulCalls / stats.totalCalls,
  averageTime: stats.averageExecutionTime,
  mcpUsage: stats.mcpStats,
  a2aUsage: stats.a2aStats
});
```

## 错误处理和回退

工具路由器提供了完善的错误处理和回退机制：

1. **自动重试**: 失败时自动重试指定次数
2. **服务回退**: MCP失败时回退到A2A，反之亦然
3. **超时处理**: 设置合理的超时时间
4. **错误记录**: 详细记录错误信息用于调试

```typescript
// 配置错误处理
toolRouter.updateConfig({
  enableFallback: true,
  maxRetries: 2,
  timeoutMs: 30000,
  retryDelay: 1000
});
```

## 性能优化

### 能力缓存

工具路由器会缓存工具能力分析结果，避免重复计算：

```typescript
// 清除能力缓存（如果需要）
toolRouter.clearCapabilityCache();
```

### 负载均衡

在高并发场景下，路由器会自动进行负载均衡：

```typescript
// 配置负载均衡
toolRouter.updateConfig({
  strategy: 'load_balanced',
  loadBalanceThreshold: 0.7 // 负载超过70%时触发均衡
});
```

## 事件监听

工具路由器支持事件监听，便于监控和调试：

```typescript
// 监听路由事件
toolRouter.on('tool_routed', (event) => {
  console.log('工具路由事件:', {
    toolName: event.toolName,
    selectedExecutor: event.selectedExecutor,
    strategy: event.strategy,
    timestamp: event.timestamp
  });
});

toolRouter.on('execution_completed', (event) => {
  console.log('执行完成事件:', {
    toolName: event.toolName,
    success: event.success,
    executionTime: event.executionTime,
    executor: event.executor
  });
});

toolRouter.on('fallback_triggered', (event) => {
  console.log('回退触发事件:', {
    originalExecutor: event.originalExecutor,
    fallbackExecutor: event.fallbackExecutor,
    reason: event.reason
  });
});
```

## 最佳实践

### 1. 策略选择

- **开发环境**: 使用 `capability_based` 策略，便于调试
- **生产环境**: 使用 `hybrid` 策略，平衡性能和可靠性
- **高并发场景**: 使用 `load_balanced` 策略

### 2. 配置优化

```typescript
// 生产环境推荐配置
const productionConfig = {
  strategy: 'hybrid',
  mcpPriority: 0.6,
  a2aPriority: 0.4,
  loadBalanceThreshold: 0.8,
  enableFallback: true,
  maxRetries: 2,
  timeoutMs: 30000,
  retryDelay: 1000
};

// 开发环境推荐配置
const developmentConfig = {
  strategy: 'capability_based',
  enableFallback: true,
  maxRetries: 1,
  timeoutMs: 60000,
  enableDebugLogging: true
};
```

### 3. 监控和调试

- 定期检查路由统计信息
- 监听关键事件
- 设置合适的日志级别
- 使用能力分析功能验证路由决策

### 4. 错误处理

```typescript
try {
  const result = await toolRouter.executeToolCall(toolCall);
  if (!result.success) {
    // 处理执行失败
    logger.error('工具执行失败:', result.error);
    // 可以尝试手动指定执行器
  }
} catch (error) {
  // 处理系统级错误
  logger.error('系统错误:', error);
}
```

## 故障排除

### 常见问题

1. **工具找不到执行器**
   - 检查MCP服务和A2A代理是否正常运行
   - 验证工具名称是否正确
   - 检查能力配置是否匹配

2. **执行超时**
   - 增加超时时间配置
   - 检查网络连接
   - 验证服务响应性能

3. **负载不均衡**
   - 调整负载均衡阈值
   - 检查服务性能差异
   - 考虑使用不同的路由策略

### 调试技巧

```typescript
// 启用详细日志
toolRouter.updateConfig({
  enableDebugLogging: true
});

// 分析特定工具的路由决策
const analysis = await toolRouter.analyzeToolCapabilities('problematic_tool');
console.log('路由分析:', analysis);

// 检查统计信息
const stats = toolRouter.getStatistics();
console.log('失败率:', stats.failedCalls / stats.totalCalls);
```

## 扩展开发

### 自定义路由策略

可以通过继承ToolRouter类来实现自定义路由策略：

```typescript
class CustomToolRouter extends ToolRouter {
  protected async selectExecutor(
    toolCall: ToolCallRequest,
    mcpCandidates: any[],
    a2aCandidates: any[]
  ): Promise<any> {
    // 实现自定义选择逻辑
    return super.selectExecutor(toolCall, mcpCandidates, a2aCandidates);
  }
}
```

### 自定义能力分析

```typescript
class EnhancedToolRouter extends ToolRouter {
  async analyzeToolCapabilities(toolName: string): Promise<any> {
    const baseAnalysis = await super.analyzeToolCapabilities(toolName);

    // 添加自定义分析逻辑
    const customScore = this.calculateCustomScore(toolName);

    return {
      ...baseAnalysis,
      customScore
    };
  }
}
```

## 总结

工具路由器为Manus系统提供了强大的工具调用路由能力，通过智能路由策略、能力分析、负载均衡等功能，实现了从硬编码工具解析到动态路由的转变。这不仅提高了系统的灵活性和可扩展性，还为未来的功能扩展奠定了坚实的基础。
