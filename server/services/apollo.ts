import axios from 'axios';
import { getConfig, logApi } from '../db';

const APOLLO_API_BASE = 'https://api.apollo.io/v1';

export interface ApolloPerson {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  organization_name?: string;
  city: string;
  state: string;
  country: string;
  linkedin_url: string;
  email: string;
  phone_numbers?: Array<{
    raw_number: string;
    sanitized_number: string;
    type: string;
    position: number;
    status: string;
  }>;
}

export interface ApolloSearchResult {
  success: boolean;
  people: ApolloPerson[];
  totalCount: number;
  errorMessage?: string;
}

async function getApolloApiKey(): Promise<string> {
  const key = await getConfig('APOLLO_API_KEY');
  if (!key) throw new Error('Apollo API key not configured');
  return key;
}

export async function searchPeople(
  name: string,
  title: string,
  state: string,
  limit: number = 100,
  userId?: number
): Promise<ApolloSearchResult> {
  const apiKey = await getApolloApiKey();
  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${APOLLO_API_BASE}/mixed_people/search`,
      {
        api_key: apiKey,
        q_keywords: name,
        person_titles: [title],
        person_locations: [`United States, ${state}`],
        page: 1,
        per_page: Math.min(limit, 100),
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
    );

    const responseTime = Date.now() - startTime;
    await logApi('apollo_search', '/mixed_people/search', { name, title, state }, response.status, responseTime, true, undefined, 0, userId);

    return {
      success: true,
      people: response.data.people || [],
      totalCount: response.data.pagination?.total_entries || 0,
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    await logApi('apollo_search', '/mixed_people/search', { name, title, state }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
    return { success: false, people: [], totalCount: 0, errorMessage: error.message };
  }
}

export async function enrichPeopleBatch(peopleIds: string[], userId?: number): Promise<ApolloPerson[]> {
  const apiKey = await getApolloApiKey();
  const results: ApolloPerson[] = [];

  const shuffledIds = shuffleArray([...peopleIds]);
  const batchSize = 10;
  const batches = chunkArray(shuffledIds, batchSize);

  for (const batch of batches) {
    const startTime = Date.now();

    try {
      const response = await axios.post(
        `${APOLLO_API_BASE}/people/bulk_match`,
        {
          api_key: apiKey,
          details: batch.map(id => ({ id })),
          reveal_personal_emails: true,
          reveal_phone_number: true,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 60000 }
      );

      const responseTime = Date.now() - startTime;
      await logApi('apollo_enrich', '/people/bulk_match', { ids: batch }, response.status, responseTime, true, undefined, 0, userId);

      if (response.data.matches) {
        results.push(...response.data.matches);
      }
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      await logApi('apollo_enrich', '/people/bulk_match', { ids: batch }, error.response?.status || 0, responseTime, false, error.message, 0, userId);
    }
  }

  return results;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
