import axios from 'axios';
import { getConfig, logApi } from '../db';

const SCRAPE_DO_BASE = 'https://api.scrape.do';

export interface VerificationResult {
  verified: boolean;
  source: 'TruePeopleSearch' | 'FastPeopleSearch' | 'none';
  matchScore: number;
  phoneNumber?: string;
  phoneType?: 'mobile' | 'landline' | 'voip' | 'unknown';
  carrier?: string;
  details?: {
    age?: number;
    city?: string;
    state?: string;
    carrier?: string;
  };
  rawData?: any;
}

export interface PersonToVerify {
  firstName: string;
  lastName: string;
  city?: string;
  state: string;
  phone: string;
}

async function getScrapeDoToken(): Promise<string> {
  // 支持两种配置名称
  let token = await getConfig('SCRAPE_DO_API_KEY');
  if (!token) {
    token = await getConfig('SCRAPE_DO_TOKEN');
  }
  if (!token) {
    throw new Error('Scrape.do API token not configured (SCRAPE_DO_API_KEY or SCRAPE_DO_TOKEN)');
  }
  return token;
}

export async function verifyWithTruePeopleSearch(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  const startTime = Date.now();

  const searchName = `${person.firstName} ${person.lastName}`.replace(/\s+/g, '-');
  const location = person.city ? `${person.city}-${person.state}`.replace(/\s+/g, '-') : person.state;
  const targetUrl = `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(searchName)}&citystatezip=${encodeURIComponent(location)}`;

  try {
    const response = await axios.get(SCRAPE_DO_BASE, {
      params: { token, url: targetUrl, super: true, geoCode: 'us', render: true },
      timeout: 60000,
    });

    const responseTime = Date.now() - startTime;
    const html = response.data;
    const result = parseTruePeopleSearchResult(html, person);

    await logApi('scrape_tps', targetUrl, { name: searchName, location }, response.status, responseTime, true, undefined, 0, userId);

    return result;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    await logApi('scrape_tps', targetUrl, { name: searchName, location }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
    return { verified: false, source: 'none', matchScore: 0 };
  }
}

export async function verifyWithFastPeopleSearch(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  const token = await getScrapeDoToken();
  const startTime = Date.now();

  const searchName = `${person.firstName}-${person.lastName}`;
  const location = person.city ? `${person.city}-${person.state}` : person.state;
  const targetUrl = `https://www.fastpeoplesearch.com/name/${encodeURIComponent(searchName)}_${encodeURIComponent(location)}`;

  try {
    const response = await axios.get(SCRAPE_DO_BASE, {
      params: { token, url: targetUrl, super: true, geoCode: 'us', render: true },
      timeout: 60000,
    });

    const responseTime = Date.now() - startTime;
    const html = response.data;
    const result = parseFastPeopleSearchResult(html, person);

    await logApi('scrape_fps', targetUrl, { name: searchName, location }, response.status, responseTime, true, undefined, 0, userId);

    return result;
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    await logApi('scrape_fps', targetUrl, { name: searchName, location }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
    return { verified: false, source: 'none', matchScore: 0 };
  }
}

export async function verifyPhoneNumber(person: PersonToVerify, userId?: number): Promise<VerificationResult> {
  const tpsResult = await verifyWithTruePeopleSearch(person, userId);
  
  if (tpsResult.verified && tpsResult.matchScore >= 70) {
    return { ...tpsResult, source: 'TruePeopleSearch' };
  }

  const fpsResult = await verifyWithFastPeopleSearch(person, userId);
  
  if (fpsResult.verified && fpsResult.matchScore >= 70) {
    return { ...fpsResult, source: 'FastPeopleSearch' };
  }

  return tpsResult.matchScore > fpsResult.matchScore ? tpsResult : fpsResult;
}

function parseTruePeopleSearchResult(html: string, person: PersonToVerify): VerificationResult {
  const result: VerificationResult = { verified: false, source: 'TruePeopleSearch', matchScore: 0, details: {} };

  try {
    const namePattern = new RegExp(`${escapeRegex(person.firstName)}[\\s\\S]*?${escapeRegex(person.lastName)}`, 'i');
    if (!namePattern.test(html)) return result;

    let score = 30;

    const statePattern = new RegExp(`\\b${escapeRegex(person.state)}\\b`, 'i');
    if (statePattern.test(html)) score += 20;

    if (person.city) {
      const cityPattern = new RegExp(`\\b${escapeRegex(person.city)}\\b`, 'i');
      if (cityPattern.test(html)) score += 20;
    }

    const cleanPhone = person.phone.replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
      const phonePattern = new RegExp(cleanPhone.slice(-10));
      if (phonePattern.test(html.replace(/\D/g, ''))) {
        score += 30;
        result.verified = true;
      }
    }

    const ageMatch = html.match(/Age[:\s]*(\d{2,3})/i);
    if (ageMatch) result.details!.age = parseInt(ageMatch[1], 10);

    const carrierMatch = html.match(/(?:Carrier|Provider)[:\s]*([A-Za-z\s]+?)(?:<|,|\n)/i);
    if (carrierMatch) result.details!.carrier = carrierMatch[1].trim();

    if (/mobile|cell|wireless/i.test(html)) result.phoneType = 'mobile';
    else if (/landline|home/i.test(html)) result.phoneType = 'landline';
    else if (/voip/i.test(html)) result.phoneType = 'voip';

    result.matchScore = Math.min(score, 100);
  } catch (error) {
    console.error('Error parsing TruePeopleSearch result:', error);
  }

  return result;
}

function parseFastPeopleSearchResult(html: string, person: PersonToVerify): VerificationResult {
  const result: VerificationResult = { verified: false, source: 'FastPeopleSearch', matchScore: 0, details: {} };

  try {
    const namePattern = new RegExp(`${escapeRegex(person.firstName)}[\\s\\S]*?${escapeRegex(person.lastName)}`, 'i');
    if (!namePattern.test(html)) return result;

    let score = 30;

    const statePattern = new RegExp(`\\b${escapeRegex(person.state)}\\b`, 'i');
    if (statePattern.test(html)) score += 20;

    if (person.city) {
      const cityPattern = new RegExp(`\\b${escapeRegex(person.city)}\\b`, 'i');
      if (cityPattern.test(html)) score += 20;
    }

    const cleanPhone = person.phone.replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
      const phonePattern = new RegExp(cleanPhone.slice(-10));
      if (phonePattern.test(html.replace(/\D/g, ''))) {
        score += 30;
        result.verified = true;
      }
    }

    const ageMatch = html.match(/(\d{2,3})\s*(?:years?\s*old|yo)/i);
    if (ageMatch) result.details!.age = parseInt(ageMatch[1], 10);

    result.matchScore = Math.min(score, 100);
  } catch (error) {
    console.error('Error parsing FastPeopleSearch result:', error);
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
