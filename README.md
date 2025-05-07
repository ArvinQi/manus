# Manus

一个用 TypeScript 实现的多功能 AI 代理框架，参考了 Python 版本的 OpenManus 项目。

## 项目简介

Manus 是一个灵活的 AI 代理框架，可以使用多种工具来解决各种任务。它基于大型语言模型（LLM）的能力，通过工具调用机制扩展 AI 的能力范围。

## 特性

- 基于 TypeScript 实现，提供类型安全和现代化的代码结构
- 支持多种 LLM 提供商（如 OpenAI、Azure 等）
- 可扩展的工具系统，轻松添加新功能
- 灵活的代理架构，支持自定义行为
- 内置日志和配置管理

## 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/manus.git
cd manus

# 安装依赖
npm install

# 构建项目
npm run build
```

## 配置

在使用 Manus 之前，你需要设置配置文件：

1. 复制示例配置文件：

```bash
cp config/config.example.toml config/config.toml
```

2. 编辑 `config/config.toml` 文件，添加你的 API 密钥和其他设置。

## 使用方法

### 基本用法

```bash
# 运行 Manus 代理
npm start
```

然后按照提示输入你的指令。

### 编程方式使用

```typescript
import { Manus } from 'manus';

async function run() {
  // 创建并初始化 Manus 代理
  const agent = await Manus.create();
  
  try {
    // 运行代理
    await agent.run('帮我查找关于人工智能的最新研究');
  } finally {
    // 清理资源
    await agent.cleanup();
  }
}

run().catch(console.error);
```

## 扩展 Manus

### 添加新工具

```typescript
import { BaseTool, ToolResult } from 'manus';

class MyTool extends BaseTool {
  constructor() {
    super({
      name: 'MyTool',
      description: '我的自定义工具',
      parameters: {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: '工具输入'
          }
        },
        required: ['input']
      }
    });
  }

  async run(args: { input: string }): Promise<ToolResult> {
    // 实现工具逻辑
    return new ToolResult({
      output: `处理输入: ${args.input}`
    });
  }
}
```

## 许可证

MIT