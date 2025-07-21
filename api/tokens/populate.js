import { kv } from '../lib/redis.js';

const FACTORY_ADDRESSES = {
  factory1: '0x394c3D5990cEfC7Be36B82FDB07a7251ACe61cc7',
  factory2: '0x0c4F73328dFCECfbecf235C9F78A4494a7EC5ddC'
};
 
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const isVercelCron = req.headers['x-vercel-cron'];
  const authHeader = req.headers['authorization'];
  const validAuth = authHeader === `Bearer ${process.env.CRON_SECRET || 'default-secret'}`;

  if (!isVercelCron && !validAuth) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const lastScanTimestamp = await kv.get('last_scan_timestamp');
    const isBootstrap = !lastScanTimestamp;
    
    if (isBootstrap) {
      console.log('BOOTSTRAP MODE: Scanning for ALL historical tokens...');
      return await bootstrapAllTokens(res);
    } else {
      console.log('INCREMENTAL MODE: Checking for new tokens...');
      return await incrementalUpdate(res, parseInt(lastScanTimestamp));
    }

  } catch (error) {
    console.error('Population error:', error);
    return res.status(500).json({ 
      error: 'Failed to populate tokens',
      details: error.message 
    });
  }
}

async function bootstrapAllTokens(res) {
  console.log('Scanning both factories for ALL historical tokens...');
  
  const results = {
    processed: 0,
    added: 0,
    skipped: 0,
    errors: 0
  };

  const factoriesToScan = [
    { name: 'V4', address: FACTORY_ADDRESSES.factory1 },
    { name: 'V3', address: FACTORY_ADDRESSES.factory2 }
  ];

  for (const factory of factoriesToScan) {
    console.log(`Scanning ${factory.name} factory for ALL transactions...`);

    try {
      let page = 1;
      const pageSize = 100;
      let hasMore = true;

      while (hasMore) {
        console.log(`Fetching ${factory.name} page ${page}...`);

        const apiUrl = `https://api.scan.pulsechain.com/api?module=account&action=txlist&address=${factory.address}&sort=desc&page=${page}&offset=${pageSize}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${factory.name}`);
        }

        const data = await response.json();
        if (data.status !== '1' || !data.result || data.result.length === 0) {
          console.log(`${factory.name} page ${page}: No more data`);
          hasMore = false;
          break;
        }

        const factoryTransactions = data.result.filter(tx => 
          tx.to && 
          tx.to.toLowerCase() === factory.address.toLowerCase() && 
          tx.isError === '0'
        );

        console.log(`${factory.name} page ${page}: Found ${factoryTransactions.length} token creation transactions`);

        for (const tx of factoryTransactions) {
          results.processed++;

          try {
            const existingToken = await kv.get(`token:${tx.hash}`);
            if (existingToken) {
              results.skipped++;
              continue;
            }

            const tokenData = await extractTokenDataFromTx(tx, factory.name);
            
            if (tokenData) {
              // Store individual token
              await kv.set(`token:${tx.hash}`, tokenData);
              
              // Update all tokens list
              const allTokens = await kv.get('all_tokens') || [];
              if (!allTokens.includes(tx.hash)) {
                allTokens.push(tx.hash);
                await kv.set('all_tokens', allTokens);
              }
              
              // Update indexes using KV arrays
              if (tokenData.creator) {
                const creatorKey = `creator:${tokenData.creator.toLowerCase()}`;
                const creatorTokens = await kv.get(creatorKey) || [];
                if (!creatorTokens.includes(tx.hash)) {
                  creatorTokens.push(tx.hash);
                  await kv.set(creatorKey, creatorTokens);
                }
              }
              
              if (tokenData.factoryVersion) {
                const factoryKey = `factory:${tokenData.factoryVersion.toLowerCase()}`;
                const factoryTokens = await kv.get(factoryKey) || [];
                if (!factoryTokens.includes(tx.hash)) {
                  factoryTokens.push(tx.hash);
                  await kv.set(factoryKey, factoryTokens);
                }
              }

              results.added++;
              
              if (results.added % 50 === 0) {
                console.log(`Processed ${results.added} tokens so far...`);
              }

            } else {
              results.errors++;
            }

          } catch (error) {
            console.error(`Error processing transaction ${tx.hash}:`, error);
            results.errors++;
          }
        }

        if (data.result.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

    } catch (error) {
      console.error(`Error scanning ${factory.name} factory:`, error);
      results.errors++;
    }
  }

  await kv.set('last_scan_timestamp', Math.floor(Date.now() / 1000).toString());

  console.log('BOOTSTRAP COMPLETE:', results);

  return res.status(200).json({
    success: true,
    bootstrap: true,
    results,
    message: `Bootstrap complete! Found ${results.added} historical tokens. Future scans will be incremental.`
  });
}

async function incrementalUpdate(res, sinceTimestamp) {
  console.log(`Looking for tokens created since: ${new Date(sinceTimestamp * 1000).toISOString()}`);

  const results = {
    processed: 0,
    added: 0,
    skipped: 0,
    errors: 0,
    lastScanTime: new Date(sinceTimestamp * 1000).toISOString()
  };

  const factoriesToScan = [
    { name: 'V4', address: FACTORY_ADDRESSES.factory1 },
    { name: 'V3', address: FACTORY_ADDRESSES.factory2 }
  ];

  let latestTimestamp = sinceTimestamp;

  for (const factory of factoriesToScan) {
    console.log(`Checking ${factory.name} for new tokens...`);

    try {
      const apiUrl = `https://api.scan.pulsechain.com/api?module=account&action=txlist&address=${factory.address}&sort=desc&page=1&offset=50`;
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${factory.name}`);
      }

      const data = await response.json();
      if (data.status !== '1' || !data.result) {
        console.log(`No new data from ${factory.name}`);
        continue;
      }

      const newTransactions = data.result.filter(tx => 
        tx.to && 
        tx.to.toLowerCase() === factory.address.toLowerCase() && 
        tx.isError === '0' &&
        parseInt(tx.timeStamp) > sinceTimestamp
      );

      console.log(`Found ${newTransactions.length} new transactions in ${factory.name}`);

      for (const tx of newTransactions) {
        results.processed++;

        try {
          const existingToken = await kv.get(`token:${tx.hash}`);
          if (existingToken) {
            results.skipped++;
            continue;
          }

          const tokenData = await extractTokenDataFromTx(tx, factory.name);
          
          if (tokenData) {
            // Store individual token
            await kv.set(`token:${tx.hash}`, tokenData);
            
            // Update all tokens list
            const allTokens = await kv.get('all_tokens') || [];
            if (!allTokens.includes(tx.hash)) {
              allTokens.push(tx.hash);
              await kv.set('all_tokens', allTokens);
            }
            
            // Update indexes using KV arrays
            if (tokenData.creator) {
              const creatorKey = `creator:${tokenData.creator.toLowerCase()}`;
              const creatorTokens = await kv.get(creatorKey) || [];
              if (!creatorTokens.includes(tx.hash)) {
                creatorTokens.push(tx.hash);
                await kv.set(creatorKey, creatorTokens);
              }
            }
            
            if (tokenData.factoryVersion) {
              const factoryKey = `factory:${tokenData.factoryVersion.toLowerCase()}`;
              const factoryTokens = await kv.get(factoryKey) || [];
              if (!factoryTokens.includes(tx.hash)) {
                factoryTokens.push(tx.hash);
                await kv.set(factoryKey, factoryTokens);
              }
            }

            results.added++;
            console.log(`Added new token: ${tx.hash.slice(0, 10)}...`);

            const txTimestamp = parseInt(tx.timeStamp);
            if (txTimestamp > latestTimestamp) {
              latestTimestamp = txTimestamp;
            }

          } else {
            results.errors++;
          }

        } catch (error) {
          console.error(`Error processing transaction ${tx.hash}:`, error);
          results.errors++;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error(`Error scanning ${factory.name} factory:`, error);
      results.errors++;
    }
  }

  const newScanTimestamp = latestTimestamp > sinceTimestamp ? latestTimestamp : Math.floor(Date.now() / 1000);
  await kv.set('last_scan_timestamp', newScanTimestamp.toString());

  console.log('Incremental scan complete:', results);

  const message = results.added > 0 
    ? `Found ${results.added} new tokens` 
    : 'No new tokens found';

  return res.status(200).json({
    success: true,
    incremental: true,
    results,
    message,
    newScanTimestamp: new Date(newScanTimestamp * 1000).toISOString()
  });
}

async function extractTokenDataFromTx(tx, factoryVersion) {
  try {
    const timestamp = new Date(parseInt(tx.timeStamp) * 1000).toISOString();
    
    return {
      txHash: tx.hash,
      creator: tx.from,
      factoryVersion: factoryVersion,
      factoryAddress: tx.to,
      timestamp: timestamp,
      blockNumber: tx.blockNumber,
      gasUsed: tx.gasUsed,
      status: 'basic',
      addedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error extracting basic token data:', error);
    return null;
  }
}
