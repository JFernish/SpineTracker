import { kv } from '../../lib/redis.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && !req.headers['x-vercel-cron']) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
 
  try {
    console.log('Starting scheduled token update...');

    const lastScanTimestamp = await kv.get('last_scan_timestamp') || 0;
    
    const now = Math.floor(Date.now() / 1000);
    const timeSinceLastScan = now - lastScanTimestamp;
    
    // Skip if less than 10 minutes since last scan
    if (timeSinceLastScan < 600) {
      console.log(`Skipping scan - only ${timeSinceLastScan}s since last scan`);
      return res.status(200).json({ 
        skipped: true, 
        message: 'Too soon since last scan',
        timeSinceLastScan 
      });
    }

    // Call the populate endpoint
    const populateUrl = `${req.headers.host?.includes('localhost') ? 'http' : 'https'}://${req.headers.host}/api/tokens/populate`;
    
    const populateResponse = await fetch(populateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET || 'default-secret'}`
      },
      body: JSON.stringify({
        factory: 'both',
        limit: 25,
        sinceTimestamp: lastScanTimestamp
      })
    });

    if (!populateResponse.ok) {
      throw new Error(`Populate endpoint returned ${populateResponse.status}`);
    }

    const result = await populateResponse.json();

    console.log('Cron update complete:', result);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...result
    });

  } catch (error) {
    console.error('Cron update failed:', error);
    return res.status(500).json({ 
      error: 'Cron update failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
