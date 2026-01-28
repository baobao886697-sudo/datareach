/**
 * 使用 Scrape.do API 获取页面（带超时和重试）
 * 
 * 关键参数说明 (根据 Scrape.do 技术支持建议):
 * - super=true: 使用住宅代理，提高成功率
 * - geoCode=us: 使用美国 IP
 * - 不使用 render=true: SearchPeopleFree 不支持渲染模式
 */
async function fetchWithScrapedo(url: string, token: string): Promise<string> {
  const encodedUrl = encodeURIComponent(url);
  const apiUrl = `https://api.scrape.do/?token=${token}&url=${encodedUrl}&super=true&geoCode=us`;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= SCRAPE_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS + 15000);
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // 检查是否是可重试的服务器错误 (502, 503, 504)
      if (!response.ok) {
        const isRetryableError = [502, 503, 504].includes(response.status);
        if (isRetryableError && attempt < SCRAPE_MAX_RETRIES) {
          console.log(`[SPF fetchWithScrapedo] 服务器错误 ${response.status}，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
          continue;
        }
        throw new Error(`Scrape.do API 请求失败: ${response.status} ${response.statusText}`);
      }
      
      const text = await response.text();
      
      // 检查响应是否是 JSON 错误（scrape.do 有时返回 200 但内容是 JSON 错误）
      if (text.startsWith('{') && text.includes('"StatusCode"')) {
        try {
          const jsonError = JSON.parse(text);
          const statusCode = jsonError.StatusCode || 0;
          const isRetryableError = [502, 503, 504].includes(statusCode);
          
          if (isRetryableError && attempt < SCRAPE_MAX_RETRIES) {
            console.log(`[SPF fetchWithScrapedo] API 返回 JSON 错误 (StatusCode: ${statusCode})，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
            await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
            continue;
          }
          
          const errorMsg = Array.isArray(jsonError.Message) ? jsonError.Message.join(', ') : (jsonError.Message || 'Unknown error');
          throw new Error(`Scrape.do API 返回错误: StatusCode ${statusCode} - ${errorMsg}`);
        } catch (parseError: any) {
          // 如果不是有效的 JSON 或已经是我们的错误，重新抛出
          if (parseError.message?.includes('Scrape.do API')) {
            throw parseError;
          }
        }
      }
      
      // 检查响应是否是有效的 HTML
      const trimmedText = text.trim();
      if (!trimmedText.startsWith('<') && !trimmedText.startsWith('<!DOCTYPE')) {
        if (attempt < SCRAPE_MAX_RETRIES) {
          console.log(`[SPF fetchWithScrapedo] 响应不是有效的 HTML，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
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
        console.log(`[SPF fetchWithScrapedo] 请求失败 (${error.message})，正在重试 (${attempt + 1}/${SCRAPE_MAX_RETRIES})...`);
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError || new Error('请求失败');
}
