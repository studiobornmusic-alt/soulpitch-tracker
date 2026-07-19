export default async function handler(req, res) {
  const slug = req.url.split('/t/')[1]?.split('?')[0];
  if (!slug || !/^[a-z0-9]+$/i.test(slug)) {
    return res.status(400).send('Missing or invalid slug');
  }
  const userAgent = req.headers['user-agent'] || '';
  const BOT_PATTERNS = [
    /bot/i, /crawl/i, /spider/i, /slurp/i, /facebookexternalhit/i,
    /whatsapp/i, /slackbot/i, /telegrambot/i, /discordbot/i,
    /outlook/i, /safelinks/i, /googleimageproxy/i, /link.?checker/i,
    /mailru/i, /yandex/i, /preview/i, /monitoring/i, /uptime/i,
    /headlesschrome/i, /phantomjs/i
  ];
  const isLikelyBot = BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  const lookupRes = await fetch(
    `${SUPABASE_URL}/rest/v1/listen_links?slug=eq.${encodeURIComponent(slug)}&select=id,source_url,track_id,pitch_id`,
    { headers }
  );
  const rows = await lookupRes.json();
  if (!rows.length) {
    return res.status(404).send('Link not found');
  }
  const link = rows[0];
  let targetUrl;
  try {
    targetUrl = new URL(link.source_url);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).send('Invalid link');
    }
  } catch {
    return res.status(400).send('Invalid link');
  }

  let shouldLog = false;
  if (link.pitch_id && !isLikelyBot) {
    let statusConfirmed = false;
    let pitchStatus = null;
    for (let attempt = 0; attempt < 2 && !statusConfirmed; attempt++) {
      try {
        const statusRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pitches?id=eq.${encodeURIComponent(link.pitch_id)}&select=status`,
          { headers }
        );
        const statusRows = await statusRes.json();
        if (statusRows.length) {
          pitchStatus = statusRows[0].status;
          statusConfirmed = true;
        }
      } catch {
        // retry on next loop iteration
      }
    }
    shouldLog = statusConfirmed && pitchStatus !== 'ready_to_pitch';
  }

  if (shouldLog) {
    await fetch(`${SUPABASE_URL}/rest/v1/link_clicks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        pitch_id: link.pitch_id,
        link_url: link.source_url,
        clicked_at: new Date().toISOString()
      })
    });
  }

  res.redirect(302, targetUrl.href);
}
