/**
 * ASO Keyword Rank Crawler
 * - iOS: iTunes Search API (공식, 안정적)
 * - Play Store: google-play-scraper (npm)
 * → Supabase aso_keyword_rankings 테이블에 저장
 *
 * Usage: node crawl_keywords.js
 * Cron:  매일 09:00 KST 실행 권장
 */

const SUPABASE_URL = 'https://wgzpqbuldhhgnkvcbziw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnenBxYnVsZGhoZ25rdmNieml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjYzMDIsImV4cCI6MjA5MDQwMjMwMn0.RVxI-kVZniF8DXhAhRfW2bM9uJE_q9qMYv306oxFXH8';

const IOS_APP_ID = 1270676408; // QANDA App Store ID
const IOS_BUNDLE_ID = 'Mathpresso.QandaStudent';
const PS_PACKAGE = 'com.mathpresso.qanda';

const IOS_KEYWORDS = ['ebs','개념원리ai','공부','공부앱','과학','답지','대성마이맥','메가스터디','모의고사','문제','문제집','수학','수학문제풀이','열품타','이투스','찰칵','풀이','수학대왕','올클','내신'];
const PS_KEYWORDS = ['개념원리ai','공부','답지','대성마이맥','디지털교과서','모의고사','문제','문제집','수학','수학대왕','수학문제','수학문제풀이','숙제','시험','열품타','오르조','올클','인강','풀이','내신','찰칵'];

const TODAY = new Date().toISOString().slice(0, 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- iOS: iTunes Search API ---
async function getIosRank(keyword) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(keyword)}&media=software&country=kr&limit=200`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  if (!res.ok) throw new Error(`iTunes API ${res.status}`);
  const data = await res.json();
  const results = data.results || [];
  const idx = results.findIndex(r =>
    r.trackId === IOS_APP_ID ||
    r.bundleId === IOS_BUNDLE_ID ||
    r.bundleId?.toLowerCase().includes('mathpresso')
  );
  return idx >= 0 ? idx + 1 : null;
}

// --- Play Store: google-play-scraper ---
async function getPsRank(keyword, gplay) {
  const results = await gplay.search({
    term: keyword,
    num: 200,
    lang: 'ko',
    country: 'kr'
  });
  const idx = results.findIndex(r => r.appId === PS_PACKAGE);
  return idx >= 0 ? idx + 1 : null;
}

// --- Supabase upsert ---
async function saveToSupabase(records) {
  // Use plain POST (ignore-duplicates won't work without unique constraint)
  // First, delete today's existing records to allow re-runs
  for (const platform of ['ios', 'playstore']) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/aso_keyword_rankings?date=eq.${TODAY}&platform=eq.${platform}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        }
      }
    );
  }

  // Insert all records
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/aso_keyword_rankings`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch)
    });
    console.log(`  Supabase batch ${Math.floor(i / 500) + 1}: ${res.status} (${batch.length} records)`);
  }
}

async function main() {
  console.log(`=== ASO Keyword Rank Crawl: ${TODAY} ===\n`);

  const records = [];

  // --- iOS ---
  console.log('[iOS] Crawling keyword ranks...');
  for (const kw of IOS_KEYWORDS) {
    try {
      const rank = await getIosRank(kw);
      records.push({ date: TODAY, platform: 'ios', keyword: kw, rank });
      const display = rank ? `${rank}위` : '순위권 밖';
      console.log(`  ${kw}: ${display}`);
    } catch (e) {
      console.log(`  ${kw}: ERROR - ${e.message}`);
      records.push({ date: TODAY, platform: 'ios', keyword: kw, rank: null });
    }
    await sleep(1000); // rate limit 방지
  }

  // --- Play Store ---
  console.log('\n[Play Store] Crawling keyword ranks...');
  const gplay = (await import('google-play-scraper')).default;
  for (const kw of PS_KEYWORDS) {
    try {
      const rank = await getPsRank(kw, gplay);
      records.push({ date: TODAY, platform: 'playstore', keyword: kw, rank });
      const display = rank ? `${rank}위` : '순위권 밖';
      console.log(`  ${kw}: ${display}`);
    } catch (e) {
      console.log(`  ${kw}: ERROR - ${e.message}`);
      records.push({ date: TODAY, platform: 'playstore', keyword: kw, rank: null });
    }
    await sleep(1500); // rate limit 방지
  }

  // --- Save ---
  console.log(`\nSaving ${records.length} records to Supabase...`);
  await saveToSupabase(records);

  // --- Summary ---
  const iosRanked = records.filter(r => r.platform === 'ios' && r.rank != null);
  const psRanked = records.filter(r => r.platform === 'playstore' && r.rank != null);
  const iosAvg = iosRanked.length ? (iosRanked.reduce((s, r) => s + r.rank, 0) / iosRanked.length).toFixed(1) : '-';
  const psAvg = psRanked.length ? (psRanked.reduce((s, r) => s + r.rank, 0) / psRanked.length).toFixed(1) : '-';

  console.log(`\n=== Summary ===`);
  console.log(`  iOS: ${iosRanked.length}/${IOS_KEYWORDS.length} keywords ranked, avg ${iosAvg}위`);
  console.log(`  PS:  ${psRanked.length}/${PS_KEYWORDS.length} keywords ranked, avg ${psAvg}위`);
  console.log('Done!');
}

main().catch(console.error);
