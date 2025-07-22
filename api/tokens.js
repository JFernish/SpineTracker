import { kv } from '../lib/redis.js';

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
    const { factory, creator } = req.query;
    
    console.log('Loading tokens with filters:', { factory, creator });

    let tokens = [];
    
    // Use efficient indexed queries when possible
    if (factory) {
      // Query by factory index - use array instead of Redis sets
      const factoryKey = `factory:${factory.toLowerCase()}`;
      const tokenHashes = await kv.get(factoryKey) || [];
      
      if (tokenHashes.length > 0) {
        // Get token data for each hash
        for (const hash of tokenHashes) {
          const tokenData = await kv.get(`token:${hash}`);
          if (tokenData) {
            tokens.push({
              ...tokenData,
              id: hash
            });
          }
        }
      }
    } else if (creator) {
      // Query by creator index - use array instead of Redis sets
      const creatorKey = `creator:${creator.toLowerCase()}`;
      const tokenHashes = await kv.get(creatorKey) || [];
      
      if (tokenHashes.length > 0) {
        // Get token data for each hash
        for (const hash of tokenHashes) {
          const tokenData = await kv.get(`token:${hash}`);
          if (tokenData) {
            tokens.push({
              ...tokenData,
              id: hash
            });
          }
        }
      }
    } else {
      // Get all tokens - using our all_tokens list
      const allTokenHashes = await kv.get('all_tokens') || [];
      
      if (allTokenHashes.length > 0) {
        for (const hash of allTokenHashes) {
          const tokenData = await kv.get(`token:${hash}`);
          if (tokenData) {
            tokens.push({
              ...tokenData,
              id: hash
            });
          }
        }
      }
    }

    // Sort by timestamp (newest first)
    tokens.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log(`Returning ${tokens.length} tokens to authorized client`);

    // Return in the exact format your HTML expects
    return res.status(200).json({
      tokens: tokens,
      total: tokens.length,
      hasMore: false
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      tokens: [],
      total: 0,
      hasMore: false
    });
  }
}
