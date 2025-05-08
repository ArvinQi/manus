/**
 * PlanningTool 使用示例
 * 展示如何创建和管理任务计划
 */
import { PlanningTool, ToolResult } from '../src/index.js';

// 创建 PlanningTool 实例
const planningTool = new PlanningTool();

// 异步函数用于演示 PlanningTool 的使用
async function demonstratePlanningTool() {
  console.log('===== PlanningTool 使用示例 =====');

  // 1. 创建一个新计划
  console.log('\n1. 创建新计划:');
  const createResult = await planningTool.run({
    command: 'create',
    plan_id: 'project-1',
    title: '开发新功能',
    steps: ['分析需求', '设计架构', '编写代码', '测试功能', '部署上线'],
  });
  console.log(createResult.output);

  // 2. 标记第一个步骤为进行中
  console.log('\n2. 标记步骤为进行中:');
  const markInProgressResult = await planningTool.run({
    command: 'mark_step',
    plan_id: 'project-1',
    step_index: 0,
    step_status: 'in_progress',
    step_notes: '正在收集和分析用户需求',
  });
  console.log(markInProgressResult.output);

  // 3. 标记第一个步骤为已完成
  console.log('\n3. 标记步骤为已完成:');
  const markCompletedResult = await planningTool.run({
    command: 'mark_step',
    plan_id: 'project-1',
    step_index: 0,
    step_status: 'completed',
    step_notes: '需求分析已完成，已确定核心功能',
  });
  console.log(markCompletedResult.output);

  // 4. 创建另一个计划
  console.log('\n4. 创建另一个计划:');
  const createAnotherResult = await planningTool.run({
    command: 'create',
    plan_id: 'project-2',
    title: '修复 Bug',
    steps: ['复现问题', '定位原因', '修复代码', '验证修复'],
  });
  console.log(createAnotherResult.output);

  // 5. 列出所有计划
  console.log('\n5. 列出所有计划:');
  const listResult = await planningTool.run({
    command: 'list',
  });
  console.log(listResult.output);

  // 6. 获取特定计划详情
  console.log('\n6. 获取计划详情:');
  const getResult = await planningTool.run({
    command: 'get',
    plan_id: 'project-1',
  });
  console.log(getResult.output);

  // 7. 更新计划
  console.log('\n7. 更新计划:');
  const updateResult = await planningTool.run({
    command: 'update',
    plan_id: 'project-1',
    title: '开发新功能 v2',
    steps: ['分析需求', '设计架构', '编写代码', '单元测试', '集成测试', '部署上线', '监控反馈'],
  });
  console.log(updateResult.output);

  // 8. 删除计划
  console.log('\n8. 删除计划:');
  const deleteResult = await planningTool.run({
    command: 'delete',
    plan_id: 'project-2',
  });
  console.log(deleteResult.output);

  // 9. 再次列出所有计划
  console.log('\n9. 再次列出所有计划:');
  const listAgainResult = await planningTool.run({
    command: 'list',
  });
  console.log(listAgainResult.output);
}

// 运行示例
demonstrateplanningTool().catch((error) => {
  console.error('示例运行出错:', error);
});
