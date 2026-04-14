/**
 * Sensor Tower ASO 키워드 일간 예상 다운로드 크롤링
 * - 기존 ASO monitoring에 등록된 키워드만 필터링
 * - Play Store + App Store
 * → Supabase aso_keyword_downloads_daily 테이블에 저장
 *
 * 사전 조건: node st_login.js 로 세션 저장 필요
 * Usage: node crawl_sensortower.js
 */

const { chromium } = require('playwright');

const SUPABASE_URL = 'https://wgzpqbuldhhgnkvcbziw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnenBxYnVsZGhoZ25rdmNieml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjYzMDIsImV4cCI6MjA5MDQwMjMwMn0.RVxI-kVZniF8DXhAhRfW2bM9uJE_q9qMYv306oxFXH8';

const SESSION_DIR = __dirname + '/.st-session';
const TODAY = new Date().toISOString().slice(0, 10);

// Sensor Tower URL 설정
const PS_VIEW_ID = '69a0059e04429989a8cf2159';
const IOS_VIEW_ID = '69d368fa3903072723c4bf3d';
const PS_APP_PARAM = 'ssaa=com.mathpresso.qanda';
const IOS_APP_PARAM = 'ssia=1270676408';

// Sensor Tower에 전달할 키워드 (ST 뷰에 등록된 전체 — 데이터는 이 중 모니터링 대상만 필터)
const PS_KEYWORDS = ['콴다','수학문제풀이','문제','콰다','콴디','문제풀이','콴','쾬다','답지','콴가','콴드','문제풀이앱','콴더','수학 문제 풀이','수학대왕','콴다 선생님 수학 문제 풀어주는 과외','qanda','문제 풀이','공부','콴자'];
const IOS_KEYWORDS = ['콴다','수학문제풀이','수학','콴다과외','문제','qanda','콴디','콴','쾬다','문제풀이앱','수학대왕','콴가','수학문제','답지','photomath','콴자','공부','문제풀이','quanda','개념원리ai'];

// 기존 ASO monitoring에 등록된 키워드만 저장
const MONITOR_PS_KEYWORDS = new Set(['개념원리ai','공부','답지','대성마이맥','디지털교과서','모의고사','문제','문제집','수학','수학대왕','수학문제','수학문제풀이','숙제','시험','열품타','오르조','올클','인강','풀이','내신','찰칵']);
const MONITOR_IOS_KEYWORDS = new Set(['ebs','개념원리ai','공부','공부앱','과학','답지','대성마이맥','메가스터디','모의고사','문제','문제집','수학','수학문제풀이','열품타','이투스','찰칵','풀이','수학대왕','올클','내신']);

function buildUrl(os, viewId, appParam, keywords) {
  const kwParams = keywords.map(k => `aso_keywords=${encodeURIComponent(k)}`).join('&');
  return `https://app.sensortower.com/store-marketing/aso/performance-tracking?os=${os}&country=KR&granularity=daily&start_date=${TODAY}&end_date=${TODAY}&device=iphone&page=1&page_size=200&metric=downloads&breakdown=selectedKeywords&aso_keyword_view=${viewId}&${appParam}&${kwParams}`;
}

async function fetchKeywordData(page, os, viewId, appParam, keywords) {
  const appId = appParam.split('=')[1];
  const matchId = os === 'ios' ? '1270676408' : appId;
  const matchPattern = `aso_keywords_management_table_${matchId}`;

  const url = buildUrl(os, viewId, appParam, keywords);

  // Start navigation and wait for the specific API response
  const [response] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes(matchPattern) && !res.url().includes('untrack'),
      { timeout: 60000 }
    ),
    page.goto(url, { waitUntil: 'commit', timeout: 60000 }),
  ]);

  const tableData = await response.json();

  if (!tableData?.data) {
    throw new Error(`No data for ${os}`);
  }

  const rows = tableData.data.filter(d => d.keyword);
  return rows;
}

async function saveDownloads(records) {
  if (!records.length) return;

  // Delete + insert for today (uses aso_keyword_downloads_daily)
  for (const platform of ['ios', 'playstore']) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/aso_keyword_downloads_daily?date=eq.${TODAY}&platform=eq.${platform}`,
      {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      }
    );
  }

  // Map to daily table schema
  const dailyRecords = records.map(r => ({
    date: r.date,
    platform: r.platform,
    keyword: r.keyword,
    est_downloads: r.installs
  }));

  for (let i = 0; i < dailyRecords.length; i += 500) {
    const batch = dailyRecords.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/aso_keyword_downloads_daily`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch)
    });
    console.log(`  aso_keyword_downloads_daily batch: ${res.status} (${batch.length} records)`);
  }
}

async function main() {
  console.log(`=== Sensor Tower Crawl: ${TODAY} ===\n`);

  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const dlRecords = [];

  // --- Play Store ---
  console.log('[Play Store] Fetching keyword data...');
  try {
    const psRows = await fetchKeywordData(page, 'android', PS_VIEW_ID, PS_APP_PARAM, PS_KEYWORDS);
    console.log(`  ST: ${psRows.length} keywords total`);
    for (const r of psRows) {
      if (r.est_keyword_downloads != null && MONITOR_PS_KEYWORDS.has(r.keyword)) {
        dlRecords.push({ date: TODAY, platform: 'playstore', keyword: r.keyword, installs: Math.round(r.est_keyword_downloads) });
        console.log(`  ${r.keyword}: ${Math.round(r.est_keyword_downloads)} dl`);
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }

  // --- App Store ---
  console.log('\n[App Store] Fetching keyword data...');
  try {
    const iosRows = await fetchKeywordData(page, 'ios', IOS_VIEW_ID, IOS_APP_PARAM, IOS_KEYWORDS);
    console.log(`  ST: ${iosRows.length} keywords total`);
    for (const r of iosRows) {
      if (r.est_keyword_downloads != null && MONITOR_IOS_KEYWORDS.has(r.keyword)) {
        dlRecords.push({ date: TODAY, platform: 'ios', keyword: r.keyword, installs: Math.round(r.est_keyword_downloads) });
        console.log(`  ${r.keyword}: ${Math.round(r.est_keyword_downloads)} dl`);
      }
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }

  await ctx.close();

  // --- Save to Supabase ---
  console.log(`\nSaving ${dlRecords.length} download records...`);
  await saveDownloads(dlRecords);

  const psDl = dlRecords.filter(r => r.platform === 'playstore');
  const iosDl = dlRecords.filter(r => r.platform === 'ios');
  console.log(`\n=== Summary ===`);
  console.log(`  PS: ${psDl.length} keywords, total ${psDl.reduce((s, r) => s + r.installs, 0)} dl`);
  console.log(`  iOS: ${iosDl.length} keywords, total ${iosDl.reduce((s, r) => s + r.installs, 0)} dl`);

  if (dlRecords.length === 0) {
    console.log('ERROR: No data fetched. Session may have expired. Run: node st_login.js');
    process.exit(1);
  }
  console.log('Done!');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
