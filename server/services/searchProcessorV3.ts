
/**
 * 搜索处理器 V3 - 双模式版
 */
import {
  getUserById, 
  deductCredits,
  addCredits,
  freezeCreditsLinkedIn,
  settleCreditsLinkedIn,
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
import { brightdataSearchPeople } from './brightdata';
import { verifyPhoneNumber, PersonToVerify, VerificationResult } from './scraper';
import { SearchTask, users } from '../../drizzle/schema';
import { getDb } from '../db';
import { sql, eq } from 'drizzle-orm';
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
    mode?: 'fuzzy' | 'exact';
  };
  cacheHit: boolean;
  message: string;
}

export interface SearchLogEntry {
  timestamp: string;
  time: string;
  level: 'info' | 'success' | 'warning' | 'error' | 'debug';
  phase: 'init' | 'search' | 'process' | 'verify' | 'complete';
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
  apifyApiCalls: number;
  verifyApiCalls: number;
  apifyReturned: number;
  recordsProcessed: number;
  totalResults: number;
  resultsWithPhone: number;
  resultsWithEmail: number;
  resultsVerified: number;
  excludedNoPhone: number;
  excludedNoContact: number;
  excludedAgeFilter: number;
  excludedError: number;
  excludedApiError: number;
  creditsUsed: number;
  creditsRefunded: number;
  creditsFinal: number;
  totalDuration: number;
  avgProcessTime: number;
  verifySuccessRate: number;
  apiCreditsExhausted: boolean;
  unprocessedCount: number;
}

export interface SearchProgress {
  taskId: string;
  status: 'initializing' | 'searching' | 'processing' | 'verifying' | 'completed' | 'stopped' | 'failed' | 'insufficient_credits';
  phase: 'init' | 'search' | 'process' | 'verify' | 'complete';
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

export interface SearchCacheData {
  data: LeadPerson[];
  totalAvailable: number;
  requestedCount: number;
  searchParams: {
    name: string;
    title: string;
    state: string;
    limit: number;
  };
  createdAt: string;
}

// ============ 常量定义 ============

// 默认积分值（当数据库配置不存在时使用）
const DEFAULT_FUZZY_SEARCH_CREDITS = 1;
const DEFAULT_FUZZY_PHONE_CREDITS_PER_PERSON = 2;
const DEFAULT_EXACT_SEARCH_CREDITS = 5;
const DEFAULT_EXACT_PHONE_CREDITS_PER_PERSON = 10;
const VERIFY_CREDITS_PER_PHONE = 0;
const CONCURRENT_VERIFY_LIMIT = 5;
const CACHE_FULFILLMENT_THRESHOLD = 0.8;

// 配置键名常量
export const CONFIG_KEYS = {
  FUZZY_SEARCH_CREDITS: 'FUZZY_SEARCH_CREDITS',
  FUZZY_CREDITS_PER_PERSON: 'FUZZY_CREDITS_PER_PERSON',
  EXACT_SEARCH_CREDITS: 'EXACT_SEARCH_CREDITS',
  EXACT_CREDITS_PER_PERSON: 'EXACT_CREDITS_PER_PERSON',
};

// 获取积分配置的辅助函数
export async function getSearchCreditsConfig() {
  const [fuzzySearch, fuzzyPerPerson, exactSearch, exactPerPerson] = await Promise.all([
    getConfig(CONFIG_KEYS.FUZZY_SEARCH_CREDITS),
    getConfig(CONFIG_KEYS.FUZZY_CREDITS_PER_PERSON),
    getConfig(CONFIG_KEYS.EXACT_SEARCH_CREDITS),
    getConfig(CONFIG_KEYS.EXACT_CREDITS_PER_PERSON),
  ]);
  
  return {
    fuzzySearchCredits: fuzzySearch ? parseInt(fuzzySearch, 10) : DEFAULT_FUZZY_SEARCH_CREDITS,
    fuzzyCreditsPerPerson: fuzzyPerPerson ? parseInt(fuzzyPerPerson, 10) : DEFAULT_FUZZY_PHONE_CREDITS_PER_PERSON,
    exactSearchCredits: exactSearch ? parseInt(exactSearch, 10) : DEFAULT_EXACT_SEARCH_CREDITS,
    exactCreditsPerPerson: exactPerPerson ? parseInt(exactPerPerson, 10) : DEFAULT_EXACT_PHONE_CREDITS_PER_PERSON,
  };
}

// ============ 工具函数 ============

function generateSearchHash(name: string, title: string, state: string, limit: number): string {
  const normalized = `${name.toLowerCase().trim()}|${title.toLowerCase().trim()}|${state.toLowerCase().trim()}|${limit}`;
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
    excludedApiError: 0,
    creditsUsed: 0,
    creditsRefunded: 0,
    creditsFinal: 0,
    totalDuration: 0,
    avgProcessTime: 0,
    verifySuccessRate: 0,
    apiCreditsExhausted: false,
    unprocessedCount: 0,
  };
}

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
  ageMax?: number,
  mode: 'fuzzy' | 'exact' = 'fuzzy'
): Promise<SearchPreviewResult> {
  // 从数据库获取积分配置
  const creditsConfig = await getSearchCreditsConfig();
  const searchCredits = mode === 'fuzzy' ? creditsConfig.fuzzySearchCredits : creditsConfig.exactSearchCredits;
  const phoneCreditsPerPerson = mode === 'fuzzy' ? creditsConfig.fuzzyCreditsPerPerson : creditsConfig.exactCreditsPerPerson;
  const user = await getUserById(userId);
  if (!user) {
    return {
      success: false,
      totalAvailable: 0,
      estimatedCredits: 0,
      searchCredits: searchCredits,
      phoneCreditsPerPerson: phoneCreditsPerPerson,
      canAfford: false,
      userCredits: 0,
      maxAffordable: 0,
      searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount, ageMin, ageMax, mode },
      cacheHit: false,
      message: '用户不存在'
    };
  }

  const searchHash = generateSearchHash(searchName, searchTitle, searchState, requestedCount);
  // 缓存键与 executeSearchV3 保持一致
  const cacheKey = `search:${mode}:${searchHash}`;
  const cached = mode === 'fuzzy' ? await getCacheByKey(cacheKey) : null;
  
  let totalAvailable = 0;
  let cacheHit = false;
  let cacheMessage = '';

  if (cached) {
    let cachedSearchData: SearchCacheData;
    if (cached.data && typeof cached.data === 'object' && 'totalAvailable' in cached.data) {
      cachedSearchData = cached.data as SearchCacheData;
    } else {
      const oldData = cached.data as LeadPerson[];
      cachedSearchData = {
        data: oldData,
        totalAvailable: oldData.length,
        requestedCount: requestedCount,
        searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount },
        createdAt: new Date().toISOString()
      };
    }
    
    const fulfillmentRate = cachedSearchData.data.length / cachedSearchData.totalAvailable;
    
    if (fulfillmentRate >= CACHE_FULFILLMENT_THRESHOLD) {
      cacheHit = true;
      totalAvailable = Math.min(cachedSearchData.data.length, requestedCount);
      cacheMessage = `✨ 命中缓存！找到 ${cachedSearchData.data.length} 条记录（充足率 ${Math.round(fulfillmentRate * 100)}% >= 80%）`;
    } else {
      cacheHit = false;
      totalAvailable = requestedCount;
      cacheMessage = `🔍 缓存数据不足（${cachedSearchData.data.length}/${cachedSearchData.totalAvailable}，${Math.round(fulfillmentRate * 100)}% < 80%），将重新获取`;
    }
  } else {
    totalAvailable = requestedCount;
    cacheMessage = mode === 'fuzzy' ? `🔍 无缓存，预估可获取 ${totalAvailable} 条记录` : `🎯 精准搜索模式，将实时获取 ${totalAvailable} 条记录`;
  }

  const estimatedCredits = searchCredits + totalAvailable * phoneCreditsPerPerson;
  const canAfford = user.credits >= estimatedCredits;
  const maxAffordable = Math.floor((user.credits - searchCredits) / phoneCreditsPerPerson);

  return {
    success: true,
    totalAvailable,
    estimatedCredits,
    searchCredits,
    phoneCreditsPerPerson,
    canAfford,
    userCredits: user.credits,
    maxAffordable: Math.max(0, maxAffordable),
    searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount, ageMin, ageMax, mode },
    cacheHit,
    message: cacheMessage,
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
  mode: 'fuzzy' | 'exact' = 'fuzzy',
  onProgress?: (progress: SearchProgress) => void
): Promise<SearchTask | undefined> {
  // 从数据库获取积分配置
  const creditsConfig = await getSearchCreditsConfig();
  const currentSearchCredits = mode === 'fuzzy' ? creditsConfig.fuzzySearchCredits : creditsConfig.exactSearchCredits;
  const currentPhoneCreditsPerPerson = mode === 'fuzzy' ? creditsConfig.fuzzyCreditsPerPerson : creditsConfig.exactCreditsPerPerson;
  
  const startTime = Date.now();
  const logs: SearchLogEntry[] = [];
  const stats = createInitialStats();
  
  let currentStep = 0;
  const totalSteps = requestedCount + 10;
  
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

  const user = await getUserById(userId);
  if (!user) throw new Error('用户不存在');

  // ==================== 预扣费机制 ====================
  // 计算最大预估费用（搜索费 + 最大数据费）
  const maxEstimatedCost = currentSearchCredits + requestedCount * currentPhoneCreditsPerPerson;
  
  // 检查积分是否足够
  const userCreditsVal = parseFloat(String(user.credits)) || 0;
  if (userCreditsVal < maxEstimatedCost) {
    throw new Error(`积分不足，预估最大消耗 ${maxEstimatedCost} 积分（搜索费 ${currentSearchCredits} + 数据费 ${requestedCount} × ${currentPhoneCreditsPerPerson}），当前余额 ${userCreditsVal} 积分`);
  }

  const searchHash = generateSearchHash(searchName, searchTitle, searchState, requestedCount);
  const params = { 
    name: searchName, 
    title: searchTitle, 
    state: searchState,
    limit: requestedCount,
    ageMin,
    ageMax,
    enableVerification,
    dataSource: mode === 'fuzzy' ? 'apify' : 'brightdata',
    mode
  };

  const task = await createSearchTask(userId, searchHash, params, requestedCount);
  if (!task) throw new Error('创建搜索任务失败');

  // ==================== 执行预扣费 ====================
  const freezeResult = await freezeCreditsLinkedIn(userId, maxEstimatedCost, task.taskId);
  if (!freezeResult.success) {
    throw new Error(freezeResult.message);
  }
  const frozenAmount = freezeResult.frozenAmount;

  const progress: SearchProgress = {
    taskId: task.taskId,
    status: 'initializing',
    phase: 'init',
    phaseProgress: 0,
    overallProgress: 0,
    step: 0,
    totalSteps: 7,
    currentAction: '初始化',
    stats: stats,
    logs: logs,
    startTime: startTime,
    lastUpdateTime: startTime,
  };

  const mapStatusToDbStatus = (status: SearchProgress['status']) => {
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'stopped') return 'stopped';
    return 'running';
  };

  const updateProgress = async (action: string, status?: SearchProgress['status'], phase?: SearchProgress['phase'], overall?: number) => {
    progress.currentAction = action;
    if (status) progress.status = status;
    if (phase) progress.phase = phase;
    if (overall) progress.overallProgress = overall;
    progress.lastUpdateTime = Date.now();
    
    stats.totalDuration = Date.now() - startTime;
    if (stats.recordsProcessed > 0) {
      stats.avgProcessTime = Math.round(stats.totalDuration / stats.recordsProcessed);
    }
    
    const dbStatus = mapStatusToDbStatus(progress.status);
    await updateSearchTask(task.taskId, { 
      logs, 
      status: dbStatus as any, 
      creditsUsed: stats.creditsUsed,
      progress: progress.overallProgress,
    });
    
    onProgress?.(progress);
  };

  try {
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
    addLog(`   搜索模式: ${mode === 'fuzzy' ? '模糊搜索' : '精准搜索'}`, 'info', 'init', '');
    addLog('───────────────────────────────────────────────────────────', 'info', 'init', '');
    addLog(`💰 积分信息:`, 'info', 'init', '');
    addLog(`   当前余额: ${user.credits} 积分`, 'info', 'init', '');
    addLog(`   预估消耗: ${currentSearchCredits + requestedCount * currentPhoneCreditsPerPerson} 积分`, 'info', 'init', '');
    addLog(`   (搜索费 ${currentSearchCredits} + 数据费 ${requestedCount} × ${currentPhoneCreditsPerPerson})`, 'info', 'init', '');
    addLog('═══════════════════════════════════════════════════════════', 'info', 'init', '');
    await updateProgress('初始化搜索任务', 'searching', 'init', 10);

    // ==================== 预扣费已完成，显示信息 ====================
    currentStep++;
    const modeLabel = mode === 'fuzzy' ? '模糊搜索' : '精准搜索';
    addLog(`💰 预扣费机制已启用`, 'info', 'init', '');
    addLog(`   ✅ 已预扣: ${frozenAmount} 积分`, 'success', 'init', '✅');
    addLog(`   💡 任务完成后将按实际消耗结算，多扣的积分会退还`, 'info', 'init', '');
    await updateProgress('预扣费完成', undefined, undefined, 20);

    currentStep++;
    addLog('───────────────────────────────────────────────────────────', 'info', 'search', '');
    // 根据模式动态生成缓存键前缀
    const cacheKey = `search:${mode}:${searchHash}`;
    const cached = mode === 'fuzzy' ? await getCacheByKey(cacheKey) : null;
    
    let searchResults: LeadPerson[] = [];
    
    if (cached) {
      let cachedSearchData: SearchCacheData;
      if (cached.data && typeof cached.data === 'object' && 'totalAvailable' in cached.data) {
        cachedSearchData = cached.data as SearchCacheData;
      } else {
        const oldData = cached.data as LeadPerson[];
        cachedSearchData = {
          data: oldData,
          totalAvailable: oldData.length,
          requestedCount: requestedCount,
          searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount },
          createdAt: new Date().toISOString()
        };
      }
      
      const fulfillmentRate = cachedSearchData.data.length / cachedSearchData.totalAvailable;
      
      addLog(`📊 检查缓存: ${searchName} + ${searchTitle} + ${searchState} + ${requestedCount}`, 'info', 'search', '');
      addLog(`   缓存数据量: ${cachedSearchData.data.length} 条`, 'info', 'search', '');
      addLog(`   LinkedIn 数据库估计: ${cachedSearchData.totalAvailable} 条`, 'info', 'search', '');
      addLog(`   数据充足率: ${Math.round(fulfillmentRate * 100)}%`, 'info', 'search', '');
      
      if (fulfillmentRate >= CACHE_FULFILLMENT_THRESHOLD) {
        addLog(`✨ 缓存命中！数据充足率 ${Math.round(fulfillmentRate * 100)}% >= 80%`, 'success', 'search', '✨');
        const shuffledCache = shuffleArray([...cachedSearchData.data]);
        searchResults = shuffledCache.slice(0, Math.min(requestedCount, shuffledCache.length));
        stats.apifyReturned = searchResults.length;
        addLog(`🎲 已随机提取 ${searchResults.length} 条记录`, 'info', 'search', '');
        addLog(`⏭️ 跳过 LinkedIn API 调用，节省时间和成本`, 'info', 'search', '');
      } else {
        addLog(`⚠️ 缓存数据不足！充足率 ${Math.round(fulfillmentRate * 100)}% < 80%`, 'warning', 'search', '⚠️');
        addLog(`🔄 需要重新调用 LinkedIn API 获取最新数据...`, 'info', 'search', '');
        // Fall through to API call
      }
    }

    if (searchResults.length === 0) {
      if (mode === 'fuzzy') {
        stats.apifyApiCalls++;
        addLog(`🔍 正在调用 LinkedIn Leads Finder (Apify)...`, 'info', 'search', '');
        addLog(`⏳ LinkedIn 数据获取中，请耐心等待...`, 'info', 'search', '');
        addLog(`   (通常需要 1-3 分钟，取决于数据量)`, 'info', 'search', '');
        await updateProgress('调用 LinkedIn API', 'searching', 'search', 30);
        
        const apiStartTime = Date.now();
        const apifyResult = await apifySearchPeople(searchName, searchTitle, searchState, requestedCount, userId);
        const apiDuration = Date.now() - apiStartTime;

        if (!apifyResult.success || !apifyResult.people) {
          throw new Error(apifyResult.errorMessage || 'LinkedIn 搜索失败');
        }

        searchResults = apifyResult.people;
        stats.apifyReturned = searchResults.length;
        addLog(`✅ LinkedIn 返回 ${searchResults.length} 条数据`, 'success', 'search', '✅');
        addLog(`⏱️ API 响应时间: ${formatDuration(apiDuration)}`, 'info', 'search', '');

        const newCacheData: SearchCacheData = {
          data: searchResults,
          totalAvailable: searchResults.length,
          requestedCount: requestedCount,
          searchParams: { name: searchName, title: searchTitle, state: searchState, limit: requestedCount },
          createdAt: new Date().toISOString()
        };
        await setCache(cacheKey, 'search', newCacheData, 180);
        addLog(`💾 已更新缓存 (180天有效)`, 'info', 'search', '');
      } else {
        addLog(`🎯 正在执行精准搜索 (Bright Data + PDL)...`, 'info', 'search', '');
        await updateProgress('调用精准搜索 API', 'searching', 'search', 30);

        const apiStartTime = Date.now();
        searchResults = await brightdataSearchPeople(searchName, searchTitle, searchState, requestedCount);
        const apiDuration = Date.now() - apiStartTime;

        stats.apifyReturned = searchResults.length;
        addLog(`✅ 精准搜索返回 ${searchResults.length} 条数据`, 'success', 'search', '✅');
        addLog(`⏱️ API 响应时间: ${formatDuration(apiDuration)}`, 'info', 'search', '');
      }
    }

    await updateProgress('处理搜索结果', undefined, 'search', 50);

    if (searchResults.length === 0) {
      addLog(`⚠️ 未找到匹配的结果`, 'warning', 'complete', '⚠️');
      addLog(`   请尝试调整搜索条件后重试`, 'info', 'complete', '');
      
      // ==================== 预扣费机制：无结果时的结算 ====================
      if (mode === 'exact') {
        // 精准搜索无结果，实际消耗为0，退还全部预扣积分
        stats.creditsUsed = 0;
        addLog(`💰 精准搜索无结果，将退还全部预扣积分`, 'info', 'complete', '');
      } else {
        // 模糊搜索无结果，仍收取搜索基础费
        stats.creditsUsed = currentSearchCredits;
        addLog(`💰 模糊搜索无结果，收取搜索基础费 ${currentSearchCredits} 积分`, 'info', 'complete', '');
      }
      
      // 结算退还
      const settlement = await settleCreditsLinkedIn(userId, frozenAmount, stats.creditsUsed, task.taskId);
      addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
      addLog(`💰 费用结算:`, 'info', 'complete', '');
      addLog(`   • 预扣积分: ${frozenAmount} 积分`, 'info', 'complete', '');
      addLog(`   • 实际消耗: ${stats.creditsUsed} 积分`, 'info', 'complete', '');
      if (settlement.refundAmount > 0) {
        addLog(`   • ✅ 已退还: ${settlement.refundAmount} 积分`, 'success', 'complete', '✅');
      }
      addLog(`   • 当前余额: ${settlement.newBalance} 积分`, 'info', 'complete', '');
      
      progress.status = 'completed';
      await updateProgress('搜索完成', 'completed', 'complete', 100);
      return getSearchTask(task.taskId);
    }

    currentStep++;
    const actualCount = Math.min(searchResults.length, requestedCount);
    const dataCreditsNeeded = actualCount * currentPhoneCreditsPerPerson;
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
    addLog(`📊 数据量计算:`, 'info', 'process', '');
    addLog(`   用户请求: ${requestedCount} 条`, 'info', 'process', '');
    addLog(`   实际返回: ${searchResults.length} 条`, 'info', 'process', '');
    addLog(`   可处理数量: ${actualCount} 条`, 'info', 'process', '');
    
    // ==================== 预扣费机制：不再中途扣费，只统计实际消耗 ====================
    // 记录实际数据费用（用于最终结算）
    stats.creditsUsed = currentSearchCredits + dataCreditsNeeded;
    
    addLog(`💰 预估实际消耗:`, 'info', 'process', '');
    addLog(`   搜索费: ${currentSearchCredits} 积分`, 'info', 'process', '');
    addLog(`   数据费: ${actualCount} 条 × ${currentPhoneCreditsPerPerson} = ${dataCreditsNeeded} 积分`, 'info', 'process', '');
    addLog(`   预估总计: ${stats.creditsUsed} 积分`, 'info', 'process', '');
    addLog(`   💡 已预扣 ${frozenAmount} 积分，任务完成后结算退还`, 'info', 'process', '');
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
    
    const shuffledResults = shuffleArray(searchResults);
    addLog(`🔀 已打乱数据顺序，采用随机提取策略`, 'info', 'process', '');
    addLog(`📊 开始逐条处理数据...`, 'info', 'process', '');
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');

    const toProcess = shuffledResults.slice(0, actualCount);
    const CONCURRENT_BATCH_SIZE = 16;
    
    addLog(`🚀 启用并发处理模式，并发数: ${CONCURRENT_BATCH_SIZE}`, 'info', 'process', '');
    
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
        dataSource: mode === 'fuzzy' ? 'apify' : 'brightdata',
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
    
    let taskStopped = false;
    const currentTaskCheck = await getSearchTask(task.taskId);
    if (currentTaskCheck?.status === 'stopped') {
      addLog(`⏹️ 任务已被用户停止`, 'warning', 'complete', '⏹️');
      progress.status = 'stopped';
      taskStopped = true;
    }
    
    if (!taskStopped && recordsWithPhone.length > 0) {
      addLog(`🔄 开始并发验证 ${recordsWithPhone.length} 条有电话记录...`, 'info', 'verify', '');
      addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
      
      const totalBatches = Math.ceil(recordsWithPhone.length / CONCURRENT_BATCH_SIZE);
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
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
        
        let apiCreditsExhausted = false;
        
        const batchPromises = batch.map(async (person, indexInBatch) => {
          const globalIndex = processedCount + indexInBatch + 1;
          stats.recordsProcessed++;
          
          const personName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown';
          
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
            dataSource: mode === 'fuzzy' ? 'apify' : 'brightdata',
          };
          
          stats.resultsWithPhone++;
          
          if (enableVerification) {
            // 使用用户指定的年龄范围，如果未指定则使用默认值 50-79
            const effectiveMinAge = ageMin || 50;
            const effectiveMaxAge = ageMax || 79;
            
            const personToVerify: PersonToVerify = {
              firstName: person.first_name || '',
              lastName: person.last_name || '',
              city: person.city || '',
              state: person.state || '',
              phone: phoneNumber,
              minAge: effectiveMinAge,
              maxAge: effectiveMaxAge
            };
            
            stats.verifyApiCalls++;
            const verifyResult = await verifyPhoneNumber(personToVerify, userId);
            
            if (verifyResult) {
              if (verifyResult.apiError === 'INSUFFICIENT_CREDITS') {
                apiCreditsExhausted = true;
                stats.excludedApiError++;
                return { person, resultData, excluded: true, reason: 'api_credits_exhausted', apiError: true };
              }
              
              resultData.verificationScore = verifyResult.matchScore;
              resultData.verificationSource = verifyResult.source;
              resultData.age = verifyResult.details?.age || null;
              resultData.carrier = verifyResult.details?.carrier || null;
              
              if (verifyResult.verified) {
                resultData.phoneStatus = 'verified';
                resultData.verifiedAt = new Date();
                stats.resultsVerified++;
              }
              
              if (ageMin && ageMax && verifyResult.details?.age) {
                const age = verifyResult.details.age;
                if (age < ageMin || age > ageMax) {
                  stats.excludedAgeFilter++;
                  return { person, resultData, excluded: true, reason: 'age', apiError: false };
                }
              }
            }
          }
          
          return { person, resultData, excluded: false, reason: null, apiError: false };
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        const apiErrorResults = batchResults.filter(r => r.apiError);
        if (apiErrorResults.length > 0) {
          apiCreditsExhausted = true;
          stats.apiCreditsExhausted = true;
        }
        
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
            
            const personCacheKey = `person:${result.person.id}`;
            await setCache(personCacheKey, 'person', result.resultData, 180);
          }
        }
        
        const batchDuration = Date.now() - batchStartTime;
        processedCount += batch.length;
        
        const progressPercent = Math.round((processedCount / actualCount) * 100);
        const verified = batchResults.filter(r => r.resultData.phoneStatus === 'verified').length;
        const excluded = batchResults.filter(r => r.excluded).length;
        
        addLog(`   ✅ 批次完成: ${verified} 验证通过, ${excluded} 被排除, 耗时 ${formatDuration(batchDuration)}`, 'success', 'process', '');
        await updateProgress(`已处理 ${processedCount}/${actualCount}`, 'processing', 'process', progressPercent);
        
        if (apiCreditsExhausted) {
          addLog('', 'info', 'process', '');
          addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'error', 'process', '');
          addLog('⚠️ 当前使用人数过多，服务繁忙，搜索提前结束', 'error', 'process', '');
          addLog('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'error', 'process', '');
          addLog('📌 已验证的数据已保存，您可以导出已完成的结果', 'warning', 'process', '');
          addLog('📞 请联系客服处理', 'warning', 'process', '');
          addLog('', 'info', 'process', '');
          
          // ==================== 预扣费机制：更新实际消耗统计 ====================
          const unprocessedCount = actualCount - processedCount;
          // 重新计算实际消耗（搜索费 + 已处理的数据费）
          stats.creditsUsed = currentSearchCredits + processedCount * currentPhoneCreditsPerPerson;
          stats.unprocessedCount = unprocessedCount;
          addLog(`💰 实际消耗已更新: ${stats.creditsUsed} 积分（未处理 ${unprocessedCount} 条）`, 'info', 'process', '');
          addLog(`💡 任务结束后将统一结算退还多扣的积分`, 'info', 'process', '');
          
          progress.status = 'stopped';
          break;
        }
        
        if ((batchIndex + 1) % 5 === 0 && (batchIndex + 1) < totalBatches) {
          addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
        }
      }
    }

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
      addLog(`⏹️ 搜索已停止`, 'warning', 'complete', '⏹️');
    } else if (finalStatus === 'insufficient_credits') {
      addLog(`⚠️ 积分不足，搜索提前结束`, 'warning', 'complete', '⚠️');
    } else {
      addLog(`🎉 搜索完成！`, 'success', 'complete', '');
    }
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    addLog(`📊 搜索结果统计:`, 'info', 'complete', '');
    addLog(`   LinkedIn 返回: ${stats.apifyReturned} 条`, 'info', 'complete', '');
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
    stats.creditsFinal = stats.creditsUsed - stats.creditsRefunded;
    addLog(`💰 积分消耗: ${stats.creditsUsed} 积分`, 'info', 'complete', '');
    if (stats.creditsRefunded > 0) {
      addLog(`💰 积分节省: ${stats.creditsRefunded} 积分 (因实际数据量少于请求量)`, 'success', 'complete', '');  
    }
    addLog(`⏱️ 总耗时: ${formatDuration(stats.totalDuration)}`, 'info', 'complete', '');
    if (stats.resultsWithPhone > 0) {
      addLog(`📈 验证成功率: ${stats.verifySuccessRate}%`, 'info', 'complete', '');
    }
    // ==================== 结算退还机制 ====================
    const settlement = await settleCreditsLinkedIn(userId, frozenAmount, stats.creditsUsed, task.taskId);
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    addLog(`💰 费用结算:`, 'info', 'complete', '');
    addLog(`   • 预扣积分: ${frozenAmount} 积分`, 'info', 'complete', '');
    addLog(`   • 实际消耗: ${stats.creditsUsed} 积分`, 'info', 'complete', '');
    if (settlement.refundAmount > 0) {
      addLog(`   • ✅ 已退还: ${settlement.refundAmount} 积分`, 'success', 'complete', '✅');
    }
    addLog(`   • 当前余额: ${settlement.newBalance} 积分`, 'info', 'complete', '');
    
    addLog('═══════════════════════════════════════════════════════════', 'info', 'complete', '');

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
    const safeErrMsg = (error.message || '').includes('Scrape.do') ? '服务繁忙，请稍后重试' : error.message;
    addLog(`❌ 错误: ${safeErrMsg}`, 'error', 'complete', '❌');
    
    // ==================== 失败时的结算退还 ====================
    const settlement = await settleCreditsLinkedIn(userId, frozenAmount, stats.creditsUsed, task.taskId);
    addLog(`💰 失败结算:`, 'info', 'complete', '');
    addLog(`   • 预扣积分: ${frozenAmount} 积分`, 'info', 'complete', '');
    addLog(`   • 已消耗: ${stats.creditsUsed} 积分`, 'info', 'complete', '');
    if (settlement.refundAmount > 0) {
      addLog(`   • ✅ 已退还: ${settlement.refundAmount} 积分`, 'success', 'complete', '✅');
    }
    addLog(`   • 当前余额: ${settlement.newBalance} 积分`, 'info', 'complete', '');
    
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
