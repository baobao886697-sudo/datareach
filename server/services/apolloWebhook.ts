import { getSearchTask, updateSearchTask, getSearchResults, updateSearchResultByApolloId } from '../db';
import { verifyPhoneNumber, PersonToVerify } from './scraper';

// 存储待处理的电话号码请求
interface PendingRequest {
  taskId: string;
  personId: string;
  personData: any;
  timestamp: number;
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
  personData: any
) {
  pendingPhoneRequests.set(personId, {
    taskId,
    personId,
    personData,
    timestamp: Date.now()
  });
  console.log(`[Apollo Webhook] Registered pending request for person ${personId}, task ${taskId}`);
}

export function getPendingRequestCount(): number {
  return pendingPhoneRequests.size;
}

export async function handleApolloWebhook(payload: any): Promise<{ processed: number; errors: number }> {
  console.log('[Apollo Webhook] Received payload:', JSON.stringify(payload).slice(0, 1000));
  
  let processed = 0;
  let errors = 0;
  
  // Apollo webhook 返回的数据格式可能是:
  // 1. { matches: [{ id, phone_numbers: [...] }] } - bulk_match 响应
  // 2. { person: { id, phone_numbers: [...] } } - 单个 match 响应
  // 3. 直接是数组 [{ id, phone_numbers: [...] }]
  
  let peopleToProcess: any[] = [];
  
  if (payload.matches && Array.isArray(payload.matches)) {
    peopleToProcess = payload.matches;
  } else if (payload.person) {
    peopleToProcess = [payload.person];
  } else if (Array.isArray(payload)) {
    peopleToProcess = payload;
  } else if (payload.id && payload.phone_numbers) {
    peopleToProcess = [payload];
  }
  
  if (peopleToProcess.length === 0) {
    console.log('[Apollo Webhook] No valid data to process');
    return { processed: 0, errors: 0 };
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
      
      const { taskId, personData } = pendingRequest;
      
      if (phoneNumbers.length === 0) {
        console.log(`[Apollo Webhook] No phone numbers for person ${personId}`);
        // 更新结果状态为无电话
        await updateSearchResultByApolloId(taskId, personId, {
          phone: null,
          phoneStatus: 'no_phone',
          phoneType: null
        });
        continue;
      }
      
      // 获取第一个电话号码（优先使用 mobile）
      let selectedPhone = phoneNumbers[0];
      for (const phone of phoneNumbers) {
        if (phone.type === 'mobile' || phone.type === 'personal') {
          selectedPhone = phone;
          break;
        }
      }
      
      const phoneNumber = selectedPhone.sanitized_number || selectedPhone.raw_number;
      const phoneType = selectedPhone.type || 'unknown';
      
      console.log(`[Apollo Webhook] Found phone ${phoneNumber} (${phoneType}) for person ${personId}`);
      
      // 验证电话号码
      const personToVerify: PersonToVerify = {
        firstName: personData.first_name || '',
        lastName: personData.last_name || '',
        city: personData.city || '',
        state: personData.state || '',
        phone: phoneNumber
      };
      
      console.log(`[Apollo Webhook] Verifying phone for ${personData.first_name} ${personData.last_name}`);
      const verifyResult = await verifyPhoneNumber(personToVerify);
      
      // 更新搜索结果
      const updateData: any = {
        phone: phoneNumber,
        phoneStatus: verifyResult.verified ? 'verified' : 'received',
        phoneType: phoneType,
        verified: verifyResult.verified,
        verificationScore: verifyResult.matchScore,
        verificationDetails: verifyResult.details
      };
      
      if (verifyResult.details?.age) {
        updateData.age = verifyResult.details.age;
      }
      if (verifyResult.details?.carrier) {
        updateData.carrier = verifyResult.details.carrier;
      }
      
      await updateSearchResultByApolloId(taskId, personId, updateData);
      
      console.log(`[Apollo Webhook] Updated result for ${personData.first_name} ${personData.last_name}, verified: ${verifyResult.verified}, score: ${verifyResult.matchScore}`);
      
      // 更新任务日志
      const task = await getSearchTask(taskId);
      if (task && task.logs) {
        const logs = task.logs as any[];
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        logs.push({
          timestamp,
          level: verifyResult.verified ? 'success' : 'info',
          message: `📱 ${personData.first_name} ${personData.last_name} - 电话已获取: ${phoneNumber.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')} (${verifyResult.verified ? '已验证' : '待验证'})`
        });
        
        await updateSearchTask(taskId, { logs });
      }
      
      processed++;
    } catch (error: any) {
      console.error(`[Apollo Webhook] Error processing match:`, error);
      errors++;
    }
  }
  
  console.log(`[Apollo Webhook] Completed: processed=${processed}, errors=${errors}`);
  return { processed, errors };
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
