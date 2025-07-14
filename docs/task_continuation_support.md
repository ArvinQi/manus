# Manus 任务继续执行支持

## 概述

Manus代理系统提供了完整的任务持久化和继续执行支持，允许任务在中断后无缝恢复执行。这个功能对于长时间运行的复杂任务特别有用。

## 修复的问题

### 1. 方法名不匹配问题

**问题**：`main.ts`中调用的方法名与Manus类中实际实现的方法名不匹配

**修复前**：
- `main.ts`调用 `continueTaskExecution()` → Manus类只有 `continueTask()`
- `main.ts`调用 `getTaskProgress()` → Manus类只有 `getTaskStatus()`

**修复后**：
- 添加了 `continueTaskExecution()` 方法作为 `continueTask()` 的别名
- 添加了 `getTaskProgress()` 方法，返回适合进度显示的格式

### 2. 方法实现完善

**增强的功能**：
- `pauseTask()` 方法增加了更好的错误处理和日志记录
- `getTaskProgress()` 方法提供了更详细的进度信息，包括直接的进度字段

## 核心功能特性

### 1. 任务持久化

```typescript
// 任务自动保存到 .manus/tasks/current_task.json
const taskManager = new TaskManager(workspaceRoot);
const task = taskManager.createTask(title, description, steps);
```

### 2. 任务状态管理

支持的任务状态：
- `PENDING` - 待执行
- `RUNNING` - 执行中
- `PAUSED` - 已暂停
- `COMPLETED` - 已完成
- `FAILED` - 执行失败
- `CANCELLED` - 已取消

### 3. 任务继续执行

```typescript
// 方法1: 使用原始方法
const success = manus.continueTask(taskId);

// 方法2: 使用别名方法（用于main.ts）
const success = manus.continueTaskExecution();
```

### 4. 任务进度查询

```typescript
// 获取详细任务状态
const status = manus.getTaskStatus();

// 获取任务进度（格式化用于显示）
const progress = manus.getTaskProgress();
console.log(`进度: ${progress.completedSteps}/${progress.totalSteps} (${progress.progress.toFixed(1)}%)`);
```

### 5. 任务暂停和恢复

```typescript
// 暂停任务
const pauseSuccess = manus.pauseTask();

// 恢复任务（通过continueTask）
const resumeSuccess = manus.continueTask();
```

## API 参考

### continueTaskExecution(): boolean
别名方法，调用 `continueTask()` 实现任务继续执行。

**返回值**：
- `true` - 成功找到并继续执行任务
- `false` - 没有找到可继续的任务或任务已完成

### getTaskProgress(): TaskProgressInfo
获取任务进度信息，返回格式化的进度数据。

**返回值结构**：
```typescript
{
  hasTask: boolean;
  totalSteps: number;
  completedSteps: number;
  progress: number;
  message?: string;
  task?: {
    id: string;
    title: string;
    description: string;
    status: string;
    // ... 其他任务信息
  };
  executionStats?: any;
}
```

### pauseTask(): boolean
暂停当前执行的任务。

**特性**：
- 创建检查点保存当前状态
- 记录暂停事件到执行历史
- 停止自动保存定时器

### getTaskStatus(): TaskStatusInfo
获取完整的任务状态信息，包括执行统计。

### getTaskHistory(limit?: number): ExecutionEvent[]
获取任务执行历史记录。

### getHistoricalTasks(limit?: number): TaskSummary[]
获取历史任务摘要列表。

## 文件持久化

### 存储位置
- 当前任务：`.manus/tasks/current_task.json`
- 任务历史：`.manus/tasks/task_history.json`
- 任务检查点：内存管理器中

### 自动保存
- 任务状态变更时自动保存
- 定期检查点创建（可配置间隔）
- 支持自动清理过期历史记录

## 使用示例

### 命令行使用

```bash
# 继续执行之前的任务
npm run start -- --continue

# 或者
node dist/main.js --continue
```

### 编程方式使用

```typescript
import { Manus } from './src/agent/manus.js';

// 创建实例并继续任务
const manus = await Manus.create({
  continueTask: true,
  maxSteps: 30
});

// 检查是否可以继续执行
const canContinue = manus.continueTaskExecution();
if (canContinue) {
  const progress = manus.getTaskProgress();
  console.log(`继续执行任务，当前进度: ${progress.progress.toFixed(1)}%`);
}
```

## 错误处理

### 常见情况
1. **没有可继续的任务**
   - 返回 `false`
   - 记录警告日志

2. **任务已完成**
   - 返回 `false`
   - 记录信息日志

3. **任务文件损坏**
   - 捕获解析错误
   - 记录错误日志
   - 返回 `null`

### 恢复策略
- 任务状态验证
- 自动检查点恢复
- 步骤级重试机制
- 失败步骤跳过选项

## 最佳实践

### 1. 任务设计
- 将复杂任务分解为小步骤
- 每个步骤应该是幂等的
- 设置合理的重试次数

### 2. 状态管理
- 定期检查任务状态
- 及时处理失败步骤
- 合理使用暂停功能

### 3. 资源管理
- 及时清理过期任务
- 监控存储空间使用
- 定期备份重要任务

## 演示示例

运行完整的任务继续执行演示：

```bash
npm run build
npx tsx examples/task_continuation_example.ts
```

演示内容包括：
- 任务创建和状态查看
- 任务执行和暂停
- 任务继续执行（模拟重启场景）
- 任务历史和综合状态查看

## 故障排除

### 常见问题

1. **任务无法继续执行**
   - 检查 `.manus/tasks/current_task.json` 是否存在
   - 验证任务状态是否为 `PAUSED` 或 `PENDING`
   - 确认任务未过期（默认24小时）

2. **进度显示不正确**
   - 检查步骤完成状态
   - 验证元数据中的计数器
   - 重新计算进度百分比

3. **任务历史丢失**
   - 检查 `.manus/tasks/task_history.json`
   - 验证写入权限
   - 检查磁盘空间

### 调试技巧

```typescript
// 启用详细日志
const manus = await Manus.create({
  continueTask: true,
  llmConfigName: 'debug' // 使用调试配置
});

// 检查任务状态
const status = manus.getTaskStatus();
console.log('Task Status:', JSON.stringify(status, null, 2));

// 检查执行历史
const history = manus.getTaskHistory(10);
console.log('Execution History:', history);
```

## 总结

Manus的任务继续执行功能现在已经完全实现并经过测试验证。主要特性包括：

✅ **完整的任务持久化** - 自动保存任务状态和进度
✅ **灵活的任务控制** - 支持暂停、恢复、继续执行
✅ **详细的状态跟踪** - 提供多级别的状态和进度信息
✅ **错误恢复机制** - 支持步骤重试和失败处理
✅ **历史记录管理** - 完整的执行历史和任务归档
✅ **API兼容性** - 修复了方法名不匹配问题

这个功能使得Manus代理能够处理长时间运行的复杂任务，即使在系统重启或中断的情况下也能无缝恢复执行。
