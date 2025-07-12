/**
 * 智能对话上下文管理器
 * 根据相关性和重要性智能选择对话历史，而不是传递完整对话记录
 */

import { Logger } from '../utils/logger.js';
import { Message, Role } from '../schema/index.js';
import { MemoryManager, MemoryType } from './memory_manager.js';

export interface ConversationConfig {
  maxContextMessages: number;
  maxTokenLimit: number;
  relevanceThreshold: number;
  importanceThreshold: number;
  sessionTimeoutMs: number;
  summarizationThreshold: number;
}

export interface MessageContext {
  message: Message;
  timestamp: number;
  importance: number;
  relevanceScore?: number;
  sessionId?: string;
  topicId?: string;
}

export interface ConversationSession {
  sessionId: string;
  startTime: number;
  lastActivity: number;
  topic: string;
  messages: MessageContext[];
  summary?: string;
  isActive: boolean;
}

/**
 * 智能对话上下文管理器
 */
export class ConversationContextManager {
  private logger: Logger;
  private config: ConversationConfig;
  private sessions: Map<string, ConversationSession> = new Map();
  private currentSessionId: string | null = null;
  private memoryManager?: MemoryManager;

  // 主题关键词映射
  private topicKeywords = new Map<string, string[]>([
    ['coding', ['代码', '编程', '函数', '变量', '调试', 'bug', 'javascript', 'python', 'typescript']],
    ['file_ops', ['文件', '目录', '读取', '写入', '删除', '创建', '保存']],
    ['system', ['系统', '配置', '设置', '环境', '安装', '启动']],
    ['task_planning', ['任务', '计划', '步骤', '执行', '完成', '目标']],
    ['browser', ['浏览器', '网页', '点击', '输入', '搜索', '页面']],
    ['analysis', ['分析', '总结', '报告', '数据', '结果', '统计']],
  ]);

  constructor(config: ConversationConfig, memoryManager?: MemoryManager) {
    this.logger = new Logger('ConversationContextManager');
    this.config = config;
    this.memoryManager = memoryManager;
  }

  /**
   * 添加新消息到上下文管理
   */
  async addMessage(message: Message, metadata?: Record<string, any>): Promise<void> {
    const now = Date.now();

    // 计算消息重要性
    const importance = this.calculateMessageImportance(message);

    // 检测主题
    const topicId = this.detectMessageTopic(message);

    // 检查是否需要开始新的会话
    const sessionId = this.getOrCreateSession(message, topicId, now);

    const messageContext: MessageContext = {
      message,
      timestamp: now,
      importance,
      sessionId,
      topicId,
    };

    // 添加到当前会话
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(messageContext);
      session.lastActivity = now;

      // 记录到内存管理器（如果启用）
      if (this.memoryManager && importance > this.config.importanceThreshold) {
        await this.memoryManager.recordConversation(
          message.role as 'user' | 'assistant',
          message.content || '',
          { ...metadata, sessionId, topicId, importance }
        );
      }

      // 检查是否需要摘要
      if (session.messages.length >= this.config.summarizationThreshold) {
        await this.summarizeSession(sessionId);
      }
    }

    this.logger.debug(`Added message to session ${sessionId}, importance: ${importance}, topic: ${topicId}`);
  }

  /**
   * 获取相关的对话上下文
   */
  async getRelevantContext(currentQuery: string, maxMessages?: number): Promise<Message[]> {
    const limit = maxMessages || this.config.maxContextMessages;

    try {
      // 1. 分析当前查询的主题
      const currentTopic = this.detectQueryTopic(currentQuery);

      // 2. 获取相关的消息
      const relevantMessages = await this.findRelevantMessages(currentQuery, currentTopic);

      // 3. 按重要性和相关性排序
      const sortedMessages = this.sortMessagesByRelevance(relevantMessages, currentQuery);

      // 4. 应用token限制
      const contextMessages = this.applyTokenLimit(sortedMessages, limit);

      // 5. 构建最终上下文
      const finalContext = this.buildFinalContext(contextMessages);

      this.logger.info(`Built relevant context: ${finalContext.length} messages from ${relevantMessages.length} candidates`);

      return finalContext;
    } catch (error) {
      this.logger.error(`Failed to get relevant context: ${error}`);
      return this.getFallbackContext(limit);
    }
  }

  /**
   * 计算消息重要性（0-1）
   */
  private calculateMessageImportance(message: Message): number {
    let importance = 0.5; // 基础重要性

    // 用户消息更重要
    if (message.role === Role.USER) {
      importance += 0.3;
    }

    // 包含工具调用的消息很重要
    if (message.tool_calls && message.tool_calls.length > 0) {
      importance += 0.2;
    }

    // 错误消息很重要
    if (message.content?.toLowerCase().includes('错误') ||
        message.content?.toLowerCase().includes('error')) {
      importance += 0.2;
    }

    // 长消息可能更重要
    const contentLength = message.content?.length || 0;
    if (contentLength > 100) {
      importance += Math.min(0.1, contentLength / 1000);
    }

    // 包含特定关键词的消息
    const content = message.content?.toLowerCase() || '';
    if (content.includes('重要') || content.includes('关键') ||
        content.includes('问题') || content.includes('help')) {
      importance += 0.15;
    }

    return Math.min(1.0, importance);
  }

  /**
   * 检测消息主题
   */
  private detectMessageTopic(message: Message): string {
    const content = message.content?.toLowerCase() || '';

    for (const [topic, keywords] of this.topicKeywords) {
      const matchCount = keywords.filter(keyword => content.includes(keyword)).length;
      if (matchCount > 0) {
        return topic;
      }
    }

    return 'general';
  }

  /**
   * 检测查询主题
   */
  private detectQueryTopic(query: string): string {
    return this.detectMessageTopic({ content: query, role: Role.USER } as Message);
  }

  /**
   * 获取或创建会话
   */
  private getOrCreateSession(message: Message, topicId: string, timestamp: number): string {
    const now = timestamp;

    // 检查当前会话是否仍然活跃
    if (this.currentSessionId) {
      const currentSession = this.sessions.get(this.currentSessionId);
      if (currentSession &&
          currentSession.isActive &&
          (now - currentSession.lastActivity) < this.config.sessionTimeoutMs) {

        // 检查主题是否一致
        if (currentSession.topic === topicId || topicId === 'general') {
          return this.currentSessionId;
        }
      }
    }

    // 创建新会话
    const sessionId = `session_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    const session: ConversationSession = {
      sessionId,
      startTime: timestamp,
      lastActivity: timestamp,
      topic: topicId,
      messages: [],
      isActive: true,
    };

    this.sessions.set(sessionId, session);
    this.currentSessionId = sessionId;

    // 清理过期会话
    this.cleanupExpiredSessions(timestamp);

    this.logger.info(`Created new session: ${sessionId} for topic: ${topicId}`);
    return sessionId;
  }

  /**
   * 查找相关消息
   */
  private async findRelevantMessages(query: string, currentTopic: string): Promise<MessageContext[]> {
    const relevantMessages: MessageContext[] = [];

    // 1. 从当前会话获取消息
    if (this.currentSessionId) {
      const currentSession = this.sessions.get(this.currentSessionId);
      if (currentSession) {
        relevantMessages.push(...currentSession.messages);
      }
    }

    // 2. 从相同主题的其他会话获取重要消息
    for (const session of this.sessions.values()) {
      if (session.sessionId !== this.currentSessionId && session.topic === currentTopic) {
        const importantMessages = session.messages.filter(
          msg => msg.importance > this.config.importanceThreshold
        );
        relevantMessages.push(...importantMessages);
      }
    }

    // 3. 如果使用记忆管理器，从记忆中搜索相关内容
    if (this.memoryManager) {
      try {
        const relatedMemories = await this.memoryManager.queryMemories({
          types: [MemoryType.CONVERSATION],
          tags: [currentTopic, 'important'],
          limit: Math.min(10, this.config.maxContextMessages / 2),
          sortBy: 'importance',
          sortOrder: 'desc',
        });

        // 将记忆转换为消息上下文（简化处理）
        for (const memory of relatedMemories) {
          if (memory.content && memory.content.message) {
            relevantMessages.push({
              message: {
                role: memory.content.role || Role.ASSISTANT,
                content: memory.content.message,
              } as Message,
              timestamp: memory.timestamp,
              importance: memory.importance,
              relevanceScore: 0.8,
            });
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to query memories: ${error}`);
      }
    }

    return relevantMessages;
  }

  /**
   * 按相关性排序消息
   */
  private sortMessagesByRelevance(messages: MessageContext[], query: string): MessageContext[] {
    const queryLower = query.toLowerCase();

    // 计算每个消息的相关性分数
    return messages
      .map(msgCtx => {
        const content = msgCtx.message.content?.toLowerCase() || '';
        let relevanceScore = 0;

        // 文本相似性（简单实现）
        const queryWords = queryLower.split(/\s+/);
        const matchedWords = queryWords.filter(word => content.includes(word)).length;
        relevanceScore += (matchedWords / queryWords.length) * 0.5;

        // 时间权重（越新越重要）
        const ageHours = (Date.now() - msgCtx.timestamp) / (1000 * 60 * 60);
        const timeWeight = Math.max(0, 1 - ageHours / 24); // 24小时内的消息有时间权重
        relevanceScore += timeWeight * 0.3;

        // 重要性权重
        relevanceScore += msgCtx.importance * 0.2;

        return {
          ...msgCtx,
          relevanceScore,
        };
      })
      .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  }

  /**
   * 应用token限制
   */
  private applyTokenLimit(messages: MessageContext[], maxMessages: number): MessageContext[] {
    // 简单实现：按消息数量限制
    const result = messages.slice(0, maxMessages);

    // 确保包含最近的几条消息
    if (this.currentSessionId) {
      const currentSession = this.sessions.get(this.currentSessionId);
      if (currentSession) {
        const recentMessages = currentSession.messages.slice(-3);

        // 合并去重
        const allMessages = [...result];
        for (const recent of recentMessages) {
          if (!allMessages.find(m => m.timestamp === recent.timestamp)) {
            allMessages.push(recent);
          }
        }

        return allMessages.slice(0, maxMessages);
      }
    }

    return result;
  }

  /**
   * 构建最终上下文
   */
  private buildFinalContext(messageContexts: MessageContext[]): Message[] {
    // 按时间排序确保对话顺序
    const sortedByTime = messageContexts.sort((a, b) => a.timestamp - b.timestamp);

    // 提取消息
    return sortedByTime.map(ctx => ctx.message);
  }

  /**
   * 获取后备上下文（当智能选择失败时）
   */
  private getFallbackContext(maxMessages: number): Message[] {
    if (this.currentSessionId) {
      const currentSession = this.sessions.get(this.currentSessionId);
      if (currentSession) {
        const recentMessages = currentSession.messages.slice(-maxMessages);
        return recentMessages.map(ctx => ctx.message);
      }
    }

    return [];
  }

  /**
   * 摘要会话
   */
  private async summarizeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.messages.length < this.config.summarizationThreshold) {
      return;
    }

    try {
      // 简单摘要实现：保留最重要的消息，其他的创建摘要
      const importantMessages = session.messages.filter(
        msg => msg.importance > this.config.importanceThreshold
      );

      const lessImportantMessages = session.messages.filter(
        msg => msg.importance <= this.config.importanceThreshold
      );

      if (lessImportantMessages.length > 0) {
        // 创建摘要文本
        const summaryContent = this.createSessionSummary(lessImportantMessages);
        session.summary = summaryContent;

        // 只保留重要消息
        session.messages = importantMessages;

        this.logger.info(`Summarized session ${sessionId}: kept ${importantMessages.length} important messages, summarized ${lessImportantMessages.length} messages`);
      }
    } catch (error) {
      this.logger.error(`Failed to summarize session ${sessionId}: ${error}`);
    }
  }

  /**
   * 创建会话摘要
   */
  private createSessionSummary(messages: MessageContext[]): string {
    const topics = new Set<string>();
    const actions = new Set<string>();

    for (const msgCtx of messages) {
      if (msgCtx.topicId) {
        topics.add(msgCtx.topicId);
      }

      if (msgCtx.message.tool_calls) {
        for (const toolCall of msgCtx.message.tool_calls) {
          actions.add(toolCall.function.name);
        }
      }
    }

    const topicList = Array.from(topics).join(', ');
    const actionList = Array.from(actions).join(', ');

    return `会话摘要：讨论了${topicList}相关主题，执行了${actionList}等操作。共${messages.length}条消息。`;
  }

  /**
   * 清理过期会话
   */
  private cleanupExpiredSessions(currentTime: number): void {
    const expiredSessions = [];

    for (const [sessionId, session] of this.sessions) {
      if ((currentTime - session.lastActivity) > this.config.sessionTimeoutMs * 2) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
      this.logger.debug(`Cleaned up expired session: ${sessionId}`);
    }
  }

  /**
   * 获取会话统计信息
   */
  getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    totalMessages: number;
    currentSessionId: string | null;
  } {
    let totalMessages = 0;
    let activeSessions = 0;

    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length;
      if (session.isActive) {
        activeSessions++;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      totalMessages,
      currentSessionId: this.currentSessionId,
    };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ConversationConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info('Updated conversation context configuration');
  }

  /**
   * 清理所有会话
   */
  clearAllSessions(): void {
    this.sessions.clear();
    this.currentSessionId = null;
    this.logger.info('Cleared all conversation sessions');
  }
}
