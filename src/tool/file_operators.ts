/**
 * 文件操作工具
 * 用于读取、写入和列出文件等操作
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { BaseTool, ToolResult } from './base.js';
import { Logger } from '../utils/logger.js';

// 将回调式API转换为Promise式API
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const readdirAsync = promisify(fs.readdir);
const statAsync = promisify(fs.stat);
const mkdirAsync = promisify(fs.mkdir);

/**
 * 文件操作工具
 * 提供文件读取、写入、列出等功能
 */
export class FileOperatorsTool extends BaseTool {
  private logger = new Logger('FileOperatorsTool');

  constructor() {
    super({
      name: 'file_operators',
      description: '执行文件操作，如读取、写入和列出文件',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: '要执行的操作类型: read, write, list, exists, mkdir',
            enum: ['read', 'write', 'list', 'exists', 'mkdir'],
          },
          path: {
            type: 'string',
            description: '文件或目录的路径',
          },
          content: {
            type: 'string',
            description: '写入文件的内容（仅用于write操作）',
          },
          encoding: {
            type: 'string',
            description: '文件编码（默认为utf-8）',
            default: 'utf-8',
          },
          recursive: {
            type: 'boolean',
            description: '是否递归创建目录（仅用于mkdir操作）',
            default: false,
          },
        },
        required: ['operation', 'path'],
      },
    });
  }

  /**
   * 执行文件操作工具
   * @param args 工具参数
   * @returns 操作结果
   */
  async run(args: {
    operation: 'read' | 'write' | 'list' | 'exists' | 'mkdir';
    path: string;
    content?: string;
    encoding?: string;
    recursive?: boolean;
  }): Promise<ToolResult> {
    const { operation, path: filePath, content, encoding = 'utf-8', recursive = false } = args;

    try {
      switch (operation) {
        case 'read':
          return await this.readFile(filePath, encoding);
        case 'write':
          return await this.writeFile(filePath, content || '', encoding);
        case 'list':
          return await this.listFiles(filePath);
        case 'exists':
          return await this.fileExists(filePath);
        case 'mkdir':
          return await this.makeDirectory(filePath, recursive);
        default:
          return new ToolResult({ error: `不支持的操作: ${operation}` });
      }
    } catch (error) {
      this.logger.error(`文件操作失败: ${error}`);
      return new ToolResult({ error: `文件操作失败: ${error}` });
    }
  }

  /**
   * 读取文件内容
   */
  private async readFile(filePath: string, encoding: string): Promise<ToolResult> {
    this.logger.info(`读取文件: ${filePath}`);
    try {
      const content = await readFileAsync(filePath, { encoding: encoding as BufferEncoding });
      return new ToolResult({ output: content });
    } catch (error) {
      return new ToolResult({ error: `读取文件失败: ${error}` });
    }
  }

  /**
   * 写入文件内容
   */
  private async writeFile(
    filePath: string,
    content: string,
    encoding: string
  ): Promise<ToolResult> {
    this.logger.info(`写入文件: ${filePath}`);
    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await mkdirAsync(dir, { recursive: true });
      }

      await writeFileAsync(filePath, content, { encoding: encoding as BufferEncoding });
      return new ToolResult({ output: `文件已成功写入: ${filePath}` });
    } catch (error) {
      return new ToolResult({ error: `写入文件失败: ${error}` });
    }
  }

  /**
   * 列出目录中的文件
   */
  private async listFiles(dirPath: string): Promise<ToolResult> {
    this.logger.info(`列出目录: ${dirPath}`);
    try {
      const files = await readdirAsync(dirPath);
      const fileDetails = await Promise.all(
        files.map(async (file) => {
          const fullPath = path.join(dirPath, file);
          const stats = await statAsync(fullPath);
          return {
            name: file,
            path: fullPath,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
          };
        })
      );
      return new ToolResult({ output: fileDetails });
    } catch (error) {
      return new ToolResult({ error: `列出目录失败: ${error}` });
    }
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filePath: string): Promise<ToolResult> {
    this.logger.info(`检查文件是否存在: ${filePath}`);
    try {
      const exists = fs.existsSync(filePath);
      if (exists) {
        const stats = await statAsync(filePath);
        return new ToolResult({
          output: {
            exists,
            isDirectory: stats.isDirectory(),
            isFile: stats.isFile(),
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
          },
        });
      }
      return new ToolResult({ output: { exists } });
    } catch (error) {
      return new ToolResult({ error: `检查文件是否存在失败: ${error}` });
    }
  }

  /**
   * 创建目录
   */
  private async makeDirectory(dirPath: string, recursive: boolean): Promise<ToolResult> {
    this.logger.info(`创建目录: ${dirPath}`);
    try {
      await mkdirAsync(dirPath, { recursive });
      return new ToolResult({ output: `目录已成功创建: ${dirPath}` });
    } catch (error) {
      return new ToolResult({ error: `创建目录失败: ${error}` });
    }
  }
}
