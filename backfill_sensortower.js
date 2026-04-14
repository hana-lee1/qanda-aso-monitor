/**
 * Sensor Tower 90일치 키워드별 주간 install 백필
 * 차트 API에서 주간 데이터를 가져와 aso_keyword_downloads_daily에 저장
 * (무료 플랜은 차트가 주간 단위, daily는 crawl_sensortower.js에서 매일 수집)
 */
const { chromium } = require('playwright');

const SUPABASE_URL = 'https://wgzpqbuldhhgnkvcbziw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnenBxYnVsZGhoZ25rdmNieml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjYzMDIsImV4cCI6MjA5MDQwMjMwMn0.RVxI-kVZniF8DXhAhRfW2bM9uJE_q9qMYv306oxFXH8';

const SESSION_DIR = __dirname + '/.st-session';

const PS_VIEW_ID = '69a0059e04429989a8cf2159';
const IOS_VIEW_ID = '69d368fa3903072723c4bf3d';
const PS_KEYWORDS = ['콴다','수학문제풀이','문제','콰다','콴디','문제풀이','콴','쾬다','답지','콴가','콴드','문제풀이앱','콴더','수학 문제 풀이','수학대왕','콴다 선생님 수학 문제 풀어주는 과외','qanda','문제 풀이','공부','콴자'];
const IOS_KEYWORDS = ['콴다','수학문제풀이','수학','콴다과외','문제','qanda','콴디','콴','쾬다','문제풀이앱','수학대왕','콴가','수학문제','답지','photomath','콴자','공부','문제풀이','quanda','개념원리ai'];

const MONITOR_PS = new Set(['개념원리ai','공부','답지','대성마이맥','디지털교과서','모의고사','문제','문제집','수학','수학대왕','수학문제','수학문제풀이','숙제','시험','열품타','오르조','올클','인강','풀이','내신','찰칵']);
const MONITOR_IOS = new Set(['ebs','개념원리ai','공부','공부앱','과학','답지','대성마이맥','메가스터디','모의고사','문제','문제집','수학','수학문제풀이','열품타','이투스','찰칵','풀이','수학대왕','올클','내신']);

// 90일 기간
const END = new Date().toISOString().slice(0, 10);
const START = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

function buildUrl(os, viewId, appParam, keywords) {
  const kwParams = keywords.map(k => `aso_keywords=${encodeURIComponent(k)}`).join('&');
  return `https://app.sensortower.com/store-marketing/aso/performance-tracking?os=${os}&country=KR&granularity=daily&start_date=${START}&end_date=${END}&duration=P90D&device=iphone&page=1&page_size=200&metric=downloads&breakdown=selectedKeywords&aso_keyword_view=${viewId}&${appParam}&${kwParams}`;
}

async function fetchChartData(page, os, viewId, appParam, keywords) {
  const appId = appParam.split('=')[1];
  const matchId = os === 'ios' ? '1270676408' : appId;
  const chartPattern = `aso_performance_tracking_chart_${matchId}`;

  const url = buildUrl(os, viewId, appParam, keywords);

  const [response] = await Promise.all([
    page.waitForResponse(
      res => res.url().includes(chartPattern),
      { timeout: 60000 }
    ),
    page.goto(url, { waitUntil: 'commit', timeout: 60000 }),
  ]);

  const json = await response.json();
  return json.data || [];
}

async function main() {
  console.log(`=== Sensor Tower Backfill: ${START} ~ ${END} ===\n`);

  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  const allRecords = [];

  // --- Play Store ---
  console.log('[Play Store] Fetching 90-day chart data...');
  try {
    const rows = await fetchChartData(page, 'android', PS_VIEW_ID, 'ssaa=com.mathpresso.qanda', PS_KEYWORDS);
    console.log(`  Chart rows: ${rows.length}`);
    for (const r of rows) {
      if (r.keyword && r.date && r.est_keyword_downloads != null && MONITOR_PS.has(r.keyword)) {
        allRecords.push({ date: r.date, platform: 'playstore', keyword: r.keyword, est_downloads: Math.round(r.est_keyword_downloads) });
      }
    }
    const psDates = [...new Set(allRecords.filter(r => r.platform === 'playstore').map(r => r.date))].sort();
    console.log(`  Filtered: ${allRecords.filter(r => r.platform === 'playstore').length} records, ${psDates.length} dates`);
    if (psDates.length) console.log(`  Range: ${psDates[0]} ~ ${psDates[psDates.length - 1]}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }

  // --- App Store ---
  console.log('\n[App Store] Fetching 90-day chart data...');
  try {
    const rows = await fetchChartData(page, 'ios', IOS_VIEW_ID, 'ssia=1270676408', IOS_KEYWORDS);
    console.log(`  Chart rows: ${rows.length}`);
    for (const r of rows) {
      if (r.keyword && r.date && r.est_keyword_downloads != null && MONITOR_IOS.has(r.keyword)) {
        allRecords.push({ date: r.date, platform: 'ios', keyword: r.keyword, est_downloads: Math.round(r.est_keyword_downloads) });
      }
    }
    const iosDates = [...new Set(allRecords.filter(r => r.platform === 'ios').map(r => r.date))].sort();
    console.log(`  Filtered: ${allRecords.filter(r => r.platform === 'ios').length} records, ${iosDates.length} dates`);
    if (iosDates.length) console.log(`  Range: ${iosDates[0]} ~ ${iosDates[iosDates.length - 1]}`);
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }

  await ctx.close();

  if (!allRecords.length) {
    console.log('\nNo records to save.');
    return;
  }

  // --- Delete existing and insert ---
  console.log(`\nSaving ${allRecords.length} records to Supabase...`);

  // Delete existing daily data for this range
  for (const platform of ['ios', 'playstore']) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/aso_keyword_downloads_daily?platform=eq.${platform}&date=gte.${START}&date=lte.${END}`,
      { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    console.log(`  Deleted ${platform}: ${res.status}`);
  }

  // Insert in batches
  for (let i = 0; i < allRecords.length; i += 500) {
    const batch = allRecords.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/aso_keyword_downloads_daily`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch)
    });
    console.log(`  Batch ${Math.floor(i / 500) + 1}: ${res.status} (${batch.length} records)`);
  }

  console.log('Done!');
}

main().catch(console.error);
