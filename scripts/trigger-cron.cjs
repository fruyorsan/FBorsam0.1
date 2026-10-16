const fs = require('fs')
const env = fs.readFileSync('.env.local', 'utf8')
const m = env.match(/BOT_CRON_SECRET=["']?([^"'\r\n]+)/)
const sec = m ? m[1].trim() : ''

fetch('https://frborsam.vercel.app/api/bot/cron?secret=' + encodeURIComponent(sec))
  .then(r => r.json())
  .then(d => {
    console.log('CRON OK:', d.ok)
    console.log('ACTIONS:', d.actions)
    console.log('MESSAGE:', d.message)
    console.log('FUTURES:', d.futures)
  })
  .catch(console.error)
