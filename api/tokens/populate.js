import { kv } from '../../lib/redis.js';

const FACTORY_ADDRESSES = {
  factory1: '0x394c3D5990cEfC7Be36B82FDB07a7251ACe61cc7',
  factory2: '0x0c4F73328dFCECfbecf235C9F78A4494a7EC5ddC'
};

// Token ABI for contract calls
const TOKEN_ABI = [
  {"type":"function","name":"name","inputs":[],"outputs":[{"name":"","type":"string","internalType":"string"}],"stateMutability":"view"},
  {"type":"function","name":"symbol","inputs":[],"outputs":[{"name":"","type":"string","internalType":"string"}],"stateMutability":"view"},
  {"type":"function","name":"Parent","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},
  {"type":"function","name":"parent","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"}
];

let provider = null;

async function getProvider() {
  if (!provider) {
    const { ethers } = await import('ethers');
    provider = new ethers.JsonRpcProvider('https://rpc-pulsechain.g4mm4.io');
  }
  return provider;
}

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

            // Extract COMPLETE token data
            const tokenData = await extractCompleteTokenData(tx, factory.name);
            
            if (tokenData) {
              // Store complete token data
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
              
              if (results.added % 25 === 0) {
                console.log(`Processed ${results.added} tokens so far...`);
              }

            } else {
              results.errors++;
            }

          } catch (error) {
            console.error(`Error processing transaction ${tx.hash}:`, error);
            results.errors++;
          }

          // Small delay to avoid overwhelming RPC
          await new Promise(resolve => setTimeout(resolve, 100));
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
    message: `Bootstrap complete! Found ${results.added} historical tokens with complete data. Future scans will be incremental.`
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

          // Extract COMPLETE token data for new tokens too
          const tokenData = await extractCompleteTokenData(tx, factory.name);
          
          if (tokenData) {
            // Store complete token data
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
            console.log(`Added new token: ${tokenData.tokenName} (${tx.hash.slice(0, 10)}...)`);

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

        await new Promise(resolve => setTimeout(resolve, 200));
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
    ? `Found ${results.added} new tokens with complete data` 
    : 'No new tokens found';

  return res.status(200).json({
    success: true,
    incremental: true,
    results,
    message,
    newScanTimestamp: new Date(newScanTimestamp * 1000).toISOString()
  });
}

async function extractCompleteTokenData(tx, factoryVersion) {
  try {
    const rpcProvider = await getProvider();
    const { ethers } = await import('ethers');
    const timestamp = new Date(parseInt(tx.timeStamp) * 1000).toISOString();
    
    // Get transaction receipt to extract token data
    const receipt = await rpcProvider.getTransactionReceipt(tx.hash);
    if (!receipt) {
      console.log(`No receipt found for ${tx.hash}`);
      return null;
    }

    const transaction = await rpcProvider.getTransaction(tx.hash);
    
    // Extract token creation parameters from transaction input
    let tokenName = 'Unknown';
    let tokenSymbol = 'Unknown';
    let parentAddress = '0x0000000000000000000000000000000000000000';
    
    try {
      const inputData = transaction.data.slice(10); // Remove function selector
      const abiCoder = new ethers.AbiCoder();
      const decoded = abiCoder.decode(['string', 'string', 'uint256', 'address'], '0x' + inputData);
      
      tokenName = decoded[0] || 'Unknown';
      tokenSymbol = decoded[1] || 'Unknown';
      parentAddress = decoded[3] || '0x0000000000000000000000000000000000000000';
    } catch (error) {
      console.log(`Error decoding transaction data for ${tx.hash}:`, error.message);
    }

    // Extract token contract address from Transfer events - FIXED VERSION
    const tokenContractAddress = findTokenContractFromLogs(receipt.logs, tx.from);
    
    // Extract initial supply from MV token transfers
    const initialSupply = extractInitialSupply(receipt);
    const initialSupplyFormatted = formatSupply(initialSupply);
    
    // Get parent token info if it exists
    let parentName = 'None';
    let parentDisplayName = 'None';
    
    if (parentAddress !== '0x0000000000000000000000000000000000000000') {
      try {
        const parentContract = new ethers.Contract(parentAddress, TOKEN_ABI, rpcProvider);
        parentName = await parentContract.name().catch(() => 'Unknown Parent');
        parentDisplayName = parentName;
      } catch (error) {
        console.log(`Error getting parent name for ${parentAddress}:`, error.message);
        parentName = 'Unknown Parent';
        parentDisplayName = 'Unknown Parent';
      }
    }

    return {
      txHash: tx.hash,
      creator: tx.from,
      factoryVersion: factoryVersion,
      factoryAddress: tx.to,
      timestamp: timestamp,
      blockNumber: tx.blockNumber,
      gasUsed: tx.gasUsed,
      // Complete token data stored in database
      tokenContractAddress,
      tokenName,
      tokenSymbol,
      initialSupply,
      initialSupplyFormatted,
      parent: parentAddress,
      parentName,
      parentDisplayName,
      status: 'complete',
      addedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error extracting complete token data:', error);
    return null;
  }
}

function findTokenContractFromLogs(logs, creatorAddress) {
  // Parse Transfer events to find the one that goes to the creator
  for (const log of logs) {
    if (log.topics && log.topics.length >= 3) {
      // Check if this is a Transfer event (topic[0] would be the Transfer signature)
      // Look for transfers where:
      // - topics[1] is zero address (minting)
      // - topics[2] matches the creator address
      try {
        const fromAddress = log.topics[1];
        const toAddress = log.topics[2];
        
        // Convert creator address to the same format as topic (32-byte hex)
        const creatorTopic = '0x000000000000000000000000' + creatorAddress.slice(2).toLowerCase();
        
        // Check if this is a mint (from zero) to creator
        if (fromAddress === '0x0000000000000000000000000000000000000000000000000000000000000000' &&
            toAddress.toLowerCase() === creatorTopic.toLowerCase()) {
          return log.address; // This is the token that was minted to the creator
        }
      } catch (error) {
        // Skip malformed logs
        continue;
      }
    }
  }
  
  // Fallback: find any Transfer event from zero address (last one)
  let tokenAddress = null;
  for (const log of logs) {
    if (log.topics && log.topics.length >= 3) {
      const fromAddress = log.topics[1];
      if (fromAddress === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        tokenAddress = log.address;
      }
    }
  }
  
  return tokenAddress;
}

function extractInitialSupply(receipt) {
  try {
    const MV_TOKEN_ADDRESS = "0xA1BEe1daE9Af77dAC73aA0459eD63b4D93fC6d29";
    
    // Find MV token transfers (these represent the initial supply cost)
    let mvAmount = '0';
    for (const log of receipt.logs) {
      if (log.address && log.address.toLowerCase() === MV_TOKEN_ADDRESS.toLowerCase()) {
        if (log.data && log.data !== '0x') {
          try {
            // Simple hex to decimal conversion for the data field
            const hexValue = log.data;
            if (hexValue.length > 2) {
              mvAmount = BigInt(hexValue).toString();
            }
          } catch (error) {
            // Skip if can't parse
            continue;
          }
        }
      }
    }
    return mvAmount;
  } catch (error) {
    console.error('Error extracting initial supply:', error);
    return '0';
  }
}

function formatSupply(supplyWei) {
  try {
    if (supplyWei === '0') return '0';
    
    // Simple conversion: divide by 10^18 and format
    const supply = Number(supplyWei) / (10 ** 18);
    if (supply === 0) return '0';
    
    // Format to 3 significant digits
    const result = supply.toPrecision(3);
    return parseFloat(result).toString();
  } catch (error) {
    return '0';
  }
}
