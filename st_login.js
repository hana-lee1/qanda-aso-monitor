/**
 * Sensor Tower 로그인 세션 저장
 * 브라우저가 열리면 Google로 로그인 → 로그인 완료 후 터미널에서 Enter
 * 세션이 .st-session/ 에 저장됨
 */
const { chromium } = require('playwright');
const readline = require('readline');

const SESSION_DIR = __dirname + '/.st-session';

async function main() {
  console.log('Sensor Tower 로그인 세션 저장');
  console.log('브라우저가 열리면 Google 계정으로 로그인하세요.\n');

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto('https://app.sensortower.com/login');

  console.log('로그인 페이지가 열렸습니다.');
  console.log('Google 계정으로 로그인을 완료한 후, 여기서 Enter를 눌러주세요...');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question('', resolve));
  rl.close();

  // 현재 URL 확인
  const url = page.url();
  console.log('현재 URL:', url);

  // 쿠키 저장 확인
  const cookies = await browser.cookies();
  console.log(`세션 저장 완료: ${cookies.length}개 쿠키`);
  console.log(`세션 경로: ${SESSION_DIR}`);

  await browser.close();
  console.log('\n다음에 crawl_sensortower.js를 실행하면 이 세션을 재사용합니다.');
}

main().catch(console.error);
