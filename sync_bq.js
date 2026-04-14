const fs = require('fs');

const SUPABASE_URL = 'https://wgzpqbuldhhgnkvcbziw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnenBxYnVsZGhoZ25rdmNieml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjYzMDIsImV4cCI6MjA5MDQwMjMwMn0.RVxI-kVZniF8DXhAhRfW2bM9uJE_q9qMYv306oxFXH8';

async function upsert(table, records) {
  if (!records.length) return;
  // Get existing dates to skip duplicates
  const dates = [...new Set(records.map(r => r.date))];
  const dateFilter = dates.map(d => `"${d}"`).join(',');
  const existRes = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?platform=eq.playstore&date=in.(${dates.join(',')})&select=date`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = new Set((await existRes.json()).map(r => r.date));
  const newRecords = records.filter(r => !existing.has(r.date));
  console.log(`  ${table}: ${records.length} total, ${existing.size} existing, ${newRecords.length} new`);

  if (!newRecords.length) return;
  for (let i = 0; i < newRecords.length; i += 500) {
    const batch = newRecords.slice(i, i + 500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch)
    });
    console.log(`  ${table} batch ${Math.floor(i/500)+1}: ${res.status} (${batch.length} records)`);
  }
}

function parseJSON(filePath) {
  if (!fs.existsSync(filePath)) { console.log(`  File not found: ${filePath}`); return []; }
  const raw = fs.readFileSync(filePath, 'utf-8');
  // BQ output has status line before JSON, find the array start
  const jsonStart = raw.indexOf('[');
  if (jsonStart === -1) {
    console.log(`  No JSON array in ${filePath}: ${raw.slice(0, 200)}`);
    return [];
  }
  return JSON.parse(raw.slice(jsonStart));
}

async function main() {
  // 1. Store Performance -> aso_downloads + aso_store_views
  console.log('=== Store Performance ===');
  const storeData = parseJSON('/tmp/bq_store_perf.json');
  console.log(`  Parsed ${storeData.length} rows`);

  const downloads = storeData.map(r => ({
    date: r.Date,
    platform: 'playstore',
    downloads: parseInt(r.Store_listing_acquisitions) || 0
  }));

  const views = storeData.map(r => ({
    date: r.Date,
    platform: 'playstore',
    views: parseInt(r.Store_listing_visitors) || 0
  }));

  console.log('  Syncing downloads...');
  await upsert('aso_downloads', downloads);
  console.log('  Syncing store views...');
  await upsert('aso_store_views', views);

  // 2. Ratings -> aso_ratings (insert new + update avg)
  console.log('\n=== Ratings ===');
  const ratingsData = parseJSON('/tmp/bq_ratings.json');
  console.log(`  Parsed ${ratingsData.length} rows`);

  // Insert new dates (ignore duplicates)
  const ratingRecords = ratingsData.map(r => ({
    date: r.Date,
    platform: 'playstore',
    daily_avg_rating: parseFloat(r.Daily_Average_Rating) || null,
    total_avg_rating: parseFloat(r.Total_Average_Rating) || null,
    star5: 0, star4: 0, star3: 0, star2: 0, star1: 0
  }));
  await upsert('aso_ratings', ratingRecords);

  // Update daily_avg_rating for all dates
  let updated = 0;
  for (const r of ratingsData) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/aso_ratings?date=eq.${r.Date}&platform=eq.playstore`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_avg_rating: parseFloat(r.Daily_Average_Rating) || null, total_avg_rating: parseFloat(r.Total_Average_Rating) || null })
    });
    if (res.ok) updated++;
  }
  console.log(`  Updated avg ratings: ${updated} rows`);

  console.log('\nDone!');
}

main().catch(console.error);
