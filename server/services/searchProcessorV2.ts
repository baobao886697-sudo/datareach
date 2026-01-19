/**
 * 增强版搜索处理器 V2
 * 
 * 功能特点：
 * 1. 预览搜索 - 先获取总数和预估，用户确认后再执行
 * 2. 实时详细日志 - 每一步操作都有清晰的日志输出
 * 3. Scrape.do 二次验证 - 验证电话号码真实性
 * 4. 丰富的统计数据 - 便于用户了解搜索进度
 */

import {
  getUserById, 
  deductCredits, 
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
import { searchPeople, enrichPerson, ApolloPerson, requestPhoneNumberAsync } from './apollo';
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
  time: string; // 简短时间格式 HH:MM:SS
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  phase: 'init' | 'apollo' | 'enrich' | 'phone' | 'verify' | 'complete';
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

export interface SearchStats {
  // API 调用统计
  apolloSearchCalls: number;
  apolloEnrichCalls: number;
  apolloPhoneRequests: number;
  scrapeDoVerifyCalls: number;
  
  // 结果统计
  totalRecordsFound: number;
  recordsProcessed: number;
  validResults: number;
  
  // 电话统计
  phonesRequested: number;
  phonesReceived: number;
  phonesVerified: number;
  phonesVerifyFailed: number;
  phonesPending: number;
  
  // 排除统计
  excludedNoPhone: number;
  excludedVerifyFailed: number;
  excludedAgeFilter: number;
  excludedDuplicate: number;
  excludedError: number;
  
  // 缓存统计
  cacheHits: number;
  cacheMisses: number;
  
  // 积分统计
  creditsUsed: number;
  creditsRefunded: number;
  
  // 性能统计
  avgResponseTime: number;
  totalDuration: number;
  
  // 验证成功率
  verifySuccessRate: number;
}

export interface SearchProgress {
  taskId: string;
  status: 'initializing' | 'searching' | 'enriching' | 'requesting_phones' | 'verifying' | 'completed' | 'stopped' | 'failed' | 'insufficient_credits';
  phase: 'init' | 'apollo' | 'enrich' | 'phone' | 'verify' | 'complete';
  phaseProgress: number; // 当前阶段进度 0-100
  overallProgress: number; // 总体进度 0-100
  step: number;
  totalSteps: number;
  currentAction: string;
  currentPerson?: string;
  stats: SearchStats;
  logs: SearchLogEntry[];
  estimatedTimeRemaining?: number; // 预估剩余时间（秒）
  startTime: number;
  lastUpdateTime: number;
}

// ============ 常量定义 ============

const SEARCH_CREDITS = 1;
const PHONE_CREDITS_PER_PERSON = 2;
const VERIFY_CREDITS_PER_PHONE = 0; // 验证暂不收费
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;

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

// ============ 预览搜索 ============

export async function previewSearch(
  userId: number,
  searchName: string,
  searchTitle: string,
  searchState: string,
  requestedCount: number = 50,
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
  const cacheKey = `search:${searchHash}`;
  const cached = await getCacheByKey(cacheKey);
  
  let totalAvailable = 0;
  let cacheHit = false;

  if (cached) {
    cacheHit = true;
    const cachedData = cached.data as ApolloPerson[];
    totalAvailable = cachedData.length;
  } else {
    // 调用 Apollo API 获取总数（只获取第一页）
    try {
      const result = await searchPeople(searchName, searchTitle, searchState, 1, userId);
      if (result.success) {
        totalAvailable = result.totalCount;
      }
    } catch (error) {
      console.error('Preview search error:', error);
    }
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
      : `🔍 Apollo 返回 ${totalAvailable} 条可用记录`
  };
}

// ============ 执行搜索 V2 ============

export async function executeSearchV2(
  userId: number,
  searchName: string,
  searchTitle: string,
  searchState: string,
  requestedCount: number = 50,
  ageMin?: number,
  ageMax?: number,
  enableVerification: boolean = true,
  onProgress?: (progress: SearchProgress) => void
): Promise<SearchTask | undefined> {
  
  const startTime = Date.now();
  const logs: SearchLogEntry[] = [];
  
  const stats: SearchStats = {
    apolloSearchCalls: 0,
    apolloEnrichCalls: 0,
    apolloPhoneRequests: 0,
    scrapeDoVerifyCalls: 0,
    totalRecordsFound: 0,
    recordsProcessed: 0,
    validResults: 0,
    phonesRequested: 0,
    phonesReceived: 0,
    phonesVerified: 0,
    phonesVerifyFailed: 0,
    phonesPending: 0,
    excludedNoPhone: 0,
    excludedVerifyFailed: 0,
    excludedAgeFilter: 0,
    excludedDuplicate: 0,
    excludedError: 0,
    cacheHits: 0,
    cacheMisses: 0,
    creditsUsed: 0,
    creditsRefunded: 0,
    avgResponseTime: 0,
    totalDuration: 0,
    verifySuccessRate: 0,
  };
  
  let currentStep = 0;
  const totalSteps = requestedCount + 10; // 10个初始化/完成步骤 + 每条结果一个步骤
  
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
    enableVerification
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

  // 更新进度的辅助函数
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
    progress.stats.totalDuration = Date.now() - startTime;
    
    // 计算验证成功率
    if (stats.phonesReceived > 0) {
      stats.verifySuccessRate = Math.round((stats.phonesVerified / stats.phonesReceived) * 100);
    }
    
    // 更新数据库
    await updateSearchTask(task.taskId, { 
      logs, 
      status: progress.status as any, 
      creditsUsed: stats.creditsUsed,
      progress: progress.overallProgress
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
    addLog(`搜索任务启动 #${task.taskId.slice(0, 8)}`, 'success', 'init', '🚀');
    addLog('═══════════════════════════════════════════════════════════', 'info', 'init', '');
    addLog(`搜索条件:`, 'info', 'init', '📋');
    addLog(`  • 姓名关键词: ${searchName}`, 'info', 'init', '   ');
    addLog(`  • 职位: ${searchTitle}`, 'info', 'init', '   ');
    addLog(`  • 地区: ${searchState}`, 'info', 'init', '   ');
    addLog(`  • 请求数量: ${requestedCount} 条`, 'info', 'init', '   ');
    if (ageMin && ageMax) {
      addLog(`  • 年龄筛选: ${ageMin} - ${ageMax} 岁`, 'info', 'init', '   ');
    }
    addLog(`  • 电话验证: ${enableVerification ? '已启用' : '已禁用'}`, 'info', 'init', '   ');
    addLog(`预估消耗: ~${SEARCH_CREDITS + requestedCount * PHONE_CREDITS_PER_PERSON} 积分`, 'info', 'init', '💰');
    addLog(`当前余额: ${user.credits} 积分`, 'info', 'init', '💳');
    addLog('───────────────────────────────────────────────────────────', 'info', 'init', '');
    await updateProgress('初始化搜索任务', 'searching', 'init', 10);

    // ═══════════════════════════════════════════════════════════════
    // 阶段 2: 扣除搜索积分
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    const searchDeducted = await deductCredits(userId, SEARCH_CREDITS, 'search', `搜索: ${searchName} | ${searchTitle} | ${searchState}`, task.taskId);
    if (!searchDeducted) throw new Error('扣除搜索积分失败');
    stats.creditsUsed += SEARCH_CREDITS;
    addLog(`已扣除搜索积分: ${SEARCH_CREDITS}`, 'success', 'init', '✅', undefined, undefined, { creditsUsed: SEARCH_CREDITS });
    await updateProgress('扣除搜索积分', undefined, undefined, 20);

    // ═══════════════════════════════════════════════════════════════
    // 阶段 3: 检查缓存 / 调用 Apollo API
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    const cacheKey = `search:${searchHash}`;
    const cached = await getCacheByKey(cacheKey);
    
    let apolloResults: ApolloPerson[] = [];
    
    if (cached) {
      stats.cacheHits++;
      addLog(`命中全局缓存！跳过 Apollo API 调用`, 'success', 'apollo', '✨');
      apolloResults = cached.data as ApolloPerson[];
      stats.totalRecordsFound = apolloResults.length;
      addLog(`缓存中有 ${apolloResults.length} 条记录`, 'info', 'apollo', '📦');
    } else {
      stats.cacheMisses++;
      addLog(`正在调用 Apollo API 搜索...`, 'info', 'apollo', '🔍');
      await updateProgress('调用 Apollo API', 'searching', 'apollo', 30);
      
      const apiStartTime = Date.now();
      stats.apolloSearchCalls++;
      
      const searchResult = await searchPeople(searchName, searchTitle, searchState, requestedCount * 2, userId);
      const apiDuration = Date.now() - apiStartTime;
      
      await logApi('apollo_search', '/people/search', params, searchResult.success ? 200 : 500, apiDuration, searchResult.success, searchResult.errorMessage, 0, userId);

      if (!searchResult.success || !searchResult.people) {
        throw new Error(searchResult.errorMessage || 'Apollo 搜索失败');
      }

      apolloResults = searchResult.people;
      stats.totalRecordsFound = apolloResults.length;
      addLog(`Apollo API 返回 ${apolloResults.length} 条基础数据`, 'success', 'apollo', '📋', undefined, undefined, { duration: apiDuration });
      addLog(`API 响应时间: ${formatDuration(apiDuration)}`, 'debug', 'apollo', '⏱️');

      // 缓存搜索结果 180天
      await setCache(cacheKey, 'search', apolloResults, 180);
      addLog(`已缓存搜索结果 (180天有效)`, 'info', 'apollo', '💾');
    }

    await updateProgress('处理搜索结果', undefined, 'apollo', 50);

    if (apolloResults.length === 0) {
      addLog(`未找到匹配结果`, 'warning', 'complete', '⚠️');
      progress.status = 'completed';
      await updateProgress('搜索完成', 'completed', 'complete', 100);
      return getSearchTask(task.taskId);
    }

    // ═══════════════════════════════════════════════════════════════
    // 阶段 4: 打乱顺序并准备处理
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    const shuffledResults = shuffleArray(apolloResults);
    addLog(`已打乱数据顺序，采用跳动提取策略`, 'info', 'enrich', '🔀');
    addLog('───────────────────────────────────────────────────────────', 'info', 'enrich', '');
    addLog(`开始逐条处理数据...`, 'info', 'enrich', '📊');
    addLog('───────────────────────────────────────────────────────────', 'info', 'enrich', '');

    // ═══════════════════════════════════════════════════════════════
    // 阶段 5: 逐条处理数据
    // ═══════════════════════════════════════════════════════════════
    const toProcess = shuffledResults.slice(0, requestedCount);
    let processedCount = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const person = toProcess[i];
      currentStep++;
      processedCount++;
      stats.recordsProcessed++;
      
      const personName = `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown';
      progress.currentPerson = personName;
      
      // 检查任务是否被停止
      const currentTask = await getSearchTask(task.taskId);
      if (currentTask?.status === 'stopped') {
        addLog(`任务已被用户停止`, 'warning', 'complete', '⏹️');
        progress.status = 'stopped';
        break;
      }
      
      // 检查积分
      const currentUser = await getUserById(userId);
      if (!currentUser || currentUser.credits < PHONE_CREDITS_PER_PERSON) {
        addLog(`积分不足，停止获取。需要 ${PHONE_CREDITS_PER_PERSON} 积分，当前 ${currentUser?.credits || 0}`, 'warning', 'complete', '⚠️');
        progress.status = 'insufficient_credits';
        break;
      }

      // 扣除积分
      const deducted = await deductCredits(userId, PHONE_CREDITS_PER_PERSON, 'search', `获取电话: ${personName}`, task.taskId);
      if (!deducted) {
        addLog(`扣除积分失败`, 'error', 'enrich', '❌');
        stats.excludedError++;
        continue;
      }
      stats.creditsUsed += PHONE_CREDITS_PER_PERSON;

      // 显示处理进度
      const progressPercent = Math.round((processedCount / requestedCount) * 100);
      addLog(`[${processedCount}/${requestedCount}] 正在处理: ${personName}`, 'info', 'enrich', '🔍', processedCount, requestedCount);
      await updateProgress(`处理 ${personName}`, 'enriching', 'enrich', progressPercent);

      // 获取详细信息
      const enrichStartTime = Date.now();
      stats.apolloEnrichCalls++;
      const enrichedPerson = await enrichPerson(person.id, userId);
      const enrichDuration = Date.now() - enrichStartTime;
      
      await logApi('apollo_enrich', '/people/match', { id: person.id }, enrichedPerson ? 200 : 500, enrichDuration, !!enrichedPerson, undefined, PHONE_CREDITS_PER_PERSON, userId);

      if (!enrichedPerson) {
        stats.excludedError++;
        addLog(`[${processedCount}/${requestedCount}] ${personName} - 获取详情失败`, 'warning', 'enrich', '⚠️', processedCount, requestedCount, { name: personName, reason: '获取详情失败' });
        continue;
      }

      // 年龄筛选
      // TODO: 如果有年龄数据，进行筛选

      // 构建结果数据
      const resultData = {
        apolloId: enrichedPerson.id,
        firstName: enrichedPerson.first_name,
        lastName: enrichedPerson.last_name,
        fullName: `${enrichedPerson.first_name} ${enrichedPerson.last_name}`,
        title: enrichedPerson.title,
        company: enrichedPerson.organization_name,
        city: enrichedPerson.city,
        state: enrichedPerson.state,
        country: enrichedPerson.country,
        email: enrichedPerson.email,
        phone: null as string | null,
        phoneStatus: 'pending' as 'pending' | 'received' | 'verified' | 'no_phone' | 'failed',
        phoneType: null as string | null,
        linkedinUrl: enrichedPerson.linkedin_url,
        age: null as number | null,
        carrier: null as string | null,
        verificationSource: null as string | null,
        verificationScore: null as number | null,
        verifiedAt: null as Date | null,
      };

      // 保存结果到数据库
      const savedResult = await saveSearchResult(task.id, enrichedPerson.id, resultData, false, 0, null);
      
      if (savedResult) {
        stats.validResults++;
        stats.phonesPending++;
        
        // 显示邮箱信息
        if (enrichedPerson.email) {
          addLog(`[${processedCount}/${requestedCount}] ${personName}`, 'success', 'enrich', '📧', processedCount, requestedCount, { 
            name: personName, 
            email: enrichedPerson.email,
            company: enrichedPerson.organization_name 
          });
          addLog(`    邮箱: ${enrichedPerson.email}`, 'info', 'enrich', '   ');
          if (enrichedPerson.organization_name) {
            addLog(`    公司: ${enrichedPerson.organization_name}`, 'info', 'enrich', '   ');
          }
        } else {
          addLog(`[${processedCount}/${requestedCount}] ${personName} - 无邮箱`, 'info', 'enrich', '📧', processedCount, requestedCount);
        }
        
        // 异步请求电话号码
        addLog(`[${processedCount}/${requestedCount}] 正在异步获取电话号码...`, 'info', 'phone', '📱', processedCount, requestedCount);
        stats.apolloPhoneRequests++;
        stats.phonesRequested++;
        
        const phoneRequested = await requestPhoneNumberAsync(
          enrichedPerson.id,
          task.taskId,
          enrichedPerson,
          userId
        );
        
        if (phoneRequested) {
          addLog(`[${processedCount}/${requestedCount}] 电话号码请求已发送`, 'success', 'phone', '✅', processedCount, requestedCount);
        } else {
          addLog(`[${processedCount}/${requestedCount}] 电话号码请求失败`, 'warning', 'phone', '⚠️', processedCount, requestedCount);
        }
      }

      // 缓存个人数据
      const personCacheKey = `person:${enrichedPerson.id}`;
      await setCache(personCacheKey, 'person', resultData, 180);

      // 添加分隔线（每5条）
      if (processedCount % 5 === 0 && processedCount < requestedCount) {
        addLog('───────────────────────────────────────────────────────────', 'info', 'enrich', '');
      }

      await updateProgress();
    }

    // ═══════════════════════════════════════════════════════════════
    // 阶段 6: 完成
    // ═══════════════════════════════════════════════════════════════
    addLog('═══════════════════════════════════════════════════════════', 'info', 'complete', '');
    
    const finalStatus = progress.status === 'stopped' ? 'stopped' : 
                         progress.status === 'insufficient_credits' ? 'insufficient_credits' : 'completed';
    
    if (finalStatus === 'stopped') {
      addLog(`搜索已停止`, 'warning', 'complete', '⏹️');
    } else if (finalStatus === 'insufficient_credits') {
      addLog(`积分不足，搜索提前结束`, 'warning', 'complete', '⚠️');
    } else {
      addLog(`基础搜索完成！`, 'success', 'complete', '🎉');
    }
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    addLog(`📊 搜索结果统计:`, 'info', 'complete', '');
    addLog(`   • Apollo 返回: ${stats.totalRecordsFound} 条`, 'info', 'complete', '');
    addLog(`   • 处理记录: ${stats.recordsProcessed} 条`, 'info', 'complete', '');
    addLog(`   • 有效结果: ${stats.validResults} 条`, 'info', 'complete', '');
    addLog(`   • 电话待获取: ${stats.phonesPending} 条`, 'info', 'complete', '');
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    addLog(`💰 积分消耗: ${stats.creditsUsed}`, 'info', 'complete', '');
    addLog(`⏱️ 总耗时: ${formatDuration(Date.now() - startTime)}`, 'info', 'complete', '');
    addLog('═══════════════════════════════════════════════════════════', 'info', 'complete', '');
    
    if (stats.phonesPending > 0) {
      addLog(`📱 电话号码正在后台异步获取中，请稍候刷新查看...`, 'info', 'complete', '');
    }
    
    if (stats.excludedError > 0 || stats.excludedNoPhone > 0) {
      addLog(`🚫 排除统计:`, 'info', 'complete', '');
      if (stats.excludedError > 0) addLog(`   • 获取失败: ${stats.excludedError}`, 'info', 'complete', '');
      if (stats.excludedNoPhone > 0) addLog(`   • 无电话: ${stats.excludedNoPhone}`, 'info', 'complete', '');
      if (stats.excludedAgeFilter > 0) addLog(`   • 年龄不符: ${stats.excludedAgeFilter}`, 'info', 'complete', '');
    }

    progress.status = finalStatus;
    stats.totalDuration = Date.now() - startTime;
    
    await updateSearchTask(task.taskId, {
      status: finalStatus,
      actualCount: stats.validResults,
      creditsUsed: stats.creditsUsed,
      logs,
      progress: 100,
      completedAt: new Date()
    });

    return getSearchTask(task.taskId);

  } catch (error: any) {
    progress.status = 'failed';
    addLog(`错误: ${error.message}`, 'error', 'complete', '❌');
    
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
        verificationSource: result.source,
        data: {
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
