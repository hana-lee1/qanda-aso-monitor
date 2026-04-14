/**
 * App Store Connect 로그인 세션 저장
 * 브라우저가 열리면 Apple ID로 로그인 → 완료 후 Enter
 */
const { chromium } = require('playwright');
const readline = require('readline');

const SESSION_DIR = __dirname + '/.asc-session';

async function main() {
  console.log('App Store Connect 로그인 세션 저장');
  console.log('브라우저가 열리면 Apple ID로 로그인하세요.\n');

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://appstoreconnect.apple.com/apps/1270676408/analytics/acquisition/sources');

  console.log('로그인 후 Analytics 페이지가 보이면 Enter를 누르세요...');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('', resolve));
  rl.close();

  const cookies = await browser.cookies();
  console.log(`세션 저장 완료: ${cookies.length}개 쿠키`);
  await browser.close();
}

main().catch(console.error);
