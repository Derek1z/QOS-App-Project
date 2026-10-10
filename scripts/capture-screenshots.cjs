/**
 * Captures the README screenshots from the browser preview (built-in demo
 * data, no workspace file needed):
 *
 *   npm run preview:web            # in one terminal (http://localhost:5173)
 *   npx electron scripts/capture-screenshots.cjs
 *
 * Writes docs/screenshots/*.png at 1440x900.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const URL = process.env.PREVIEW_URL || 'http://localhost:5173'
const OUT = path.join(__dirname, '..', 'docs', 'screenshots')
const W = 1440
const H = 900

// Runs in the page: click the button whose text (emoji stripped) is `label`.
const clickJs = (label) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().replace(/^\\W+/, '') === ${JSON.stringify(label)})
  if (b) b.click()
  return !!b
})()`
const scrollJs = (selectorOrText) => `(() => {
  const el = document.querySelector(${JSON.stringify(selectorOrText)}) ||
    [...document.querySelectorAll('h2, h3')].find((h) => h.textContent.includes(${JSON.stringify(selectorOrText)}))
  if (el) el.scrollIntoView({ block: 'start' })
  return !!el
})()`

/** Each shot: steps run in order (click / scroll / wait ms), then a capture. */
const SHOTS = [
  { file: 'executive_overview.png', steps: [['click', 'Executive Overview'], ['wait', 3000]] },
  { file: 'nc_breach_analytics.png', steps: [['click', 'NC & Breach Analytics'], ['wait', 3000]] },
  { file: 'forecasting.png', steps: [['click', 'Forecasting & Early Warning'], ['wait', 3500]] },
  { file: 'cell_investigation.png', steps: [['click', 'Cell Investigation'], ['wait', 3500]] },
  {
    file: 'ghana_health_matrix.png',
    steps: [['click', 'Ghana Health Matrix'], ['wait', 2000], ['click', '260 Districts'], ['wait', 2500], ['scroll', 'Ghana Interactive Health Map'], ['wait', 800]]
  },
  {
    file: 'data_manager_import.png',
    steps: [['click', 'Data Manager'], ['wait', 1500], ['click', 'Use sample CSV'], ['wait', 3000], ['scroll', '.map-table'], ['wait', 800]]
  }
]

async function run() {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  win.webContents.setFrameRate(30)
  await win.loadURL(URL)
  await new Promise((r) => setTimeout(r, 4000))
  fs.mkdirSync(OUT, { recursive: true })
  for (const shot of SHOTS) {
    for (const [kind, arg] of shot.steps) {
      if (kind === 'wait') await new Promise((r) => setTimeout(r, arg))
      else {
        const ok = await win.webContents.executeJavaScript(kind === 'click' ? clickJs(arg) : scrollJs(arg))
        if (!ok) throw new Error(`${shot.file}: ${kind} '${arg}' found nothing`)
      }
    }
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, shot.file), img.toPNG())
    console.log(`wrote docs/screenshots/${shot.file} (${img.getSize().width}x${img.getSize().height})`)
  }
}

app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((e) => {
    console.error(e)
    app.exit(1)
  })
