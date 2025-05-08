/**
 * 规划流程类
 * 负责执行基于规划的流程
 */

import path from 'path';
import { Flow } from './flow_factory.js';
import { PlanningAgent } from '../agent/planning.js';
import { Logger } from '../utils/logger.js';

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

/**
 * 规划流程类
 * 实现基于规划的流程编排
 */
export class PlanningFlow implements Flow {
  private agents: Record<string, any>;
  private logger: Logger;
  private planningAgent: PlanningAgent;

  /**
   * 构造函数
   * @param agents 代理映射表
   */
  constructor(agents: Record<string, any>) {
    this.agents = agents;
    this.logger = new Logger('PlanningFlow');
    this.planningAgent = new PlanningAgent(path.join(process.cwd(), 'task_plan.md'));
  }

  /**
   * 执行流程
   * @param prompt 用户输入的提示词
   * @returns 执行结果
   */
  async execute(prompt: string): Promise<string> {
    this.logger.info('开始执行规划流程');

    // 获取主要代理
    const manus = this.agents['manus'];
    if (!manus) {
      throw new Error('未找到 manus 代理');
    }

    try {
      // 初始化计划
      this.initializePlan(prompt);

      // 获取当前步骤索引
      const currentStepIndex = this.planningAgent.getCurrentStepIndex();

      try {
        // 执行代理
        await manus.run(prompt);

        // 标记当前步骤为完成
        this.planningAgent.markStepDone(currentStepIndex);
        this.logger.info('当前计划步骤已完成');
      } catch (error) {
        this.logger.error(`执行出错: ${error}`);
        this.planningAgent.insertPriorityStep('处理执行异常');
        throw error;
      }

      return '流程执行完成';
    } catch (error) {
      this.logger.error(`流程执行失败: ${error}`);
      return `流程执行失败: ${error.message}`;
    }
  }

  /**
   * 初始化计划
   * @param prompt 用户输入的提示词
   */
  private initializePlan(prompt: string) {
    // 如果计划为空，则初始化一个基本计划
    if (this.planningAgent.getPlan().length === 0) {
      this.planningAgent.initPlan([
        `解析用户需求: ${prompt}`,
        '制定开发计划',
        '执行编码任务',
        '验证测试结果'
      ]);
    }
  }
}
