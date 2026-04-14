/**
 * iOS 2025 제품 페이지 조회 수 가져오기
 * 1) Snapshot 리포트 생성 (없으면)
 * 2) Discovery 인스턴스 대기
 * 3) KR 제품 페이지 뷰 데이터 다운로드
 * 4) Supabase aso_store_views에 저장
 *
 * Usage: node fetch_ios_views_2025.js
 * (Snapshot 생성 후 최대 48시간 소요. 여러 번 실행해도 안전)
 */
const jwt = require('jsonwebtoken');
const fs = require('fs');
const zlib = require('zlib');

const KEY_ID = '3223MTDBUU';
const ISSUER_ID = '69a6de8d-936e-47e3-e053-5b8c7c11a4d1';
const PK = fs.readFileSync('/Users/mlt318/Downloads/AuthKey_3223MTDBUU.p8', 'utf-8');
const APP_ID = '1270676408';

const SUPABASE_URL = 'https://wgzpqbuldhhgnkvcbziw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndnenBxYnVsZGhoZ25rdmNieml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MjYzMDIsImV4cCI6MjA5MDQwMjMwMn0.RVxI-kVZniF8DXhAhRfW2bM9uJE_q9qMYv306oxFXH8';

function token() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({ iss: ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }, PK,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: KEY_ID, typ: 'JWT' } });
}

async function api(url, opts = {}) {
  const t = token();
  const res = await fetch(url, { ...opts, headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json', ...opts.headers } });
  if (res.status === 204) return null;
  const text = await res.text();
  try { return { status: res.status, ok: res.ok, data: JSON.parse(text) }; } catch { return { status: res.status, ok: res.ok, data: text }; }
}

async function getOrCreateSnapshot() {
  // Check existing requests
  const list = await api(`https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}/analyticsReportRequests`);
  const snapshot = list.data?.data?.find(r => r.attributes?.accessType === 'ONE_TIME_SNAPSHOT');
  if (snapshot) {
    console.log('Existing snapshot:', snapshot.id);
    return snapshot.id;
  }

  // Create new
  console.log('Creating new snapshot...');
  const body = {
    data: {
      type: 'analyticsReportRequests',
      attributes: { accessType: 'ONE_TIME_SNAPSHOT' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } }
    }
  };
  const res = await api('https://api.appstoreconnect.apple.com/v1/analyticsReportRequests', {
    method: 'POST', body: JSON.stringify(body)
  });
  if (res.ok) {
    console.log('Created snapshot:', res.data.data.id);
    return res.data.data.id;
  }
  console.log('Failed to create snapshot:', res.status, res.data?.errors?.[0]?.detail);
  return null;
}

async function getDiscoveryInstances(snapshotId) {
  const reportId = `r14-${snapshotId}`;
  let url = `https://api.appstoreconnect.apple.com/v1/analyticsReports/${reportId}/instances?limit=200`;
  let all = [];
  while (url) {
    const res = await api(url);
    if (!res?.ok) break;
    all = all.concat(res.data?.data || []);
    url = res.data?.links?.next || null;
  }
  return all;
}

async function downloadInstance(instanceId) {
  const segs = await api(`https://api.appstoreconnect.apple.com/v1/analyticsReportInstances/${instanceId}/segments`);
  let allData = '';
  for (const seg of segs.data?.data || []) {
    const url = seg.attributes?.url;
    if (!url) continue;
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    try { allData += zlib.gunzipSync(buf).toString('utf-8'); } catch { allData += buf.toString('utf-8'); }
  }
  return allData;
}

function parseTSV(tsv) {
  const lines = tsv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map(line => {
    const vals = line.split('\t');
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = vals[i]?.trim() || '');
    return obj;
  });
}

async function main() {
  console.log('=== iOS 2025 Store Views Fetch ===\n');

  // Step 1: Get or create snapshot
  const snapshotId = await getOrCreateSnapshot();
  if (!snapshotId) {
    console.log('\nSnapshot not available yet. Try again later.');
    return;
  }

  // Step 2: Check discovery instances
  const instances = await getDiscoveryInstances(snapshotId);
  console.log(`Discovery instances: ${instances.length}`);

  if (instances.length === 0) {
    console.log('\nNo instances yet. Apple is still generating the snapshot.');
    console.log('This can take up to 48 hours. Run this script again later.');
    return;
  }

  // Filter 2025 instances
  const instances2025 = instances.filter(i => i.attributes?.processingDate?.startsWith('2025'));
  console.log(`2025 instances: ${instances2025.length}`);
  if (instances2025.length === 0) {
    console.log('No 2025 data in snapshot. All dates:', instances.map(i => i.attributes?.processingDate).sort().join(', '));
    return;
  }

  // Step 3: Download and parse
  console.log('\nDownloading discovery data...');
  const viewsByDate = {};
  for (const inst of instances2025) {
    const date = inst.attributes.processingDate;
    process.stdout.write(`  ${date}...`);
    const tsv = await downloadInstance(inst.id);
    const rows = parseTSV(tsv);
    // Filter KR, aggregate Product Page Views + Impressions
    rows.filter(r => r.Territory === 'KR').forEach(r => {
      const d = r.Date;
      if (!d || !d.startsWith('2025')) return;
      if (!viewsByDate[d]) viewsByDate[d] = 0;
      const count = parseInt(r.Counts) || 0;
      if (r.Event === 'Impression' || r.Event === 'Product Page View') {
        viewsByDate[d] += count;
      }
    });
    console.log(' done');
  }

  const records = Object.entries(viewsByDate)
    .map(([date, views]) => ({ date, platform: 'ios', views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  console.log(`\nParsed: ${records.length} dates`);
  if (records.length) {
    console.log(`Range: ${records[0].date} ~ ${records[records.length - 1].date}`);
  }

  if (!records.length) return;

  // Step 4: Save to Supabase
  console.log('\nSaving to Supabase...');
  // Get existing iOS 2025 dates
  const existRes = await fetch(
    `${SUPABASE_URL}/rest/v1/aso_store_views?platform=eq.ios&date=gte.2025-01-01&date=lte.2025-12-31&select=date`,
    { headers: { 'apikey': SUPABASE_KEY } }
  );
  const existing = new Set((await existRes.json()).map(r => r.date));
  const newRecords = records.filter(r => !existing.has(r.date));
  console.log(`Existing: ${existing.size}, New: ${newRecords.length}`);

  if (newRecords.length) {
    for (let i = 0; i < newRecords.length; i += 500) {
      const batch = newRecords.slice(i, i + 500);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/aso_store_views`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch)
      });
      console.log(`  Batch ${Math.floor(i / 500) + 1}: ${res.status} (${batch.length} records)`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
