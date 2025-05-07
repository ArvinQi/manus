/**
 * Coder Agent
 * 实现智能编码能力，使用 Codex 完成编码工作
 */

import { ReActAgent } from './react.js';
import { AgentState, Memory, Message } from '../schema/index.js';
import { LLM } from '../llm/index.js';
import { Logger } from '../utils/logger.js';
import { ToolCollection } from '../tool/tool_collection.js';
import { BashTool } from '../tool/bash.js';
import { FileOperatorsTool } from '../tool/file_operators.js';
import { BaseTool } from '../tool/base.js';

/**
 * Codex 执行结果评估
 */
interface CodexEvaluation {
  success: boolean;
  score: number; // 0-100 分数评估
  feedback: string; // 评估反馈
  executionTime: number; // 执行时间（毫秒）
  errors?: string[]; // 错误信息
  warnings?: string[]; // 警告信息
}

/**
 * Codex 执行记录
 */
interface CodexRecord {
  timestamp: number;
  task: string;
  code: string;
  evaluation: CodexEvaluation;
  metadata?: Record<string, any>;
}

/**
 * Coder Agent 配置
 */
interface CoderAgentConfig {
  codexPath?: string; // Codex 可执行文件路径
  approvalMode?: 'suggest' | 'auto-edit' | 'full-auto'; // Codex 审批模式
  workingDir?: string; // 工作目录
  recordsDir?: string; // 记录保存目录
  maxRetries?: number; // 最大重试次数
  evaluationPrompt?: string; // 评估提示词
}

/**
 * Coder Agent
 * 实现智能编码能力，使用 Codex 完成编码工作
 */
export class CoderAgent extends ReActAgent {
  private logger = new Logger('CoderAgent');
  private config: CoderAgentConfig;
  private records: CodexRecord[] = [];
  private bashTool: BashTool;
  private fileOps: FileOperatorsTool;

  /**
   * 构造函数
   * @param llm LLM 实例
   * @param tools 工具集合
   * @param config 配置
   */
  constructor(llm: LLM, tools: ToolCollection, config: CoderAgentConfig = {}) {
    super(llm, tools);

    // 默认配置
    this.config = {
      codexPath: 'codex', // 默认使用全局安装的 codex
      approvalMode: 'suggest', // 默认使用建议模式
      workingDir: process.cwd(), // 默认使用当前工作目录
      recordsDir: '.codex-records', // 默认记录目录
      maxRetries: 3, // 默认最大重试次数
      evaluationPrompt: '评估以下代码的质量、正确性和效率。给出 0-100 的评分和详细反馈。', // 默认评估提示词
      ...config,
    };

    // 获取必要的工具
    this.bashTool = this.findTool(BashTool) as BashTool;
    this.fileOps = this.findTool(FileOperatorsTool) as FileOperatorsTool;

    // 确保记录目录存在
    this.ensureRecordsDir();
  }

  /**
   * 查找特定类型的工具
   * @param toolType 工具类型
   * @returns 工具实例或 undefined
   */
  private findTool<T extends BaseTool>(toolType: new (...args: any[]) => T): T | undefined {
    for (const tool of this.tools.tools) {
      if (tool instanceof toolType) {
        return tool as T;
      }
    }
    return undefined;
  }

  /**
   * 确保记录目录存在
   */
  private async ensureRecordsDir(): Promise<void> {
    const recordsPath = `${this.config.workingDir}/${this.config.recordsDir}`;
    try {
      const exists = await this.fileOps.run({ operation: 'exists', path: recordsPath });
      if (!exists.output) {
        await this.fileOps.run({ operation: 'mkdir', path: recordsPath, recursive: true });
        this.logger.info(`创建记录目录: ${recordsPath}`);
      }
    } catch (error) {
      this.logger.error(`创建记录目录失败: ${error}`);
    }
  }

  /**
   * 检查 Codex 是否可用
   * @returns 是否可用
   */
  async isCodexAvailable(): Promise<boolean> {
    try {
      const result = await this.bashTool.run({
        command: `${this.config.codexPath} --version`,
        cwd: this.config.workingDir,
      });

      return !result.error;
    } catch (error) {
      this.logger.error(`检查 Codex 可用性失败: ${error}`);
      return false;
    }
  }

  /**
   * 执行编码任务
   * @param task 任务描述
   * @returns 执行结果
   */
  async code(task: string): Promise<CodexRecord> {
    this.logger.info(`开始执行编码任务: ${task}`);

    // 检查 Codex 是否可用
    const isAvailable = await this.isCodexAvailable();
    if (!isAvailable) {
      throw new Error('Codex 不可用，请确保已正确安装并配置');
    }

    // 执行 Codex 命令
    const startTime = Date.now();
    const result = await this.bashTool.run({
      command: `${this.config.codexPath} --approval-mode ${this.config.approvalMode} "${task}"`,
      cwd: this.config.workingDir,
    });
    const executionTime = Date.now() - startTime;

    // 提取生成的代码
    const code = this.extractCodeFromOutput(result.output as string);

    // 评估代码
    const evaluation = await this.evaluateCode(code, task);

    // 创建记录
    const record: CodexRecord = {
      timestamp: Date.now(),
      task,
      code,
      evaluation: {
        ...evaluation,
        executionTime,
      },
    };

    // 保存记录
    await this.saveRecord(record);
    this.records.push(record);

    return record;
  }

  /**
   * 从输出中提取代码
   * @param output Codex 输出
   * @returns 提取的代码
   */
  private extractCodeFromOutput(output: string): string {
    // 这里的实现可能需要根据 Codex 的实际输出格式进行调整
    // 简单实现：查找代码块
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks = output.match(codeBlockRegex) || [];

    return codeBlocks
      .map((block) => block.replace(/```(?:\w+)?\n?/g, '').replace(/```$/g, ''))
      .join('\n\n');
  }

  /**
   * 评估代码
   * @param code 代码
   * @param task 任务
   * @returns 评估结果
   */
  private async evaluateCode(code: string, task: string): Promise<CodexEvaluation> {
    this.logger.info('开始评估代码');

    try {
      // 使用 LLM 评估代码
      const prompt = `${this.config.evaluationPrompt}\n\n任务: ${task}\n\n代码:\n${code}`;

      const messages: Message[] = [
        {
          role: 'system',
          content: '你是一个专业的代码评估专家，擅长评估代码质量、正确性和效率。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];

      const response = await this.llm.chat(messages);

      // 解析评估结果
      return this.parseEvaluation(response.content);
    } catch (error) {
      this.logger.error(`评估代码失败: ${error}`);
      return {
        success: false,
        score: 0,
        feedback: `评估失败: ${error}`,
        executionTime: 0,
        errors: [`${error}`],
      };
    }
  }

  /**
   * 解析评估结果
   * @param content LLM 响应内容
   * @returns 评估结果
   */
  private parseEvaluation(content: string): CodexEvaluation {
    try {
      // 尝试提取分数
      const scoreMatch = content.match(/(?:分数|评分|得分|score)\s*[：:：]\s*(\d+)/i);
      const score = scoreMatch ? parseInt(scoreMatch[1], 10) : 50;

      // 提取错误和警告
      const errorsMatch = content.match(/(?:错误|errors)[：:：]\s*([\s\S]*?)(?=\n\n|$)/i);
      const warningsMatch = content.match(/(?:警告|warnings)[：:：]\s*([\s\S]*?)(?=\n\n|$)/i);

      const errors = errorsMatch
        ? errorsMatch[1]
            .split('\n')
            .map((e) => e.trim())
            .filter(Boolean)
        : undefined;

      const warnings = warningsMatch
        ? warningsMatch[1]
            .split('\n')
            .map((w) => w.trim())
            .filter(Boolean)
        : undefined;

      return {
        success: score >= 60, // 60分以上视为成功
        score,
        feedback: content,
        executionTime: 0, // 这个值会在外部设置
        errors,
        warnings,
      };
    } catch (error) {
      this.logger.error(`解析评估结果失败: ${error}`);
      return {
        success: false,
        score: 0,
        feedback: content,
        executionTime: 0,
        errors: [`解析评估结果失败: ${error}`],
      };
    }
  }

  /**
   * 保存记录
   * @param record 记录
   */
  private async saveRecord(record: CodexRecord): Promise<void> {
    try {
      const recordsPath = `${this.config.workingDir}/${this.config.recordsDir}`;
      const filename = `${recordsPath}/record-${record.timestamp}.json`;

      await this.fileOps.run({
        operation: 'write',
        path: filename,
        content: JSON.stringify(record, null, 2),
        encoding: 'utf8',
      });

      this.logger.info(`记录已保存: ${filename}`);
    } catch (error) {
      this.logger.error(`保存记录失败: ${error}`);
    }
  }

  /**
   * 获取所有记录
   * @returns 记录列表
   */
  getRecords(): CodexRecord[] {
    return [...this.records];
  }

  /**
   * 获取最近的记录
   * @param count 数量
   * @returns 记录列表
   */
  getRecentRecords(count: number = 5): CodexRecord[] {
    return this.records.sort((a, b) => b.timestamp - a.timestamp).slice(0, count);
  }

  /**
   * 获取成功率
   * @returns 成功率（0-1）
   */
  getSuccessRate(): number {
    if (this.records.length === 0) return 0;

    const successCount = this.records.filter((r) => r.evaluation.success).length;
    return successCount / this.records.length;
  }

  /**
   * 获取平均评分
   * @returns 平均评分（0-100）
   */
  getAverageScore(): number {
    if (this.records.length === 0) return 0;

    const totalScore = this.records.reduce((sum, r) => sum + r.evaluation.score, 0);
    return totalScore / this.records.length;
  }

  /**
   * 获取常见错误
   * @param count 数量
   * @returns 错误列表
   */
  getCommonErrors(count: number = 5): string[] {
    const errorMap = new Map<string, number>();

    // 统计错误出现次数
    this.records.forEach((record) => {
      if (record.evaluation.errors) {
        record.evaluation.errors.forEach((error) => {
          const count = errorMap.get(error) || 0;
          errorMap.set(error, count + 1);
        });
      }
    });

    // 按出现次数排序
    return Array.from(errorMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([error]) => error);
  }

  /**
   * 生成评估报告
   * @returns 报告内容
   */
  generateReport(): string {
    const totalTasks = this.records.length;
    if (totalTasks === 0) {
      return '暂无编码任务记录';
    }

    const successRate = this.getSuccessRate() * 100;
    const averageScore = this.getAverageScore();
    const commonErrors = this.getCommonErrors();

    let report = `# Codex 编码评估报告\n\n`;
    report += `## 总体统计\n\n`;
    report += `- 总任务数: ${totalTasks}\n`;
    report += `- 成功率: ${successRate.toFixed(2)}%\n`;
    report += `- 平均评分: ${averageScore.toFixed(2)}/100\n\n`;

    if (commonErrors.length > 0) {
      report += `## 常见错误\n\n`;
      commonErrors.forEach((error, index) => {
        report += `${index + 1}. ${error}\n`;
      });
      report += '\n';
    }

    report += `## 最近任务\n\n`;
    const recentRecords = this.getRecentRecords();
    recentRecords.forEach((record, index) => {
      const date = new Date(record.timestamp).toLocaleString();
      report += `### 任务 ${index + 1} (${date})\n\n`;
      report += `- 任务描述: ${record.task}\n`;
      report += `- 评分: ${record.evaluation.score}/100\n`;
      report += `- 执行时间: ${record.evaluation.executionTime}ms\n`;
      report += `- 状态: ${record.evaluation.success ? '成功' : '失败'}\n\n`;
      report += `#### 反馈\n\n${record.evaluation.feedback}\n\n`;
    });

    return report;
  }
}
