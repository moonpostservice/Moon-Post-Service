// Vercel serverless function: report the visitor's coarse location from
// Vercel's edge geolocation headers. Used by the send-by-link reveal page to
// lock a recipient's moonrise to their actual city (sharper than the
// browser-timezone fallback). No body, no PII stored — just echoes the headers.

module.exports = (req, res) => {
  const h = req.headers;
  const num = (v) => (v != null && v !== '' && !Number.isNaN(parseFloat(v))) ? parseFloat(v) : null;

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({
    city: h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : null,
    country: h['x-vercel-ip-country'] || null,
    lat: num(h['x-vercel-ip-latitude']),
    lon: num(h['x-vercel-ip-longitude']),
    tz: h['x-vercel-ip-timezone'] || null,
  });
};
