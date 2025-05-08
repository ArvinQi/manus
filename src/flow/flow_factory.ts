/**
 * 流程工厂类和流程类型枚举
 * 负责创建不同类型的流程实例
 */

import { Manus } from '../agent/manus.js';
import { PlanningFlow } from './planning_flow.js';

/**
 * 流程类型枚举
 */
export enum FlowType {
  PLANNING = 'planning',
  // 可以在此添加更多流程类型
}

/**
 * 流程接口
 */
export interface Flow {
  /**
   * 执行流程
   * @param prompt 用户输入的提示词
   * @returns 执行结果
   */
  execute(prompt: string): Promise<string>;
}

/**
 * 流程工厂类
 * 负责创建不同类型的流程实例
 */
export class FlowFactory {
  /**
   * 创建流程实例
   * @param options 流程选项
   * @returns 流程实例
   */
  static createFlow(options: {
    flowType: FlowType;
    agents: Record<string, any>;
  }): Flow {
    const { flowType, agents } = options;

    switch (flowType) {
      case FlowType.PLANNING:
        return new PlanningFlow(agents);
      default:
        throw new Error(`不支持的流程类型: ${flowType}`);
    }
  }
}
