/**
 * PlanningTool 类
 * 提供计划创建、管理和跟踪功能
 * 参考 Python 版本实现
 */
import { BaseTool, ToolResult } from './base.js';
import { FileOperatorsTool } from './file_operators.js';
import { Logger } from '../utils/logger.js';

// 计划步骤状态枚举
type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';

// 计划步骤接口
interface PlanStep {
  description: string;
  status: StepStatus;
  notes?: string;
}

// 计划接口
interface Plan {
  plan_id: string;
  title: string;
  steps: string[];
  step_statuses: StepStatus[];
  step_notes: string[];
}

// 命令类型
type PlanningCommand = 'create' | 'update' | 'list' | 'get' | 'set_active' | 'mark_step' | 'delete';

// 工具描述
const PLANNING_TOOL_DESCRIPTION = `
A planning tool that allows the agent to create and manage plans for solving complex tasks.
The tool provides functionality for creating plans, updating plan steps, and tracking progress.
`;

/**
 * PlanningTool 类
 * 允许代理创建和管理计划，用于解决复杂任务
 */
export class PlanningTool extends BaseTool {
  name = 'planning';
  description = PLANNING_TOOL_DESCRIPTION;
  parameters = {
    type: 'object',
    properties: {
      command: {
        description:
          'The command to execute. Available commands: create, update, list, get, set_active, mark_step, delete.',
        enum: ['create', 'update', 'list', 'get', 'set_active', 'mark_step', 'delete'],
        type: 'string',
      },
      plan_id: {
        description:
          'Unique identifier for the plan. Required for create, update, set_active, and delete commands. Optional for get and mark_step (uses active plan if not specified).',
        type: 'string',
      },
      title: {
        description:
          'Title for the plan. Required for create command, optional for update command.',
        type: 'string',
      },
      steps: {
        description:
          'List of plan steps. Required for create command, optional for update command.',
        type: 'array',
        items: { type: 'string' },
      },
      step_index: {
        description: 'Index of the step to update (0-based). Required for mark_step command.',
        type: 'integer',
      },
      step_status: {
        description: 'Status to set for a step. Used with mark_step command.',
        enum: ['not_started', 'in_progress', 'completed', 'blocked'],
        type: 'string',
      },
      step_notes: {
        description: 'Additional notes for a step. Optional for mark_step command.',
        type: 'string',
      },
    },
    required: ['command'],
    additionalProperties: false,
  };

  private plans: Record<string, Plan> = {}; // 存储计划的字典
  private _current_plan_id: string | null = null; // 当前活动计划ID
  private fileOperator: FileOperatorsTool;
  private logger: Logger;

  constructor() {
    super({
      name: 'planning',
      description: PLANNING_TOOL_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          command: {
            description:
              'The command to execute. Available commands: create, update, list, get, set_active, mark_step, delete.',
          },
        },
      },
    });
    this.fileOperator = new FileOperatorsTool();
    this.logger = new Logger('PlanningTool');

    // 初始化时自动加载计划文件，支持从中断任务中恢复
    this.loadPlansFromFile().catch((error) => {
      this.logger.error(`初始化时加载计划失败: ${error}`);
    });
  }

  /**
   * 执行计划工具
   * @param params 工具参数
   */
  async run(params: any): Promise<ToolResult> {
    const { command, plan_id, title, steps, step_index, step_status, step_notes } = params;

    try {
      switch (command) {
        case 'create':
          return await this._createPlan(plan_id, title, steps);
        case 'update':
          return await this._updatePlan(plan_id, title, steps);
        case 'list':
          return await this._listPlans();
        case 'get':
          return await this._getPlan(plan_id);
        case 'set_active':
          return await this._setActivePlan(plan_id);
        case 'mark_step':
          return await this._markStep(plan_id, step_index, step_status, step_notes);
        case 'delete':
          return await this._deletePlan(plan_id);
        default:
          return new ToolResult({
            error: `Unrecognized command: ${command}. Allowed commands are: create, update, list, get, set_active, mark_step, delete`,
          });
      }
    } catch (error) {
      return new ToolResult({
        error: `Error executing planning tool: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * 创建新计划
   * @param plan_id 计划ID
   * @param title 计划标题
   * @param steps 计划步骤数组
   */
  private async _createPlan(
    plan_id: string | undefined,
    title: string | undefined,
    steps: string[] | undefined
  ): Promise<ToolResult> {
    if (!plan_id) {
      return new ToolResult({ error: 'Parameter `plan_id` is required for command: create' });
    }

    if (plan_id in this.plans) {
      return new ToolResult({
        error: `A plan with ID '${plan_id}' already exists. Use 'update' to modify existing plans.`,
      });
    }

    if (!title) {
      return new ToolResult({ error: 'Parameter `title` is required for command: create' });
    }

    if (!steps || !Array.isArray(steps) || !steps.every((step) => typeof step === 'string')) {
      return new ToolResult({
        error: 'Parameter `steps` must be a non-empty list of strings for command: create',
      });
    }

    // 创建新计划并初始化步骤状态
    const plan: Plan = {
      plan_id,
      title,
      steps,
      step_statuses: Array(steps.length).fill('not_started'),
      step_notes: Array(steps.length).fill(''),
    };

    this.plans[plan_id] = plan;
    this._current_plan_id = plan_id; // 设置为活动计划

    // 保存计划到文件
    await this._savePlansToMarkdown();

    return new ToolResult({
      output: `Plan created successfully with ID: ${plan_id}\n\n${this._formatPlan(plan)}`,
    });
  }

  /**
   * 更新现有计划
   * @param plan_id 计划ID
   * @param title 新标题（可选）
   * @param steps 新步骤数组（可选）
   */
  private async _updatePlan(
    plan_id: string | undefined,
    title: string | undefined,
    steps: string[] | undefined
  ): Promise<ToolResult> {
    if (!plan_id) {
      return new ToolResult({ error: 'Parameter `plan_id` is required for command: update' });
    }

    if (!(plan_id in this.plans)) {
      return new ToolResult({ error: `No plan found with ID: ${plan_id}` });
    }

    const plan = this.plans[plan_id];

    if (title) {
      plan.title = title;
    }

    if (steps) {
      if (!Array.isArray(steps) || !steps.every((step) => typeof step === 'string')) {
        return new ToolResult({
          error: 'Parameter `steps` must be a list of strings for command: update',
        });
      }

      // 保留未更改步骤的现有状态和注释
      const oldSteps = plan.steps;
      const oldStatuses = plan.step_statuses;
      const oldNotes = plan.step_notes;

      // 创建新的步骤状态和注释
      const newStatuses: StepStatus[] = [];
      const newNotes: string[] = [];

      for (let i = 0; i < steps.length; i++) {
        // 如果步骤在旧步骤中相同位置存在，保留状态和注释
        if (i < oldSteps.length && steps[i] === oldSteps[i]) {
          newStatuses.push(oldStatuses[i]);
          newNotes.push(oldNotes[i]);
        } else {
          newStatuses.push('not_started');
          newNotes.push('');
        }
      }

      plan.steps = steps;
      plan.step_statuses = newStatuses;
      plan.step_notes = newNotes;
    }

    // 保存更新后的计划到文件
    await this._savePlansToMarkdown();

    return new ToolResult({
      output: `Plan updated successfully: ${plan_id}\n\n${this._formatPlan(plan)}`,
    });
  }

  /**
   * 列出所有可用计划
   */
  private async _listPlans(): Promise<ToolResult> {
    if (Object.keys(this.plans).length === 0) {
      return new ToolResult({
        output: "No plans available. Create a plan with the 'create' command.",
      });
    }

    let output = 'Available plans:\n';
    for (const [plan_id, plan] of Object.entries(this.plans)) {
      const currentMarker = plan_id === this._current_plan_id ? ' (active)' : '';
      const completed = plan.step_statuses.filter((status) => status === 'completed').length;
      const total = plan.steps.length;
      const progress = `${completed}/${total} steps completed`;
      output += `• ${plan_id}${currentMarker}: ${plan.title} - ${progress}\n`;
    }

    return new ToolResult({ output });
  }

  /**
   * 获取特定计划的详细信息
   * @param plan_id 计划ID（可选，如果未提供则使用当前活动计划）
   */
  private async _getPlan(plan_id: string | undefined): Promise<ToolResult> {
    if (!plan_id) {
      // 如果未提供计划ID，使用当前活动计划
      if (!this._current_plan_id) {
        return new ToolResult({
          error: 'No active plan. Please specify a plan_id or set an active plan.',
        });
      }
      plan_id = this._current_plan_id;
    }

    if (!(plan_id in this.plans)) {
      return new ToolResult({ error: `No plan found with ID: ${plan_id}` });
    }

    const plan = this.plans[plan_id];
    return new ToolResult({ output: this._formatPlan(plan) });
  }

  /**
   * 设置活动计划
   * @param plan_id 计划ID
   */
  private async _setActivePlan(plan_id: string | undefined): Promise<ToolResult> {
    if (!plan_id) {
      return new ToolResult({ error: 'Parameter `plan_id` is required for command: set_active' });
    }

    if (!(plan_id in this.plans)) {
      return new ToolResult({ error: `No plan found with ID: ${plan_id}` });
    }

    this._current_plan_id = plan_id;
    return new ToolResult({
      output: `Plan '${plan_id}' is now the active plan.\n\n${this._formatPlan(
        this.plans[plan_id]
      )}`,
    });
  }

  /**
   * 标记步骤状态
   * @param plan_id 计划ID（可选，如果未提供则使用当前活动计划）
   * @param step_index 步骤索引
   * @param step_status 步骤状态
   * @param step_notes 步骤注释（可选）
   */
  private async _markStep(
    plan_id: string | undefined,
    step_index: number | undefined,
    step_status: StepStatus | undefined,
    step_notes: string | undefined
  ): Promise<ToolResult> {
    if (!plan_id) {
      // 如果未提供计划ID，使用当前活动计划
      if (!this._current_plan_id) {
        return new ToolResult({
          error: 'No active plan. Please specify a plan_id or set an active plan.',
        });
      }
      plan_id = this._current_plan_id;
    }

    if (!(plan_id in this.plans)) {
      return new ToolResult({ error: `No plan found with ID: ${plan_id}` });
    }

    if (step_index === undefined) {
      return new ToolResult({ error: 'Parameter `step_index` is required for command: mark_step' });
    }

    const plan = this.plans[plan_id];

    if (step_index < 0 || step_index >= plan.steps.length) {
      return new ToolResult({
        error: `Invalid step_index: ${step_index}. Valid indices range from 0 to ${plan.steps.length - 1}.`,
      });
    }

    if (
      step_status &&
      !['not_started', 'in_progress', 'completed', 'blocked'].includes(step_status)
    ) {
      return new ToolResult({
        error: `Invalid step_status: ${step_status}. Valid statuses are: not_started, in_progress, completed, blocked`,
      });
    }

    if (step_status) {
      plan.step_statuses[step_index] = step_status;
    }

    if (step_notes) {
      plan.step_notes[step_index] = step_notes;
    }

    // 保存更新后的计划到文件
    await this._savePlansToMarkdown();

    return new ToolResult({
      output: `Step ${step_index} updated in plan '${plan_id}'.\n\n${this._formatPlan(plan)}`,
    });
  }

  /**
   * 删除计划
   * @param plan_id 计划ID
   */
  private async _deletePlan(plan_id: string | undefined): Promise<ToolResult> {
    if (!plan_id) {
      return new ToolResult({ error: 'Parameter `plan_id` is required for command: delete' });
    }

    if (!(plan_id in this.plans)) {
      return new ToolResult({ error: `No plan found with ID: ${plan_id}` });
    }

    delete this.plans[plan_id];

    // 如果删除的计划是当前活动计划，清除活动计划
    if (this._current_plan_id === plan_id) {
      this._current_plan_id = null;
    }

    // 保存更新后的计划到文件
    await this._savePlansToMarkdown();

    return new ToolResult({ output: `Plan '${plan_id}' has been deleted.` });
  }

  /**
   * 格式化计划显示
   * @param plan 计划对象
   */
  private _formatPlan(plan: Plan): string {
    let output = `Plan: ${plan.title} (ID: ${plan.plan_id})\n`;
    output += '='.repeat(output.length) + '\n\n';

    // 计算进度统计
    const totalSteps = plan.steps.length;
    const completed = plan.step_statuses.filter((status) => status === 'completed').length;
    const inProgress = plan.step_statuses.filter((status) => status === 'in_progress').length;
    const blocked = plan.step_statuses.filter((status) => status === 'blocked').length;
    const notStarted = plan.step_statuses.filter((status) => status === 'not_started').length;

    output += `Progress: ${completed}/${totalSteps} steps completed `;
    if (totalSteps > 0) {
      const percentage = (completed / totalSteps) * 100;
      output += `(${percentage.toFixed(1)}%)\n`;
    } else {
      output += '(0%)\n';
    }

    output += `Status: ${completed} completed, ${inProgress} in progress, ${blocked} blocked, ${notStarted} not started\n\n`;
    output += 'Steps:\n';

    // 添加每个步骤及其状态和注释
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const status = plan.step_statuses[i];
      const notes = plan.step_notes[i];

      const statusSymbol =
        {
          not_started: '[ ]',
          in_progress: '[→]',
          completed: '[✓]',
          blocked: '[!]',
        }[status] || '[ ]';

      output += `${i}. ${statusSymbol} ${step}\n`;
      if (notes) {
        output += `   Notes: ${notes}\n`;
      }
    }

    return output;
  }

  /**
   * Markdown格式化计划内容
   */
  private _formatPlanMarkdown(plan: Plan): string {
    let output = `# ${plan.title} (ID: ${plan.plan_id})\n`;
    output += `\n`;
    const totalSteps = plan.steps.length;
    const completed = plan.step_statuses.filter((status) => status === 'completed').length;
    const inProgress = plan.step_statuses.filter((status) => status === 'in_progress').length;
    const blocked = plan.step_statuses.filter((status) => status === 'blocked').length;
    const notStarted = plan.step_statuses.filter((status) => status === 'not_started').length;
    output += `**进度**: ${completed}/${totalSteps} 步已完成 `;
    if (totalSteps > 0) {
      const percentage = (completed / totalSteps) * 100;
      output += `(${percentage.toFixed(1)}%)\n`;
    } else {
      output += '(0%)\n';
    }
    output += `\n**状态**: ${completed} 完成, ${inProgress} 进行中, ${blocked} 阻塞, ${notStarted} 未开始\n`;
    output += `\n## 步骤\n`;
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const status = plan.step_statuses[i];
      const notes = plan.step_notes[i];
      const statusSymbol =
        {
          not_started: '- [ ]',
          in_progress: '- [→]',
          completed: '- [x]',
          blocked: '- [!]',
        }[status] || '- [ ]';
      output += `${statusSymbol} ${step}\n`;
      if (notes) {
        output += `  > 备注: ${notes}\n`;
      }
    }
    return output;
  }

  /**
   * 保存计划到md文件
   * @returns ToolResult 包含操作结果或错误信息
   */
  private async _savePlansToMarkdown(): Promise<ToolResult> {
    try {
      await this._ensureManusDirExists();
      for (const planId of Object.keys(this.plans)) {
        const plan = this.plans[planId];
        const mdContent = this._formatPlanMarkdown(plan);
        const mdPath = `./.manus/plan_${planId}.md`;
        const result = await this.fileOperator.run({
          operation: 'write',
          path: mdPath,
          content: mdContent,
          encoding: 'utf-8',
        });
        if (result.error) {
          const errorMsg = `保存计划Markdown失败: ${result.error}`;
          this.logger.error(errorMsg);
          return new ToolResult({ error: errorMsg });
        }
      }
      return new ToolResult({ output: '计划已同步到Markdown文件' });
    } catch (error) {
      const errorMsg = `保存计划Markdown时出错: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(errorMsg);
      return new ToolResult({ error: errorMsg });
    }
  }

  /**
   * 保存计划到文件
   * @returns ToolResult 包含操作结果或错误信息
   */
  private async _savePlansToFile(): Promise<ToolResult> {
    try {
      const plansData = {
        plans: this.plans,
        current_plan_id: this._current_plan_id,
        last_updated: new Date().toISOString(),
      };

      // 确保.manus目录存在
      await this._ensureManusDirExists();

      const result = await this.fileOperator.run({
        operation: 'write',
        path: this._getPlansFilePath(),
        content: JSON.stringify(plansData, null, 2),
        encoding: 'utf-8',
      });

      if (result.error) {
        const errorMsg = `保存计划失败: ${result.error}`;
        this.logger.error(errorMsg);
        return new ToolResult({ error: errorMsg });
      }

      return new ToolResult({ output: '计划保存成功' });
    } catch (error) {
      const errorMsg = `保存计划时出错: ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(errorMsg);
      return new ToolResult({ error: errorMsg });
    }
  }

  /**
   * 从文件加载计划
   */
  async loadPlansFromFile(): Promise<void> {
    try {
      // 确保.manus目录存在
      await this._ensureManusDirExists();

      // 检查文件是否存在
      const existsResult = await this.fileOperator.run({
        operation: 'exists',
        path: this._getPlansFilePath(),
      });

      if (existsResult.error || !existsResult.output?.exists) {
        // 如果文件不存在，初始化空计划
        this.plans = {};
        this._current_plan_id = null;
        this.logger.info('计划文件不存在，初始化空计划');
        return;
      }

      // 读取文件内容
      const readResult = await this.fileOperator.run({
        operation: 'read',
        path: this._getPlansFilePath(),
        encoding: 'utf-8',
      });

      if (readResult.error) {
        this.logger.error(`读取计划文件失败: ${readResult.error}`);
        this.plans = {};
        this._current_plan_id = null;
        return;
      }

      // 解析JSON数据
      const content = readResult.output as string;
      try {
        const plansData = JSON.parse(content);

        // 更新计划数据
        if (plansData.plans) {
          this.plans = plansData.plans;
          this._current_plan_id = plansData.current_plan_id || null;
          this.logger.info(`成功从文件恢复了 ${Object.keys(this.plans).length} 个计划`);
        } else {
          this.plans = {};
          this._current_plan_id = null;
          this.logger.warning('计划文件格式不正确，初始化空计划');
        }
      } catch (parseError) {
        this.logger.error(`解析计划文件失败: ${parseError}`);
        this.plans = {};
        this._current_plan_id = null;
      }
    } catch (error) {
      this.logger.error(`加载计划时出错: ${error}`);
      // 初始化空计划
      this.plans = {};
      this._current_plan_id = null;
    }
  }

  /**
   * 获取计划文件路径
   */
  private _getPlansFilePath(): string {
    return './.manus/plans.json';
  }

  /**
   * 确保.manus目录存在
   * 用于初始化时确保存储目录可用
   */
  private async _ensureManusDirExists(): Promise<void> {
    try {
      const dirPath = './.manus';
      const dirExistsResult = await this.fileOperator.run({
        operation: 'exists',
        path: dirPath,
      });

      if (dirExistsResult.error) {
        this.logger.error(`检查.manus目录失败: ${dirExistsResult.error}`);
        return;
      }

      // 如果目录不存在，创建它
      if (!dirExistsResult.output?.exists) {
        const mkdirResult = await this.fileOperator.run({
          operation: 'mkdir',
          path: dirPath,
        });

        if (mkdirResult.error) {
          this.logger.error(`创建.manus目录失败: ${mkdirResult.error}`);
          return;
        }

        this.logger.info('.manus目录创建成功');
      }
    } catch (error) {
      this.logger.error(
        `确保.manus目录存在时出错: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
