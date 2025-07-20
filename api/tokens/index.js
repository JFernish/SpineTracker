import { kv } from '@vercel/kv';

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
        // Query by factory index
        const factoryKey = `factory:${factory.toLowerCase()}`;
        const tokenHashes = await kv.smembers(factoryKey);
        
        if (tokenHashes.length > 0) {
          const keys = tokenHashes.map(hash => `token:${hash}`);
          const tokenData = await kv.mget(...keys);
          
          for (let i = 0; i < tokenHashes.length; i++) {
            if (tokenData[i]) {
              tokens.push({
                ...tokenData[i],
                id: tokenHashes[i]
              });
            }
          }
        }
      } else if (creator) {
        // Query by creator index
        const creatorKey = `creator:${creator.toLowerCase()}`;
        const tokenHashes = await kv.smembers(creatorKey);
        
        if (tokenHashes.length > 0) {
          const keys = tokenHashes.map(hash => `token:${hash}`);
          const tokenData = await kv.mget(...keys);
          
          for (let i = 0; i < tokenHashes.length; i++) {
            if (tokenData[i]) {
              tokens.push({
                ...tokenData[i],
                id: tokenHashes[i]
              });
            }
          }
        }
      } else {
        // Get all tokens
        const allKeys = await kv.keys('token:*');
        
        if (allKeys.length > 0) {
          const tokenData = await kv.mget(...allKeys);
          
          for (let i = 0; i < allKeys.length; i++) {
            if (tokenData[i]) {
              tokens.push({
                ...tokenData[i],
                id: allKeys[i].replace('token:', '')
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

      // Update indexes for efficient querying
      const promises = [];
      
      if (tokenData.creator) {
        promises.push(kv.sadd(`creator:${tokenData.creator.toLowerCase()}`, tokenData.txHash));
      }

      if (tokenData.factoryVersion) {
        promises.push(kv.sadd(`factory:${tokenData.factoryVersion.toLowerCase()}`, tokenData.txHash));
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
