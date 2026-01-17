import {
  getUserById, 
  deductCredits, 
  createSearchTask, 
  updateSearchTask, 
  getSearchTask,
  saveSearchResult,
  getCacheByKey,
  setCache,
  logApi
} from '../db';
import { searchPeople, enrichPeopleBatch, ApolloPerson } from './apollo';
import { verifyPhoneNumber, PersonToVerify } from './scraper';
import { SearchTask } from '../../drizzle/schema';
import crypto from 'crypto';

const BATCH_SIZE = 50;
const APOLLO_BATCH_SIZE = 10;

export interface SearchProgress {
  taskId: string;
  status: string;
  totalResults: number;
  phonesRequested: number;
  phonesFetched: number;
  phonesVerified: number;
  creditsUsed: number;
  logs: Array<{ timestamp: string; level: string; message: string }>;
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

export async function executeSearch(
  userId: number,
  searchName: string,
  searchTitle: string,
  searchState: string,
  requestedCount: number = 50,
  onProgress?: (progress: SearchProgress) => void
): Promise<SearchTask | undefined> {
  const logs: Array<{ timestamp: string; level: string; message: string }> = [];
  const addLog = (message: string, level: string = 'info') => {
    const timestamp = new Date().toISOString();
    logs.push({ timestamp, level, message });
  };

  const user = await getUserById(userId);
  if (!user) throw new Error('用户不存在');

  const searchCredits = 1;
  const phoneCreditsPerPerson = 2;
  const totalPhoneCredits = requestedCount * phoneCreditsPerPerson;
  const totalCreditsNeeded = searchCredits + totalPhoneCredits;

  if (user.credits < searchCredits) {
    throw new Error(`积分不足，搜索需要至少 ${searchCredits} 积分，当前余额 ${user.credits}`);
  }

  const searchHash = generateSearchHash(searchName, searchTitle, searchState);
  const params = { name: searchName, title: searchTitle, state: searchState };

  const task = await createSearchTask(userId, searchHash, params, requestedCount);
  if (!task) throw new Error('创建搜索任务失败');

  addLog(`🚀 开始搜索: ${searchName} | ${searchTitle} | ${searchState}`);
  addLog(`📊 请求数量: ${requestedCount} 条`);

  const progress: SearchProgress = {
    taskId: task.taskId,
    status: 'searching',
    totalResults: 0,
    phonesRequested: requestedCount,
    phonesFetched: 0,
    phonesVerified: 0,
    creditsUsed: 0,
    logs
  };

  const updateProgress = async () => {
    await updateSearchTask(task.taskId, { logs, status: progress.status as any, creditsUsed: progress.creditsUsed });
    onProgress?.(progress);
  };

  try {
    // 扣除搜索积分
    const searchDeducted = await deductCredits(userId, searchCredits, 'search', `搜索: ${searchName} | ${searchTitle} | ${searchState}`, task.taskId);
    if (!searchDeducted) throw new Error('扣除搜索积分失败');
    progress.creditsUsed += searchCredits;
    addLog(`💰 已扣除搜索积分: ${searchCredits}`);

    // 检查缓存
    const cacheKey = `search:${searchHash}`;
    const cached = await getCacheByKey(cacheKey);
    
    let apolloResults: ApolloPerson[] = [];
    
    if (cached) {
      addLog(`✨ 命中全局缓存，跳过Apollo API调用`);
      apolloResults = cached.data as ApolloPerson[];
    } else {
      addLog(`🔍 调用Apollo API搜索...`);
      const startTime = Date.now();
      
      const searchResult = await searchPeople(searchName, searchTitle, searchState, requestedCount * 2);
      
      await logApi('apollo_search', '/people/search', params, searchResult.success ? 200 : 500, Date.now() - startTime, searchResult.success, searchResult.errorMessage, 0, userId);

      if (!searchResult.success || !searchResult.people) {
        throw new Error(searchResult.errorMessage || 'Apollo搜索失败');
      }

      apolloResults = searchResult.people;
      addLog(`📋 Apollo返回 ${apolloResults.length} 条基础数据`);

      // 缓存搜索结果 180天
      await setCache(cacheKey, 'search', apolloResults, 180);
    }

    progress.totalResults = apolloResults.length;
    await updateProgress();

    if (apolloResults.length === 0) {
      progress.status = 'completed';
      addLog(`⚠️ 未找到匹配结果`);
      await updateProgress();
      return getSearchTask(task.taskId);
    }

    // 跳动提取 - 打乱顺序
    const shuffledResults = shuffleArray(apolloResults);
    addLog(`🔀 已打乱数据顺序，采用跳动提取策略`);

    // 分批获取电话号码
    const toProcess = shuffledResults.slice(0, requestedCount);
    const batches = Math.ceil(toProcess.length / BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      const batchStart = batchIndex * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, toProcess.length);
      const batchPeople = toProcess.slice(batchStart, batchEnd);

      // 检查积分
      const batchCredits = batchPeople.length * phoneCreditsPerPerson;
      const currentUser = await getUserById(userId);
      if (!currentUser || currentUser.credits < batchCredits) {
        addLog(`⚠️ 积分不足，停止获取。需要 ${batchCredits} 积分，当前 ${currentUser?.credits || 0}`);
        progress.status = 'insufficient_credits';
        await updateProgress();
        break;
      }

      // 扣除积分
      const deducted = await deductCredits(userId, batchCredits, 'search', `获取电话号码 ${batchPeople.length} 条`, task.taskId);
      if (!deducted) {
        addLog(`❌ 扣除积分失败`);
        break;
      }
      progress.creditsUsed += batchCredits;
      addLog(`💰 已扣除电话获取积分: ${batchCredits} (${batchPeople.length}条 × ${phoneCreditsPerPerson}积分)`);

      // 分小批调用Apollo Enrichment
      const subBatches = Math.ceil(batchPeople.length / APOLLO_BATCH_SIZE);
      
      for (let subIndex = 0; subIndex < subBatches; subIndex++) {
        const subStart = subIndex * APOLLO_BATCH_SIZE;
        const subEnd = Math.min(subStart + APOLLO_BATCH_SIZE, batchPeople.length);
        const subBatch = batchPeople.slice(subStart, subEnd);

        addLog(`📞 获取电话号码 (${subStart + 1}-${subEnd}/${batchPeople.length})...`);

        const startTime = Date.now();
        const enrichResult = await enrichPeopleBatch(subBatch.map(p => p.id));
        
        await logApi('apollo_enrich', '/people/bulk_match', { ids: subBatch.map(p => p.id) }, enrichResult.length > 0 ? 200 : 500, Date.now() - startTime, enrichResult.length > 0, undefined, batchCredits / subBatches, userId);

        if (enrichResult.length > 0) {
          for (const person of enrichResult) {
            if (person.phone_numbers && person.phone_numbers.length > 0) {
              progress.phonesFetched++;

              // 验证电话号码
              const personToVerify: PersonToVerify = {
                firstName: person.first_name || '',
                lastName: person.last_name || '',
                city: person.city || '',
                state: person.state || searchState,
                phone: person.phone_numbers[0].sanitized_number || ''
              };

              addLog(`🔍 验证: ${person.first_name} ${person.last_name}...`);

              const verifyStartTime = Date.now();
              const verifyResult = await verifyPhoneNumber(personToVerify);
              
              await logApi(verifyResult.source === 'TruePeopleSearch' ? 'scrape_tps' : 'scrape_fps', verifyResult.source || 'unknown', personToVerify, verifyResult.verified ? 200 : 404, Date.now() - verifyStartTime, verifyResult.verified, undefined, 0, userId);

              if (verifyResult.verified) {
                progress.phonesVerified++;
                addLog(`✅ 验证通过: ${person.first_name} ${person.last_name} (匹配度: ${verifyResult.matchScore}%)`);
              } else {
                addLog(`❌ 验证失败: ${person.first_name} ${person.last_name}`);
              }

              // 保存结果
              const resultData = {
                apolloId: person.id,
                firstName: person.first_name,
                lastName: person.last_name,
                fullName: `${person.first_name} ${person.last_name}`,
                title: person.title,
                company: person.organization_name,
                city: person.city,
                state: person.state,
                country: person.country,
                email: person.email,
                phone: person.phone_numbers?.[0]?.sanitized_number,
                phoneType: person.phone_numbers?.[0]?.type,
                linkedinUrl: person.linkedin_url,
                age: verifyResult.details?.age,
                carrier: verifyResult.details?.carrier,
              };

              await saveSearchResult(task.id, person.id, resultData, verifyResult.verified, verifyResult.matchScore, verifyResult.details);

              // 缓存个人数据
              const personCacheKey = `person:${person.id}`;
              await setCache(personCacheKey, 'person', resultData, 180);
            }
          }
        }

        await updateProgress();
      }
    }

    progress.status = 'completed';
    addLog(`🎉 搜索完成！获取 ${progress.phonesFetched} 个电话，验证通过 ${progress.phonesVerified} 个`);
    addLog(`💰 总消耗积分: ${progress.creditsUsed}`);
    
    await updateSearchTask(task.taskId, {
      status: 'completed',
      actualCount: progress.phonesVerified,
      creditsUsed: progress.creditsUsed,
      logs,
      completedAt: new Date()
    });

    return getSearchTask(task.taskId);

  } catch (error: any) {
    progress.status = 'failed';
    addLog(`❌ 错误: ${error.message}`);
    
    await updateSearchTask(task.taskId, {
      status: 'failed',
      errorMessage: error.message,
      logs
    });

    throw error;
  }
}
