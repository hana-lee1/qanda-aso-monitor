#!/bin/bash
export PATH="/opt/homebrew/share/google-cloud-sdk/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
cd /Users/mlt318/Desktop/qanda-aso-monitor
LOG=/Users/mlt318/Desktop/qanda-aso-monitor/sync.log

echo "$(date): === Sync started ===" >> "$LOG"

# BQ에서 최근 7일 데이터 가져오기
bq query --project_id=mathpresso-data --use_legacy_sql=false --format=json --max_rows=100 '
SELECT Date, Store_listing_visitors, Store_listing_acquisitions
FROM `mathpresso-data.qanda_google_play.Store_Performance_country__`
WHERE Package_name = "com.mathpresso.qanda"
  AND Country_region = "KR"
  AND Date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
ORDER BY Date ASC
' > /tmp/bq_store_perf.json 2>&1
[ $? -ne 0 ] && echo "$(date): ERROR - BQ store perf query failed" >> "$LOG"

bq query --project_id=mathpresso-data --use_legacy_sql=false --format=json --max_rows=100 '
SELECT Date, Daily_Average_Rating, Total_Average_Rating
FROM `mathpresso-data.qanda_google_play.Ratings_overview__`
WHERE Package_Name = "com.mathpresso.qanda"
  AND Date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
ORDER BY Date ASC
' > /tmp/bq_ratings.json 2>&1
[ $? -ne 0 ] && echo "$(date): ERROR - BQ ratings query failed" >> "$LOG"

# Supabase에 동기화 (Play Store)
node sync_bq.js >> "$LOG" 2>&1
echo "$(date): BQ sync completed" >> "$LOG"

# App Store Connect API 동기화 (iOS)
node sync_appstore.js >> "$LOG" 2>&1
echo "$(date): App Store sync completed" >> "$LOG"

# 키워드 순위 크롤링 (iOS + Play Store)
node crawl_keywords.js >> "$LOG" 2>&1
echo "$(date): Keyword rank crawl completed" >> "$LOG"

# 교육 카테고리 순위 크롤링 (iPhone + iPad + Android)
node crawl_category.js >> "$LOG" 2>&1
echo "$(date): Category rank crawl completed" >> "$LOG"

# Sensor Tower 키워드별 일간 예상 다운로드 크롤링
node crawl_sensortower.js >> "$LOG" 2>&1
echo "$(date): Sensor Tower crawl completed" >> "$LOG"

echo "$(date): === Sync finished ===" >> "$LOG"
