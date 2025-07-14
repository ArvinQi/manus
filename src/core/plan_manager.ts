/**
 * 计划管理器
 * 专门负责任务计划的创建、保存、加载和执行状态管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger.js';

/**
 * 计划步骤状态
 */
export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';

/**
 * 计划步骤接口
 */
export interface PlanStep {
  id: string;
  description: string;
  status: StepStatus;
  notes?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * 计划接口
 */
export interface Plan {
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

/**
 * 计划管理器配置
 */
export interface PlanManagerConfig {
  workspaceRoot: string;
  planFileName?: string;
  autoSave?: boolean;
  maxAge?: number; // 计划过期时间（毫秒）
}

/**
 * 计划管理器类
 */
export class PlanManager {
  private logger: Logger;
  private config: Required<PlanManagerConfig>;
  private currentPlan: Plan | null = null;

  constructor(config: PlanManagerConfig) {
    this.logger = new Logger('PlanManager');
    this.config = {
      workspaceRoot: config.workspaceRoot,
      planFileName: config.planFileName || 'current_plan.json',
      autoSave: config.autoSave ?? true,
      maxAge: config.maxAge || 24 * 60 * 60 * 1000, // 24小时
    };
  }

  /**
   * 创建新计划
   */
  async createPlan(
    title: string,
    steps: string[],
    options?: {
      description?: string;
      sourceFile?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<Plan> {
    const planId = `plan_${Date.now()}`;

    const planSteps: PlanStep[] = steps.map((description, index) => ({
      id: `step_${index + 1}`,
      description: description.trim(),
      status: 'not_started' as StepStatus,
    }));

    const plan: Plan = {
      id: planId,
      title,
      description: options?.description,
      steps: planSteps,
      currentStepIndex: 0,
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceFile: options?.sourceFile,
      metadata: options?.metadata || {},
    };

    this.currentPlan = plan;

    if (this.config.autoSave) {
      await this.savePlan();
    }

    this.logger.info(`创建新计划: ${title}，共 ${steps.length} 个步骤`);
    return plan;
  }

  /**
   * 加载计划
   */
  async loadPlan(): Promise<Plan | null> {
    try {
      const planFilePath = this.getPlanFilePath();

      if (!fs.existsSync(planFilePath)) {
        this.logger.info('未找到保存的计划文件');
        return null;
      }

      const content = fs.readFileSync(planFilePath, 'utf-8');
      const planData = JSON.parse(content);

      // 验证计划数据有效性
      if (!this.isValidPlanData(planData)) {
        this.logger.warn('计划文件格式无效');
        return null;
      }

      // 检查计划是否过期
      if (this.isPlanExpired(planData)) {
        this.logger.info('发现过期的计划，将被忽略');
        return null;
      }

      this.currentPlan = planData;
      this.logger.info(`成功加载计划: ${planData.title}，当前步骤: ${planData.currentStepIndex + 1}/${planData.steps.length}`);

      return this.currentPlan;
    } catch (error) {
      this.logger.error(`加载计划失败: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * 保存计划
   */
  async savePlan(): Promise<boolean> {
    if (!this.currentPlan) {
      this.logger.warn('没有活跃的计划需要保存');
      return false;
    }

    try {
      this.ensureManusDirectory();

      this.currentPlan.updatedAt = Date.now();
      const planFilePath = this.getPlanFilePath();

      fs.writeFileSync(planFilePath, JSON.stringify(this.currentPlan, null, 2));

      // 同时保存兼容格式
      await this.saveCompatibleFormat();

      this.logger.info('计划已保存');
      return true;
    } catch (error) {
      this.logger.error(`保存计划失败: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * 保存兼容格式（plans.json）
   */
  private async saveCompatibleFormat(): Promise<void> {
    if (!this.currentPlan) return;

    const plansFilePath = path.join(this.config.workspaceRoot, '.manus', 'plans.json');

    const compatibleData = {
      plans: {
        [this.currentPlan.id]: {
          plan_id: this.currentPlan.id,
          title: this.currentPlan.title,
          steps: this.currentPlan.steps.map(step => step.description),
          step_statuses: this.currentPlan.steps.map(step => step.status),
          step_notes: this.currentPlan.steps.map(step => step.notes || ''),
        }
      },
      current_plan_id: this.currentPlan.id,
      last_updated: new Date().toISOString(),
    };

    fs.writeFileSync(plansFilePath, JSON.stringify(compatibleData, null, 2));
  }

  /**
   * 获取当前计划
   */
  getCurrentPlan(): Plan | null {
    return this.currentPlan;
  }

  /**
   * 获取当前计划（别名）
   */
  getActivePlan(): Plan | null {
    return this.getCurrentPlan();
  }

  /**
   * 获取当前步骤
   */
  getCurrentStep(): PlanStep | null {
    if (!this.currentPlan || this.currentPlan.currentStepIndex >= this.currentPlan.steps.length) {
      return null;
    }
    return this.currentPlan.steps[this.currentPlan.currentStepIndex];
  }

  /**
   * 获取当前步骤索引
   */
  getCurrentStepIndex(): number {
    return this.currentPlan?.currentStepIndex || 0;
  }

  /**
   * 标记当前步骤完成并推进到下一步
   */
  async markStepCompleted(notes?: string): Promise<boolean> {
    if (!this.currentPlan) {
      this.logger.warn('没有活跃的计划');
      return false;
    }

    const currentStep = this.getCurrentStep();
    if (!currentStep) {
      this.logger.warn('没有当前步骤可以标记为完成');
      return false;
    }

    // 标记当前步骤完成
    currentStep.status = 'completed';
    currentStep.endTime = Date.now();
    if (notes) {
      currentStep.notes = notes;
    }

    this.logger.info(`步骤已完成: ${currentStep.description}`);

    // 推进到下一步
    this.currentPlan.currentStepIndex++;

    // 检查是否所有步骤都完成
    if (this.currentPlan.currentStepIndex >= this.currentPlan.steps.length) {
      this.currentPlan.isActive = false;
      this.currentPlan.completedAt = Date.now();
      this.logger.info('所有计划步骤已完成！');
    } else {
      // 开始下一步
      const nextStep = this.getCurrentStep();
      if (nextStep) {
        nextStep.status = 'in_progress';
        nextStep.startTime = Date.now();
        this.logger.info(`开始执行下一步: ${nextStep.description}`);
      }
    }

    if (this.config.autoSave) {
      await this.savePlan();
    }

    return true;
  }

  /**
   * 设置步骤状态
   */
  async setStepStatus(stepIndex: number, status: StepStatus, notes?: string): Promise<boolean> {
    if (!this.currentPlan) {
      this.logger.warn('没有活跃的计划');
      return false;
    }

    if (stepIndex < 0 || stepIndex >= this.currentPlan.steps.length) {
      this.logger.warn(`无效的步骤索引: ${stepIndex}`);
      return false;
    }

    const step = this.currentPlan.steps[stepIndex];
    const oldStatus = step.status;
    step.status = status;

    if (notes) {
      step.notes = notes;
    }

    if (status === 'in_progress' && oldStatus !== 'in_progress') {
      step.startTime = Date.now();
    } else if (status === 'completed' && oldStatus !== 'completed') {
      step.endTime = Date.now();
    }

    this.logger.info(`步骤 ${stepIndex + 1} 状态更新: ${oldStatus} -> ${status}`);

    if (this.config.autoSave) {
      await this.savePlan();
    }

    return true;
  }

  /**
   * 获取计划进度信息
   */
  getProgress(): {
    isActive: boolean;
    totalSteps: number;
    completedSteps: number;
    currentStepIndex: number;
    currentStep: PlanStep | null;
    progress: number;
    remainingSteps: number;
  } {
    if (!this.currentPlan) {
      return {
        isActive: false,
        totalSteps: 0,
        completedSteps: 0,
        currentStepIndex: -1,
        currentStep: null,
        progress: 0,
        remainingSteps: 0,
      };
    }

    const completedSteps = this.currentPlan.steps.filter(step => step.status === 'completed').length;
    const totalSteps = this.currentPlan.steps.length;
    const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

    return {
      isActive: this.currentPlan.isActive,
      totalSteps,
      completedSteps,
      currentStepIndex: this.currentPlan.currentStepIndex,
      currentStep: this.getCurrentStep(),
      progress,
      remainingSteps: totalSteps - completedSteps,
    };
  }

  /**
   * 清除当前计划
   */
  async clearPlan(): Promise<boolean> {
    try {
      this.currentPlan = null;

      const planFilePath = this.getPlanFilePath();
      const plansFilePath = path.join(this.config.workspaceRoot, '.manus', 'plans.json');

      if (fs.existsSync(planFilePath)) {
        fs.unlinkSync(planFilePath);
      }
      if (fs.existsSync(plansFilePath)) {
        fs.unlinkSync(plansFilePath);
      }

      this.logger.info('计划已清除');
      return true;
    } catch (error) {
      this.logger.error(`清除计划失败: ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * 检查是否有活跃的计划
   */
  hasActivePlan(): boolean {
    return this.currentPlan !== null && this.currentPlan.isActive;
  }

  /**
   * 格式化计划显示
   */
  formatPlan(): string {
    if (!this.currentPlan) {
      return '没有活跃的计划';
    }

    let output = `计划: ${this.currentPlan.title}\n`;
    if (this.currentPlan.description) {
      output += `描述: ${this.currentPlan.description}\n`;
    }
    output += '\n步骤:\n';

    this.currentPlan.steps.forEach((step, index) => {
      const status = index < this.currentPlan!.currentStepIndex ? '✓' :
                    index === this.currentPlan!.currentStepIndex ? '→' : ' ';
      const statusText = step.status === 'completed' ? '[完成]' :
                        step.status === 'in_progress' ? '[进行中]' :
                        step.status === 'blocked' ? '[阻塞]' : '[待开始]';

      output += `${status} ${index + 1}. ${step.description} ${statusText}\n`;
    });

    const progress = this.getProgress();
    output += `\n进度: ${progress.completedSteps}/${progress.totalSteps} (${progress.progress.toFixed(1)}%)`;

    return output;
  }

  /**
   * 获取计划文件路径
   */
  private getPlanFilePath(): string {
    return path.join(this.config.workspaceRoot, '.manus', this.config.planFileName);
  }

  /**
   * 确保.manus目录存在
   */
  private ensureManusDirectory(): void {
    const manusDir = path.join(this.config.workspaceRoot, '.manus');
    if (!fs.existsSync(manusDir)) {
      fs.mkdirSync(manusDir, { recursive: true });
    }
  }

  /**
   * 验证计划数据有效性
   */
  private isValidPlanData(data: any): data is Plan {
    return (
      data &&
      typeof data.id === 'string' &&
      typeof data.title === 'string' &&
      Array.isArray(data.steps) &&
      typeof data.currentStepIndex === 'number' &&
      typeof data.isActive === 'boolean' &&
      typeof data.createdAt === 'number' &&
      typeof data.updatedAt === 'number'
    );
  }

  /**
   * 检查计划是否过期
   */
  private isPlanExpired(plan: Plan): boolean {
    const now = Date.now();
    return now - plan.updatedAt > this.config.maxAge;
  }
}
