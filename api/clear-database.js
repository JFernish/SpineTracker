import { kv } from '../lib/redis.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get confirmation parameter
    const { confirm } = req.body;
    
    if (confirm !== 'YES_DELETE_ALL_DATA') {
      return res.status(400).json({ 
        error: 'Must confirm deletion',
        instruction: 'Send POST with {"confirm": "YES_DELETE_ALL_DATA"}' 
      });
    }

    console.log('Starting database clear...');
    
    // Clear all token data
    const allTokens = await kv.get('all_tokens') || [];
    let deletedCount = 0;
    
    for (const tokenHash of allTokens) {
      await kv.del(`token:${tokenHash}`);
      deletedCount++;
    }
    
    // Clear indexes
    await kv.del('all_tokens');
    await kv.del('last_scan_timestamp');
    
    // Clear factory indexes
    await kv.del('factory:v3');
    await kv.del('factory:v4');
    
    // Clear creator indexes (this is approximate)
    const mariaAddresses = [
      '0xBF182955401aF3f2f7e244cb31184E93E74a2501',
      '0x7a20189b297343cf26d8548764b04891f37f3414'
    ];
    
    for (const address of mariaAddresses) {
      await kv.del(`creator:${address.toLowerCase()}`);
    }
    
    console.log(`Database cleared: ${deletedCount} tokens deleted`);
    
    return res.status(200).json({
      success: true,
      message: `Database cleared successfully`,
      deletedTokens: deletedCount,
      instruction: 'Now run /api/update to repopulate with complete data'
    });

  } catch (error) {
    console.error('Error clearing database:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to clear database',
      details: error.message
    });
  }
}
