# Manus 任务持久化和继续执行功能

## 概述

重构后的 Manus 代理引入了强大的任务持久化和继续执行功能，使得复杂的长时间运行任务能够在中断后自动恢复，大大提高了系统的可靠性和用户体验。

## 核心功能

### 1. 任务持久化

- **自动保存**: 任务状态每10秒自动保存到 `.manus/tasks/` 目录
- **检查点机制**: 每30秒或重要步骤完成时创建检查点
- **完整状态**: 保存任务的完整执行状态，包括步骤、进度、上下文等
- **执行历史**: 记录所有执行事件，便于调试和分析

### 2. 任务继续执行

- **自动恢复**: 启动时自动查找并恢复最近的未完成任务
- **智能恢复**: 根据任务状态和检查点智能决定恢复位置
- **状态一致性**: 确保恢复后的任务状态与中断前完全一致
- **错误处理**: 处理恢复过程中的异常情况

### 3. 任务管理

- **任务生命周期**: 完整的任务生命周期管理（创建、运行、暂停、恢复、完成）
- **步骤管理**: 细粒度的步骤状态管理和进度跟踪
- **重试机制**: 自动重试失败的步骤，可配置重试次数
- **依赖管理**: 支持步骤间的依赖关系

### 4. 智能对话上下文管理

- **自动上下文记录**: 自动记录用户和助手的对话内容
- **智能上下文检索**: 根据相关性和重要性智能选择对话历史
- **会话管理**: 按主题自动分组对话，支持会话切换和恢复
- **上下文感知**: 在任务执行过程中自动包含相关的历史对话上下文

## 架构设计

### 任务状态枚举

```typescript
enum TaskStatus {
  PENDING = 'pending',     // 待执行
  RUNNING = 'running',     // 运行中
  PAUSED = 'paused',       // 暂停
  COMPLETED = 'completed', // 已完成
  FAILED = 'failed',       // 失败
  CANCELLED = 'cancelled'  // 已取消
}
```

### 步骤状态枚举

```typescript
enum StepStatus {
  PENDING = 'pending',     // 待执行
  RUNNING = 'running',     // 运行中
  COMPLETED = 'completed', // 已完成
  FAILED = 'failed',       // 失败
  SKIPPED = 'skipped'      // 跳过
}
```

### 核心数据结构

#### TaskPersistence 接口

```typescript
interface TaskPersistence {
  id: string;                    // 任务唯一ID
  title: string;                 // 任务标题
  description: string;           // 任务描述
  status: TaskStatus;            // 任务状态
  createdAt: number;             // 创建时间
  updatedAt: number;             // 更新时间
  startTime?: number;            // 开始时间
  endTime?: number;              // 结束时间
  steps: TaskStep[];             // 任务步骤
  currentStepIndex: number;      // 当前步骤索引
  context: Record<string, any>;  // 任务上下文
  metadata: {                    // 元数据
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    progress: number;
    estimatedCompletionTime?: number;
    actualCompletionTime?: number;
    sourceFile?: string;
    userId?: string;
  };
  checkpoints: TaskCheckpoint[]; // 检查点列表
  executionHistory: ExecutionEvent[]; // 执行历史
}
```

#### TaskStep 接口

```typescript
interface TaskStep {
  id: string;                    // 步骤ID
  title: string;                 // 步骤标题
  description: string;           // 步骤描述
  status: StepStatus;            // 步骤状态
  startTime?: number;            // 开始时间
  endTime?: number;              // 结束时间
  result?: any;                  // 执行结果
  error?: string;                // 错误信息
  retryCount: number;            // 重试次数
  maxRetries: number;            // 最大重试次数
  dependencies: string[];        // 依赖步骤ID
  estimatedDuration?: number;    // 预估耗时
  actualDuration?: number;       // 实际耗时
}
```

### TaskManager 类

TaskManager 是任务管理的核心类，负责：

- 任务的创建、加载、保存
- 任务生命周期管理
- 步骤状态管理
- 检查点和自动保存
- 执行历史记录

#### 主要方法

```typescript
class TaskManager {
  // 创建新任务
  createTask(title: string, description: string, steps: Omit<TaskStep, 'id'>[]): TaskPersistence

  // 加载指定任务
  loadTask(taskId: string): TaskPersistence | null

  // 获取最近的任务
  getRecentTask(): TaskPersistence | null

  // 启动任务
  startTask(): boolean

  // 暂停任务
  pauseTask(): boolean

  // 恢复任务
  resumeTask(): boolean

  // 完成任务
  completeTask(): boolean

  // 获取当前步骤
  getCurrentStep(): TaskStep | null

  // 完成当前步骤
  completeCurrentStep(result?: any): boolean

  // 标记步骤失败
  failCurrentStep(error: string): boolean

  // 跳过当前步骤
  skipCurrentStep(reason: string): boolean

  // 设置任务上下文
  setTaskContext(key: string, value: any): void

  // 获取任务上下文
  getTaskContext(key: string): any
}
```

## 使用方法

### 1. 创建任务

```typescript
const manus = await Manus.create({
  name: 'MyAgent',
  continueTask: true, // 启用任务继续功能
});

// 创建新任务
const taskId = manus.createTask(
  '数据处理任务',
  '处理用户数据并生成报告',
  [
    '读取输入数据',
    '数据清洗和验证',
    '执行分析计算',
    '生成报告文件',
    '发送结果通知'
  ]
);
```

### 2. 继续任务

```typescript
// 通过任务ID继续指定任务
const continued = manus.continueTask(taskId);

// 或者自动恢复最近的任务
const manus = await Manus.create({
  continueTask: true, // 自动查找并恢复最近的任务
});
```

### 3. 任务状态监控

```typescript
// 获取当前任务状态
const taskStatus = manus.getTaskStatus();
console.log('任务进度:', taskStatus.task.progress);
console.log('完成步骤:', taskStatus.task.completedSteps);
console.log('总步骤数:', taskStatus.task.totalSteps);

// 获取执行历史
const history = manus.getTaskHistory(10);
history.forEach(event => {
  console.log(`${event.timestamp}: ${event.description}`);
});

// 获取历史任务记录
const historicalTasks = manus.getHistoricalTasks(5);
historicalTasks.forEach(task => {
  console.log(`${task.title} - ${task.status} (${task.progress}%)`);
});
```

### 4. 任务操作

```typescript
// 暂停任务
manus.pauseTask();

// 恢复任务执行
manus.continueTask();

// 清理资源
await manus.cleanup();
```

## 存储结构

任务数据存储在 `.manus/tasks/` 目录中，使用固定文件名避免多个任务计划同时存在：

```
.manus/
├── tasks/
│   ├── current_task.json    # 当前活跃任务
│   ├── task_history.json    # 任务历史记录
│   └── ...
└── memory/  # 其他内存数据
```

- `current_task.json` - 包含当前活跃任务的完整状态信息
- `task_history.json` - 包含已完成或被替换的任务历史记录（最多保留100条）

每个任务文件包含完整的任务状态信息，采用 JSON 格式存储。

## 错误处理和恢复

### 1. 步骤重试机制

- 步骤失败时自动重试，可配置最大重试次数
- 重试间隔可配置，支持指数退避
- 记录重试原因和次数

### 2. 任务恢复机制

- 应用重启后自动检测未完成任务
- 根据检查点信息恢复任务状态
- 处理损坏的任务文件

### 3. 故障转移

- 任务执行失败时的降级策略
- 支持跳过失败步骤继续执行
- 任务终止条件可配置

## 性能优化

### 1. 自动保存优化

- 增量保存，只保存变更的数据
- 批量保存，减少磁盘I/O
- 压缩存储，减少存储空间

### 2. 内存管理

- 任务上下文的懒加载
- 执行历史的滚动清理
- 检查点的智能清理

### 3. 并发控制

- 任务级别的并发控制
- 步骤级别的资源锁定
- 避免重复执行同一任务

## 配置选项

```typescript
const manus = await Manus.create({
  name: 'MyAgent',
  continueTask: true,           // 启用任务继续功能
  maxSteps: 50,                 // 最大步骤数
  taskTimeout: 300000,          // 任务超时时间(毫秒)
  autoSaveInterval: 10000,      // 自动保存间隔(毫秒)
  checkpointInterval: 30000,    // 检查点间隔(毫秒)
  maxRetries: 3,                // 默认最大重试次数
  taskHistoryLimit: 100,        // 任务历史记录限制
});
```

## 最佳实践

### 1. 任务设计

- 将复杂任务分解为较小的步骤
- 设计幂等的步骤，支持重复执行
- 合理设置步骤依赖关系

### 2. 错误处理

- 为每个步骤设置合适的重试次数
- 提供详细的错误信息
- 实现优雅的降级策略

### 3. 监控和调试

- 定期检查任务状态
- 分析执行历史找出性能瓶颈
- 合理使用检查点进行调试

### 4. 资源管理

- 及时清理完成的任务文件
- 监控存储空间使用情况
- 定期备份重要任务数据

## 故障排除

### 常见问题

1. **任务无法恢复**
   - 检查 `.manus/tasks/` 目录是否存在
   - 验证任务文件是否损坏
   - 检查任务状态是否正确

2. **步骤重复执行**
   - 确保步骤实现是幂等的
   - 检查步骤状态更新是否正确
   - 验证检查点机制是否正常

3. **性能问题**
   - 检查自动保存频率设置
   - 优化任务上下文数据大小
   - 清理过期的执行历史

### 调试工具

可以使用内置的调试方法：

```typescript
// 获取详细的任务信息
const taskInfo = manus.getTaskStatus();
console.log('任务详情:', JSON.stringify(taskInfo, null, 2));

// 查看执行历史
const history = manus.getTaskHistory(50);
console.log('执行历史:', history);

// 检查任务文件
const taskDir = path.join(config.getWorkspaceRoot(), '.manus', 'tasks');
const taskFiles = fs.readdirSync(taskDir);
console.log('任务文件:', taskFiles);
```

通过以上重构，Manus 现在具备了强大的任务持久化和继续执行能力，能够处理复杂的长时间运行任务，并在各种中断情况下保持任务状态的一致性和完整性。
