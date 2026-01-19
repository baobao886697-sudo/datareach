import { getSearchTask, updateSearchTask, getSearchResults, updateSearchResultByApolloId, deleteSearchResult } from '../db';
import { verifyPhoneNumber, PersonToVerify } from './scraper';

// 存储待处理的电话号码请求
interface PendingRequest {
  taskId: string;
  personId: string;
  personData: any;
  timestamp: number;
  ageFilter?: {
    min?: number;
    max?: number;
  };
}

const pendingPhoneRequests = new Map<string, PendingRequest>();

// 清理过期的请求（超过30分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of pendingPhoneRequests.entries()) {
    if (now - value.timestamp > 30 * 60 * 1000) {
      console.log(`[Apollo Webhook] Cleaning up expired request for person ${value.personId}`);
      pendingPhoneRequests.delete(key);
    }
  }
}, 5 * 60 * 1000);

export function registerPendingPhoneRequest(
  requestId: string,
  taskId: string,
  personId: string,
  personData: any,
  ageFilter?: { min?: number; max?: number }
) {
  pendingPhoneRequests.set(personId, {
    taskId,
    personId,
    personData,
    timestamp: Date.now(),
    ageFilter
  });
  console.log(`[Apollo Webhook] Registered pending request for person ${personId}, task ${taskId}, ageFilter: ${JSON.stringify(ageFilter)}`);
}

export function getPendingRequestCount(): number {
  return pendingPhoneRequests.size;
}

export async function handleApolloWebhook(payload: any): Promise<{ processed: number; errors: number; excluded: number }> {
  console.log('[Apollo Webhook] Received payload:', JSON.stringify(payload).slice(0, 1000));
  
  let processed = 0;
  let errors = 0;
  let excluded = 0;
  
  // Apollo webhook 返回的数据格式可能是:
  // 1. { people: [{ id, status, phone_numbers: [...] }] } - bulk_match webhook 响应 (最常见)
  // 2. { matches: [{ id, phone_numbers: [...] }] } - bulk_match 响应
  // 3. { person: { id, phone_numbers: [...] } } - 单个 match 响应
  // 4. 直接是数组 [{ id, phone_numbers: [...] }]
  // 5. { id, phone_numbers: [...] } - 单个对象
  
  let peopleToProcess: any[] = [];
  
  if (payload.people && Array.isArray(payload.people)) {
    // Apollo bulk_match webhook 返回格式
    peopleToProcess = payload.people;
    console.log(`[Apollo Webhook] Found ${peopleToProcess.length} people in payload.people`);
  } else if (payload.matches && Array.isArray(payload.matches)) {
    peopleToProcess = payload.matches;
    console.log(`[Apollo Webhook] Found ${peopleToProcess.length} people in payload.matches`);
  } else if (payload.person) {
    peopleToProcess = [payload.person];
    console.log(`[Apollo Webhook] Found 1 person in payload.person`);
  } else if (Array.isArray(payload)) {
    peopleToProcess = payload;
    console.log(`[Apollo Webhook] Found ${peopleToProcess.length} people in array payload`);
  } else if (payload.id && payload.phone_numbers) {
    peopleToProcess = [payload];
    console.log(`[Apollo Webhook] Found 1 person in direct payload`);
  }
  
  if (peopleToProcess.length === 0) {
    console.log('[Apollo Webhook] No valid data to process');
    return { processed: 0, errors: 0, excluded: 0 };
  }

  for (const match of peopleToProcess) {
    try {
      const personId = match.id;
      const phoneNumbers = match.phone_numbers || [];
      
      console.log(`[Apollo Webhook] Processing person ${personId}, phones: ${phoneNumbers.length}`);
      
      // 查找对应的待处理请求
      const pendingRequest = pendingPhoneRequests.get(personId);
      
      if (!pendingRequest) {
        console.log(`[Apollo Webhook] No pending request found for person ${personId}`);
        continue;
      }
      
      // 移除待处理请求
      pendingPhoneRequests.delete(personId);
      
      const { taskId, personData, ageFilter } = pendingRequest;
      
      if (phoneNumbers.length === 0) {
        console.log(`[Apollo Webhook] No phone numbers for person ${personId}`);
        // 更新结果状态为无电话
        await updateSearchResultByApolloId(taskId, personId, {
          phone: null,
          phoneStatus: 'no_phone',
          phoneType: null
        });
        
        // 添加日志
        await addWebhookLog(taskId, personData, '📱 无电话号码', 'warning');
        continue;
      }
      
      // 获取第一个电话号码（优先使用 mobile）
      // Apollo 返回的字段名是 type_cd 而不是 type
      let selectedPhone = phoneNumbers[0];
      for (const phone of phoneNumbers) {
        const phoneType = phone.type_cd || phone.type;
        if (phoneType === 'mobile' || phoneType === 'personal') {
          selectedPhone = phone;
          break;
        }
      }
      
      const phoneNumber = selectedPhone.sanitized_number || selectedPhone.raw_number;
      const phoneType = selectedPhone.type_cd || selectedPhone.type || 'unknown';
      
      console.log(`[Apollo Webhook] Found phone ${phoneNumber} (${phoneType}) for person ${personId}`);
      
      // 验证电话号码（同时获取年龄）
      const personToVerify: PersonToVerify = {
        firstName: personData.first_name || '',
        lastName: personData.last_name || '',
        city: personData.city || '',
        state: personData.state || '',
        phone: phoneNumber
      };
      
      console.log(`[Apollo Webhook] Verifying phone for ${personData.first_name} ${personData.last_name}`);
      const verifyResult = await verifyPhoneNumber(personToVerify);
      
      // 获取年龄
      const age = verifyResult.details?.age;
      
      // 年龄筛选检查
      if (ageFilter && age !== undefined) {
        const minAge = ageFilter.min || 0;
        const maxAge = ageFilter.max || 999;
        
        if (age < minAge || age > maxAge) {
          console.log(`[Apollo Webhook] Age ${age} not in range [${minAge}, ${maxAge}], excluding person ${personId}`);
          
          // 删除不符合年龄条件的结果
          await deleteSearchResult(taskId, personId);
          
          // 添加排除日志
          await addWebhookLog(
            taskId, 
            personData, 
            `🚫 年龄 ${age} 岁不在筛选范围 [${minAge}-${maxAge}]，已排除`, 
            'warning',
            { age, ageFilter }
          );
          
          excluded++;
          continue;
        }
        
        console.log(`[Apollo Webhook] Age ${age} is within range [${minAge}, ${maxAge}]`);
      }
      
      // 更新搜索结果
      const updateData: any = {
        phone: phoneNumber,
        phoneStatus: verifyResult.verified ? 'verified' : 'received',
        phoneType: phoneType,
        verified: verifyResult.verified,
        verificationScore: verifyResult.matchScore,
        verificationDetails: verifyResult.details
      };
      
      if (age !== undefined) {
        updateData.age = age;
      }
      if (verifyResult.details?.carrier) {
        updateData.carrier = verifyResult.details.carrier;
      }
      
      await updateSearchResultByApolloId(taskId, personId, updateData);
      
      // 生成详细日志 - 包含"找到电话"关键词以便前端统计
      const maskedPhone = phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
      let logMessage = `📱 找到电话: ${personData.first_name} ${personData.last_name}`;
      
      if (age !== undefined) {
        logMessage += ` (${age}岁)`;
      }
      
      logMessage += ` - ${maskedPhone}`;
      
      if (verifyResult.verified) {
        logMessage += ` ✅ 验证通过 (${verifyResult.matchScore}%)`;
      } else {
        logMessage += ` ⚠️ 待验证 (${verifyResult.matchScore}%)`;
      }
      
      await addWebhookLog(
        taskId, 
        personData, 
        logMessage, 
        verifyResult.verified ? 'success' : 'info',
        { phone: maskedPhone, age, verified: verifyResult.verified, score: verifyResult.matchScore }
      );
      
      console.log(`[Apollo Webhook] Updated result for ${personData.first_name} ${personData.last_name}, age: ${age}, verified: ${verifyResult.verified}, score: ${verifyResult.matchScore}`);
      
      processed++;
    } catch (error: any) {
      console.error(`[Apollo Webhook] Error processing match:`, error);
      errors++;
    }
  }
  
  console.log(`[Apollo Webhook] Completed: processed=${processed}, errors=${errors}, excluded=${excluded}`);
  return { processed, errors, excluded };
}

// 添加 webhook 处理日志到任务
async function addWebhookLog(
  taskId: string, 
  personData: any, 
  message: string, 
  level: 'info' | 'success' | 'warning' | 'error',
  details?: any
) {
  try {
    const task = await getSearchTask(taskId);
    if (task && task.logs) {
      const logs = task.logs as any[];
      const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      
      logs.push({
        timestamp,
        time: timestamp,
        level,
        phase: 'phone',
        message,
        details: {
          name: `${personData.first_name} ${personData.last_name}`,
          ...details
        }
      });
      
      await updateSearchTask(taskId, { logs });
    }
  } catch (error) {
    console.error('[Apollo Webhook] Error adding log:', error);
  }
}

export function getWebhookUrl(): string {
  // 使用环境变量或默认的 Railway URL
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const publicUrl = process.env.PUBLIC_URL;
  
  if (publicUrl) {
    return `${publicUrl}/api/apollo-webhook`;
  }
  
  if (railwayDomain) {
    return `https://${railwayDomain}/api/apollo-webhook`;
  }
  
  // 默认使用 Railway 生产环境 URL
  return 'https://leadhunter-pro-production.up.railway.app/api/apollo-webhook';
}
