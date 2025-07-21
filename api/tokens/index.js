import { kv } from '../lib/redis.js';

export default async function handler(req, res) {
  // Enable CORS for your frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Get all tokens (since we're only dealing with incremental additions)
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

      return res.status(200).json({
        tokens: tokens,
        total: tokens.length,
        hasMore: false
      });

    } else if (req.method === 'POST') {
      // Add new token data (used by populate script)
      const tokenData = req.body;
      
      if (!tokenData.txHash) {
        return res.status(400).json({ error: 'Transaction hash is required' });
      }

      // Store token data
      await kv.set(`token:${tokenData.txHash}`, {
        ...tokenData,
        addedAt: new Date().toISOString()
      });

      // Update indexes using arrays instead of Redis sets
      const promises = [];
      
      // Add to all tokens list
      const allTokens = await kv.get('all_tokens') || [];
      if (!allTokens.includes(tokenData.txHash)) {
        allTokens.push(tokenData.txHash);
        promises.push(kv.set('all_tokens', allTokens));
      }
      
      if (tokenData.creator) {
        const creatorKey = `creator:${tokenData.creator.toLowerCase()}`;
        const creatorTokens = await kv.get(creatorKey) || [];
        if (!creatorTokens.includes(tokenData.txHash)) {
          creatorTokens.push(tokenData.txHash);
          promises.push(kv.set(creatorKey, creatorTokens));
        }
      }

      if (tokenData.factoryVersion) {
        const factoryKey = `factory:${tokenData.factoryVersion.toLowerCase()}`;
        const factoryTokens = await kv.get(factoryKey) || [];
        if (!factoryTokens.includes(tokenData.txHash)) {
          factoryTokens.push(tokenData.txHash);
          promises.push(kv.set(factoryKey, factoryTokens));
        }
      }

      await Promise.all(promises);

      return res.status(201).json({ success: true, message: 'Token added successfully' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}
