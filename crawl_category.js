/**
 * ASO Education Category Rank Crawler
 * - iOS iPhone: iTunes RSS topfreeapplications/genre=6017
 * - iOS iPad:   iTunes RSS topfreeipadapplications/genre=6017
 * - Play Store: google-play-scraper TOP_FREE EDUCATION
 * → Supabase aso_category_rankings 테이블에 저장
 *
 * Usage: node crawl_category.js
 */

const SUPABASE_URL = 'https://wgzpqbuldhhgnkvcbziw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnenBxYnVsZGhoZ25rdmNieml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjYzMDIsImV4cCI6MjA5MDQwMjMwMn0.RVxI-kVZniF8DXhAhRfW2bM9uJE_q9qMYv306oxFXH8';

const IOS_APP_ID = '1270676408';
const PS_PACKAGE = 'com.mathpresso.qanda';
const TODAY = new Date().toISOString().slice(0, 10);

// --- iOS: iTunes RSS Feed ---
async function getIosCategoryRank(feedPath) {
  const url = `https://itunes.apple.com/kr/rss/${feedPath}/limit=200/genre=6017/json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  if (!res.ok) throw new Error(`iTunes RSS ${res.status}`);
  const data = await res.json();
  const entries = data.feed?.entry || [];
  const idx = entries.findIndex(e => {
    const appId = e.id?.attributes?.['im:id'] || '';
    return appId === IOS_APP_ID;
  });
  return { rank: idx >= 0 ? idx + 1 : null, total: entries.length };
}

// --- Play Store: google-play-scraper ---
async function getPsCategoryRank() {
  const gplay = (await import('google-play-scraper')).default;
  const results = await gplay.list({
    category: gplay.category.EDUCATION,
    collection: gplay.collection.TOP_FREE,
    num: 200,
    lang: 'ko',
    country: 'kr'
  });
  const idx = results.findIndex(r => r.appId === PS_PACKAGE);
  return { rank: idx >= 0 ? idx + 1 : null, total: results.length };
}

// --- Supabase ---
async function saveToSupabase(records) {
  // 오늘자 기존 데이터 삭제 (재실행 안전)
  await fetch(
    `${SUPABASE_URL}/rest/v1/aso_category_rankings?date=eq.${TODAY}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      }
    }
  );

  const res = await fetch(`${SUPABASE_URL}/rest/v1/aso_category_rankings`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(records)
  });
  console.log(`  Supabase: ${res.status} (${records.length} records)`);
}

async function main() {
  console.log(`=== Education Category Rank Crawl: ${TODAY} ===\n`);

  const records = [];

  // iPhone
  console.log('[iOS - iPhone]');
  const iphone = await getIosCategoryRank('topfreeapplications');
  console.log(`  교육 무료 순위: ${iphone.rank ? iphone.rank + '위' : '순위권 밖'} (top ${iphone.total})`);
  records.push({ date: TODAY, platform: 'ios', category: 'Education', device: 'iphone', rank: iphone.rank });

  // iPad
  console.log('[iOS - iPad]');
  const ipad = await getIosCategoryRank('topfreeipadapplications');
  console.log(`  교육 무료 순위: ${ipad.rank ? ipad.rank + '위' : '순위권 밖'} (top ${ipad.total})`);
  records.push({ date: TODAY, platform: 'ios', category: 'Education', device: 'ipad', rank: ipad.rank });

  // Android
  console.log('[Play Store - Android]');
  const android = await getPsCategoryRank();
  console.log(`  교육 무료 순위: ${android.rank ? android.rank + '위' : '순위권 밖'} (top ${android.total})`);
  records.push({ date: TODAY, platform: 'playstore', category: 'Education', device: 'android', rank: android.rank });

  // Save
  console.log('\nSaving to Supabase...');
  await saveToSupabase(records);

  console.log('\nDone!');
}

main().catch(console.error);
