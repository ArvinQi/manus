# CoderAgent 智能编码代理

`CoderAgent` 是一个智能编码代理，它利用 [Codex](https://github.com/openai/codex) 工具来实现自动化编码能力，并提供代码评估和记录功能。

## 功能特点

- 集成 Codex 工具执行编码任务
- 自动评估生成代码的质量、正确性和效率
- 记录编码任务和评估结果
- 生成详细的评估报告
- 支持多种审批模式（建议、自动编辑、完全自动）
- 提供成功率、平均评分等统计数据

## 安装要求

使用 CoderAgent 前，需要先安装 Codex 工具：

```bash
npm install -g @openai/codex
```

并确保设置了 OpenAI API 密钥：

```bash
export OPENAI_API_KEY="your-api-key-here"
```

## 使用方法

### 基本用法

```typescript
import { CoderAgent } from 'manus';
import { OpenAILLM } from 'manus';
import { ToolCollection } from 'manus';

// 创建 LLM 实例
const llm = new OpenAILLM({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4-turbo',
});

// 创建工具集合
const tools = new ToolCollection();

// 创建 CoderAgent 实例
const coderAgent = new CoderAgent(llm, tools);

// 执行编码任务
const task = '创建一个简单的 Express 服务器，提供 RESTful API 接口';
const result = await coderAgent.code(task);

// 输出结果
console.log(`任务完成，评分: ${result.evaluation.score}/100`);
console.log(`状态: ${result.evaluation.success ? '成功' : '失败'}`);

// 生成评估报告
const report = coderAgent.generateReport();
console.log(report);
```

### 配置选项

`CoderAgent` 构造函数接受以下配置选项：

```typescript
interface CoderAgentConfig {
  codexPath?: string;       // Codex 可执行文件路径，默认为 'codex'
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto'; // Codex 审批模式，默认为 'suggest'
  workingDir?: string;      // 工作目录，默认为当前工作目录
  recordsDir?: string;      // 记录保存目录，默认为 '.codex-records'
  maxRetries?: number;      // 最大重试次数，默认为 3
  evaluationPrompt?: string; // 评估提示词
}
```

示例：

```typescript
const coderAgent = new CoderAgent(llm, tools, {
  approvalMode: 'full-auto',  // 使用完全自动模式
  workingDir: './my-project', // 指定工作目录
  recordsDir: './records',    // 指定记录目录
});
```

## 审批模式

Codex 支持三种审批模式：

1. **suggest**（默认）：Codex 会提出建议，但需要用户确认才能应用更改
2. **auto-edit**：Codex 可以自动编辑文件，但执行命令仍需用户确认
3. **full-auto**：Codex 可以自动编辑文件并执行命令，无需用户确认

## 评估报告

`CoderAgent` 可以生成详细的评估报告，包含以下信息：

- 总体统计（任务数、成功率、平均评分）
- 常见错误列表
- 最近任务的详细信息（评分、执行时间、反馈）

示例：

```typescript
const report = coderAgent.generateReport();
console.log(report);
```

## API 参考

### `code(task: string): Promise<CodexRecord>`

执行编码任务，返回执行记录。

### `isCodexAvailable(): Promise<boolean>`

检查 Codex 是否可用。

### `getRecords(): CodexRecord[]`

获取所有记录。

### `getRecentRecords(count: number = 5): CodexRecord[]`

获取最近的记录。

### `getSuccessRate(): number`

获取成功率（0-1）。

### `getAverageScore(): number`

获取平均评分（0-100）。

### `getCommonErrors(count: number = 5): string[]`

获取常见错误列表。

### `generateReport(): string`

生成评估报告。

## 记录结构

```typescript
interface CodexRecord {
  timestamp: number;        // 时间戳
  task: string;             // 任务描述
  code: string;             // 生成的代码
  evaluation: {             // 评估结果
    success: boolean;       // 是否成功
    score: number;          // 评分（0-100）
    feedback: string;       // 评估反馈
    executionTime: number;  // 执行时间（毫秒）
    errors?: string[];      // 错误信息
    warnings?: string[];    // 警告信息
  };
  metadata?: Record<string, any>; // 元数据
}
```

## 注意事项

- 确保 Codex 工具已正确安装并可访问
- 设置有效的 OpenAI API 密钥
- 在使用 `full-auto` 模式时要小心，因为它会自动执行命令
- 评估结果依赖于 LLM 的能力，可能需要调整评估提示词以获得更准确的结果

## 示例

完整示例请参考 [examples/coder_agent_example.ts](../examples/coder_agent_example.ts)。