/**
 * 规划流程类
 * 负责执行基于规划的流程
 */

import path from 'path';
import { Flow } from './flow_factory.js';
import { Logger } from '../utils/logger.js';
import { PlanningTool } from '../tool/planning.js';

// 计划ID常量
const DEFAULT_PLAN_ID = 'main_task_plan';

/**
 * 规划流程类
 * 实现基于规划的流程编排
 */
export class PlanningFlow implements Flow {
  private agents: Record<string, any>;
  private logger: Logger;
  private planningTool: PlanningTool;
  private currentPlanId: string;

  /**
   * 构造函数
   * @param agents 代理映射表
   */
  constructor(agents: Record<string, any>) {
    this.agents = agents;
    this.logger = new Logger('PlanningFlow');
    this.planningTool = new PlanningTool();
    this.currentPlanId = DEFAULT_PLAN_ID;
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
      await this.initializePlan(prompt);

      // 获取计划详情
      const planResult = await this.planningTool.run({
        command: 'get',
        plan_id: this.currentPlanId,
      });

      if (planResult.error) {
        throw new Error(`获取计划失败: ${planResult.error}`);
      }

      // 确保输出存在
      if (!planResult.output) {
        throw new Error('获取计划失败: 没有返回计划数据');
      }

      // 从 planningTool 获取计划详情
      // 由于 _formatPlan 返回的是格式化文本而不是 JSON，我们需要直接获取计划数据
      const planId = this.currentPlanId;
      const plan = (this.planningTool as any).plans[planId];
      
      if (!plan) {
        throw new Error(`找不到计划: ${planId}`);
      }
      
      // 找到第一个未开始或进行中的步骤
      const currentStepIndex = plan.step_statuses.findIndex(
        (status: string) => status === 'not_started' || status === 'in_progress'
      );

      if (currentStepIndex === -1) {
        return '所有计划步骤已完成';
      }

      // 标记当前步骤为进行中
      await this.planningTool.run({
        command: 'mark_step',
        plan_id: this.currentPlanId,
        step_index: currentStepIndex,
        step_status: 'in_progress',
        step_notes: '正在执行...',
      });

      try {
        // 执行代理
        await manus.run(prompt);

        // 标记当前步骤为完成
        await this.planningTool.run({
          command: 'mark_step',
          plan_id: this.currentPlanId,
          step_index: currentStepIndex,
          step_status: 'completed',
          step_notes: '步骤已完成',
        });

        this.logger.info('当前计划步骤已完成');
      } catch (error) {
        this.logger.error(`执行出错: ${error}`);

        // 标记当前步骤为阻塞
        await this.planningTool.run({
          command: 'mark_step',
          plan_id: this.currentPlanId,
          step_index: currentStepIndex,
          step_status: 'blocked',
          step_notes: `执行出错: ${error.message}`,
        });

        // 添加处理异常的步骤
        try {
          // 确保 plan 和 plan.steps 存在
          if (plan && Array.isArray(plan.steps)) {
            await this.planningTool.run({
              command: 'update',
              plan_id: this.currentPlanId,
              steps: [...plan.steps, '处理执行异常']
            });
          } else {
            // 如果 plan 不可用，创建一个新的步骤
            await this.planningTool.run({
              command: 'create',
              plan_id: this.currentPlanId + '_error',
              title: '错误恢复计划',
              steps: ['处理执行异常']
            });
          }
        } catch (updateError) {
          this.logger.error(`添加异常处理步骤失败: ${updateError}`);
          // 继续抛出原始错误
        }

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
  private async initializePlan(prompt: string) {
    // 检查计划是否存在
    const planResult = await this.planningTool.run({
      command: 'get',
      plan_id: this.currentPlanId,
    });

    // 如果计划不存在，则创建新计划
    if (planResult.error) {
      await this.planningTool.run({
        command: 'create',
        plan_id: this.currentPlanId,
        title: `任务计划: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`,
        steps: [`解析用户需求: ${prompt}`, '制定开发计划', '执行编码任务', '验证测试结果'],
      });

      // 设置为活动计划
      await this.planningTool.run({
        command: 'set_active',
        plan_id: this.currentPlanId,
      });
    }
  }
}
