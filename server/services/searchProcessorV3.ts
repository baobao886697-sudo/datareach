/**
 * 搜索处理器 V3 - Apify 版本
 * 
 * 使用 Apify Leads Finder 替代 Apollo API
 * 
 * 主要变化：
 * 1. 数据源从 Apollo 切换到 Apify
 * 2. 不再需要 Webhook 异步获取电话（Apify 一次性返回所有数据）
 * 3. 保留 scrape.do 二次电话验证功能
 * 4. 简化流程，提高效率
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

export interface SearchStats {
  // API 调用统计
  apifySearchCalls: number;
  scrapeDoVerifyCalls: number;
  
  // 结果统计
  totalRecordsFound: number;
  recordsProcessed: number;
  validResults: number;
  
  // 电话统计
  phonesFound: number;
  phonesVerified: number;
  phonesVerifyFailed: number;
  
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

const SEARCH_CREDITS = 1;
const PHONE_CREDITS_PER_PERSON = 2;
const VERIFY_CREDITS_PER_PHONE = 0;
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
  const cacheKey = `apify:${searchHash}`;
  const cached = await getCacheByKey(cacheKey);
  
  let totalAvailable = 0;
  let cacheHit = false;

  if (cached) {
    cacheHit = true;
    const cachedData = cached.data as LeadPerson[];
    totalAvailable = cachedData.length;
  } else {
    // 对于 Apify，我们不做预览搜索（成本太高）
    // 直接返回请求数量作为预估
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
  requestedCount: number = 50,
  ageMin?: number,
  ageMax?: number,
  enableVerification: boolean = true,
  onProgress?: (progress: SearchProgress) => void
): Promise<SearchTask | undefined> {
  
  const startTime = Date.now();
  const logs: SearchLogEntry[] = [];
  
  const stats: SearchStats = {
    apifySearchCalls: 0,
    scrapeDoVerifyCalls: 0,
    totalRecordsFound: 0,
    recordsProcessed: 0,
    validResults: 0,
    phonesFound: 0,
    phonesVerified: 0,
    phonesVerifyFailed: 0,
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
    dataSource: 'apify'  // 标记数据源
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
    progress.stats.totalDuration = Date.now() - startTime;
    
    // 计算验证成功率
    if (stats.phonesFound > 0) {
      stats.verifySuccessRate = Math.round((stats.phonesVerified / stats.phonesFound) * 100);
    }
    
    // 更新数据库
    const dbStatus = mapStatusToDbStatus(progress.status);
    await updateSearchTask(task.taskId, { 
      logs, 
      status: dbStatus as any, 
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
    addLog(`数据源: Apify Leads Finder`, 'info', 'init', '🔌');
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
    // 阶段 3: 检查缓存 / 调用 Apify API
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    const cacheKey = `apify:${searchHash}`;
    const cached = await getCacheByKey(cacheKey);
    
    let apifyResults: LeadPerson[] = [];
    
    if (cached) {
      stats.cacheHits++;
      addLog(`命中全局缓存！跳过 Apify API 调用`, 'success', 'apify', '✨');
      apifyResults = cached.data as LeadPerson[];
      stats.totalRecordsFound = apifyResults.length;
      addLog(`缓存中有 ${apifyResults.length} 条记录`, 'info', 'apify', '📦');
    } else {
      stats.cacheMisses++;
      addLog(`正在调用 Apify Leads Finder...`, 'info', 'apify', '🔍');
      addLog(`⏳ Apify Actor 运行中，请耐心等待（可能需要1-3分钟）...`, 'info', 'apify', '');
      await updateProgress('调用 Apify API', 'searching', 'apify', 30);
      
      const apiStartTime = Date.now();
      stats.apifySearchCalls++;
      
      const searchResult = await apifySearchPeople(searchName, searchTitle, searchState, requestedCount * 2, userId);
      const apiDuration = Date.now() - apiStartTime;

      if (!searchResult.success || !searchResult.people) {
        throw new Error(searchResult.errorMessage || 'Apify 搜索失败');
      }

      apifyResults = searchResult.people;
      stats.totalRecordsFound = apifyResults.length;
      addLog(`Apify 返回 ${apifyResults.length} 条完整数据`, 'success', 'apify', '📋', undefined, undefined, { duration: apiDuration });
      addLog(`API 响应时间: ${formatDuration(apiDuration)}`, 'debug', 'apify', '⏱️');

      // 缓存搜索结果 180天
      await setCache(cacheKey, 'search', apifyResults, 180);
      addLog(`已缓存搜索结果 (180天有效)`, 'info', 'apify', '💾');
    }

    await updateProgress('处理搜索结果', undefined, 'apify', 50);

    if (apifyResults.length === 0) {
      addLog(`未找到匹配结果`, 'warning', 'complete', '⚠️');
      progress.status = 'completed';
      await updateProgress('搜索完成', 'completed', 'complete', 100);
      return getSearchTask(task.taskId);
    }

    // ═══════════════════════════════════════════════════════════════
    // 阶段 4: 打乱顺序并准备处理
    // ═══════════════════════════════════════════════════════════════
    currentStep++;
    const shuffledResults = shuffleArray(apifyResults);
    addLog(`已打乱数据顺序，采用跳动提取策略`, 'info', 'process', '🔀');
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
    addLog(`开始逐条处理数据...`, 'info', 'process', '📊');
    addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');

    // ═══════════════════════════════════════════════════════════════
    // 阶段 5: 逐条处理数据（Apify 已包含电话，直接处理）
    // ═══════════════════════════════════════════════════════════════
    const toProcess = shuffledResults.slice(0, requestedCount);
    let processedCount = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const person = toProcess[i];
      currentStep++;
      processedCount++;
      stats.recordsProcessed++;
      
      const personName = person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown';
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
      const deducted = await deductCredits(userId, PHONE_CREDITS_PER_PERSON, 'search', `获取数据: ${personName}`, task.taskId);
      if (!deducted) {
        addLog(`扣除积分失败`, 'error', 'process', '❌');
        stats.excludedError++;
        continue;
      }
      stats.creditsUsed += PHONE_CREDITS_PER_PERSON;

      // 显示处理进度
      const progressPercent = Math.round((processedCount / requestedCount) * 100);
      addLog(`[${processedCount}/${requestedCount}] 正在处理: ${personName}`, 'info', 'process', '🔍', processedCount, requestedCount);
      await updateProgress(`处理 ${personName}`, 'processing', 'process', progressPercent);

      // 获取电话号码（Apify 已经返回）
      const phoneNumbers = person.phone_numbers || [];
      let selectedPhone = phoneNumbers[0];
      
      // 优先选择手机号
      for (const phone of phoneNumbers) {
        if (phone.type === 'mobile') {
          selectedPhone = phone;
          break;
        }
      }

      const phoneNumber = selectedPhone?.sanitized_number || selectedPhone?.raw_number || null;
      const phoneType = selectedPhone?.type || 'unknown';

      // 构建结果数据
      const resultData = {
        apifyId: person.id,  // 使用 Apify 生成的 ID
        apolloId: person.id, // 兼容旧字段
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
        phoneStatus: phoneNumber ? 'received' : 'no_phone' as 'pending' | 'received' | 'verified' | 'no_phone' | 'failed',
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

      // 如果没有电话号码
      if (!phoneNumber) {
        stats.excludedNoPhone++;
        addLog(`[${processedCount}/${requestedCount}] ${personName} - 无电话号码`, 'warning', 'process', '📵', processedCount, requestedCount);
        
        // 仍然保存结果（有邮箱的情况下）
        if (person.email) {
          await saveSearchResult(task.id, person.id, resultData, false, 0, null);
          stats.validResults++;
          addLog(`[${processedCount}/${requestedCount}] ${personName} - 已保存（仅邮箱）`, 'info', 'process', '📧', processedCount, requestedCount, {
            name: personName,
            email: person.email
          });
        }
        continue;
      }

      stats.phonesFound++;

      // 二次电话验证
      if (enableVerification) {
        addLog(`[${processedCount}/${requestedCount}] 正在验证电话号码...`, 'info', 'verify', '🔍', processedCount, requestedCount);
        
        const personToVerify: PersonToVerify = {
          firstName: person.first_name || '',
          lastName: person.last_name || '',
          city: person.city || '',
          state: person.state || '',
          phone: phoneNumber
        };

        stats.scrapeDoVerifyCalls++;
        const verifyResult = await verifyPhoneNumber(personToVerify, userId);

        if (verifyResult) {
          resultData.verificationScore = verifyResult.matchScore;
          resultData.verificationSource = verifyResult.source;
          resultData.age = verifyResult.details?.age || null;
          resultData.carrier = verifyResult.details?.carrier || null;
          
          if (verifyResult.verified) {
            resultData.phoneStatus = 'verified';
            resultData.verifiedAt = new Date();
            stats.phonesVerified++;
            
            const maskedPhone = phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
            addLog(`[${processedCount}/${requestedCount}] ${personName} - ✅ 验证通过 (${verifyResult.matchScore}%)`, 'success', 'verify', '✅', processedCount, requestedCount, {
              name: personName,
              phone: maskedPhone,
              matchScore: verifyResult.matchScore
            });
          } else {
            stats.phonesVerifyFailed++;
            addLog(`[${processedCount}/${requestedCount}] ${personName} - ⚠️ 验证未通过 (${verifyResult.matchScore}%)`, 'warning', 'verify', '⚠️', processedCount, requestedCount, {
              name: personName,
              matchScore: verifyResult.matchScore
            });
          }

          // 年龄筛选
          if (ageMin && ageMax && verifyResult.details?.age) {
            const age = verifyResult.details.age;
            if (age < ageMin || age > ageMax) {
              stats.excludedAgeFilter++;
              addLog(`[${processedCount}/${requestedCount}] ${personName} - 年龄 ${age} 不在范围 [${ageMin}-${ageMax}]，已排除`, 'warning', 'verify', '🚫', processedCount, requestedCount);
              continue;
            }
          }
        }
      }

      // 保存结果到数据库
      const savedResult = await saveSearchResult(task.id, person.id, resultData, resultData.phoneStatus === 'verified', resultData.verificationScore || 0, null);
      
      if (savedResult) {
        stats.validResults++;
        
        // 显示结果信息
        if (person.email) {
          addLog(`    📧 邮箱: ${person.email}`, 'info', 'process', '   ');
        }
        if (person.organization_name) {
          addLog(`    🏢 公司: ${person.organization_name}`, 'info', 'process', '   ');
        }
        if (phoneNumber) {
          const maskedPhone = phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
          addLog(`    📱 电话: ${maskedPhone}`, 'info', 'process', '   ');
        }
      }

      // 缓存个人数据
      const personCacheKey = `person:${person.id}`;
      await setCache(personCacheKey, 'person', resultData, 180);

      // 添加分隔线（每5条）
      if (processedCount % 5 === 0 && processedCount < requestedCount) {
        addLog('───────────────────────────────────────────────────────────', 'info', 'process', '');
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
      addLog(`搜索完成！`, 'success', 'complete', '🎉');
    }
    
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    addLog(`📊 搜索结果统计:`, 'info', 'complete', '');
    addLog(`   • Apify 返回: ${stats.totalRecordsFound} 条`, 'info', 'complete', '');
    addLog(`   • 处理记录: ${stats.recordsProcessed} 条`, 'info', 'complete', '');
    addLog(`   • 有效结果: ${stats.validResults} 条`, 'info', 'complete', '');
    addLog(`   • 有电话: ${stats.phonesFound} 条`, 'info', 'complete', '');
    addLog(`   • 验证通过: ${stats.phonesVerified} 条`, 'info', 'complete', '');
    addLog('───────────────────────────────────────────────────────────', 'info', 'complete', '');
    addLog(`💰 积分消耗: ${stats.creditsUsed}`, 'info', 'complete', '');
    addLog(`⏱️ 总耗时: ${formatDuration(Date.now() - startTime)}`, 'info', 'complete', '');
    addLog('═══════════════════════════════════════════════════════════', 'info', 'complete', '');
    
    if (stats.excludedError > 0 || stats.excludedNoPhone > 0 || stats.excludedAgeFilter > 0) {
      addLog(`🚫 排除统计:`, 'info', 'complete', '');
      if (stats.excludedError > 0) addLog(`   • 处理失败: ${stats.excludedError}`, 'info', 'complete', '');
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
