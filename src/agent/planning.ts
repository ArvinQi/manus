/**
 * PlanningAgent 类
 * 负责任务规划、记录和动态管理
 * 支持planning工具功能
 */
import fs from 'fs';
import path from 'path';

interface PlanStep {
  description: string;
  status: 'pending' | 'done';
  details?: string;
}

export class PlanningAgent {
  private plan: PlanStep[] = [];
  private planFile: string;
  private currentStepIndex: number = 0;
  private planningTools: Record<string, Function> = {};

  constructor(planFilePath: string) {
    this.planFile = planFilePath;
    this.loadPlan();
    this.initPlanningTools();
  }

  /**
   * 初始化规划工具
   * 提供类似Python版本的planning工具功能
   */
  private initPlanningTools() {
    this.planningTools = {
      create: (steps: string[]) => this.initPlan(steps),
      update: (index: number, description: string) => this.updateStep(index, description),
      mark_step: (index: number) => this.markStepDone(index),
      add_step: (description: string) => this.addStep(description),
      insert_step: (index: number, description: string) => this.insertPriorityStep(description, index),
      get_plan: () => this.getPlan(),
      get_current_step: () => this.getCurrentStep(),
      get_current_index: () => this.getCurrentStepIndex()
    };
  }

  /**
   * 获取规划工具
   * @returns 规划工具集合
   */
  getPlanningTools() {
    return this.planningTools;
  }

  /**
   * 初始化任务计划
   * @param steps 初始步骤描述数组
   */
  initPlan(steps: string[]) {
    this.plan = steps.map((desc) => ({ description: desc, status: 'pending' }));
    this.currentStepIndex = 0;
    this.savePlan();
    return { success: true, message: '计划已初始化', plan: this.plan };
  }

  /**
   * 标记某步骤为已完成
   * @param index 步骤索引
   */
  markStepDone(index: number) {
    if (this.plan[index]) {
      this.plan[index].status = 'done';
      this.savePlan();

      // 更新当前步骤索引到下一个待处理步骤
      this.updateCurrentStepIndex();

      return { success: true, message: '步骤已标记为完成', step: this.plan[index] };
    }
    return { success: false, message: '步骤索引无效' };
  }

  /**
   * 更新当前步骤索引
   * 找到第一个待处理的步骤
   */
  private updateCurrentStepIndex() {
    const pendingIndex = this.plan.findIndex(step => step.status === 'pending');
    if (pendingIndex !== -1) {
      this.currentStepIndex = pendingIndex;
    } else {
      // 如果没有待处理步骤，保持当前索引
    }
  }

  /**
   * 新增任务步骤
   * @param desc 步骤描述
   */
  addStep(desc: string) {
    this.plan.push({ description: desc, status: 'pending' });
    this.savePlan();
    return { success: true, message: '步骤已添加', step: this.plan[this.plan.length - 1] };
  }

  /**
   * 更新步骤描述
   * @param index 步骤索引
   * @param description 新的描述
   */
  updateStep(index: number, description: string) {
    if (this.plan[index]) {
      this.plan[index].description = description;
      this.savePlan();
      return { success: true, message: '步骤已更新', step: this.plan[index] };
    }
    return { success: false, message: '步骤索引无效' };
  }

  /**
   * 获取当前步骤
   */
  getCurrentStep() {
    return this.plan[this.currentStepIndex];
  }

  /**
   * 获取所有步骤
   */
  getPlan() {
    return this.plan;
  }

  getCurrentSpec() {
    const step = this.plan[this.currentStepIndex];
    return {
      requirements: step.description,
      technicalDetails: this.generateTechnicalDetails(step)
    };
  }

  /**
   * 高优先级插入步骤
   * @param desc 步骤描述
   * @param index 插入位置（默认插入当前步骤后）
   */
  insertPriorityStep(desc: string, index?: number) {
    const insertIndex = index !== undefined ? index : this.currentStepIndex + 1;
    this.plan.splice(insertIndex, 0, { description: desc, status: 'pending' });
    this.savePlan();
    return { success: true, message: '优先步骤已插入', step: this.plan[insertIndex] };
  }

  private generateTechnicalDetails(step: PlanStep) {
    return `技术规范要求：\n1. 使用模块化架构\n2. 包含单元测试\n3. 遵循${step.description}的详细实现规范`;
  }

  /**
   * 获取当前步骤索引
   */
  getCurrentStepIndex() {
    return this.currentStepIndex;
  }

  /**
   * 保存计划到md文件
   */
  private savePlan() {
    const lines = ['# 任务计划', '', '## 已完成步骤', ...this.plan.filter(s => s.status === 'done').map((s, i) => `${i + 1}. ${s.description}`), '', '## 待完成步骤', ...this.plan.filter(s => s.status === 'pending').map((s, i) => `${i + 1}. ${s.description}`)];
    fs.writeFileSync(this.planFile, lines.join('\n'), 'utf-8');
  }

  /**
   * 加载已有计划
   */
  private loadPlan() {
    if (fs.existsSync(this.planFile)) {
      const content = fs.readFileSync(this.planFile, 'utf-8');
      const lines = content.split('\n');

      let currentSection = '';
      lines.forEach(line => {
        if (line.startsWith('## 已完成步骤')) {
          currentSection = 'done';
        } else if (line.startsWith('## 待完成步骤')) {
          currentSection = 'pending';
        } else if (line.match(/^\d+\.\s/)) {
          const desc = line.replace(/^\d+\.\s/, '');
          this.plan.push({
            description: desc,
            status: currentSection === 'done' ? 'done' : 'pending'
          });
        }
      });
    } else {
      this.initPlan([
        '解析用户需求',
        '制定开发计划',
        '执行编码任务',
        '验证测试结果'
      ]);
    }
  }
}
