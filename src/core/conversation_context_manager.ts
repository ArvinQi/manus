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
  // 新增：标记是否为受保护的消息（如首次任务消息）
  isProtected?: boolean;
  // 新增：消息类型标识
  messageType?: 'task_creation' | 'task_instruction' | 'important_user_input' | 'normal';
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
    [
      'coding',
      ['代码', '编程', '函数', '变量', '调试', 'bug', 'javascript', 'python', 'typescript'],
    ],
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

    // 检查是否已经添加过相同的消息（避免重复添加）
    const messageSignature = this.createMessageSignature(message);
    if (this.isMessageAlreadyAdded(messageSignature)) {
      this.logger.debug(`Message already exists, skipping: ${messageSignature}`);
      return;
    }

    // 检测消息类型和是否需要保护
    const messageType = this.detectMessageType(message, metadata);
    const isProtected = this.shouldProtectMessage(message, messageType, metadata);

    // 计算消息重要性（如果是保护消息，设置高重要性）
    const importance = isProtected ? 1.0 : this.calculateMessageImportance(message);

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
      isProtected,
      messageType,
    };

    // 添加到当前会话
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(messageContext);
      session.lastActivity = now;

      // 记录消息签名，避免重复添加
      this.addMessageSignature(messageSignature);

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

    this.logger.debug(
      `Added message to session ${sessionId}, importance: ${importance}, topic: ${topicId}`
    );
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

      this.logger.info(
        `Built relevant context: ${finalContext.length} messages from ${relevantMessages.length} candidates`
      );

      return finalContext;
    } catch (error) {
      this.logger.error(`Failed to get relevant context: ${error}`);
      return this.getFallbackContext(limit);
    }
  }

  /**
   * 检测消息类型
   */
  private detectMessageType(
    message: Message,
    metadata?: Record<string, any>
  ): MessageContext['messageType'] {
    const content = message.content?.toLowerCase() || '';

    // 检查元数据中的任务相关信息
    if (metadata?.isTaskCreation || metadata?.isFirstTask) {
      return 'task_creation';
    }

    // 检查内容中的任务创建关键词
    if (
      content.includes('创建任务') ||
      content.includes('新任务') ||
      content.includes('开始任务') ||
      content.includes('第一个任务') ||
      content.includes('首次任务') ||
      content.includes('初始任务')
    ) {
      return 'task_creation';
    }

    // 检查任务指令关键词
    if (
      content.includes('执行') ||
      content.includes('完成') ||
      content.includes('处理') ||
      content.includes('帮我') ||
      content.includes('请') ||
      (content.includes('任务') && content.length > 20)
    ) {
      return 'task_instruction';
    }

    // 检查重要用户输入
    if (
      message.role === Role.USER &&
      (content.includes('重要') ||
        content.includes('关键') ||
        content.includes('必须') ||
        content.includes('一定要') ||
        content.length > 100)
    ) {
      return 'important_user_input';
    }

    return 'normal';
  }

  /**
   * 判断消息是否需要保护
   */
  private shouldProtectMessage(
    message: Message,
    messageType: MessageContext['messageType'],
    metadata?: Record<string, any>
  ): boolean {
    // 明确标记为保护的消息
    if (metadata?.isProtected) {
      return true;
    }

    // 任务创建消息必须保护
    if (messageType === 'task_creation') {
      return true;
    }

    // 会话开始的前几条用户消息保护（特别是首次任务）
    if (message.role === Role.USER && this.currentSessionId) {
      const currentSession = this.sessions.get(this.currentSessionId);
      if (
        currentSession &&
        currentSession.messages.filter((m) => m.message.role === Role.USER).length <= 2
      ) {
        return true;
      }
    }

    // 长度超过一定阈值的用户消息保护
    if (message.role === Role.USER && (message.content?.length || 0) > 200) {
      return true;
    }

    return false;
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
    if (
      message.content?.toLowerCase().includes('错误') ||
      message.content?.toLowerCase().includes('error')
    ) {
      importance += 0.2;
    }

    // 长消息可能更重要
    const contentLength = message.content?.length || 0;
    if (contentLength > 100) {
      importance += Math.min(0.1, contentLength / 1000);
    }

    // 包含特定关键词的消息
    const content = message.content?.toLowerCase() || '';
    if (
      content.includes('重要') ||
      content.includes('关键') ||
      content.includes('问题') ||
      content.includes('help')
    ) {
      importance += 0.15;
    }

    return Math.min(1.0, importance);
  }

  /**
   * 检测消息主题
   */
  private detectMessageTopic(message: Message): string {
    const content = message.content?.toLowerCase() || '';

    // 如果内容太短，保持当前主题或归类为general
    if (content.length < 10) {
      return this.currentSessionId
        ? this.sessions.get(this.currentSessionId)?.topic || 'general'
        : 'general';
    }

    const topicScores = new Map<string, number>();

    // 计算每个主题的匹配分数
    for (const [topic, keywords] of this.topicKeywords) {
      const matchCount = keywords.filter((keyword) => content.includes(keyword)).length;
      if (matchCount > 0) {
        // 计算权重分数：匹配的关键词数量 / 总关键词数量
        const score = matchCount / keywords.length;
        topicScores.set(topic, score);
      }
    }

    // 如果没有任何匹配，保持当前主题或归类为general
    if (topicScores.size === 0) {
      return this.currentSessionId
        ? this.sessions.get(this.currentSessionId)?.topic || 'general'
        : 'general';
    }

    // 找到得分最高的主题
    let bestTopic = 'general';
    let bestScore = 0;

    for (const [topic, score] of topicScores) {
      if (score > bestScore) {
        bestScore = score;
        bestTopic = topic;
      }
    }

    // 只有当匹配分数足够高时才切换主题，否则保持当前主题
    const TOPIC_SWITCH_THRESHOLD = 0.15; // 需要至少15%的关键词匹配

    if (bestScore >= TOPIC_SWITCH_THRESHOLD) {
      return bestTopic;
    }

    // 如果匹配分数不够高，保持当前主题
    return this.currentSessionId
      ? this.sessions.get(this.currentSessionId)?.topic || 'general'
      : 'general';
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

    // 记录当前会话信息（用于调试）
    const currentSession = this.currentSessionId ? this.sessions.get(this.currentSessionId) : null;
    const previousTopic = currentSession?.topic || 'none';

    // 检查当前会话是否仍然活跃
    if (this.currentSessionId && currentSession) {
      const timeSinceLastActivity = now - currentSession.lastActivity;
      const isWithinTimeout = timeSinceLastActivity < this.config.sessionTimeoutMs;

      this.logger.debug(
        `Session check: ${this.currentSessionId}, active: ${currentSession.isActive}, timeout: ${isWithinTimeout} (${Math.round(timeSinceLastActivity / 1000)}s ago), topic: ${currentSession.topic} -> ${topicId}`
      );

      if (currentSession.isActive && isWithinTimeout) {
        // 更宽松的主题匹配策略
        const shouldReuseSession = this.shouldReuseSession(currentSession.topic, topicId);
        this.logger.debug(
          `Should reuse session: ${shouldReuseSession} (${currentSession.topic} -> ${topicId})`
        );

        if (shouldReuseSession) {
          // 更新会话活动时间
          currentSession.lastActivity = now;

          // 更新会话主题为更通用的主题（如果适用）
          if (topicId === 'general' || currentSession.topic === 'general') {
            currentSession.topic = topicId !== 'general' ? topicId : currentSession.topic;
          }

          this.logger.debug(`Reusing session: ${this.currentSessionId} for topic: ${topicId}`);
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

    this.logger.info(
      `Created new session: ${sessionId} for topic: ${topicId} (previous: ${previousTopic})`
    );
    return sessionId;
  }

  /**
   * 判断是否应该复用现有会话
   */
  private shouldReuseSession(currentTopic: string, newTopic: string): boolean {
    // 如果主题完全相同，直接复用
    if (currentTopic === newTopic) {
      return true;
    }

    // 如果任一主题是 'general'，复用会话
    if (currentTopic === 'general' || newTopic === 'general') {
      return true;
    }

    // 定义相关主题组 - 这些主题之间可以复用会话
    const relatedTopicGroups = [
      ['coding', 'file_ops', 'system'], // 开发相关
      ['task_planning', 'analysis'], // 规划分析相关
      ['browser', 'system'], // 浏览器和系统操作相关
    ];

    // 检查是否属于同一主题组
    for (const group of relatedTopicGroups) {
      if (group.includes(currentTopic) && group.includes(newTopic)) {
        return true;
      }
    }

    // 默认情况下，如果主题差异不大，也可以复用
    // 可以根据实际需要调整这个策略
    return false;
  }

  /**
   * 查找相关消息
   */
  private async findRelevantMessages(
    query: string,
    currentTopic: string
  ): Promise<MessageContext[]> {
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
          (msg) => msg.importance > this.config.importanceThreshold
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
      .map((msgCtx) => {
        const content = msgCtx.message.content?.toLowerCase() || '';
        let relevanceScore = 0;

        // 文本相似性（简单实现）
        const queryWords = queryLower.split(/\s+/);
        const matchedWords = queryWords.filter((word) => content.includes(word)).length;
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
    // 首先分离受保护的消息和普通消息
    const protectedMessages = messages.filter((m) => m.isProtected);
    const normalMessages = messages.filter((m) => !m.isProtected);

    // 如果受保护的消息数量已经超过限制，优先保留最重要的受保护消息
    if (protectedMessages.length >= maxMessages) {
      this.logger.warn(
        `Protected messages exceed limit, keeping ${maxMessages} most important ones`
      );
      return protectedMessages.sort((a, b) => b.importance - a.importance).slice(0, maxMessages);
    }

    // 计算剩余可用位置
    const remainingSlots = maxMessages - protectedMessages.length;

    // 从普通消息中选择最相关和最重要的
    const selectedNormalMessages = normalMessages
      .sort(
        (a, b) => (b.relevanceScore || 0) + b.importance - ((a.relevanceScore || 0) + a.importance)
      )
      .slice(0, remainingSlots);

    // 确保包含最近的几条消息
    if (this.currentSessionId) {
      const currentSession = this.sessions.get(this.currentSessionId);
      if (currentSession) {
        const recentMessages = currentSession.messages.slice(-3);

        for (const recent of recentMessages) {
          if (
            !protectedMessages.find((m) => m.timestamp === recent.timestamp) &&
            !selectedNormalMessages.find((m) => m.timestamp === recent.timestamp)
          ) {
            // 如果还有空间，添加最近消息
            if (selectedNormalMessages.length < remainingSlots) {
              selectedNormalMessages.push(recent);
            } else {
              // 替换最不重要的消息
              const leastImportant = selectedNormalMessages.sort(
                (a, b) => a.importance - b.importance
              )[0];
              if (leastImportant && recent.importance >= leastImportant.importance) {
                const index = selectedNormalMessages.indexOf(leastImportant);
                selectedNormalMessages[index] = recent;
              }
            }
          }
        }
      }
    }

    // 合并并按时间排序
    const finalMessages = [...protectedMessages, ...selectedNormalMessages];
    return finalMessages.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * 构建最终上下文
   */
  private buildFinalContext(messageContexts: MessageContext[]): Message[] {
    // 按时间排序确保对话顺序
    const sortedByTime = messageContexts.sort((a, b) => a.timestamp - b.timestamp);

    // 提取消息
    const messages = sortedByTime.map((ctx) => ctx.message);

    // *** 关键修复：确保工具调用和结果的配对完整性，防止Claude API错误 ***
    const validatedMessages = this.validateToolCallIntegrity(messages);

    return validatedMessages;
  }

  /**
   * 验证工具调用完整性
   * 确保工具调用和工具结果正确配对，防止API错误
   */
  private validateToolCallIntegrity(messages: Message[]): Message[] {
    const result: Message[] = [];
    const toolCallIds = new Set<string>();
    const toolResultIds = new Set<string>();

    // 第一遍：收集所有工具调用ID和工具结果ID
    for (const message of messages) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        message.tool_calls.forEach((call) => {
          if (call.id) {
            toolCallIds.add(call.id);
          }
        });
      }
      if (message.tool_call_id) {
        toolResultIds.add(message.tool_call_id);
      }
    }

    // 第二遍：只保留有完整配对的工具调用消息
    for (const message of messages) {
      if (message.tool_calls && message.tool_calls.length > 0) {
        // 检查工具调用是否都有对应的结果
        const completePairs = message.tool_calls.filter((call) =>
          call.id && toolResultIds.has(call.id)
        );

        if (completePairs.length === message.tool_calls.length) {
          // 所有工具调用都有对应结果，保留原消息
          result.push(message);
        } else if (completePairs.length > 0) {
          // 部分工具调用有结果，创建新消息只包含完整的配对
          result.push({
            role: message.role,
            content: message.content,
            tool_calls: completePairs,
            ...(message.tool_call_id && { tool_call_id: message.tool_call_id }),
            ...(message.name && { name: message.name }),
            ...(message.base64_image && { base64_image: message.base64_image }),
          } as Message);
        } else {
          // 没有完整配对，只保留文本内容
          if (message.content) {
            result.push({
              role: message.role,
              content: message.content,
              ...(message.base64_image && { base64_image: message.base64_image }),
            } as Message);
          }
        }
      } else if (message.tool_call_id) {
        // 工具结果消息：只保留有对应工具调用的结果
        if (toolCallIds.has(message.tool_call_id)) {
          result.push(message);
        } else {
          this.logger.debug(
            `Removing orphaned tool result: ${message.tool_call_id} (no matching tool call)`
          );
        }
      } else {
        // 普通消息，直接保留
        result.push(message);
      }
    }

    if (result.length !== messages.length) {
      this.logger.debug(
        `Tool call integrity validation: ${messages.length} -> ${result.length} messages`
      );
    }

    return result;
  }

  /**
   * 获取后备上下文（当智能选择失败时）
   */
  private getFallbackContext(maxMessages: number): Message[] {
    if (this.currentSessionId) {
      const currentSession = this.sessions.get(this.currentSessionId);
      if (currentSession) {
        const recentMessages = currentSession.messages.slice(-maxMessages);
        return recentMessages.map((ctx) => ctx.message);
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
        (msg) => msg.importance > this.config.importanceThreshold
      );

      const lessImportantMessages = session.messages.filter(
        (msg) => msg.importance <= this.config.importanceThreshold
      );

      if (lessImportantMessages.length > 0) {
        // 创建摘要文本
        const summaryContent = this.createSessionSummary(lessImportantMessages);
        session.summary = summaryContent;

        // 只保留重要消息
        session.messages = importantMessages;

        this.logger.info(
          `Summarized session ${sessionId}: kept ${importantMessages.length} important messages, summarized ${lessImportantMessages.length} messages`
        );
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
      if (currentTime - session.lastActivity > this.config.sessionTimeoutMs * 2) {
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
   * 获取详细的会话统计信息（用于调试）
   */
  getDetailedSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    totalMessages: number;
    currentSessionId: string | null;
    currentSessionTopic: string | null;
    currentSessionAge: number;
    sessionList: Array<{
      sessionId: string;
      topic: string;
      messageCount: number;
      age: number;
      isActive: boolean;
    }>;
  } {
    const now = Date.now();
    const sessionList = Array.from(this.sessions.values()).map((session) => ({
      sessionId: session.sessionId,
      topic: session.topic,
      messageCount: session.messages.length,
      age: Math.round((now - session.startTime) / (1000 * 60)), // 分钟
      isActive: session.isActive,
    }));

    const currentSession = this.currentSessionId ? this.sessions.get(this.currentSessionId) : null;

    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter((s) => s.isActive).length,
      totalMessages: Array.from(this.sessions.values()).reduce(
        (sum, s) => sum + s.messages.length,
        0
      ),
      currentSessionId: this.currentSessionId,
      currentSessionTopic: currentSession?.topic || null,
      currentSessionAge: currentSession
        ? Math.round((now - currentSession.startTime) / (1000 * 60))
        : 0,
      sessionList: sessionList.sort((a, b) => b.age - a.age), // 按年龄排序
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

  /**
   * 创建消息签名用于重复检测
   */
  private createMessageSignature(message: Message): string {
    // 使用消息的关键信息创建签名
    const content = message.content || '';
    const role = message.role;
    const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls) : '';
    const toolCallId = message.tool_call_id || '';

    return `${role}:${content.slice(0, 100)}:${toolCalls}:${toolCallId}`;
  }

  /**
   * 检查消息是否已经添加过
   */
  private isMessageAlreadyAdded(signature: string): boolean {
    if (!this.currentSessionId) {
      return false;
    }

    const session = this.sessions.get(this.currentSessionId);
    if (!session) {
      return false;
    }

    // 检查当前会话中是否已有相同签名的消息
    return session.messages.some((msgCtx) => {
      const existingSignature = this.createMessageSignature(msgCtx.message);
      return existingSignature === signature;
    });
  }

  /**
   * 记录消息签名（为了保持接口一致性，实际上已在isMessageAlreadyAdded中处理）
   */
  private addMessageSignature(signature: string): void {
    // 消息已经添加到会话中，这个方法只是为了保持接口一致性
    this.logger.debug(`Message signature recorded: ${signature.slice(0, 50)}...`);
  }
}
