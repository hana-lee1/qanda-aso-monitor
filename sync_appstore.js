const jwt = require('jsonwebtoken');
const fs = require('fs');
const zlib = require('zlib');

const KEY_ID = '3223MTDBUU';
const ISSUER_ID = '69a6de8d-936e-47e3-e053-5b8c7c11a4d1';
const PK = fs.readFileSync('/Users/mlt318/Downloads/AuthKey_3223MTDBUU.p8', 'utf-8');
const ONGOING_ID = '83bd0b47-9ab8-4297-a40e-ad68291bfc72';

const SUPABASE_URL = 'https://wgzpqbuldhhgnkvcbziw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnenBxYnVsZGhoZ25rdmNieml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjYzMDIsImV4cCI6MjA5MDQwMjMwMn0.RVxI-kVZniF8DXhAhRfW2bM9uJE_q9qMYv306oxFXH8';

function token() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' },
    PK,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: KEY_ID, typ: 'JWT' } }
  );
}

async function apiFetch(url) {
  const t = token();
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + t } });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function downloadInstance(instanceId) {
  const segs = await apiFetch(`https://api.appstoreconnect.apple.com/v1/analyticsReportInstances/${instanceId}/segments`);
  let allData = '';
  for (const seg of segs.data || []) {
    const url = seg.attributes.url;
    if (!url) continue;
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    try { allData += zlib.gunzipSync(buf).toString('utf-8'); } catch { allData += buf.toString('utf-8'); }
  }
  return allData;
}

function parseTSV(tsv) {
  const lines = tsv.trim().split('\n');
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const vals = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = vals[i]?.trim() || '');
    return obj;
  });
}

async function supabaseInsert(table, records) {
  // Get existing dates to skip duplicates
  const dates = [...new Set(records.map(r => r.date))];
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?platform=eq.ios&date=in.(${dates.join(',')})&select=date`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = new Set((await existingRes.json()).map(r => r.date));
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
    console.log(`  ${table} batch ${Math.floor(i / 500) + 1}: ${res.status} (${batch.length})`);
  }
}

async function processAllInstances(reportId, reportName) {
  console.log(`\n--- ${reportName} ---`);
  let allInstances = [];
  let url = `https://api.appstoreconnect.apple.com/v1/analyticsReports/${reportId}/instances?limit=50`;
  while (url) {
    const data = await apiFetch(url);
    allInstances = allInstances.concat(data.data || []);
    url = data.links?.next || null;
  }
  console.log(`  ${allInstances.length} instances found`);

  let allRows = [];
  for (const inst of allInstances) {
    const tsv = await downloadInstance(inst.id);
    if (tsv) {
      const rows = parseTSV(tsv);
      allRows = allRows.concat(rows);
    }
  }
  console.log(`  ${allRows.length} total rows downloaded`);
  return allRows;
}

async function main() {
  const requestIds = [ONGOING_ID];

  // 1. Discovery & Engagement -> aso_store_views (iOS impressions + product page views)
  let allDiscovery = [];
  for (const rid of requestIds) {
    try {
      const rows = await processAllInstances(`r14-${rid}`, `Discovery (${rid.slice(0, 8)})`);
      allDiscovery = allDiscovery.concat(rows);
    } catch (e) { console.log(`  Skip: ${e.message.slice(0, 100)}`); }
  }

  // Filter KR, aggregate by date: Product Page View (고유 기기 = Unique Devices)
  const discoveryByDate = {};
  allDiscovery.filter(r => r.Territory === 'KR').forEach(r => {
    const d = r.Date;
    if (!d) return;
    if (!discoveryByDate[d]) discoveryByDate[d] = 0;
    const uniqueDevices = parseInt(r['Unique Devices']) || 0;
    if (r.Event === 'Product Page View') {
      discoveryByDate[d] += uniqueDevices;
    }
  });

  const viewRecords = Object.entries(discoveryByDate).map(([date, views]) => ({
    date, platform: 'ios', views
  }));
  console.log(`\niOS Store Views: ${viewRecords.length} dates`);
  if (viewRecords.length) await supabaseInsert('aso_store_views', viewRecords);

  // 2. App Downloads -> aso_downloads (iOS new downloads)
  let allDownloads = [];
  for (const rid of requestIds) {
    try {
      const rows = await processAllInstances(`r3-${rid}`, `Downloads (${rid.slice(0, 8)})`);
      allDownloads = allDownloads.concat(rows);
    } catch (e) { console.log(`  Skip: ${e.message.slice(0, 100)}`); }
  }

  // Filter KR, only first-time downloads, aggregate by date
  const dlByDate = {};
  allDownloads.filter(r => r.Territory === 'KR').forEach(r => {
    const d = r.Date;
    if (!d) return;
    const type = r['Download Type'] || '';
    // Count all download types (First-Time Download, Redownload, Auto-update)
    // For "new installs" we want First-Time Downloads only
    if (type === 'First-Time Download' || type === 'Redownload') {
      dlByDate[d] = (dlByDate[d] || 0) + (parseInt(r.Counts) || 0);
    }
  });

  const dlRecords = Object.entries(dlByDate).map(([date, downloads]) => ({
    date, platform: 'ios', downloads
  }));
  console.log(`\niOS Downloads: ${dlRecords.length} dates`);
  if (dlRecords.length) await supabaseInsert('aso_downloads', dlRecords);

  console.log('\nDone!');
}

main().catch(console.error);
