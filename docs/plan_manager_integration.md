# PlanManager与Manus集成指南

## 概述

PlanManager已成功集成到Manus代理中，提供了完整的计划管理功能。这个集成使得Manus代理能够在任务持久化的基础上，增加更灵活的计划管理能力，支持计划创建、执行、进度跟踪和状态管理。

## 核心功能

### 1. 双重管理系统

Manus现在同时支持两套管理系统：

- **TaskManager**: 详细的任务执行管理，包含步骤依赖、重试机制、检查点等
- **PlanManager**: 轻量级的计划管理，专注于高层次的步骤规划和进度跟踪

### 2. 智能同步机制

- 计划与任务可以相互转换和同步
- 支持从任务生成计划，或从计划创建任务
- 自动保持数据一致性

### 3. 上下文感知

- think()方法现在能感知计划状态
- 生成的提示词包含当前计划进度和步骤信息
- 增强了智能体的决策能力

## 架构设计

### 类结构

```typescript
export class Manus extends ToolCallAgent {
  private taskManager: TaskManager;      // 任务管理器
  private planManager: PlanManager;      // 计划管理器（新增）
  private conversationContextManager: ConversationContextManager;

  // ... 其他成员
}
```

### 数据流

```
用户输入 → 计划创建 → 任务同步 → 执行监控 → 进度更新 → 状态保存
    ↓              ↓           ↓           ↓
 消息保护 → 对话上下文 → 智能感知 → 提示生成
```

## API 接口

### 计划管理核心API

```typescript
// 创建计划
async createPlan(
  title: string,
  steps: string[],
  options?: {
    description?: string;
    sourceFile?: string;
    metadata?: Record<string, any>;
  }
): Promise<string>

// 获取当前计划
getCurrentPlan(): Plan | null

// 获取当前计划步骤
getCurrentPlanStep(): PlanStep | null

// 标记步骤完成
async markPlanStepCompleted(notes?: string): Promise<boolean>

// 设置步骤状态
async setPlanStepStatus(
  stepIndex: number,
  status: PlanStepStatus,
  notes?: string
): Promise<boolean>

// 获取进度信息
getPlanProgress(): ProgressInfo

// 格式化计划显示
formatCurrentPlan(): string

// 清除计划
async clearPlan(): Promise<boolean>

// 检查是否有活跃计划
hasActivePlan(): boolean
```

### 同步和集成API

```typescript
// 获取综合状态
getComprehensiveStatus(): {
  task: any;
  plan: {
    isActive: boolean;
    currentPlan: Plan | null;
    progress: any;
  };
  conversation: any;
}

// 同步计划与任务
async syncPlanWithTask(): Promise<boolean>
```

## 使用示例

### 基础使用

```typescript
import { Manus } from '../src/agent/manus.js';

// 创建智能体实例
const manus = await Manus.create({
  name: 'PlanAgent',
  description: '支持计划管理的智能代理',
  maxSteps: 100,
});

// 创建计划
const planId = await manus.createPlan(
  '项目开发计划',
  [
    '需求分析和规划',
    '技术架构设计',
    '核心功能开发',
    '测试和调试',
    '部署和上线'
  ],
  {
    description: '完整的软件开发流程',
    metadata: { priority: 'high', estimatedDays: 30 }
  }
);

// 执行计划步骤
await manus.setPlanStepStatus(0, 'in_progress', '开始需求分析');
await manus.markPlanStepCompleted('需求分析完成');

// 查看进度
const progress = manus.getPlanProgress();
console.log(`进度: ${progress.completedSteps}/${progress.totalSteps}`);
```

### 计划与任务同步

```typescript
// 从任务创建计划
const taskId = manus.createTask('优化任务', '性能优化', ['分析', '优化', '测试']);
await manus.syncPlanWithTask(); // 从任务生成计划

// 从计划创建任务
await manus.createPlan('新计划', ['步骤1', '步骤2', '步骤3']);
await manus.syncPlanWithTask(); // 从计划生成任务
```

### 持久化和恢复

```typescript
// 创建计划并执行
const manus1 = await Manus.create({ name: 'Session1' });
await manus1.createPlan('长期项目', ['阶段1', '阶段2', '阶段3']);
await manus1.markPlanStepCompleted('阶段1完成');
await manus1.cleanup(); // 自动保存

// 在新会话中恢复
const manus2 = await Manus.create({ name: 'Session2' });
const restoredPlan = manus2.getCurrentPlan(); // 自动加载保存的计划
if (restoredPlan) {
  console.log('计划已恢复:', restoredPlan.title);
}
```

## 数据结构

### Plan接口

```typescript
interface Plan {
  id: string;
  title: string;
  description?: string;
  steps: PlanStep[];
  currentStepIndex: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  sourceFile?: string;
  metadata?: Record<string, any>;
}
```

### PlanStep接口

```typescript
interface PlanStep {
  id: string;
  description: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
  notes?: string;
  startTime?: number;
  endTime?: number;
}
```

### ProgressInfo接口

```typescript
interface ProgressInfo {
  isActive: boolean;
  totalSteps: number;
  completedSteps: number;
  currentStepIndex: number;
  currentStep: PlanStep | null;
  progress: number;
  remainingSteps: number;
}
```

## 配置选项

### PlanManager配置

```typescript
interface PlanManagerConfig {
  workspaceRoot: string;           // 工作空间根目录
  planFileName?: string;           // 计划文件名（默认: 'current_plan.json'）
  autoSave?: boolean;              // 自动保存（默认: true）
  maxAge?: number;                 // 计划过期时间（默认: 24小时）
}
```

### 默认配置

```typescript
// 在Manus构造函数中的默认配置
this.planManager = new PlanManager({
  workspaceRoot: config.getWorkspaceRoot(),
  planFileName: 'current_plan.json',
  autoSave: true,
  maxAge: 24 * 60 * 60 * 1000, // 24小时
});
```

## 智能感知增强

### think()方法的计划感知

当执行think()方法时，生成的提示词现在包含：

```
当前任务: [任务信息]
任务状态: [状态信息]
...

当前计划: [计划标题]
计划描述: [计划描述]
计划进度: [已完成]/[总步骤] ([百分比]%)
当前计划步骤: [当前步骤描述]
步骤状态: [步骤状态]
接下来的计划步骤:
2. [下一步骤]
3. [再下一步骤]

相关对话上下文:
...
```

### 消息保护集成

计划创建时自动保护相关消息：

```typescript
// 在createPlan中自动执行
await this.markMessageAsProtected(
  `创建计划: ${title}，包含 ${steps.length} 个步骤`,
  '计划创建消息'
);
```

## 文件存储

### 存储位置

- **当前计划**: `.manus/current_plan.json`
- **兼容格式**: `.manus/plans.json`（保持与旧版本兼容）

### 文件格式

```json
{
  "id": "plan_1703123456789",
  "title": "项目开发计划",
  "description": "完整的软件开发流程",
  "steps": [
    {
      "id": "step_1",
      "description": "需求分析和规划",
      "status": "completed",
      "startTime": 1703123456789,
      "endTime": 1703123556789,
      "notes": "需求分析完成，确定核心功能"
    }
  ],
  "currentStepIndex": 1,
  "isActive": true,
  "createdAt": 1703123456789,
  "updatedAt": 1703123556789,
  "metadata": {
    "priority": "high",
    "estimatedDays": 30
  }
}
```

## 最佳实践

### 1. 计划设计

```typescript
// ✅ 好的做法：清晰的步骤描述
await manus.createPlan(
  '数据分析项目',
  [
    '数据收集和清理',
    '探索性数据分析',
    '特征工程和选择',
    '模型训练和验证',
    '结果可视化和报告'
  ],
  {
    description: '完整的数据科学项目流程',
    metadata: {
      dataSize: 'large',
      complexity: 'medium',
      deadline: '2024-12-31'
    }
  }
);

// ❌ 避免：过于模糊的步骤
await manus.createPlan('项目', ['做事', '完成'], {});
```

### 2. 步骤状态管理

```typescript
// ✅ 合理的状态转换
await manus.setPlanStepStatus(0, 'in_progress', '开始数据收集');
await manus.markPlanStepCompleted('数据收集完成，获得10万条记录');

// ✅ 处理阻塞状态
await manus.setPlanStepStatus(2, 'blocked', '等待数据源权限申请');
// 解除阻塞后
await manus.setPlanStepStatus(2, 'in_progress', '权限获得，继续特征工程');
```

### 3. 同步策略

```typescript
// ✅ 根据需要选择同步方向
const hasTask = manus.getTaskStatus().currentTask !== null;
const hasPlan = manus.hasActivePlan();

if (hasTask && !hasPlan) {
  // 从任务创建计划
  await manus.syncPlanWithTask();
} else if (hasPlan && !hasTask) {
  // 从计划创建任务
  await manus.syncPlanWithTask();
}
```

### 4. 进度监控

```typescript
// ✅ 定期检查进度
const progress = manus.getPlanProgress();

if (progress.progress > 50) {
  console.log('项目已完成一半，进入后期阶段');
}

if (progress.currentStep?.status === 'blocked') {
  console.log('当前步骤被阻塞，需要处理:', progress.currentStep.notes);
}
```

## 集成优势

### 1. 灵活性

- 可以独立使用计划管理或任务管理
- 支持两者之间的灵活转换
- 适应不同规模和复杂度的项目

### 2. 持久性

- 自动保存计划状态
- 支持会话间的计划恢复
- 与现有任务持久化系统协同工作

### 3. 智能感知

- AI代理能感知计划进度
- 生成包含计划上下文的智能提示
- 增强决策制定能力

### 4. 用户体验

- 统一的API接口
- 丰富的状态查询功能
- 详细的进度跟踪和显示

## 故障排除

### 常见问题

1. **计划未能保存**
   ```typescript
   // 检查工作空间权限
   const plan = manus.getCurrentPlan();
   if (plan) {
     await manus.planManager.savePlan();
   }
   ```

2. **计划恢复失败**
   ```typescript
   // 检查文件是否存在
   const plan = await manus.planManager.loadPlan();
   if (!plan) {
     console.log('未找到保存的计划文件');
   }
   ```

3. **同步失败**
   ```typescript
   // 检查状态
   const comprehensive = manus.getComprehensiveStatus();
   console.log('任务状态:', comprehensive.task);
   console.log('计划状态:', comprehensive.plan);
   ```

## 性能考虑

### 内存使用

- 计划数据通常比任务数据更轻量
- 自动清理过期计划
- 建议定期保存重要计划状态

### 存储优化

- 使用自动保存减少数据丢失风险
- 兼容格式确保向后兼容性
- 定期清理历史文件

## 总结

PlanManager与Manus的集成成功地将高层次的计划管理与详细的任务执行相结合，提供了：

- **完整的项目生命周期管理**
- **灵活的执行策略选择**
- **智能的上下文感知能力**
- **可靠的数据持久化机制**

这个集成使得Manus代理能够更好地理解和执行复杂的多步骤项目，同时保持了系统的简洁性和可扩展性。
