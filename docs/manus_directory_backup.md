# Manus 目录备份功能

## 概述

Manus代理在创建新任务时，会自动备份现有的`.manus`目录，确保之前的任务状态、计划和对话历史不会丢失。这个功能提供了完整的数据保护机制，让用户可以安全地开始新任务而不用担心丢失历史数据。

## 功能特性

### 1. 自动备份触发

- **触发时机**: 每当调用`createTask()`方法创建新任务时
- **备份条件**: 仅当`.manus`目录存在时才进行备份
- **备份方式**: 将整个`.manus`目录重命名为带时间戳的备份目录

### 2. 智能备份管理

- **备份命名**: 使用本地时间格式命名，如`.manus_backup_2024-01-15_10-30-45-123`，方便阅读
- **自动清理**: 自动保留最近的10个备份，删除更早的备份
- **错误处理**: 备份失败不会阻止任务创建，只记录错误日志

### 3. 完整数据保护

- **任务数据**: 保护当前任务和历史任务记录
- **计划数据**: 保护活跃计划和计划历史
- **对话上下文**: 保护对话会话和消息历史
- **其他数据**: 保护内存数据库和自定义数据

## 备份流程详解

### 第一步：检查现有目录
```
检查 .manus 目录是否存在
├── 存在 → 继续备份流程
└── 不存在 → 跳过备份，直接创建新目录
```

### 第二步：创建备份
```
生成时间戳备份目录名
├── 格式: .manus_backup_YYYY-MM-DD_HH-mm-ss-SSS
├── 示例: .manus_backup_2024-01-15_10-30-45-123
└── 重命名 .manus → .manus_backup_[timestamp]
```

### 第三步：清理旧备份
```
扫描所有 .manus_backup_* 目录
├── 按修改时间排序（最新在前）
├── 保留前10个备份
└── 删除第11个及以后的备份
```

### 第四步：创建新环境
```
重新创建 .manus 目录结构
├── 创建 .manus/tasks/ 目录
├── 保存新任务到 current_task.json
└── 如有旧任务，保存到 task_history.json
```

## 使用示例

### 基本使用

```typescript
import { Manus } from './src/agent/manus.js';

// 创建Manus实例
const manus = await Manus.create({
  name: 'MyAgent',
  maxSteps: 20
});

// 创建新任务 - 将自动备份现有的.manus目录
const taskId = manus.createTask(
  '新项目任务',
  '开始一个全新的项目，需要清理环境',
  [
    '分析需求',
    '设计架构',
    '实现功能',
    '测试验证'
  ]
);

console.log(`新任务已创建: ${taskId}`);
// 日志会显示: "已备份.manus目录到: .manus_backup_2024-01-15_10-30-45-123"
```

### 检查备份状态

```typescript
import * as fs from 'fs';
import * as path from 'path';

// 获取所有备份目录
function getBackupDirectories(workspaceRoot: string) {
  const backupPattern = /^\.manus_backup_/;
  return fs.readdirSync(workspaceRoot)
    .filter(item => {
      const fullPath = path.join(workspaceRoot, item);
      return backupPattern.test(item) && fs.statSync(fullPath).isDirectory();
    })
    .map(item => ({
      name: item,
      path: path.join(workspaceRoot, item),
      mtime: fs.statSync(path.join(workspaceRoot, item)).mtime
    }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

// 使用示例
const backups = getBackupDirectories('./');
console.log(`找到 ${backups.length} 个备份:`);
backups.forEach((backup, index) => {
  console.log(`${index + 1}. ${backup.name} (${backup.mtime.toLocaleString()})`);
});
```

## 恢复备份数据

如果需要恢复之前的数据，可以手动操作：

### 方法1：完全恢复

```bash
# 1. 备份当前.manus目录（如果需要）
mv .manus .manus_current

# 2. 恢复指定备份（替换timestamp为实际时间戳）
mv .manus_backup_2024-01-15_10-30-45-123 .manus
```

### 方法2：选择性恢复

```bash
# 只恢复任务数据
cp -r .manus_backup_2024-01-15_10-30-45-123/tasks .manus/

# 只恢复计划数据
cp .manus_backup_2024-01-15_10-30-45-123/current_plan.json .manus/

# 只恢复对话历史
cp -r .manus_backup_2024-01-15_10-30-45-123/conversations .manus/
```

### 方法3：程序化恢复

```typescript
/**
 * 恢复指定的备份
 */
async function restoreBackup(backupName: string): Promise<boolean> {
  try {
    const workspaceRoot = config.getWorkspaceRoot();
    const currentManusDir = path.join(workspaceRoot, '.manus');
    const backupDir = path.join(workspaceRoot, backupName);

    // 检查备份是否存在
    if (!fs.existsSync(backupDir)) {
      console.error(`备份不存在: ${backupName}`);
      return false;
    }

    // 备份当前.manus目录
    if (fs.existsSync(currentManusDir)) {
      const currentBackupName = `.manus_current_${Date.now()}`;
      fs.renameSync(currentManusDir, path.join(workspaceRoot, currentBackupName));
      console.log(`当前.manus目录已备份为: ${currentBackupName}`);
    }

    // 恢复备份
    fs.renameSync(backupDir, currentManusDir);
    console.log(`已恢复备份: ${backupName}`);

    return true;
  } catch (error) {
    console.error(`恢复备份失败: ${(error as Error).message}`);
    return false;
  }
}

// 使用示例
const restored = await restoreBackup('.manus_backup_2024-01-15_10-30-45-123');
if (restored) {
  console.log('备份恢复成功！');
}
```

## 备份目录结构

备份的`.manus`目录包含以下内容：

```
.manus_backup_2024-01-15_10-30-45-123/
├── tasks/
│   ├── current_task.json      # 当前任务状态
│   └── task_history.json      # 历史任务记录
├── current_plan.json          # 当前活跃计划
├── conversations/             # 对话会话数据
│   ├── session_001.json
│   └── session_002.json
├── memory.db                  # 内存数据库
└── vector_store.db           # 向量存储（如果有）
```

## 配置选项

虽然备份功能是自动的，但可以通过以下方式影响其行为：

### 1. 环境变量配置

```bash
# 设置最大备份数量（默认10个）
export MANUS_MAX_BACKUPS=15

# 禁用自动备份（不推荐）
export MANUS_DISABLE_BACKUP=true
```

### 2. 代码配置

```typescript
// 在创建TaskManager时传入配置
class TaskManager {
  constructor(workspaceRoot: string, options?: {
    maxBackups?: number;
    disableBackup?: boolean;
  }) {
    // 配置逻辑
  }
}
```

## 最佳实践

### 1. 备份管理

- **定期清理**: 虽然系统会自动清理，但建议定期手动检查备份目录
- **重要备份**: 对于重要的项目状态，可以手动重命名备份目录防止被自动清理
- **磁盘空间**: 注意备份占用的磁盘空间，特别是包含大量对话历史的情况

### 2. 数据恢复

- **测试恢复**: 在重要操作前，先测试备份恢复流程
- **选择性恢复**: 优先使用选择性恢复，避免覆盖有用的新数据
- **备份验证**: 恢复后验证数据完整性

### 3. 故障排除

- **权限问题**: 确保对工作目录有读写权限
- **磁盘空间**: 确保有足够的磁盘空间进行备份
- **并发访问**: 避免多个Manus实例同时操作同一目录

## 故障排除

### 常见问题

1. **备份失败**
   ```
   错误: 备份.manus目录失败: ENOENT: no such file or directory
   解决: 检查工作目录权限和磁盘空间
   ```

2. **清理失败**
   ```
   错误: 清理备份失败: EBUSY: resource busy or locked
   解决: 确保没有其他进程正在访问备份目录
   ```

3. **恢复失败**
   ```
   错误: 恢复备份失败: 备份不存在
   解决: 检查备份目录名称是否正确
   ```

### 调试技巧

```typescript
// 启用详细日志
import { Logger } from './src/utils/logger.js';

const logger = new Logger('BackupDebug');
logger.setLevel('debug');

// 手动测试备份功能
const taskManager = new TaskManager('./');
// 查看日志输出了解备份过程
```

## 总结

Manus的目录备份功能提供了完整的数据保护机制：

- ✅ **自动化**: 无需手动操作，创建任务时自动备份
- ✅ **智能化**: 自动管理备份数量，避免磁盘空间浪费
- ✅ **可靠性**: 备份失败不影响任务创建，确保系统稳定性
- ✅ **灵活性**: 支持完全恢复和选择性恢复
- ✅ **透明性**: 详细的日志记录，方便调试和监控

这个功能确保了用户在开始新任务时不会丢失宝贵的历史数据，提供了安心的工作环境。
