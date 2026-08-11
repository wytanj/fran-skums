import puppeteer from 'puppeteer'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = 'c:/Users/Jeremy Tan/CodeProjects/fran-skums'
const browser = await puppeteer.launch({
  headless: 'shell',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-first-run'],
})
const page = await browser.newPage()
await page.goto(pathToFileURL(resolve(root, 'server/assets/report.html')).href, { waitUntil: 'networkidle0' })
await page.pdf({
  path: resolve(root, 'server/assets/report.pdf'),
  format: 'A4',
  printBackground: true,
  margin: { top: '16mm', bottom: '16mm', left: '13mm', right: '13mm' },
})
await browser.close()
console.log('pdf written')
