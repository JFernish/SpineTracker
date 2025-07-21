import { kv } from '../lib/redis.js';

export default async function handler(req, res) {
  // Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
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

    console.log(`Returning ${tokens.length} tokens`);

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
