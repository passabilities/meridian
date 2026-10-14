// Evaluate in an owned /fixture/frame from e2e-hostname-header.mjs. Run at
// 320/375/414/768/1280px. HTTP/settings writes are real; auth is controlled.
// Held/rejected responses and long/IP labels are explicit browser controls.
(async () => {
  const check = (value, message) => { if (!value) throw new Error(message) }
  check(frameElement?.getAttribute('data-owned-fixture') === 'hostname-contract', 'Use the owned hostname fixture frame')
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async predicate => {
    for (let i = 0; i < 100; i++) { if (predicate()) return; await pause(50) }
    throw new Error('Hostname fixture condition timed out')
  }
  const bounds = () => ({ viewport: innerWidth, page: document.documentElement.scrollWidth,
    header: document.querySelector('.meridian-header').getBoundingClientRect().right })
  const settledBounds = async (view = window) => {
    await view.document.fonts.ready
    let previous, stable = 0
    for (let i = 0; i < 50; i++) {
      // Timer sampling stays bounded when an offscreen frame/hidden preview
      // throttles or suspends animation frames.
      await pause(200)
      const current = { viewport: view.innerWidth, page: view.document.documentElement.scrollWidth,
        header: view.document.querySelector('.meridian-header').getBoundingClientRect().right }
      if (JSON.stringify(current) === JSON.stringify(previous)) stable++
      else stable = 0
      if (stable >= 2) return current
      previous = current
    }
    throw new Error('Fixture header/document geometry did not settle')
  }
  if (location.pathname.startsWith('/fixture/before/')) {
    await until(() => document.getElementById('mhStatusText')?.textContent)
    return { result: 'BASELINE', hostnameChipPresent: !!document.getElementById('mhHost'), bounds: await settledBounds() }
  }
  check(location.pathname === '/settings' || location.pathname === '/fixture/provider', 'Use Settings or standalone provider fixture')
  const nativeFetch = window.fetch.bind(window)
  const json = async (path, method = 'GET', value) => {
    const response = await nativeFetch(path, { method, headers: { 'Content-Type': 'application/json' },
      ...(value !== undefined ? { body: JSON.stringify(value) } : {}) })
    check(response.ok, 'Owned fixture request failed: ' + path)
    return response.json()
  }
  // Measure the actual unchanged page at this CSS width. Existing baseline
  // overflow must not be misattributed to the opt-in header change.
  check((await json('/fixture/state')).baseline, 'Set an exact E2E_BASELINE_ROOT for visual comparison')
  const baselineFrame = document.createElement('iframe')
  baselineFrame.style.cssText = 'position:fixed;left:-10000px;top:0;border:0;width:' + innerWidth + 'px;height:1000px;visibility:hidden'
  baselineFrame.setAttribute('aria-hidden', 'true')
  baselineFrame.src = location.pathname === '/settings' ? '/fixture/before/settings' : '/fixture/before/providers'
  document.body.appendChild(baselineFrame)
  let baseline
  try {
    await until(() => baselineFrame.contentDocument?.readyState === 'complete'
      && baselineFrame.contentDocument.querySelector('.meridian-header'))
    await until(() => baselineFrame.contentDocument.getElementById('mhStatusText')?.textContent)
    baseline = await settledBounds(baselineFrame.contentWindow)
    check(baseline.viewport === innerWidth, 'Baseline CSS viewport differs')
  } finally { baselineFrame.remove() }
  const host = document.getElementById('mhHost')
  const releases = []
  let heldHealth, heldPut, rejectHealth = false, overrideName, stressBuild = false
  let putCount = 0
  const gate = () => {
    let release, captured
    const waiting = new Promise(resolve => { release = resolve })
    const entered = new Promise(resolve => { captured = resolve })
    releases.push(release)
    return { waiting, entered, release, captured }
  }
  window.fetch = async (input, options) => {
    const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
    if (path === '/settings/api/header' && options?.method === 'PUT') {
      putCount++
      if (heldPut) { const hold = heldPut; heldPut = undefined; hold.captured(); await hold.waiting }
    }
    if (path === '/health' && rejectHealth) { rejectHealth = false; throw new Error('Owned failed-health control') }
    let response = await nativeFetch(input, options)
    if (path === '/health') {
      if (overrideName || stressBuild) {
        const data = await response.json()
        if (overrideName && typeof data.hostname === 'string') data.hostname = overrideName
        if (stressBuild) data.build = { ...data.build, latest: '9.99.9', updateAvailable: true }
        response = new Response(JSON.stringify(data), { status: response.status, headers: response.headers })
      }
      if (heldHealth) { const hold = heldHealth; heldHealth = undefined; hold.captured(); await hold.waiting }
    }
    return response
  }
  const refresh = () => window.meridianHeaderRefresh()
  const labelVisible = () => !host.hidden && !!host.textContent
  const control = () => document.getElementById('hdr-hostname')
  const enabled = async value => {
    if (location.pathname === '/settings') {
      await until(() => control() && !control().disabled)
      if (control().checked !== value) control().click()
      await until(() => control()?.checked === value && !control().disabled)
    } else await json('/settings/api/header', 'PUT', { showHostname: value })
    refresh()
    await until(() => value ? labelVisible() : host.hidden && host.textContent === '')
    check((await json('/settings/api/header')).showHostname === value, 'Persisted consent did not match UI')
  }
  try {
    await json('/settings/api/header', 'PUT', { showHostname: false })
    if (location.pathname === '/settings') await window.loadHeaderSettings()
    refresh(); await until(() => host.hidden)
    check(!Object.hasOwn(await json('/health'), 'hostname'), 'Off health disclosed a hostname')
    const actualHostname = (await json('/settings/api/header')).hostname
    let oneSaveAtATime = null, olderPollIgnored = null, failedPollClearsLabel = null
    if (location.pathname === '/settings') {
      check(control().getAttribute('aria-label') === 'Show hostname', 'Checkbox has no accessible name')
      const hold = gate(); heldPut = hold
      const start = putCount
      control().click(); await hold.entered
      check(control().disabled, 'Checkbox permits overlapping saves')
      control().click(); check(putCount === start + 1, 'A second save raced the first')
      hold.release(); await until(() => control()?.checked && !control().disabled && labelVisible())
      oneSaveAtATime = true
      const old = gate(); heldHealth = old
      refresh(); await old.entered
      await enabled(false)
      old.release(); await pause(150)
      check(host.hidden && host.textContent === '', 'Old health response restored disabled hostname')
      olderPollIgnored = true
      await enabled(true)
      rejectHealth = true; refresh()
      await until(() => host.hidden && document.getElementById('mhStatusText').textContent === 'Offline')
      check((await json('/settings/api/header')).showHostname === true, 'Failed poll changed stored consent')
      failedPollClearsLabel = true
    } else await enabled(true)
    const labels = []
    stressBuild = true
    for (const full of ['very-long-machine-hostname-for-fleet-operations-and-build-workers-123456789.fleet.example', '203.0.113.27', '2001:db8::f00d']) {
      overrideName = full; refresh()
      const expected = full.includes(':') || /^[0-9.]+$/.test(full) ? full : full.split('.')[0]
      await until(() => host.textContent === expected)
      check(host.title === 'Running on ' + full, 'Full-hostname tooltip was lost')
      const measured = await settledBounds(), rect = host.getBoundingClientRect(), style = getComputedStyle(host)
      check(measured.page <= baseline.page + 1, 'Hostname added page overflow beyond the measured baseline')
      check(measured.header <= measured.viewport + 1, 'Header escaped viewport')
      check(rect.left >= -1 && rect.right <= measured.viewport + 1, 'Hostname escaped header viewport')
      check(style.textOverflow === 'ellipsis' && style.overflowX === 'hidden', 'Hostname clipping contract changed')
      check(!document.getElementById('mhUpdate').hidden, 'Update notice disappeared with hostname')
      labels.push({ full, text: host.textContent, title: host.title, width: rect.width,
        maxWidth: style.maxWidth, clipped: host.scrollWidth > host.clientWidth, bounds: measured,
        provenance: document.querySelector('.meridian-header').dataset.provForm })
    }
    overrideName = undefined; stressBuild = false
    await enabled(false)
    check((await json('/fixture/state')).modelCalls === 0, 'UI fixture attempted model generation')
    return { result: 'PASS', path: location.pathname, actualHostname, width: innerWidth,
      actualSettingsPersistence: true, oneSaveAtATime, olderPollIgnored, failedPollClearsLabel,
      consentOffAfterProbe: true, noAddedPageOverflow: true, baseline,
      syntheticAuth: true, syntheticLongAndIpLabels: true, labels }
  } finally {
    releases.forEach(release => release())
    window.fetch = nativeFetch
    await json('/settings/api/header', 'PUT', { showHostname: false })
    if (location.pathname === '/settings') await window.loadHeaderSettings()
    refresh()
  }
})()
