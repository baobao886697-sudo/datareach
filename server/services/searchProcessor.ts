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
  logApi
} from '../db';
import { searchPeople, enrichPerson, ApolloPerson, requestPhoneNumberAsync } from './apollo';
import { verifyPhoneNumber, PersonToVerify } from './scraper';
import { SearchTask } from '../../drizzle/schema';
import crypto from 'crypto';

const BATCH_SIZE = 50;
const APOLLO_BATCH_SIZE = 10;

export interface SearchProgress {
  taskId: string;
  status: string;
  step: number;
  totalSteps: number;
  currentAction: string;
  stats: {
    apolloCalls: number;
    phoneRequests: number;
    verifyRequests: number;
    totalRecords: number;
    validResults: number;
    phonesFound: number;
    phonesVerified: number;
    phonesPending: number;
    verifySuccessRate: number;
    creditsUsed: number;
    // 排除统计
    excludedNoPhone: number;
    excludedVerifyFailed: number;
    excludedAgeFilter: number;
    excludedOther: number;
  };
  logs: Array<{ 
    timestamp: string; 
    level: 'info' | 'success' | 'warning' | 'error'; 
    step?: number;
    total?: number;
    message: string;
    details?: {
      name?: string;
      phone?: string;
      matchScore?: number;
      reason?: string;
    };
  }>;
}

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

export async function executeSearch(
  userId: number,
  searchName: string,
  searchTitle: string,
  searchState: string,
  requestedCount: number = 50,
  ageMin?: number,
  ageMax?: number,
  onProgress?: (progress: SearchProgress) => void
): Promise<SearchTask | undefined> {
  
  const logs: SearchProgress['logs'] = [];
  const stats: SearchProgress['stats'] = {
    apolloCalls: 0,
    phoneRequests: 0,
    verifyRequests: 0,
    totalRecords: 0,
    validResults: 0,
    phonesFound: 0,
    phonesVerified: 0,
    phonesPending: 0,
    verifySuccessRate: 0,
    creditsUsed: 0,
    excludedNoPhone: 0,
    excludedVerifyFailed: 0,
    excludedAgeFilter: 0,
    excludedOther: 0,
  };
  
  let currentStep = 0;
  const totalSteps = requestedCount + 5; // 5个初始化步骤 + 每条结果一个步骤
  
  const addLog = (
    message: string, 
    level: 'info' | 'success' | 'warning' | 'error' = 'info',
    step?: number,
    total?: number,
    details?: SearchProgress['logs'][0]['details']
  ) => {
    const timestamp = formatTime();
    logs.push({ timestamp, level, step, total, message, details });
  };

  const user = await getUserById(userId);
  if (!user) throw new Error('用户不存在');

  const searchCredits = 1;
  const phoneCreditsPerPerson = 2;

  if (user.credits < searchCredits) {
    throw new Error(`积分不足，搜索需要至少 ${searchCredits} 积分，当前余额 ${user.credits}`);
  }

  const searchHash = generateSearchHash(searchName, searchTitle, searchState);
  const params = { 
    name: searchName, 
    title: searchTitle, 
    state: searchState,
    limit: requestedCount,
    ageMin,
    ageMax
  };

  const task = await createSearchTask(userId, searchHash, params, requestedCount);
  if (!task) throw new Error('创建搜索任务失败');

  const progress: SearchProgress = {
    taskId: task.taskId,
    status: 'initializing',
    step: 0,
    totalSteps,
    currentAction: '初始化搜索任务',
    stats,
    logs
  };

  const updateProgress = async (action?: string, status?: string) => {
    if (action) progress.currentAction = action;
    if (status) progress.status = status;
    progress.step = currentStep;
    
    // 计算验证成功率
    if (stats.phonesFound > 0) {
      stats.verifySuccessRate = Math.round((stats.phonesVerified / stats.phonesFound) * 100);
    }
    
    await updateSearchTask(task.taskId, { 
      logs, 
      status: progress.status as any, 
      creditsUsed: stats.creditsUsed,
      progress: Math.round((currentStep / totalSteps) * 100)
    });
    onProgress?.(progress);
  };

  try {
    // ===== 步骤1: 初始化 =====
    currentStep++;
    addLog(`🚀 开始搜索任务 #${task.taskId.slice(0, 8)}`, 'info');
    addLog(`📋 搜索条件: ${searchName} | ${searchTitle} | ${searchState}`, 'info');
    addLog(`📊 请求数量: ${requestedCount} 条`, 'info');
    if (ageMin && ageMax) {
      addLog(`🎂 年龄筛选: ${ageMin} - ${ageMax} 岁`, 'info');
    }
    addLog(`💰 预估消耗: ~${searchCredits + requestedCount * phoneCreditsPerPerson} 积分`, 'info');
    addLog(`📱 电话号码将通过异步方式获取，请稍候...`, 'info');
    addLog(`─────────────────────────────────────`, 'info');
    await updateProgress('初始化搜索任务', 'running');

    // ===== 步骤2: 扣除搜索积分 =====
    currentStep++;
    const searchDeducted = await deductCredits(userId, searchCredits, 'search', `搜索: ${searchName} | ${searchTitle} | ${searchState}`, task.taskId);
    if (!searchDeducted) throw new Error('扣除搜索积分失败');
    stats.creditsUsed += searchCredits;
    addLog(`💰 已扣除搜索积分: ${searchCredits}`, 'success');
    await updateProgress('扣除搜索积分');

    // ===== 步骤3: 检查缓存 =====
    currentStep++;
    const cacheKey = `search:${searchHash}`;
    const cached = await getCacheByKey(cacheKey);
    
    let apolloResults: ApolloPerson[] = [];
    
    if (cached) {
      addLog(`✨ 命中全局缓存，跳过Apollo API调用`, 'success');
      apolloResults = cached.data as ApolloPerson[];
      stats.totalRecords = apolloResults.length;
    } else {
      // ===== 步骤4: 调用Apollo API =====
      currentStep++;
      addLog(`🔍 正在调用 Apollo API 搜索...`, 'info');
      await updateProgress('调用 Apollo API');
      
      const startTime = Date.now();
      stats.apolloCalls++;
      
      const searchResult = await searchPeople(searchName, searchTitle, searchState, requestedCount * 2);
      
      await logApi('apollo_search', '/people/search', params, searchResult.success ? 200 : 500, Date.now() - startTime, searchResult.success, searchResult.errorMessage, 0, userId);

      if (!searchResult.success || !searchResult.people) {
        throw new Error(searchResult.errorMessage || 'Apollo搜索失败');
      }

      apolloResults = searchResult.people;
      stats.totalRecords = apolloResults.length;
      addLog(`📋 Apollo 返回 ${apolloResults.length} 条基础数据`, 'success');

      // 缓存搜索结果 180天
      await setCache(cacheKey, 'search', apolloResults, 180);
    }

    await updateProgress('处理搜索结果');

    if (apolloResults.length === 0) {
      progress.status = 'completed';
      addLog(`⚠️ 未找到匹配结果`, 'warning');
      await updateProgress('搜索完成', 'completed');
      return getSearchTask(task.taskId);
    }

    // ===== 步骤5: 打乱顺序 =====
    currentStep++;
    const shuffledResults = shuffleArray(apolloResults);
    addLog(`🔀 已打乱数据顺序，采用跳动提取策略`, 'info');
    addLog(`─────────────────────────────────────`, 'info');

    // ===== 分批获取详细信息并请求电话号码 =====
    const toProcess = shuffledResults.slice(0, requestedCount);
    let processedCount = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const person = toProcess[i];
      currentStep++;
      processedCount++;
      
      const personName = `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Unknown';
      
      // 检查任务是否被停止
      const currentTask = await getSearchTask(task.taskId);
      if (currentTask?.status === 'stopped') {
        addLog(`⏹️ 任务已被用户停止`, 'warning');
        progress.status = 'stopped';
        break;
      }
      
      // 检查积分
      const currentUser = await getUserById(userId);
      if (!currentUser || currentUser.credits < phoneCreditsPerPerson) {
        addLog(`⚠️ 积分不足，停止获取。需要 ${phoneCreditsPerPerson} 积分，当前 ${currentUser?.credits || 0}`, 'warning');
        progress.status = 'insufficient_credits';
        break;
      }

      // 扣除积分
      const deducted = await deductCredits(userId, phoneCreditsPerPerson, 'search', `获取电话: ${personName}`, task.taskId);
      if (!deducted) {
        addLog(`❌ 扣除积分失败`, 'error');
        break;
      }
      stats.creditsUsed += phoneCreditsPerPerson;
      stats.phoneRequests++;

      addLog(`🔍 [${processedCount}/${requestedCount}] 正在处理: ${personName}`, 'info', processedCount, requestedCount);
      await updateProgress(`处理 ${personName}`);

      // 获取详细信息（邮箱等，不包含电话）
      const startTime = Date.now();
      const enrichedPerson = await enrichPerson(person.id, userId);
      
      await logApi('apollo_enrich', '/people/match', { id: person.id }, enrichedPerson ? 200 : 500, Date.now() - startTime, !!enrichedPerson, undefined, phoneCreditsPerPerson, userId);

      if (!enrichedPerson) {
        stats.excludedOther++;
        addLog(`⚠️ [${processedCount}/${requestedCount}] ${personName} - 获取详情失败`, 'warning', processedCount, requestedCount, { name: personName, reason: '获取详情失败' });
        continue;
      }

      // 保存基础结果（电话号码待异步获取）
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
        phone: null, // 电话号码待异步获取
        phoneStatus: 'pending', // pending, received, verified, failed
        phoneType: null,
        linkedinUrl: enrichedPerson.linkedin_url,
        age: null,
        carrier: null,
      };

      // 保存结果到数据库
      const savedResult = await saveSearchResult(task.id, enrichedPerson.id, resultData, false, 0, null);
      
      if (savedResult) {
        stats.validResults++;
        stats.phonesPending++;
        addLog(`📧 [${processedCount}/${requestedCount}] ${personName} - 邮箱: ${enrichedPerson.email || '无'}`, 'success', processedCount, requestedCount);
        addLog(`📱 [${processedCount}/${requestedCount}] 正在异步获取电话号码...`, 'info', processedCount, requestedCount);
        
        // 异步请求电话号码（通过 webhook 返回）
        const phoneRequested = await requestPhoneNumberAsync(
          enrichedPerson.id,
          task.taskId,
          enrichedPerson,
          userId
        );
        
        if (phoneRequested) {
          addLog(`✅ [${processedCount}/${requestedCount}] 电话号码请求已发送`, 'success', processedCount, requestedCount);
        } else {
          addLog(`⚠️ [${processedCount}/${requestedCount}] 电话号码请求失败`, 'warning', processedCount, requestedCount);
        }
      }

      // 缓存个人数据
      const personCacheKey = `person:${enrichedPerson.id}`;
      await setCache(personCacheKey, 'person', resultData, 180);

      // 添加分隔线（每5条）
      if (processedCount % 5 === 0 && processedCount < requestedCount) {
        addLog(`─────────────────────────────────────`, 'info');
      }

      await updateProgress();
    }

    // ===== 完成基础搜索 =====
    addLog(`─────────────────────────────────────`, 'info');
    
    const finalStatus = progress.status === 'stopped' ? 'stopped' : 
                         progress.status === 'insufficient_credits' ? 'insufficient_credits' : 'completed';
    
    if (finalStatus === 'stopped') {
      addLog(`⏹️ 搜索已停止`, 'warning');
    } else if (finalStatus === 'insufficient_credits') {
      addLog(`⚠️ 积分不足，搜索提前结束`, 'warning');
    } else {
      addLog(`🎉 基础搜索完成！`, 'success');
      addLog(`📱 电话号码正在后台异步获取中，请稍候刷新查看...`, 'info');
    }
    addLog(`📊 结果统计:`, 'info');
    addLog(`   • 处理记录: ${processedCount}`, 'info');
    addLog(`   • 有效结果: ${stats.validResults}`, 'info');
    addLog(`   • 电话待获取: ${stats.phonesPending}`, 'info');
    addLog(`💰 总消耗积分: ${stats.creditsUsed}`, 'info');
    
    if (stats.excludedOther > 0) {
      addLog(`🚫 排除统计:`, 'info');
      addLog(`   • 获取失败: ${stats.excludedOther}`, 'info');
    }

    progress.status = finalStatus;
    
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
    addLog(`❌ 错误: ${error.message}`, 'error');
    
    await updateSearchTask(task.taskId, {
      status: 'failed',
      logs,
      creditsUsed: stats.creditsUsed,
      completedAt: new Date()
    });

    return getSearchTask(task.taskId);
  }
}
