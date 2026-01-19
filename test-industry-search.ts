/**
 * 测试 Apollo API 是否支持行业参数
 * 运行: npx tsx test-industry-search.ts
 */

import axios from 'axios';

const APOLLO_API_BASE = 'https://api.apollo.io/api/v1';

async function testIndustrySearch() {
  // 从环境变量获取 API Key
  const apiKey = process.env.APOLLO_API_KEY;
  
  if (!apiKey) {
    console.log('请设置 APOLLO_API_KEY 环境变量');
    return;
  }
  
  console.log('=== 测试 1: 使用 q_organization_keyword_tags 参数 ===\n');
  
  // 测试参数：Bob + 医疗行业关键词 + Texas
  const params1 = {
    per_page: 5,
    page: 1,
    q_keywords: 'Bob',
    person_locations: ['Texas, US'],
    q_organization_keyword_tags: ['hospital', 'healthcare', 'medical'],
  };
  
  console.log('请求参数:', JSON.stringify(params1, null, 2));
  
  try {
    const response = await axios.post(
      `${APOLLO_API_BASE}/mixed_people/api_search`,
      params1,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey
        },
        timeout: 30000
      }
    );
    
    console.log('\n状态码:', response.status);
    console.log('总数:', response.data.pagination?.total_entries || response.data.total_entries || 0);
    
    if (response.data.people && response.data.people.length > 0) {
      console.log('\n前 5 条结果:');
      for (const p of response.data.people.slice(0, 5)) {
        console.log(`  - ${p.name} | ${p.title} | ${p.organization_name}`);
        console.log(`    Organization: ${JSON.stringify(p.organization || {})}`);
      }
    }
  } catch (error: any) {
    console.log('\n错误:', error.response?.status, error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  console.log('=== 测试 2: 使用 industry_tag_ids 参数 ===\n');
  
  // 测试参数：使用 industry_tag_ids
  const params2 = {
    per_page: 5,
    page: 1,
    q_keywords: 'Bob',
    person_locations: ['Texas, US'],
    industry_tag_ids: ['5567cd4e73696439b1110000'], // Hospital & Health Care 的 ID
  };
  
  console.log('请求参数:', JSON.stringify(params2, null, 2));
  
  try {
    const response = await axios.post(
      `${APOLLO_API_BASE}/mixed_people/api_search`,
      params2,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey
        },
        timeout: 30000
      }
    );
    
    console.log('\n状态码:', response.status);
    console.log('总数:', response.data.pagination?.total_entries || response.data.total_entries || 0);
    
    if (response.data.people && response.data.people.length > 0) {
      console.log('\n前 5 条结果:');
      for (const p of response.data.people.slice(0, 5)) {
        console.log(`  - ${p.name} | ${p.title} | ${p.organization_name}`);
      }
    }
  } catch (error: any) {
    console.log('\n错误:', error.response?.status, error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(60) + '\n');
  console.log('=== 测试 3: 不使用行业参数（对照组）===\n');
  
  // 对照组：只用姓名和州
  const params3 = {
    per_page: 5,
    page: 1,
    q_keywords: 'Bob',
    person_locations: ['Texas, US'],
  };
  
  console.log('请求参数:', JSON.stringify(params3, null, 2));
  
  try {
    const response = await axios.post(
      `${APOLLO_API_BASE}/mixed_people/api_search`,
      params3,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'x-api-key': apiKey
        },
        timeout: 30000
      }
    );
    
    console.log('\n状态码:', response.status);
    console.log('总数:', response.data.pagination?.total_entries || response.data.total_entries || 0);
    
    if (response.data.people && response.data.people.length > 0) {
      console.log('\n前 5 条结果:');
      for (const p of response.data.people.slice(0, 5)) {
        console.log(`  - ${p.name} | ${p.title} | ${p.organization_name}`);
      }
    }
  } catch (error: any) {
    console.log('\n错误:', error.response?.status, error.response?.data || error.message);
  }
}

testIndustrySearch();
