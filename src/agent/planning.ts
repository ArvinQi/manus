/**
 * PlanningAgent 类
 * 负责任务规划、记录和动态管理
 * 支持planning工具功能
 * 支持通过工具读取和修改文件
 */
import path from 'path';
import { FileOperatorsTool } from '../tool/file_operators.js';
import { ToolResult } from '../tool/base.js';
import { Logger } from '../utils/logger.js';

interface PlanStep {
  description: string;
  status: 'pending' | 'done';
  details?: string;
}

// 规划系统提示词
const PLANNING_SYSTEM_PROMPT = `
你是一个专家规划代理，负责通过结构化计划高效解决问题。
你的工作是：
1. 分析请求以理解任务范围
2. 创建一个清晰、可操作的计划，使用 planning 工具取得有意义的进展
3. 根据需要使用可用工具执行步骤
4. 跟踪进度并在必要时调整计划
5. 当任务完成时，立即使用 finish 结束

可用工具将根据任务而变化，但可能包括：
- planning：创建、更新和跟踪计划（命令：create、update、mark_step 等）
- finish：任务完成时结束

将任务分解为具有明确结果的逻辑步骤。避免过多的细节或子步骤。
考虑依赖关系和验证方法。
知道何时结束 - 一旦目标达成，就不要继续思考。
`;

// 下一步提示词
const NEXT_STEP_PROMPT = `
基于当前状态，你的下一步行动是什么？
选择最有效的前进路径：
1. 计划是否足够，或者需要改进？
2. 你能立即执行下一步吗？
3. 任务是否完成？如果是，立即使用 finish。

简明扼要地说明你的推理，然后选择适当的工具或行动。
`;

export class PlanningAgent {
  private plan: PlanStep[] = [];
  private planFile: string;
  private currentStepIndex: number = 0;
  private planningTools: Record<string, Function> = {};
  private fileOperator: FileOperatorsTool;
  private logger: Logger;

  constructor(planFilePath: string) {
    this.planFile = planFilePath;
    this.fileOperator = new FileOperatorsTool();
    this.logger = new Logger('PlanningAgent');
    this.loadPlan();
    this.initPlanningTools();
  }

  /**
   * 初始化规划工具
   * 提供类似Python版本的planning工具功能
   */
  private initPlanningTools() {
    this.planningTools = {
      create: async (steps: string[]) => await this.initPlan(steps),
      update: async (index: number, description: string) =>
        await this.updateStep(index, description),
      mark_step: async (index: number) => await this.markStepDone(index),
      add_step: async (description: string) => await this.addStep(description),
      insert_step: async (index: number, description: string) =>
        await this.insertPriorityStep(description, index),
      get_plan: () => this.getPlan(),
      get_current_step: () => this.getCurrentStep(),
      get_current_index: () => this.getCurrentStepIndex(),
      export_plan: async (exportPath?: string) => await this.exportPlan(exportPath),
      import_plan: async (importPath: string) => await this.importPlan(importPath),
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
  async initPlan(steps: string[]) {
    this.plan = steps.map((desc) => ({ description: desc, status: 'pending' }));
    this.currentStepIndex = 0;
    await this.savePlan();
    return { success: true, message: '计划已初始化', plan: this.plan };
  }

  /**
   * 标记某步骤为已完成
   * @param index 步骤索引
   */
  async markStepDone(index: number) {
    if (this.plan[index]) {
      this.plan[index].status = 'done';
      await this.savePlan();

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
    const pendingIndex = this.plan.findIndex((step) => step.status === 'pending');
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
  async addStep(desc: string) {
    this.plan.push({ description: desc, status: 'pending' });
    await this.savePlan();
    return { success: true, message: '步骤已添加', step: this.plan[this.plan.length - 1] };
  }

  /**
   * 更新步骤描述
   * @param index 步骤索引
   * @param description 新的描述
   */
  async updateStep(index: number, description: string) {
    if (this.plan[index]) {
      this.plan[index].description = description;
      await this.savePlan();
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
      technicalDetails: this.generateTechnicalDetails(step),
    };
  }

  /**
   * 高优先级插入步骤
   * @param desc 步骤描述
   * @param index 插入位置（默认插入当前步骤后）
   */
  async insertPriorityStep(desc: string, index?: number) {
    const insertIndex = index !== undefined ? index : this.currentStepIndex + 1;
    this.plan.splice(insertIndex, 0, { description: desc, status: 'pending' });
    await this.savePlan();
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
  private async savePlan() {
    const lines = [
      '# 任务计划',
      '',
      '## 已完成步骤',
      ...this.plan.filter((s) => s.status === 'done').map((s, i) => `${i + 1}. ${s.description}`),
      '',
      '## 待完成步骤',
      ...this.plan
        .filter((s) => s.status === 'pending')
        .map((s, i) => `${i + 1}. ${s.description}`),
    ];

    try {
      const result = await this.fileOperator.run({
        operation: 'write',
        path: this.planFile,
        content: lines.join('\n'),
        encoding: 'utf-8',
      });

      if (result.error) {
        this.logger.error(`保存计划失败: ${result.error}`);
      }
    } catch (error) {
      this.logger.error(`保存计划时出错: ${error}`);
    }
  }

  /**
   * 加载已有计划
   */
  private async loadPlan() {
    try {
      // 检查文件是否存在
      const existsResult = await this.fileOperator.run({
        operation: 'exists',
        path: this.planFile,
      });

      if (existsResult.error) {
        this.logger.error(`检查计划文件是否存在失败: ${existsResult.error}`);
        await this.initPlan(['解析用户需求', '制定开发计划', '执行编码任务', '验证测试结果']);
        return;
      }

      const exists = existsResult.output?.exists;

      if (exists) {
        // 读取文件内容
        const readResult = await this.fileOperator.run({
          operation: 'read',
          path: this.planFile,
          encoding: 'utf-8',
        });

        if (readResult.error) {
          this.logger.error(`读取计划文件失败: ${readResult.error}`);
          await this.initPlan(['解析用户需求', '制定开发计划', '执行编码任务', '验证测试结果']);
          return;
        }

        const content = readResult.output as string;
        const lines = content.split('\n');

        let currentSection = '';
        lines.forEach((line) => {
          if (line.startsWith('## 已完成步骤')) {
            currentSection = 'done';
          } else if (line.startsWith('## 待完成步骤')) {
            currentSection = 'pending';
          } else if (line.match(/^\d+\.\s/)) {
            const desc = line.replace(/^\d+\.\s/, '');
            this.plan.push({
              description: desc,
              status: currentSection === 'done' ? 'done' : 'pending',
            });
          }
        });
      } else {
        await this.initPlan(['解析用户需求', '制定开发计划', '执行编码任务', '验证测试结果']);
      }
    } catch (error) {
      this.logger.error(`加载计划时出错: ${error}`);
      await this.initPlan(['解析用户需求', '制定开发计划', '执行编码任务', '验证测试结果']);
    }
  }

  /**
   * 导出计划到指定文件
   * @param exportPath 导出文件路径（可选，默认为当前计划文件）
   */
  async exportPlan(exportPath?: string) {
    const targetPath = exportPath || this.planFile;
    
    try {
      // 创建计划的JSON表示
      const planData = {
        steps: this.plan,
        currentStepIndex: this.currentStepIndex,
        exportTime: new Date().toISOString()
      };
      
      const result = await this.fileOperator.run({
        operation: 'write',
        path: targetPath,
        content: JSON.stringify(planData, null, 2),
        encoding: 'utf-8'
      });
      
      if (result.error) {
        this.logger.error(`导出计划失败: ${result.error}`);
        return { success: false, message: `导出计划失败: ${result.error}` };
      }
      
      return { success: true, message: `计划已导出到: ${targetPath}`, path: targetPath };
    } catch (error) {
      this.logger.error(`导出计划时出错: ${error}`);
      return { success: false, message: `导出计划时出错: ${error}` };
    }
  }
  
  /**
   * 从指定文件导入计划
   * @param importPath 导入文件路径
   */
  async importPlan(importPath: string) {
    try {
      // 检查文件是否存在
      const existsResult = await this.fileOperator.run({
        operation: 'exists',
        path: importPath
      });
      
      if (existsResult.error || !existsResult.output?.exists) {
        const errorMsg = existsResult.error || `文件不存在: ${importPath}`;
        this.logger.error(errorMsg);
        return { success: false, message: errorMsg };
      }
      
      // 读取文件内容
      const readResult = await this.fileOperator.run({
        operation: 'read',
        path: importPath,
        encoding: 'utf-8'
      });
      
      if (readResult.error) {
        this.logger.error(`读取导入文件失败: ${readResult.error}`);
        return { success: false, message: `读取导入文件失败: ${readResult.error}` };
      }
      
      // 解析JSON数据
      const content = readResult.output as string;
      const planData = JSON.parse(content);
      
      // 更新计划数据
      if (planData.steps) {
        this.plan = planData.steps;
        this.currentStepIndex = planData.currentStepIndex || 0;
        await this.savePlan();
        
        return { 
          success: true, 
          message: `计划已从 ${importPath} 导入`, 
          plan: this.plan,
          importTime: new Date().toISOString()
        };
      } else {
        return { success: false, message: '导入的文件不包含有效的计划数据' };
      }
    } catch (error) {
      this.logger.error(`导入计划时出错: ${error}`);
      return { success: false, message: `导入计划时出错: ${error}` };
    }
  }
}
