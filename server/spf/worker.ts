/**
 * SPF Worker Thread 实现
 * 
 * 基于 Scrape.do 官方文档最佳实践：
 * - 使用独立的后台线程池处理爬虫任务
 * - 每个 Worker 有独立的并发控制器
 * - 全局信号量限制系统总并发
 * 
 * 架构说明：
 * - 3 个 Worker Thread，每个 Worker 5 并发
 * - 全局最大 15 并发（跨所有 Worker）
 * - 任务队列管理，故障隔离
 */

import { parentPort, workerData, isMainThread } from 'worker_threads';
import { SpfDetailResult } from './scraper';
import { SCRAPEDO_CONFIG } from './config';
import * as cheerio from 'cheerio';

// ==================== 类型定义 ====================

export interface WorkerTask {
  type: 'search' | 'detail';
  taskId: string;
  data: SearchTaskData | DetailTask;
}

export interface SearchTaskData {
  name: string;
  location: string;
  token: string;
  maxPages: number;
  filters: SpfFilters;
  subTaskIndex: number;
}

export interface DetailTask {
  detailLink: string;
  token: string;
  filters: SpfFilters;
  subTaskIndex: number;
  searchName: string;
  searchLocation: string;
}

export interface SpfFilters {
  minAge?: number;
  maxAge?: number;
  minYear?: number;
  minPropertyValue?: number;
  excludeTMobile?: boolean;
  excludeComcast?: boolean;
  excludeLandline?: boolean;
  excludeWireless?: boolean;
}



export interface WorkerResult {
  type: 'search' | 'detail';
  taskId: string;
  success: boolean;
  data?: any;
  error?: string;
  stats?: {
    searchPageRequests?: number;
    detailPageRequests?: number;
    filteredOut?: number;
    skippedDeceased?: number;
  };
}

export interface WorkerMessage {
  type: 'task' | 'shutdown' | 'status';
  task?: WorkerTask;
}

export interface WorkerResponse {
  type: 'result' | 'progress' | 'ready' | 'error';
  result?: WorkerResult;
  progress?: { taskId: string; message: string };
  error?: string;
}

// ==================== Worker 内部并发控制 ====================

/**
 * Worker 内部信号量 - 控制单个 Worker 的并发数
 */
class WorkerSemaphore {
  private maxConcurrency: number;
  private currentCount: number = 0;
  private waitQueue: Array<() => void> = [];
  
  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }
  
  async acquire(): Promise<void> {
    if (this.currentCount < this.maxConcurrency) {
      this.currentCount++;
      return;
    }
    
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.currentCount++;
        resolve();
      });
    });
  }
  
  release(): void {
    this.currentCount--;
    if (this.waitQueue.length > 0 && this.currentCount < this.maxConcurrency) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
  
  getStatus(): { current: number; max: number; waiting: number } {
    return {
      current: this.currentCount,
      max: this.maxConcurrency,
      waiting: this.waitQueue.length,
    };
  }
}

// ==================== Scrape.do API ====================

const SCRAPE_TIMEOUT_MS = SCRAPEDO_CONFIG.TIMEOUT_MS;
const SCRAPE_MAX_RETRIES = SCRAPEDO_CONFIG.MAX_RETRIES;

/**
 * 使用 Scrape.do API 获取页面（带超时和重试）
 */
async function fetchWithScrapedo(url: string, token: string, semaphore: WorkerSemaphore): Promise<string> {
  const encodedUrl = encodeURIComponent(url);
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us`;
  
  let lastError: Error | null = null;
  
  // 获取 Worker 内部信号量
  await semaphore.acquire();
  
  try {
    for (let attempt = 0; attempt <= SCRAPE_MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS + 5000);
        
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const isRetryableError = [502, 503, 504].includes(response.status);
          if (isRetryableError && attempt < SCRAPE_MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
            continue;
          }
          throw new Error(`Scrape.do API 请求失败: ${response.status} ${response.statusText}`);
        }
        
        const text = await response.text();
        
        // 检查响应是否是 JSON 错误
        if (text.startsWith('{') && text.includes('"StatusCode"')) {
          try {
            const jsonError = JSON.parse(text);
            const statusCode = jsonError.StatusCode || 0;
            const isRetryableError = [502, 503, 504].includes(statusCode);
            
            if (isRetryableError && attempt < SCRAPE_MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
              continue;
            }
            
            const errorMsg = Array.isArray(jsonError.Message) ? jsonError.Message.join(', ') : (jsonError.Message || 'Unknown error');
            throw new Error(`Scrape.do API 返回错误: StatusCode ${statusCode} - ${errorMsg}`);
          } catch (parseError: any) {
            if (parseError.message?.includes('Scrape.do API')) {
              throw parseError;
            }
          }
        }
        
        // 检查响应是否是有效的 HTML
        const trimmedText = text.trim();
        if (!trimmedText.startsWith('<') && !trimmedText.startsWith('<!DOCTYPE')) {
          if (attempt < SCRAPE_MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
            continue;
          }
          throw new Error('Scrape.do API 返回的不是有效的 HTML');
        }
        
        return text;
      } catch (error: any) {
        lastError = error;
        
        if (attempt >= SCRAPE_MAX_RETRIES) {
          break;
        }
        
        const isTimeout = error.name === 'AbortError' || error.message?.includes('timeout');
        const isNetworkError = error.message?.includes('fetch') || error.message?.includes('network');
        const isServerError = error.message?.includes('502') || error.message?.includes('503') || error.message?.includes('504');
        
        if (isTimeout || isNetworkError || isServerError) {
          await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || new Error('请求失败');
  } finally {
    semaphore.release();
  }
}

// ==================== 解析函数 ====================

/**
 * 格式化电话号码
 */
function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return '1' + digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits;
  }
  return digits;
}

/**
 * 解析搜索页面
 */
function parseSearchPage(html: string): SpfDetailResult[] {
  const $ = cheerio.load(html);
  const results: SpfDetailResult[] = [];
  
  $('li.toc.l-i.mb-5').each((_, li) => {
    const article = $(li).find('article.current-bg').first();
    if (!article.length) return;
    
    const result: SpfDetailResult = {
      name: '',
      allPhones: [],
      addresses: [],
      familyMembers: [],
    };
    
    // 提取姓名和详情链接
    const nameLink = article.find('h2 a').first();
    if (nameLink.length) {
      result.name = nameLink.text().trim();
      const href = nameLink.attr('href');
      if (href) {
        result.detailLink = href.startsWith('http') ? href : `https://www.searchpeoplefree.com${href}`;
      }
    }
    
    // 提取年龄
    const ageH3 = article.find('h3').first();
    if (ageH3.length && ageH3.text().includes('Age')) {
      const ageSpan = ageH3.find('span').first();
      if (ageSpan.length) {
        const ageClone = ageSpan.clone();
        ageClone.find('i').remove();
        const ageText = ageClone.text().trim();
        const ageNum = parseInt(ageText, 10);
        if (!isNaN(ageNum)) {
          result.age = ageNum;
        }
        
        const birthYearEl = ageSpan.find('i.text-muted').first();
        if (birthYearEl.length) {
          const birthYearText = birthYearEl.text().trim();
          const yearMatch = birthYearText.match(/\((\d{4})/);
          if (yearMatch) {
            result.birthYear = yearMatch[1];
          }
        }
      }
    }
    
    // 检查是否已故
    result.isDeceased = $(li).text().toLowerCase().includes('deceased');
    
    if (result.name) {
      results.push(result);
    }
  });
  
  return results;
}

/**
 * 提取下一页 URL
 */
function extractNextPageUrl(html: string): string | null {
  const $ = cheerio.load(html);
  
  const nextLink = $('a:contains("Next Page"), a:contains("Next"), a.next-page, a[rel="next"]').first();
  if (nextLink.length) {
    const href = nextLink.attr('href');
    if (href) {
      return href.startsWith('http') ? href : `https://www.searchpeoplefree.com${href}`;
    }
  }
  
  const paginationLinks = $('nav.pagination a, div.pagination a, ul.pagination a');
  let maxPage = 0;
  let nextPageUrl: string | null = null;
  
  paginationLinks.each((_, el) => {
    const href = $(el).attr('href') || '';
    const pageMatch = href.match(/p-(\d+)/);
    if (pageMatch) {
      const pageNum = parseInt(pageMatch[1], 10);
      if (pageNum > maxPage) {
        maxPage = pageNum;
        nextPageUrl = href.startsWith('http') ? href : `https://www.searchpeoplefree.com${href}`;
      }
    }
  });
  
  return nextPageUrl;
}

/**
 * 解析详情页面
 */
function parseDetailPage(html: string, detailLink: string): SpfDetailResult | null {
  try {
    const $ = cheerio.load(html);
    
    const result: SpfDetailResult = {
      name: '',
      allPhones: [],
      allEmails: [],
      familyMembers: [],
      associates: [],
      businesses: [],
      addresses: [],
      alsoKnownAs: [],
      detailLink,
    };
    
    // 提取姓名
    const h1El = $('h1.highlight-letter, h1').first();
    if (h1El.length) {
      const h1Text = h1El.text().trim();
      
      if (h1Text.includes(' living in ')) {
        const parts = h1Text.split(' living in ');
        result.name = parts[0].trim();
        result.location = parts[1].trim();
        
        if (result.location.includes(',')) {
          const lastCommaIndex = result.location.lastIndexOf(',');
          result.city = result.location.substring(0, lastCommaIndex).trim();
          result.state = result.location.substring(lastCommaIndex + 1).trim();
        }
      } else {
        result.name = h1Text;
      }
      
      const nameParts = result.name.split(' ');
      if (nameParts.length >= 2) {
        result.firstName = nameParts[0];
        result.lastName = nameParts[nameParts.length - 1];
      }
    }
    
    // 提取年龄和配偶
    const currentBg = $('article.current-bg').first();
    if (currentBg.length) {
      const currentText = currentBg.text();
      
      const ageMatch = currentText.match(/Age\s*(\d+)/);
      if (ageMatch) {
        result.age = parseInt(ageMatch[1], 10);
      }
      
      const birthMatch = currentText.match(/\((\d{4})\s+or\s+\d{4}\)/);
      if (birthMatch) {
        result.birthYear = birthMatch[1];
      }
      
      const spouseMatch = currentText.match(/Married to\s*([A-Za-z\s]+?)(?:\s*\(|$|\n|Spouse)/);
      if (spouseMatch) {
        result.maritalStatus = 'Married';
        result.spouseName = spouseMatch[1].trim();
      }
      
      result.addressCount = result.addresses?.length || 0;
    }
    
    // 提取电话号码
    const phoneBg = $('article.phone-bg').first();
    if (phoneBg.length) {
      phoneBg.find('a').each((_, aEl) => {
        const phoneText = $(aEl).text().trim();
        const phoneMatch = phoneText.match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
        if (phoneMatch) {
          const phoneNumber = '1' + phoneMatch[1] + phoneMatch[2] + phoneMatch[3];
          
          const parentLi = $(aEl).closest('li');
          let phoneType = 'Unknown';
          let phoneYear: number | undefined;
          
          if (parentLi.length) {
            const liText = parentLi.text();
            
            if (liText.includes('Wireless') || liText.includes('Mobile') || liText.includes('Cell')) {
              phoneType = 'Wireless';
            } else if (liText.includes('Landline') || liText.includes('Land')) {
              phoneType = 'Landline';
            } else if (liText.includes('VoIP')) {
              phoneType = 'VoIP';
            }
            
            const yearMatch = liText.match(/(20\d{2})/);
            if (yearMatch) {
              phoneYear = parseInt(yearMatch[1], 10);
            }
          }
          
          if (result.allPhones && !result.allPhones.some(p => p.number === phoneNumber)) {
            result.allPhones.push({
              number: phoneNumber,
              type: phoneType,
              year: phoneYear,
            });
          }
        }
      });
      
      if (result.allPhones && result.allPhones.length > 0) {
        const primaryPhone = result.allPhones[0];
        result.phone = primaryPhone.number;
        result.phoneType = primaryPhone.type;
        result.phoneYear = primaryPhone.year;
      }
      
      result.phoneCount = result.allPhones?.length || 0;
    }
    
    // 提取邮箱
    const emailBg = $('article.email-bg').first();
    if (emailBg.length) {
      emailBg.find('[data-cfemail]').each((_, el) => {
        const encoded = $(el).attr('data-cfemail');
        if (encoded) {
          const decoded = decodeCfEmail(encoded);
          if (decoded && result.allEmails && !result.allEmails.includes(decoded)) {
            result.allEmails.push(decoded);
          }
        }
      });
      
      if (result.allEmails && result.allEmails.length > 0) {
        result.email = result.allEmails[0];
      }
      
      result.emailCount = result.allEmails?.length || 0;
    }
    
    // 检查是否已故
    result.isDeceased = html.toLowerCase().includes('deceased');
    
    return result;
    
  } catch (error) {
    console.error('[Worker] 解析详情页面时出错:', error);
    return null;
  }
}

/**
 * 解码 Cloudflare 邮箱保护
 */
function decodeCfEmail(encoded: string): string {
  try {
    const r = parseInt(encoded.substr(0, 2), 16);
    let email = '';
    for (let i = 2; i < encoded.length; i += 2) {
      email += String.fromCharCode(parseInt(encoded.substr(i, 2), 16) ^ r);
    }
    return email;
  } catch {
    return '';
  }
}

/**
 * 应用过滤器
 */
function applyFilters(result: SpfDetailResult, filters: SpfFilters): boolean {
  // 年龄过滤
  if (result.age !== undefined) {
    if (filters.minAge !== undefined && result.age < filters.minAge) {
      return false;
    }
    if (filters.maxAge !== undefined && result.age > filters.maxAge) {
      return false;
    }
  }
  
  // 电话类型过滤
  if (result.phoneType) {
    if (filters.excludeLandline && result.phoneType === 'Landline') {
      return false;
    }
    if (filters.excludeWireless && result.phoneType === 'Wireless') {
      return false;
    }
  }
  
  return true;
}

// ==================== Worker 主逻辑 ====================

if (!isMainThread && parentPort) {
  const workerId = workerData?.workerId || 0;
  const concurrencyPerWorker = workerData?.concurrencyPerWorker || 5;
  
  // 创建 Worker 内部信号量
  const workerSemaphore = new WorkerSemaphore(concurrencyPerWorker);
  
  console.log(`[Worker ${workerId}] 启动，并发限制: ${concurrencyPerWorker}`);
  
  // 发送就绪消息
  parentPort.postMessage({ type: 'ready' } as WorkerResponse);
  
  // 监听任务消息
  parentPort.on('message', async (message: WorkerMessage) => {
    if (message.type === 'shutdown') {
      console.log(`[Worker ${workerId}] 收到关闭信号`);
      process.exit(0);
    }
    
    if (message.type === 'status') {
      parentPort!.postMessage({
        type: 'progress',
        progress: {
          taskId: 'status',
          message: JSON.stringify(workerSemaphore.getStatus()),
        },
      } as WorkerResponse);
      return;
    }
    
    if (message.type === 'task' && message.task) {
      const task = message.task;
      
      try {
        if (task.type === 'search') {
          const result = await executeSearchTask(task.data as SearchTaskData, workerSemaphore, workerId, (msg) => {
            parentPort!.postMessage({
              type: 'progress',
              progress: { taskId: task.taskId, message: msg },
            } as WorkerResponse);
          });
          
          parentPort!.postMessage({
            type: 'result',
            result: {
              type: 'search',
              taskId: task.taskId,
              success: result.success,
              data: result.data,
              error: result.error,
              stats: result.stats,
            },
          } as WorkerResponse);
        } else if (task.type === 'detail') {
          const result = await executeDetailTask(task.data as DetailTask, workerSemaphore, workerId);
          
          parentPort!.postMessage({
            type: 'result',
            result: {
              type: 'detail',
              taskId: task.taskId,
              success: result.success,
              data: result.data,
              error: result.error,
              stats: result.stats,
            },
          } as WorkerResponse);
        }
      } catch (error: any) {
        parentPort!.postMessage({
          type: 'error',
          error: error.message || 'Unknown error',
        } as WorkerResponse);
      }
    }
  });
}

/**
 * 执行搜索任务
 */
async function executeSearchTask(
  data: SearchTaskData,
  semaphore: WorkerSemaphore,
  workerId: number,
  onProgress: (message: string) => void
): Promise<{ success: boolean; data?: any; error?: string; stats?: any }> {
  let searchPageRequests = 0;
  let filteredOut = 0;
  let skippedDeceased = 0;
  const searchResults: SpfDetailResult[] = [];
  
  try {
    // 构建搜索 URL
    const nameParts = data.name.trim().toLowerCase().replace(/\s+/g, '-');
    let searchUrl = `https://www.searchpeoplefree.com/find/${nameParts}`;
    
    if (data.location) {
      const locationParts = data.location.trim().toLowerCase().replace(/,\s*/g, '-').replace(/\s+/g, '-');
      searchUrl += `/${locationParts}`;
    }
    
    onProgress(`[Worker ${workerId}] 搜索: ${searchUrl}`);
    
    // 获取第一页
    const searchHtml = await fetchWithScrapedo(searchUrl, data.token, semaphore);
    searchPageRequests++;
    
    // 检查是否是错误响应
    if (searchHtml.includes('"ErrorCode"') || searchHtml.includes('"StatusCode":4') || searchHtml.includes('"StatusCode":5')) {
      return {
        success: false,
        error: 'API 返回错误',
        stats: { searchPageRequests, filteredOut, skippedDeceased },
      };
    }
    
    // 检测是否直接返回详情页
    const isDetailPage = (searchHtml.includes('current-bg') || searchHtml.includes('personDetails')) && 
                         !searchHtml.includes('li class="toc l-i mb-5"');
    
    if (isDetailPage) {
      onProgress(`[Worker ${workerId}] 检测到直接返回详情页`);
      const detailResult = parseDetailPage(searchHtml, searchUrl);
      if (detailResult) {
        if (detailResult.isDeceased) {
          skippedDeceased++;
        } else if (applyFilters(detailResult, data.filters)) {
          searchResults.push(detailResult);
        } else {
          filteredOut++;
        }
      }
      return {
        success: true,
        data: { searchResults },
        stats: { searchPageRequests, filteredOut, skippedDeceased },
      };
    }
    
    // 分页获取所有搜索结果
    let currentPageHtml = searchHtml;
    let currentPageNum = 1;
    
    while (currentPageNum <= data.maxPages) {
      const pageResults = parseSearchPage(currentPageHtml);
      onProgress(`[Worker ${workerId}] 第 ${currentPageNum}/${data.maxPages} 页: ${pageResults.length} 个结果`);
      
      if (pageResults.length === 0) {
        onProgress(`[Worker ${workerId}] 第 ${currentPageNum} 页无结果，停止分页`);
        break;
      }
      
      for (const result of pageResults) {
        if (result.isDeceased) {
          skippedDeceased++;
          continue;
        }
        
        if (applyFilters(result, data.filters)) {
          searchResults.push(result);
        } else {
          filteredOut++;
        }
      }
      
      const nextPageUrl = extractNextPageUrl(currentPageHtml);
      if (!nextPageUrl) {
        onProgress(`[Worker ${workerId}] 已到达最后一页，共 ${currentPageNum} 页`);
        break;
      }
      
      try {
        currentPageHtml = await fetchWithScrapedo(nextPageUrl, data.token, semaphore);
        searchPageRequests++;
        currentPageNum++;
        
        if (currentPageHtml.includes('"ErrorCode"') || currentPageHtml.includes('"StatusCode":4')) {
          onProgress(`[Worker ${workerId}] 第 ${currentPageNum} 页获取失败（API错误），停止分页`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (pageError) {
        onProgress(`[Worker ${workerId}] 获取第 ${currentPageNum + 1} 页失败，停止分页`);
        break;
      }
    }
    
    return {
      success: true,
      data: { searchResults, subTaskIndex: data.subTaskIndex },
      stats: { searchPageRequests, filteredOut, skippedDeceased },
    };
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stats: { searchPageRequests, filteredOut, skippedDeceased },
    };
  }
}

/**
 * 执行详情任务
 */
async function executeDetailTask(
  data: DetailTask,
  semaphore: WorkerSemaphore,
  workerId: number
): Promise<{ success: boolean; data?: any; error?: string; stats?: any }> {
  try {
    const baseUrl = 'https://www.searchpeoplefree.com';
    const detailUrl = data.detailLink.startsWith('http') 
      ? data.detailLink 
      : `${baseUrl}${data.detailLink.startsWith('/') ? '' : '/'}${data.detailLink}`;
    
    const html = await fetchWithScrapedo(detailUrl, data.token, semaphore);
    
    if (html.includes('"ErrorCode"') || html.includes('"StatusCode":4')) {
      return {
        success: false,
        error: 'API 返回错误',
        stats: { detailPageRequests: 1 },
      };
    }
    
    const details = parseDetailPage(html, data.detailLink);
    
    if (details) {
      if (!applyFilters(details, data.filters)) {
        return {
          success: true,
          data: null,
          stats: { detailPageRequests: 1, filteredOut: 1 },
        };
      }
      
      const detailsWithSearchInfo = {
        ...details,
        searchName: data.searchName,
        searchLocation: data.searchLocation,
        fromCache: false,
      };
      
      return {
        success: true,
        data: { details: detailsWithSearchInfo, subTaskIndex: data.subTaskIndex },
        stats: { detailPageRequests: 1 },
      };
    }
    
    return {
      success: false,
      error: '解析详情页失败',
      stats: { detailPageRequests: 1 },
    };
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      stats: { detailPageRequests: 1 },
    };
  }
}

// 导出类型供主线程使用
export type { WorkerSemaphore };
