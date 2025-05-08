/**
 * PlanningAgent 类
 * 负责任务规划、记录和动态管理
 */
import fs from 'fs';
import path from 'path';

interface PlanStep {
  description: string;
  status: 'pending' | 'done';
}

export class PlanningAgent {
  private plan: PlanStep[] = [];
  private planFile: string;
  private currentStepIndex: number = 0;

  constructor(planFilePath: string) {
    this.planFile = planFilePath;
    this.loadPlan();
  }

  /**
   * 初始化任务计划
   * @param steps 初始步骤描述数组
   */
  initPlan(steps: string[]) {
    this.plan = steps.map((desc) => ({ description: desc, status: 'pending' }));
    this.savePlan();
  }

  /**
   * 标记某步骤为已完成
   * @param index 步骤索引
   */
  markStepDone(index: number) {
    if (this.plan[index]) {
      this.plan[index].status = 'done';
      this.savePlan();
    }
  }

  /**
   * 新增任务步骤
   * @param desc 步骤描述
   */
  addStep(desc: string) {
    this.plan.push({ description: desc, status: 'pending' });
    this.savePlan();
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
