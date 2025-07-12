# 配置文件迁移说明

## 概述

本项目已将配置文件从TOML格式迁移到统一的JSON格式，简化了配置管理。

## 配置文件结构

### 新格式 (推荐)
- `config.json` - 统一配置文件，包含所有配置项

### 旧格式 (向后兼容)
- `config.toml` - 基础配置 (LLM、浏览器、搜索、工作空间)

## 配置文件查找顺序

系统会按以下顺序查找配置文件：

### JSON 格式配置文件
1. **项目目录**: `./config/config.json`
2. **用户目录**: `~/.manus/config.json`

### TOML 格式配置文件（向后兼容）
1. **项目目录**: `./config/config.toml`
2. **用户目录**: `~/.manus/config.toml`

## 配置加载优先级

1. **优先**: 使用统一的 `config.json` 文件
2. **备用**: 如果 `config.json` 不存在，则使用 TOML 配置文件

## 统一配置文件结构

```json
{
  "llm": {
    "default": {
      "model": "gpt-4o",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-...",
      "max_tokens": 4096,
      "temperature": 1.0,
      "api_type": "openai",
      "api_version": ""
    },
    "coder": {
      "model": "gpt-4o",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-...",
      "max_tokens": 4096,
      "temperature": 1.0,
      "api_type": "openai",
      "api_version": ""
    },
    "vision": {
      "model": "gpt-4o",
      "base_url": "https://api.openai.com/v1",
      "api_key": "sk-...",
      "max_tokens": 4096,
      "temperature": 1.0,
      "api_type": "openai",
      "api_version": ""
    }
  },
  "browser": {
    "headless": false,
    "disable_security": true,
    "extra_args": [],
    "max_content_length": 2000
  },
  "search": {
    "engine": "Google",
    "fallback_engines": ["DuckDuckGo", "Bing"],
    "retry_delay": 60,
    "max_retries": 3,
    "lang": "zh",
    "country": "cn"
  },
  "workspace": {
    "root": "./workspace"
  }
}
```

## 配置项说明

### LLM 配置
- `model`: 使用的模型名称
- `base_url`: API 基础URL
- `api_key`: API密钥
- `max_tokens`: 最大token数
- `temperature`: 温度参数
- `api_type`: API类型
- `api_version`: API版本

### 浏览器配置
- `headless`: 是否使用无头浏览器
- `disable_security`: 是否禁用安全检查
- `extra_args`: 额外的浏览器参数
- `max_content_length`: 最大内容长度

### 搜索配置
- `engine`: 搜索引擎
- `fallback_engines`: 备用搜索引擎
- `retry_delay`: 重试延迟
- `max_retries`: 最大重试次数
- `lang`: 语言设置
- `country`: 国家设置

### 工作空间配置
- `root`: 工作空间根目录

## 迁移步骤

1. **自动迁移**: 已创建的 `config.json` 文件整合了原有配置内容
2. **验证配置**: 系统会自动验证配置文件的完整性
3. **备份**: 建议保留原有配置文件作为备份

## 配置保存

- 配置更新会自动保存到找到的配置文件位置
- 如果没有找到配置文件，会在项目目录创建新的配置文件
- 支持热重载功能

## 全局配置

你可以在用户目录创建全局配置文件：

```bash
# 创建用户配置目录
mkdir -p ~/.manus

# 创建全局配置文件
cp ./config/config.json ~/.manus/config.json
```

全局配置文件适用于：
- 跨项目的通用配置
- 个人API密钥和凭证
- 默认的工作空间设置

## 特性

- ✅ 统一配置管理
- ✅ 向后兼容性
- ✅ 自动配置验证
- ✅ 智能配置保存
- ✅ 默认值填充
- ✅ 热重载支持

## 使用示例

### 读取配置

```typescript
import { Config } from './src/utils/config.js';

const config = Config.getInstance();

// 获取LLM配置
const llmConfig = config.getLLMConfig('default');

// 获取浏览器配置
const browserConfig = config.getBrowserConfig();

// 获取搜索配置
const searchConfig = config.getSearchConfig();

// 获取工作空间路径
const workspaceRoot = config.getWorkspaceRoot();
```

### 验证配置

```typescript
import { Config } from './src/utils/config.js';

const config = Config.getInstance();
const validation = config.validateConfig();

if (validation.valid) {
  console.log('配置验证通过');
} else {
  console.log('配置错误:', validation.errors);
}
```

### 重新加载配置

```typescript
import { Config } from './src/utils/config.js';

const config = Config.getInstance();
config.reloadConfig(); // 重新加载配置文件
```

## 注意事项

- 配置文件支持热重载
- 所有配置项都包含合理的默认值
- API密钥等敏感信息请妥善保管
- 建议定期备份配置文件
