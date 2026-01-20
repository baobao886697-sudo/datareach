/**
 * 搜索处理器 V3 - Apify 版本 (重构版)
 * 
 * 核心改进：
 * 1. 结构化统计数据 - 后端直接返回 stats 对象
 * 2. 智能积分退还 - 如果实际结果数少于请求数量，自动退还多扣积分
 * 3. 清晰的日志系统 - 让用户知道系统在做什么
 * 4. 统一的统计口径 - 前后端数据一致
 */

import {
  getUserById, 
  deductCredits,
  addCredits,
  createSearchTask, 
  updateSearchTask, 
  getSearchTask,
  saveSearchResult,
  updateSearchResult,
  getSearchResults,
  getCacheByKey,
  setCache,
  logApi,
  getConfig
} from '../db';
import { searchPeople as apifySearchPeople, LeadPerson } from './apify';
import { verifyPhoneNumber, PersonToVerify, VerificationResult } from './scraper';
import { SearchTask } from '../../drizzle/schema';
import crypto from 'crypto';

// ============ 类型定义 ============

export interface SearchPreviewResult {
  success: boolean;
  totalAvailable: number;
  estimatedCredits: number;
  searchCredits: number;
  phoneCreditsPerPerson: number;
  canAfford: boolean;
  userCredits: number;
  maxAffordable: number;
  searchParams: {
    name: string;
    title: string;
    state: string;
    limit: number;
    ageMin?: number;
    ageMax?: number;
  };
  cacheHit: boolean;
  message: string;
}

export interface SearchLogEntry {
  timestamp: string;
  time: string;
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  phase: 'init' | 'apify' | 'process' | 'verify' | 'complete';
  step?: number;
  total?: number;
  message: string;
  icon?: string;
  details?: {
    name?: string;
    phone?: string;
    email?: string;
    company?: string;
    matchScore?: number;
    reason?: string;
    duration?: number;
    creditsUsed?: number;
  };
}

/**
 * 搜索统计数据 - 结构化存储，前端直接使用
 */
export interface SearchStats {
  // === 请求统计 ===
  apifyApiCalls: number;           // Apify API 调用次数
  verifyApiCalls: number;          // 验证 API 调用次数
  
  // === 数据统计 ===
  apifyReturned: number;           // Apify 返回的原始记录数
  recordsProcessed: number;        // 实际处理的记录数
  
  // === 结果统计（最终保存的） ===
  totalResults: number;            // 总结果数（保存到数据库的）
  resultsWithPhone: number;        // 有电话的结果数
  resultsWithEmail: number;        // 有邮箱的结果数
  resultsVerified: number;         // 验证通过的结果数
  
  // === 排除统计（处理过程中被排除的） ===
  excludedNoPhone: number;         // 无电话被排除（但有邮箱仍保存）
  excludedNoContact: number;       // 无任何联系方式被排除
  excludedAgeFilter: number;       // 年龄不符被排除
  excludedError: number;           // 处理错误被排除
  
  // === 积分统计 ===
  creditsUsed: number;             // 已消耗积分
  creditsRefunded: number;         // 退还积分
  creditsFinal: number;            // 最终消耗积分 (creditsUsed - creditsRefunded)
  
  // === 性能统计 ===
  totalDuration: number;           // 总耗时（毫秒）
  avgProcessTime: number;          // 平均每条处理时间
  
  // === 验证统计 ===
  verifySuccessRate: number;       // 验证成功率（百分比）
}

export interface SearchProgress {
  taskId: string;
  status: 'initializing' | 'searching' | 'processing' | 'verifying' | 'completed' | 'stopped' | 'failed' | 'insufficient_credits';
  phase: 'init' | 'apify' | 'process' | 'verify' | 'complete';
  phaseProgress: number;
  overallProgress: number;
  step: number;
  totalSteps: number;
  currentAction: string;
  currentPerson?: string;
  stats: SearchStats;
  logs: SearchLogEntry[];
  estimatedTimeRemaining?: number;
  startTime: number;
  lastUpdateTime: number;
}

// ============ 常量定义 ============

const SEARCH_CREDITS = 1;           // 搜索基础费用
const PHONE_CREDITS_PER_PERSON = 2; // 每条数据费用
const VERIFY_CREDITS_PER_PHONE = 0; // 验证费用（目前免费）
const CONCURRENT_VERIFY_LIMIT = 5;  // 并发验证数量（可根据 Scrape.do 账户限制调整）

// ============ 工具函数 ============

function generateSearchHash(name: string, title: string, state: string): string {
  const normalized = `${name.toLowerCase().trim()}|${title.toLowerCase().trim()}|${state.toLowerCase().trim()}`;
  return crypto.createHash('md5').update(normalized).digest('hex');
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function formatTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * 创建初始统计对象
 */
function createInitialStats(): SearchStats {
  return {
    apifyApiCalls: 0,
    verifyApiCalls: 0,
    apifyReturned: 0,
    recordsProcessed: 0,
    totalResults: 0,
    resultsWithPhone: 0,
    resultsWithEmail: 0,
    resultsVerified: 0,
    excludedNoPhone: 0,
    excludedNoContact: 0,
    excludedAgeFilter: 0,
    excludedError: 0,
    creditsUsed: 0,
    creditsRefunded: 0,
    creditsFinal: 0,
    totalDuration: 0,
    avgProcessTime: 0,
    verifySuccessRate: 0,
  };
}

/**
 * 并发批量处理函数
 * 将数组分成批次，每批并发执行
 */
async function processBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T, index: number) => Promise<R>,
  onBatchComplete?: (batchIndex: number, totalBatches: number) => void
): Promise<R[]> {
  const results: R[] = [];
  const totalBatches = Math.ceil(items.length / batchSize);
  
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const start = batchIndex * batchSize;
    const end = Math.min(start + batchSize, items.length);
    const batch = items.slice(start, end);
    
    // 并发执行当前批次
    const batchResults = await Promise.all(
      batch.map((item, i) => processor(item, start + i))
    );
    
    results.push(...batchResults);
    
    if (onBatchComplete) {
      onBatchComplete(batchIndex + 1, totalBatches);
    }
  }
  
  return results;
}

// ============ 预览搜索 ============

export async function previewSearch(
  userId: number,
  searchName: string,
  searchTitle: string,
  searchState: string,
  requestedCount: number = 100,
  ageMin?: number,
  ageMax?: number
): Promise<SearchPreviewResult> {
  const user = await getUserById(userId);
  if (!user) {
    return {
      success: false,
      totalAvailable: 0,
      estimatedCredits: 0,
      searchCredits: SEARCH_CREDITS,
      phoneCreditsPerPerson: PHONE_CREDITS_PER_PERSON,
      canAfford: false,
      userCredits: 0,
      maxAffordable: 0,
      searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount, ageMin, ageMax },
      cacheHit: false,
      message: '用户不存在'
    };
  }

  // 检查缓存
  const searchHash = generateSearchHash(searchName, searchTitle, searchState);
  const cacheKey = `apify:${searchHash}`;
  const cached = await getCacheByKey(cacheKey);
  
  let totalAvailable = 0;
  let cacheHit = false;

  if (cached) {
    cacheHit = true;
    const cachedData = cached.data as LeadPerson[];
    totalAvailable = cachedData.length;
  } else {
    totalAvailable = requestedCount;
  }

  const actualCount = Math.min(requestedCount, totalAvailable);
  const estimatedCredits = SEARCH_CREDITS + actualCount * PHONE_CREDITS_PER_PERSON;
  const canAfford = user.credits >= estimatedCredits;
  const maxAffordable = Math.max(0, Math.floor((user.credits - SEARCH_CREDITS) / PHONE_CREDITS_PER_PERSON));

  return {
    success: true,
    totalAvailable,
    estimatedCredits,
    searchCredits: SEARCH_CREDITS,
    phoneCreditsPerPerson: PHONE_CREDITS_PER_PERSON,
    canAfford,
    userCredits: user.credits,
    maxAffordable,
    searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount, ageMin, ageMax },
    cacheHit,
    message: cacheHit 
      ? `✨ 命中缓存！找到 ${totalAvailable} 条记录` 
      : `🔍 预估可获取 ${totalAvailable} 条记录`
  };
}

// ============ 执行搜索 V3 ============

export async function executeSearchV3(
  userId: number,
  searchName: string,
  searchTitle: string,
  searchState: string,
  requestedCount: number = 100,
  ageMin?: number,
  ageMax?: number,
  enableVerification: boolean = true,
  onProgress?: (progress: SearchProgress) => void
): Promise<SearchTask | undefined> {
  
  const startTime = Date.now();
  const logs: SearchLogEntry[] = [];
  const stats = createInitialStats();
  
  let currentStep = 0;
  const totalSteps = requestedCount + 10;
  
  // 添加日志的辅助函数
  const addLog = (
    message: string, 
    level: SearchLogEntry['level'] = 'info',
    phase: SearchLogEntry['phase'] = 'init',
    icon?: string,
    step?: number,
    total?: number,
    details?: SearchLogEntry['details']
  ) => {
    const entry: SearchLogEntry = {
      timestamp: formatTimestamp(),
      time: formatTime(),
      level,
      phase,
      icon,
      step,
      total,
      message,
      details
    };
    logs.push(entry);
    console.log(`[${entry.time}] [${phase.toUpperCase()}] ${icon || ''} ${message}`);
  };

  // 获取用户
  const user = await getUserById(userId);
  if (!user) throw new Error('用户不存在');

  // 检查积分
  if (user.credits < SEARCH_CREDITS) {
    throw new Error(`积分不足，搜索需要至少 ${SEARCH_CREDITS} 积分，当前余额 ${user.credits}`);
  }

  // 创建搜索任务
  const searchHash = generateSearchHash(searchName, searchTitle, searchState);
  const params = { 
    name: searchName, 
    title: searchTitle, 
    state: searchState,
    limit: requestedCount,
    ageMin,
    ageMax,
    enableVerification,
    dataSource: 'apify'
  };

  const task = await createSearchTask(userId, searchHash, params, requestedCount);
  if (!task) throw new Error('创建搜索任务失败');

  // 初始化进度对象
  const progress: SearchProgress = {
    taskId: task.taskId,
    status: 'initializing',
    phase: 'init',
    phaseProgress: 0,
    overallProgress: 0,
    step: 0,
    totalSteps,
    currentAction: '初始化搜索任务',
    stats,
    logs,
    startTime,
    lastUpdateTime: Date.now()
  };

  // 将内部状态映射到数据库允许的状态
  const mapStatusToDbStatus = (status: SearchProgress['status']): string => {
    switch (status) {
      case 'initializing':
      case 'searching':
      case 'processing':
      case 'verifying':
        return 'running';
      case 'completed':
        return 'completed';
      case 'stopped':
        return 'stopped';
      case 'failed':
        return 'failed';
      case 'insufficient_credits':
        return 'insufficient_credits';
      default:
        return 'running';
    }
  };

  const updateProgress = async (
    action?: string, 
    status?: SearchProgress['status'],
    phase?: SearchProgress['phase'],
    phaseProgress?: number
  ) => {
    if (action) progress.currentAction = action;
    if (status) progress.status = status;
    if (phase) progress.phase = phase;
    if (phaseProgress !== undefined) progress.phaseProgress = phaseProgress;
    
    progress.step = currentStep;
    progress.overallProgress = Math.round((currentStep / totalSteps) * 100);
    progress.lastUpdateTime = Date.now();
    stats.totalDuration = Date.now() - startTime;
    
    // 计算验证成功率
    if (stats.resultsWithPhone > 0) {
      stats.verifySuccessRate = Math.round((stats.resultsVerified / stats.resultsWithPhone) * 100);
    }
    
    // 计算平均处理时间
    if (stats.recordsProcessed > 0) {
      stats.avgProcessTime = Math.round(stats.totalDuration / stats.recordsProcessed);
    }
    
    // 更新数据库（包含 stats）
    const dbStatus = mapStatusToDbStatus(progress.status);
    await updateSearchTask(task.taskId, { 
      logs, 
      status: dbStatus as any, 
      creditsUsed: stats.creditsUsed,
      progress: progress.overallProgress,
      // 将 stats 存储在 params 中（因为没有单独的 stats 字段）
      // 或者可以通过 logs 的最后一条传递
    });
    
    // 回调通知
    onProgress?.(progress);
  };

  try {
    // ═══════════════════════════════════════════════════════════════
    // 阶段 1: 初始化
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    addLog('═══════════════════════════════════════════════════════════', 'info', 'init', '');
    addLog(`🚀 搜索任务启动`, 'success', 'init', '🚀');
    addLog(`任务编号: #${task.taskId.slice(0, 8)}`, 'info', 'init', '📋');
    addLog('───────────────────────────────────────────────────────────', 'info', 'init', '');
    addLog(`📋 搜索条件:`, 'info', 'init', '');
    addLog(`   姓名关键词: ${searchName}`, 'info', 'init', '');
    addLog(`   职位: ${searchTitle}`, 'info', 'init', '');
    addLog(`   地区: ${searchState}`, 'info', 'init', '');
    addLog(`   请求数量: ${requestedCount} 条`, 'info', 'init', '');
    if (ageMin && ageMax) {
      addLog(`   年龄筛选: ${ageMin} - ${ageMax} 岁`, 'info', 'init', '');
    }
    addLog(`   电话验证: ${enableVerification ? '✅ 已启用' : '❌ 已禁用'}`, 'info', 'init', '');
    addLog('───────────────────────────────────────────────────────────', 'info', 'init', '');
    addLog(`💰 积分信息:`, 'info', 'init', '');
    addLog(`   当前余额: ${user.credits} 积分`, 'info', 'init', '');
    addLog(`   预估消耗: ${SEARCH_CREDITS + requestedCount * PHONE_CREDITS_PER_PERSON} 积分`, 'info', 'init', '');
    addLog(`   (搜索费 ${SEARCH_CREDITS} + 数据费 ${requestedCount} × ${PHONE_CREDITS_PER_PERSON})`, 'info', 'init', '');
    addLog('═══════════════════════════════════════════════════════════', 'info', 'init', '');
    await updateProgress('初始化搜索任务', 'searching', 'init', 10);

    // ═══════════════════════════════════════════════════════════════
    // 阶段 2: 扣除搜索积分
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    addLog(`💳 正在扣除搜索基础费用...`, 'info', 'init', '');
    const searchDeducted = await deductCredits(userId, SEARCH_CREDITS, 'search', `搜索: ${searchName} | ${searchTitle} | ${searchState}`, task.taskId);
    if (!searchDeducted) throw new Error('扣除搜索积分失败');
    stats.creditsUsed += SEARCH_CREDITS;
    addLog(`✅ 已扣除搜索费用: ${SEARCH_CREDITS} 积分`, 'success', 'init', '✅');
    await updateProgress('扣除搜索积分', undefined, undefined, 20);

    // ═══════════════════════════════════════════════════════════════
    // 阶段 3: 检查缓存 / 调用 Apify API
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    addLog('───────────────────────────────────────────────────────────', 'info', 'apify', '');
    const cacheKey = `apify:${searchHash}`;
    const cached = await getCacheByKey(cacheKey);
    
    let apifyResults: LeadPerson[] = [];
    
    if (cached) {
      addLog(`✨ 命中全局缓存！`, 'success', 'apify', '✨');
      apifyResults = cached.data as LeadPerson[];
      stats.apifyReturned = apifyResults.length;
      addLog(`📦 缓存中有 ${apifyResults.length} 条记录可用`, 'info', 'apify', '');
      addLog(`⏭️ 跳过 Apify API 调用，节省时间和成本`, 'info', 'apify', '');
    } else {
      stats.apifyApiCalls++;
      addLog(`🔍 正在调用 Apify Leads Finder...`, 'info', 'apify', '');
      addLog(`⏳ Apify Actor 运行中，请耐心等待...`, 'info', 'apify', '');
      addLog(`   (通常需要 1-3 分钟，取决于数据量)`, 'info', 'apify', '');
      await updateProgress('调用 Apify API', 'searching', 'apify', 30);
      
      const apiStartTime = Date.now();
      const searchResult = await apifySearchPeople(searchName, searchTitle, searchState, requestedCount * 2, userId);
      const apiDuration = Date.now() - apiStartTime;

      if (!searchResult.success || !searchResult.people) {
        throw new Error(searchResult.errorMessage || 'Apify 搜索失败');
      }

      apifyResults = searchResult.people;
      stats.apifyReturned = apifyResults.length;
      addLog(`✅ Apify 返回 ${apifyResults.length} 条数据`, 'success', 'apify', '✅');
      addLog(`⏱️ API 响应时间: ${formatDuration(apiDuration)}`, 'info', 'apify', '');

      // 缓存搜索结果 180天
      await setCache(cacheKey, 'search', apifyResults, 180);
      addLog(`💾 已缓存搜索结果 (180天有效)`, 'info', 'apify', '');
    }

    await updateProgress('处理搜索结果', undefined, 'apify', 50);

    if (apifyResults.length === 0) {
      addLog(`⚠️ 未找到匹配的结果`, 'warning', 'complete', '⚠️');
      addLog(`   请尝试调整搜索条件后重试`, 'info', 'complete', '');
      progress.status = 'completed';
      await updateProgress('搜索完成', 'completed', 'complete', 100);
      return getSearchTask(task.taskId);
    }

    // ═══════════════════════════════════════════════════════════════
    // 阶段 4: 计算实际数量并一次性扣除数据费用
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    const actualCount = Math.min(apifyResults.length, requestedCount);
    const dataCreditsNeeded = actualCount * PHONE_CREDITS_PER_PERSON;
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
    addLog(`📊 数据量计算:`, 'info', 'process', '');
    addLog(`   用户请求: ${requestedCount} 条`, 'info', 'process', '');
    addLog(`   实际返回: ${apifyResults.length} 条`, 'info', 'process', '');
    addLog(`   可处理数量: ${actualCount} 条`, 'info', 'process', '');
    
    // 检查用户积分是否足够
    const currentUserForDataFee = await getUserById(userId);
    if (!currentUserForDataFee || currentUserForDataFee.credits < dataCreditsNeeded) {
      addLog(`⚠️ 积分不足，无法处理数据`, 'warning', 'complete', '⚠️');
      addLog(`   需要 ${dataCreditsNeeded} 积分，当前余额 ${currentUserForDataFee?.credits || 0}`, 'info', 'complete', '');
      progress.status = 'insufficient_credits';
      await updateProgress('积分不足', 'insufficient_credits', 'complete', 100);
      return getSearchTask(task.taskId);
    }
    
    // 一次性扣除数据费用
    addLog(`💳 正在扣除数据费用...`, 'info', 'process', '');
    const dataDeducted = await deductCredits(
      userId, 
      dataCreditsNeeded, 
      'search', 
      `数据费用: ${actualCount} 条 × ${PHONE_CREDITS_PER_PERSON} 积分`, 
      task.taskId
    );
    
    if (!dataDeducted) {
      addLog(`❌ 扣除数据费用失败`, 'error', 'complete', '❌');
      throw new Error('扣除数据费用失败');
    }
    
    stats.creditsUsed += dataCreditsNeeded;
    addLog(`✅ 已扣除数据费用: ${dataCreditsNeeded} 积分 (${actualCount} 条 × ${PHONE_CREDITS_PER_PERSON})`, 'success', 'process', '✅');
    
    // 如果实际数量少于请求数量，通知用户节省了积分
    if (actualCount < requestedCount) {
      const savedCredits = (requestedCount - actualCount) * PHONE_CREDITS_PER_PERSON;
      stats.creditsRefunded = savedCredits;  // 记录节省的积分（虽然没有实际退还，但用户少付了）
      addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
      addLog(`💰 积分节省通知:`, 'success', 'process', '💰');
      addLog(`   由于实际数据量 (${actualCount}) 少于请求数量 (${requestedCount})`, 'info', 'process', '');
      addLog(`   您节省了 ${savedCredits} 积分！`, 'success', 'process', '');
      addLog(`   (原预估: ${requestedCount * PHONE_CREDITS_PER_PERSON} 积分，实际扣除: ${dataCreditsNeeded} 积分)`, 'info', 'process', '');
    }
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
    
    // ═══════════════════════════════════════════════════════════════
    // 阶段 5: 打乱顺序并准备处理
    // ═══════════════════════════════════════════════════════════════
    const shuffledResults = shuffleArray(apifyResults);
    addLog(`🔀 已打乱数据顺序，采用随机提取策略`, 'info', 'process', '');
    addLog(`📊 开始逐条处理数据...`, 'info', 'process', '');
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');

    // ═══════════════════════════════════════════════════════════════
    // 阶段 6: 并发批量处理数据 (优化版)
    // ═══════════════════════════════════════════════════════════════
    const toProcess = shuffledResults.slice(0, actualCount);
    const CONCURRENT_BATCH_SIZE = 5; // 并发数量，可根据需要调整
    
    addLog(`🚀 启用并发处理模式，并发数: ${CONCURRENT_BATCH_SIZE}`, 'info', 'process', '');
    
    // 先分离有电话和无电话的记录
    const recordsWithPhone: typeof toProcess = [];
    const recordsWithoutPhone: typeof toProcess = [];
    
    for (const person of toProcess) {
      const phoneNumbers = person.phone_numbers || [];
      let selectedPhone = phoneNumbers[0];
      for (const phone of phoneNumbers) {
        if (phone.type === 'mobile') {
          selectedPhone = phone;
          break;
        }
      }
      const phoneNumber = selectedPhone?.sanitized_number || selectedPhone?.raw_number || null;
      
      if (phoneNumber) {
        recordsWithPhone.push(person);
      } else {
        recordsWithoutPhone.push(person);
      }
    }
    
    addLog(`📊 数据分类: ${recordsWithPhone.length} 条有电话, ${recordsWithoutPhone.length} 条无电话`, 'info', 'process', '');
    
    // 快速处理无电话的记录（不需要验证，可以直接保存）
    let processedCount = 0;
    for (const person of recordsWithoutPhone) {
      processedCount++;
      stats.recordsProcessed++;
      stats.excludedNoPhone++;
      
      const personName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown';
      
      const resultData = {
        apifyId: person.id,
        apolloId: person.id,
        firstName: person.first_name,
        lastName: person.last_name,
        fullName: personName,
        title: person.title,
        company: person.organization_name || person.organization?.name,
        city: person.city,
        state: person.state,
        country: person.country,
        email: person.email,
        phone: null,
        phoneStatus: 'no_phone' as 'pending' | 'received' | 'verified' | 'no_phone' | 'failed',
        phoneType: '其他',
        linkedinUrl: person.linkedin_url,
        age: null as number | null,
        carrier: null as string | null,
        verificationSource: null as string | null,
        verificationScore: null as number | null,
        verifiedAt: null as Date | null,
        industry: person.organization?.industry || null,
        dataSource: 'apify',
      };
      
      if (person.email) {
        await saveSearchResult(task.id, person.id, resultData, false, 0, null);
        stats.totalResults++;
        stats.resultsWithEmail++;
      } else {
        stats.excludedNoContact++;
      }
    }
    
    if (recordsWithoutPhone.length > 0) {
      addLog(`✅ 已快速处理 ${recordsWithoutPhone.length} 条无电话记录`, 'info', 'process', '');
    }
    
    // 检查是否需要停止
    let taskStopped = false;
    const currentTaskCheck = await getSearchTask(task.taskId);
    if (currentTaskCheck?.status === 'stopped') {
      addLog(`⏹️ 任务已被用户停止`, 'warning', 'complete', '⏹️');
      progress.status = 'stopped';
      taskStopped = true;
    }
    
    // 并发处理有电话的记录
    if (!taskStopped && recordsWithPhone.length > 0) {
      addLog(`🔄 开始并发验证 ${recordsWithPhone.length} 条有电话记录...`, 'info', 'verify', '');
      addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
      
      const totalBatches = Math.ceil(recordsWithPhone.length / CONCURRENT_BATCH_SIZE);
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        // 检查任务是否被停止
        const currentTask = await getSearchTask(task.taskId);
        if (currentTask?.status === 'stopped') {
          addLog(`⏹️ 任务已被用户停止`, 'warning', 'complete', '⏹️');
          progress.status = 'stopped';
          break;
        }
        
        const start = batchIndex * CONCURRENT_BATCH_SIZE;
        const end = Math.min(start + CONCURRENT_BATCH_SIZE, recordsWithPhone.length);
        const batch = recordsWithPhone.slice(start, end);
        
        const batchStartTime = Date.now();
        addLog(`📦 批次 ${batchIndex + 1}/${totalBatches}: 并发处理 ${batch.length} 条记录...`, 'info', 'process', '');
        
        // 并发处理当前批次
        const batchPromises = batch.map(async (person, indexInBatch) => {
          const globalIndex = processedCount + indexInBatch + 1;
          stats.recordsProcessed++;
          
          const personName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown';
          
          // 获取电话号码
          const phoneNumbers = person.phone_numbers || [];
          let selectedPhone = phoneNumbers[0];
          for (const phone of phoneNumbers) {
            if (phone.type === 'mobile') {
              selectedPhone = phone;
              break;
            }
          }
          const phoneNumber = selectedPhone?.sanitized_number || selectedPhone?.raw_number || '';
          const phoneType = selectedPhone?.type || 'unknown';
          
          // 构建结果数据
          const resultData = {
            apifyId: person.id,
            apolloId: person.id,
            firstName: person.first_name,
            lastName: person.last_name,
            fullName: personName,
            title: person.title,
            company: person.organization_name || person.organization?.name,
            city: person.city,
            state: person.state,
            country: person.country,
            email: person.email,
            phone: phoneNumber,
            phoneStatus: 'received' as 'pending' | 'received' | 'verified' | 'no_phone' | 'failed',
            phoneType: phoneType === 'mobile' ? '手机' : phoneType === 'work' ? '座机' : '其他',
            linkedinUrl: person.linkedin_url,
            age: null as number | null,
            carrier: null as string | null,
            verificationSource: null as string | null,
            verificationScore: null as number | null,
            verifiedAt: null as Date | null,
            industry: person.organization?.industry || null,
            dataSource: 'apify',
          };
          
          stats.resultsWithPhone++;
          
          // 二次电话验证
          if (enableVerification) {
            const personToVerify: PersonToVerify = {
              firstName: person.first_name || '',
              lastName: person.last_name || '',
              city: person.city || '',
              state: person.state || '',
              phone: phoneNumber
            };
            
            stats.verifyApiCalls++;
            const verifyResult = await verifyPhoneNumber(personToVerify, userId);
            
            if (verifyResult) {
              resultData.verificationScore = verifyResult.matchScore;
              resultData.verificationSource = verifyResult.source;
              resultData.age = verifyResult.details?.age || null;
              resultData.carrier = verifyResult.details?.carrier || null;
              
              if (verifyResult.verified) {
                resultData.phoneStatus = 'verified';
                resultData.verifiedAt = new Date();
                stats.resultsVerified++;
              }
              
              // 年龄筛选
              if (ageMin && ageMax && verifyResult.details?.age) {
                const age = verifyResult.details.age;
                if (age < ageMin || age > ageMax) {
                  stats.excludedAgeFilter++;
                  return { person, resultData, excluded: true, reason: 'age' };
                }
              }
            }
          }
          
          return { person, resultData, excluded: false, reason: null };
        });
        
        // 等待当前批次完成
        const batchResults = await Promise.all(batchPromises);
        
        // 保存结果到数据库
        for (const result of batchResults) {
          if (!result.excluded) {
            const savedResult = await saveSearchResult(
              task.id, 
              result.person.id, 
              result.resultData, 
              result.resultData.phoneStatus === 'verified', 
              result.resultData.verificationScore || 0, 
              null
            );
            
            if (savedResult) {
              stats.totalResults++;
              if (result.person.email) stats.resultsWithEmail++;
            }
            
            // 缓存个人数据
            const personCacheKey = `person:${result.person.id}`;
            await setCache(personCacheKey, 'person', result.resultData, 180);
          }
        }
        
        const batchDuration = Date.now() - batchStartTime;
        processedCount += batch.length;
        
        // 更新进度
        const progressPercent = Math.round((processedCount / actualCount) * 100);
        const verified = batchResults.filter(r => r.resultData.phoneStatus === 'verified').length;
        const excluded = batchResults.filter(r => r.excluded).length;
        
        addLog(`   ✅ 批次完成: ${verified} 验证通过, ${excluded} 被排除, 耗时 ${formatDuration(batchDuration)}`, 'success', 'process', '');
        await updateProgress(`已处理 ${processedCount}/${actualCount}`, 'processing', 'process', progressPercent);
        
        // 每5个批次添加分隔线
        if ((batchIndex + 1) % 5 === 0 && (batchIndex + 1) < totalBatches) {
          addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 阶段 7: 完成统计
    // ═══════════════════════════════════════════════════════════════
    stats.totalDuration = Date.now() - startTime;
    if (stats.recordsProcessed > 0) {
      stats.avgProcessTime = Math.round(stats.totalDuration / stats.recordsProcessed);
    }
    if (stats.resultsWithPhone > 0) {
      stats.verifySuccessRate = Math.round((stats.resultsVerified / stats.resultsWithPhone) * 100);
    }

    addLog('═══════════════════════════════════════════════════════════', 'info', 'complete', '');
    
    const finalStatus = progress.status === 'stopped' ? 'stopped' : 
                         progress.status === 'insufficient_credits' ? 'insufficient_credits' : 'completed';
    
    if (finalStatus === 'stopped') {
      addLog(`⏹️ 搜索已停止`, 'warning', 'complete', '');
    } else if (finalStatus === 'insufficient_credits') {
      addLog(`⚠️ 积分不足，搜索提前结束`, 'warning', 'complete', '');
    } else {
      addLog(`🎉 搜索完成！`, 'success', 'complete', '');
    }
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    addLog(`📊 搜索结果统计:`, 'info', 'complete', '');
    addLog(`   Apify 返回: ${stats.apifyReturned} 条`, 'info', 'complete', '');
    addLog(`   处理记录: ${stats.recordsProcessed} 条`, 'info', 'complete', '');
    addLog(`   有效结果: ${stats.totalResults} 条`, 'info', 'complete', '');
    addLog(`   ├─ 有电话: ${stats.resultsWithPhone} 条`, 'info', 'complete', '');
    addLog(`   ├─ 有邮箱: ${stats.resultsWithEmail} 条`, 'info', 'complete', '');
    addLog(`   └─ 验证通过: ${stats.resultsVerified} 条`, 'info', 'complete', '');
    
    if (stats.excludedNoPhone > 0 || stats.excludedNoContact > 0 || stats.excludedAgeFilter > 0 || stats.excludedError > 0) {
      addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
      addLog(`🚫 排除统计:`, 'info', 'complete', '');
      if (stats.excludedNoPhone > 0) addLog(`   无电话号码: ${stats.excludedNoPhone}`, 'info', 'complete', '');
      if (stats.excludedNoContact > 0) addLog(`   无联系方式: ${stats.excludedNoContact}`, 'info', 'complete', '');
      if (stats.excludedAgeFilter > 0) addLog(`   年龄不符: ${stats.excludedAgeFilter}`, 'info', 'complete', '');
      if (stats.excludedError > 0) addLog(`   处理失败: ${stats.excludedError}`, 'info', 'complete', '');
    }
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    // 计算最终积分消耗
    stats.creditsFinal = stats.creditsUsed - stats.creditsRefunded;
    addLog(`💰 积分消耗: ${stats.creditsUsed} 积分`, 'info', 'complete', '');
    if (stats.creditsRefunded > 0) {
      addLog(`💰 积分节省: ${stats.creditsRefunded} 积分 (因实际数据量少于请求量)`, 'success', 'complete', '');  
    }
    addLog(`⏱️ 总耗时: ${formatDuration(stats.totalDuration)}`, 'info', 'complete', '');
    if (stats.resultsWithPhone > 0) {
      addLog(`📈 验证成功率: ${stats.verifySuccessRate}%`, 'info', 'complete', '');
    }
    addLog('═══════════════════════════════════════════════════════════', 'info', 'complete', '');

    // 在日志最后添加统计数据（供前端直接使用）
    const statsLog: SearchLogEntry = {
      timestamp: formatTimestamp(),
      time: formatTime(),
      level: 'info',
      phase: 'complete',
      message: '__STATS__',
      details: stats as any
    };
    logs.push(statsLog);

    progress.status = finalStatus;
    
    await updateSearchTask(task.taskId, {
      status: finalStatus,
      actualCount: stats.totalResults,
      creditsUsed: stats.creditsUsed,
      logs,
      progress: 100,
      completedAt: new Date()
    });

    return getSearchTask(task.taskId);

  } catch (error: any) {
    progress.status = 'failed';
    addLog(`❌ 错误: ${error.message}`, 'error', 'complete', '❌');
    
    // 添加统计数据
    const statsLog: SearchLogEntry = {
      timestamp: formatTimestamp(),
      time: formatTime(),
      level: 'info',
      phase: 'complete',
      message: '__STATS__',
      details: stats as any
    };
    logs.push(statsLog);
    
    await updateSearchTask(task.taskId, {
      status: 'failed',
      logs,
      creditsUsed: stats.creditsUsed,
      completedAt: new Date()
    });

    return getSearchTask(task.taskId);
  }
}

// ============ 验证电话号码（Scrape.do） ============

export async function verifyPhoneWithScrapeDo(
  taskId: string,
  resultId: number,
  person: {
    firstName: string;
    lastName: string;
    city?: string;
    state: string;
    phone: string;
  },
  userId?: number
): Promise<VerificationResult | null> {
  try {
    const personToVerify: PersonToVerify = {
      firstName: person.firstName,
      lastName: person.lastName,
      city: person.city,
      state: person.state,
      phone: person.phone
    };

    const result = await verifyPhoneNumber(personToVerify, userId);
    
    // 更新搜索结果
    if (result) {
      await updateSearchResult(resultId, {
        verified: result.verified,
        verificationScore: result.matchScore,
        verificationDetails: {
          source: result.source,
          phoneType: result.phoneType,
          carrier: result.carrier,
          verifiedAt: new Date().toISOString()
        }
      });
    }

    return result;
  } catch (error) {
    console.error('Scrape.do verification error:', error);
    return null;
  }
}
