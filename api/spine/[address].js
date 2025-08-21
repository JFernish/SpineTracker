import { kv } from '../../lib/redis.js';

// Rate limiting storage (resets on each deployment)
const requestCounts = new Map();
const RATE_LIMIT = 60; // requests per minute per IP
const RATE_WINDOW = 60 * 1000; // 1 minute in milliseconds

export default async function handler(req, res) {
  // Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // PROTECTION: Check allowed referrers for GET requests
  if (req.method === 'GET') {
    const allowedReferrers = [
      'spinetracker.vercel.app',
      'localhost'
      // Add approved domains here as needed
    ];
    
    const referrer = req.headers.referer || req.headers.origin || '';
    const isAllowed = allowedReferrers.some(domain => referrer.includes(domain));
    
    if (!isAllowed) {
      console.log(`Blocked request from unauthorized referrer: ${referrer}`);
      return res.status(403).json({ 
        error: 'Access denied. Please use the official SpineTracker website.',
        website: 'https://spinetracker.vercel.app'
      });
    }

    // PROTECTION: Block obvious scrapers by User-Agent
    const userAgent = req.headers['user-agent'] || '';
    const blockedAgents = ['curl', 'wget', 'python-requests', 'scrapy', 'bot', 'spider'];
    if (blockedAgents.some(agent => userAgent.toLowerCase().includes(agent))) {
      console.log(`Blocked scraper user-agent: ${userAgent}`);
      return res.status(403).json({ 
        error: 'Automated access not permitted. Please use the website interface.' 
      });
    }

    // PROTECTION: Rate limiting per IP
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.headers['x-real-ip'] || 
                     req.connection.remoteAddress || 
                     'unknown';
    
    const now = Date.now();
    const ipData = requestCounts.get(clientIP) || { count: 0, windowStart: now };
    
    // Reset window if expired
    if (now - ipData.windowStart > RATE_WINDOW) {
      ipData.count = 0;
      ipData.windowStart = now;
    }
    
    ipData.count++;
    requestCounts.set(clientIP, ipData);
    
    if (ipData.count > RATE_LIMIT) {
      console.log(`Rate limit exceeded for IP: ${clientIP}`);
      return res.status(429).json({ 
        error: 'Rate limit exceeded. Please wait before making more requests.',
        retryAfter: Math.ceil((RATE_WINDOW - (now - ipData.windowStart)) / 1000)
      });
    }

    // Clean up old entries periodically (simple cleanup)
    if (requestCounts.size > 1000) {
      const cutoff = now - RATE_WINDOW;
      for (const [ip, data] of requestCounts.entries()) {
        if (data.windowStart < cutoff) {
          requestCounts.delete(ip);
        }
      }
    }
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { address } = req.query;
    const startTime = Date.now();
    
    if (!address || !address.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid address format' });
    }

    console.log(`Building spine for address: ${address}`);

    // Build a lookup map for faster searches with normalized addresses
    const allTokenHashes = await kv.get('all_tokens') || [];
    const tokenMap = new Map();
    
    console.log(`Loading ${allTokenHashes.length} tokens into map...`);
    
    for (const hash of allTokenHashes) {
      const tokenData = await kv.get(`token:${hash}`);
      if (tokenData && tokenData.tokenContractAddress) {
        // Normalize address to lowercase for consistent lookups
        const normalizedAddress = tokenData.tokenContractAddress.toLowerCase();
        tokenMap.set(normalizedAddress, tokenData);
      }
    }
    
    console.log(`TokenMap built with ${tokenMap.size} entries`);

    // Walk up the spine
    const spine = [];
    let currentAddress = address.toLowerCase(); // Normalize starting address
    let depth = 0;
    const maxDepth = 40;

    while (currentAddress && depth < maxDepth) {
      console.log(`Looking for token at depth ${depth}: ${currentAddress}`);
      
      const tokenData = tokenMap.get(currentAddress);
      
      if (!tokenData) {
        console.log(`Token not found in database: ${currentAddress}`);
        break;
      }
      
      console.log(`Found token: ${tokenData.symbol || tokenData.name || 'Unknown'}`);
      spine.unshift(tokenData);
      
      // Normalize parent address before next lookup
      if (tokenData.parent) {
        currentAddress = tokenData.parent.toLowerCase();
        console.log(`Moving to parent: ${currentAddress}`);
      } else {
        console.log(`No parent found, ending spine traversal`);
        currentAddress = null;
      }
      
      depth++;
    }

    const queryTime = Date.now() - startTime;
    console.log(`Spine discovery completed in ${queryTime}ms, found ${spine.length} tokens`);

    return res.status(200).json({ 
      spine: spine,
      queryTime: queryTime,
      success: true,
      length: spine.length
    });
  } catch (error) {
    console.error('Spine API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      success: false
    });
  }
}
