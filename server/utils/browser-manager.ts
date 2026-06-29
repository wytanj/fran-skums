// Dynamic import — puppeteer is a devDependency (not available on Vercel)
// Crawl features only work locally; this file gracefully fails on serverless.

type Browser = any
type Page = any

let puppeteerModule: any = null
let browser: Browser | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

const IDLE_TIMEOUT = 5 * 60 * 1000 // Close browser after 5 min of inactivity

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1920,1080',
]

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

async function loadPuppeteer() {
  if (puppeteerModule) return puppeteerModule
  try {
    puppeteerModule = await import('puppeteer')
    return puppeteerModule
  } catch {
    throw new Error('Puppeteer is not available. Crawl features require local dev environment.')
  }
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(async () => {
    await closeBrowser()
  }, IDLE_TIMEOUT)
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    resetIdleTimer()
    return browser
  }

  const ppt = await loadPuppeteer()
  browser = await ppt.default.launch({
    headless: true,
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1920, height: 1080 },
  })

  resetIdleTimer()
  return browser
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (browser) {
    try {
      await browser.close()
    } catch {
      // Browser may already be closed
    }
    browser = null
  }
}

export async function createStealthPage(browser: Browser) {
  const page = await browser.newPage()
  const ua = getRandomUserAgent()

  await page.setUserAgent(ua)
  await page.setViewport({ width: 1920, height: 1080 })

  // Hide webdriver detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    })
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    })
  })

  // Set reasonable timeouts
  page.setDefaultNavigationTimeout(25000)
  page.setDefaultTimeout(15000)

  return page
}
