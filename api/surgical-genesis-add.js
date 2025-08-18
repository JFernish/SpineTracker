import { kv } from '../lib/redis.js';

// The two specific tokens to add
const GENESIS_TOKENS = [
    {
        address: '0xac57300da6e17e9e83e71b9f6f75d08dc3836532',
        factory: 'V4',
        factoryAddress: '0x394c3D5990cEfC7Be36B82FDB07a7251ACe61cc7',
        note: 'First V4 token - created in factory deployment'
    },
    {
        address: '0xaa1505c928fd85e10a550cfde9e8f464c3574d8a', 
        factory: 'V3',
        factoryAddress: '0x0c4F73328dFCECfbecf235C9F78A4494a7EC5ddC',
        note: 'First V3 token - created in factory deployment'
    }
];

// Token ABI for getting basic info
const TOKEN_ABI = [
    {"type":"function","name":"name","inputs":[],"outputs":[{"name":"","type":"string"}],"stateMutability":"view"},
    {"type":"function","name":"symbol","inputs":[],"outputs":[{"name":"","type":"string"}],"stateMutability":"view"},
    {"type":"function","name":"decimals","inputs":[],"outputs":[{"name":"","type":"uint8"}],"stateMutability":"view"}
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
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { action, confirmed } = req.body || {};
    const startTime = Date.now();
    
    try {
        if (action === 'preview' || req.method === 'GET') {
            console.log('🔍 PREVIEW: Checking genesis tokens...');
            const previewResults = await previewGenesisTokens();
            
            if (req.method === 'GET') {
                return res.status(200).send(generatePreviewHTML(previewResults));
            } else {
                return res.status(200).json({
                    success: true,
                    mode: 'preview',
                    ...previewResults
                });
            }
        }
        
        if (action === 'confirm' && confirmed === true) {
            console.log('✅ CONFIRMED: Adding genesis tokens...');
            const confirmResults = await addGenesisTokens();
            
            return res.status(200).json({
                success: true,
                mode: 'confirmed',
                ...confirmResults,
                duration: `${Date.now() - startTime}ms`
            });
        }
        
        // Default: preview
        const previewResults = await previewGenesisTokens();
        return res.status(200).send(generatePreviewHTML(previewResults));
        
    } catch (error) {
        console.error('💥 Genesis token add failed:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            duration: `${Date.now() - startTime}ms`
        });
    }
}

async function previewGenesisTokens() {
    const startTime = Date.now();
    
    try {
        console.log('🔍 Checking genesis tokens status...');
        const provider = await getProvider();
        const { ethers } = await import('ethers');
        
        const results = {
            tokensToAdd: [],
            alreadyExists: [],
            errors: []
        };
        
        for (const genesisToken of GENESIS_TOKENS) {
            try {
                console.log(`   📡 Checking ${genesisToken.factory} genesis token: ${genesisToken.address}`);
                
                // Check if already exists in database by searching for the address
                const allTokens = await kv.get('all_tokens') || [];
                let existsInDb = false;
                let existingTxHash = null;
                
                for (const txHash of allTokens) {
                    const tokenData = await kv.get(`token:${txHash}`);
                    if (tokenData && tokenData.tokenContractAddress && 
                        tokenData.tokenContractAddress.toLowerCase() === genesisToken.address.toLowerCase()) {
                        existsInDb = true;
                        existingTxHash = txHash;
                        break;
                    }
                }
                
                if (existsInDb) {
                    results.alreadyExists.push({
                        ...genesisToken,
                        txHash: existingTxHash,
                        status: 'Already exists in database'
                    });
                    console.log(`   ✅ ${genesisToken.factory} token already exists (${existingTxHash})`);
                    continue;
                }
                
                // Get token info from blockchain
                const tokenContract = new ethers.Contract(genesisToken.address, TOKEN_ABI, provider);
                
                const [name, symbol, decimals] = await Promise.all([
                    tokenContract.name().catch(() => 'Unknown Token'),
                    tokenContract.symbol().catch(() => 'UNKNOWN'),
                    tokenContract.decimals().catch(() => 18)
                ]);
                
                console.log(`   📋 Found token info: ${symbol} (${name})`);
                
                // Try to find the deployment transaction
                const deploymentTx = await findDeploymentTransaction(genesisToken.address, provider);
                
                // Create the exact token record that will be stored (preview)
                const tokenRecord = {
                    txHash: deploymentTx.hash,
                    creator: deploymentTx.from,
                    factoryVersion: genesisToken.factory,
                    factoryAddress: genesisToken.factoryAddress,
                    timestamp: new Date(deploymentTx.timestamp * 1000).toISOString(),
                    blockNumber: deploymentTx.blockNumber,
                    gasUsed: deploymentTx.gasUsed,
                    
                    // Token data
                    tokenContractAddress: genesisToken.address.toLowerCase(),
                    tokenName: name,
                    tokenSymbol: symbol,
                    initialSupply: '0', // Genesis tokens may not have initial supply data
                    initialSupplyFormatted: '0',
                    parent: '0x0000000000000000000000000000000000000000',
                    parentName: 'None',
                    parentDisplayName: 'None',
                    
                    // Metadata
                    status: 'complete',
                    addedAt: new Date().toISOString(),
                    discoveredBy: 'surgical-genesis-add',
                    isGenesisToken: true,
                    note: genesisToken.note
                };
                
                results.tokensToAdd.push({
                    ...genesisToken,
                    name,
                    symbol,
                    decimals: Number(decimals),
                    deploymentTx,
                    tokenRecord, // Include the complete record for preview
                    status: 'Ready to add'
                });
                
            } catch (error) {
                console.error(`   ❌ Error checking ${genesisToken.address}:`, error.message);
                results.errors.push({
                    ...genesisToken,
                    error: error.message
                });
            }
        }
        
        return {
            ...results,
            duration: `${Date.now() - startTime}ms`
        };
        
    } catch (error) {
        console.error('🔍 Preview failed:', error);
        throw error;
    }
}

async function findDeploymentTransaction(tokenAddress, provider) {
    try {
        // Get the contract creation transaction
        // This is a bit tricky - we'll try to find it by looking at recent blocks
        // around the factory deployment time
        
        const currentBlock = await provider.getBlockNumber();
        
        // Search backwards from current block (adjust range as needed)
        for (let blockNum = currentBlock; blockNum > currentBlock - 1000000; blockNum -= 1000) {
            try {
                const block = await provider.getBlock(blockNum, true);
                if (!block || !block.transactions) continue;
                
                for (const tx of block.transactions) {
                    if (tx.creates && tx.creates.toLowerCase() === tokenAddress.toLowerCase()) {
                        return {
                            hash: tx.hash,
                            blockNumber: blockNum,
                            timestamp: block.timestamp,
                            from: tx.from,
                            gasUsed: tx.gasLimit?.toString() || '0'
                        };
                    }
                }
            } catch (blockError) {
                // Skip problematic blocks
                continue;
            }
        }
        
        // If we can't find the exact deployment tx, create a synthetic one
        return {
            hash: `synthetic_${tokenAddress.slice(0, 10)}`,
            blockNumber: 0,
            timestamp: new Date('2024-01-01').getTime() / 1000, // Approximate factory deployment time
            from: '0x0000000000000000000000000000000000000000',
            gasUsed: '0',
            synthetic: true
        };
        
    } catch (error) {
        console.error('Error finding deployment transaction:', error);
        // Return synthetic transaction data
        return {
            hash: `synthetic_${tokenAddress.slice(0, 10)}`,
            blockNumber: 0,
            timestamp: new Date('2024-01-01').getTime() / 1000,
            from: '0x0000000000000000000000000000000000000000',
            gasUsed: '0',
            synthetic: true
        };
    }
}

async function addGenesisTokens() {
    const startTime = Date.now();
    
    try {
        console.log('✅ Adding genesis tokens to database...');
        const provider = await getProvider();
        const { ethers } = await import('ethers');
        
        const results = {
            addedTokens: 0,
            skipped: 0,
            errors: 0,
            details: []
        };
        
        for (const genesisToken of GENESIS_TOKENS) {
            try {
                console.log(`   📝 Processing ${genesisToken.factory} genesis token...`);
                
                // Check if already exists
                const allTokens = await kv.get('all_tokens') || [];
                let existsInDb = false;
                
                for (const txHash of allTokens) {
                    const tokenData = await kv.get(`token:${txHash}`);
                    if (tokenData && tokenData.tokenContractAddress && 
                        tokenData.tokenContractAddress.toLowerCase() === genesisToken.address.toLowerCase()) {
                        existsInDb = true;
                        break;
                    }
                }
                
                if (existsInDb) {
                    results.skipped++;
                    results.details.push(`${genesisToken.factory}: Already exists`);
                    continue;
                }
                
                // Get token info
                const tokenContract = new ethers.Contract(genesisToken.address, TOKEN_ABI, provider);
                const [name, symbol, decimals] = await Promise.all([
                    tokenContract.name().catch(() => 'Unknown Token'),
                    tokenContract.symbol().catch(() => 'UNKNOWN'),
                    tokenContract.decimals().catch(() => 18)
                ]);
                
                // Find or create deployment transaction info
                const deploymentTx = await findDeploymentTransaction(genesisToken.address, provider);
                
                // Create token record in same format as your populate.js
                const tokenRecord = {
                    txHash: deploymentTx.hash,
                    creator: deploymentTx.from,
                    factoryVersion: genesisToken.factory,
                    factoryAddress: genesisToken.factoryAddress,
                    timestamp: new Date(deploymentTx.timestamp * 1000).toISOString(),
                    blockNumber: deploymentTx.blockNumber,
                    gasUsed: deploymentTx.gasUsed,
                    
                    // Token data
                    tokenContractAddress: genesisToken.address.toLowerCase(),
                    tokenName: name,
                    tokenSymbol: symbol,
                    initialSupply: '0', // Genesis tokens may not have initial supply data
                    initialSupplyFormatted: '0',
                    parent: '0x0000000000000000000000000000000000000000',
                    parentName: 'None',
                    parentDisplayName: 'None',
                    
                    // Metadata
                    status: 'complete',
                    addedAt: new Date().toISOString(),
                    discoveredBy: 'surgical-genesis-add',
                    isGenesisToken: true,
                    note: genesisToken.note
                };
                
                // Store token data
                await kv.set(`token:${deploymentTx.hash}`, tokenRecord);
                
                // Update all tokens list
                const updatedAllTokens = await kv.get('all_tokens') || [];
                if (!updatedAllTokens.includes(deploymentTx.hash)) {
                    updatedAllTokens.push(deploymentTx.hash);
                    await kv.set('all_tokens', updatedAllTokens);
                }
                
                // Update indexes
                if (tokenRecord.creator) {
                    const creatorKey = `creator:${tokenRecord.creator.toLowerCase()}`;
                    const creatorTokens = await kv.get(creatorKey) || [];
                    if (!creatorTokens.includes(deploymentTx.hash)) {
                        creatorTokens.push(deploymentTx.hash);
                        await kv.set(creatorKey, creatorTokens);
                    }
                }
                
                if (tokenRecord.factoryVersion) {
                    const factoryKey = `factory:${tokenRecord.factoryVersion.toLowerCase()}`;
                    const factoryTokens = await kv.get(factoryKey) || [];
                    if (!factoryTokens.includes(deploymentTx.hash)) {
                        factoryTokens.push(deploymentTx.hash);
                        await kv.set(factoryKey, factoryTokens);
                    }
                }
                
                results.addedTokens++;
                results.details.push(`${genesisToken.factory}: Added ${symbol} (${genesisToken.address})`);
                console.log(`   ✅ Successfully added ${symbol} genesis token`);
                
            } catch (error) {
                console.error(`   ❌ Failed to add ${genesisToken.address}:`, error.message);
                results.errors++;
                results.details.push(`${genesisToken.factory}: Error - ${error.message}`);
            }
        }
        
        return {
            ...results,
            duration: `${Date.now() - startTime}ms`
        };
        
    } catch (error) {
        console.error('✅ Add genesis tokens failed:', error);
        throw error;
    }
}

function generatePreviewHTML(results) {
    const totalToAdd = results.tokensToAdd.length;
    const totalExists = results.alreadyExists.length;
    const totalErrors = results.errors.length;

    return `
<!DOCTYPE html>
<html>
<head>
    <title>🎯 Surgical Add - Genesis Tokens</title>
    <style>
        body { 
            font-family: 'Segoe UI', sans-serif; 
            max-width: 900px; 
            margin: 20px auto; 
            padding: 20px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e0e0e0;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #e74c3c, #c0392b);
            color: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            text-align: center;
        }
        .summary {
            background: rgba(6, 255, 165, 0.1);
            border: 1px solid rgba(6, 255, 165, 0.3);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        .warning {
            background: rgba(255, 193, 7, 0.1);
            border: 1px solid rgba(255, 193, 7, 0.3);
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
            color: #ffc107;
        }
        .token-card {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 15px;
            border-left: 4px solid #3498db;
        }
        .token-card.exists {
            border-left-color: #27ae60;
            background: rgba(39, 174, 96, 0.1);
        }
        .token-card.error {
            border-left-color: #e74c3c;
            background: rgba(231, 76, 60, 0.1);
        }
        .factory-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
            margin-right: 10px;
        }
        .v3 { background: #ff6b6b; color: white; }
        .v4 { background: #4ecdc4; color: white; }
        .btn {
            background: linear-gradient(135deg, #3498db, #2980b9);
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 1em;
            font-weight: 600;
            cursor: pointer;
            margin: 10px 10px 10px 0;
            transition: all 0.3s ease;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(52, 152, 219, 0.3);
        }
        .btn.success { background: linear-gradient(135deg, #27ae60, #229954); }
        .btn.danger { background: linear-gradient(135deg, #e74c3c, #c0392b); }
        code { 
            background: rgba(255, 255, 255, 0.1); 
            padding: 2px 6px; 
            border-radius: 4px; 
            font-family: monospace;
        }
        details {
            margin-top: 10px;
        }
        
        summary {
            padding: 8px;
            background: rgba(6, 255, 165, 0.1);
            border: 1px solid rgba(6, 255, 165, 0.3);
            border-radius: 5px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        summary:hover {
            background: rgba(6, 255, 165, 0.2);
        }
        
        pre {
            background: rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 5px;
            padding: 15px;
            overflow-x: auto;
            font-size: 0.85em;
            line-height: 1.4;
        }
        
        #loading {
            display: none;
            color: #06ffa5;
            font-weight: bold;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎯 Surgical Add - Genesis Tokens</h1>
        <p>Targeted addition of the first V3 and V4 tokens</p>
    </div>

    <div class="summary">
        <h2>📊 Genesis Token Status</h2>
        <ul>
            <li><strong>Tokens to Add:</strong> ${totalToAdd}</li>
            <li><strong>Already Exist:</strong> ${totalExists}</li>
            <li><strong>Errors:</strong> ${totalErrors}</li>
        </ul>
    </div>

    ${totalToAdd === 0 && totalExists > 0 ? `
        <div class="warning">
            <h3>✅ All Genesis Tokens Already Exist!</h3>
            <p>Both the first V3 and V4 tokens are already in your database. No action needed.</p>
        </div>
    ` : ''}

    ${results.tokensToAdd.map(token => `
        <div class="token-card">
            <h3>
                <span class="factory-badge ${token.factory.toLowerCase()}">${token.factory}</span>
                ${token.symbol} - ${token.name}
            </h3>
            <p><strong>Address:</strong> <code>${token.address}</code></p>
            <p><strong>Note:</strong> ${token.note}</p>
            <p><strong>Decimals:</strong> ${token.decimals}</p>
            ${token.deploymentTx.synthetic ? 
                '<p><small>⚠️ Using synthetic transaction data (original deployment tx not found)</small></p>' : 
                `<p><strong>Deployment TX:</strong> <code>${token.deploymentTx.hash}</code></p>`
            }
            
            <details style="margin-top: 15px;">
                <summary style="cursor: pointer; font-weight: bold; color: #06ffa5;">🔍 Show Complete Database Record</summary>
                <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-top: 10px;">
                    <h4>Exact data that will be stored in Redis:</h4>
                    <pre style="font-size: 0.9em; overflow-x: auto; color: #e0e0e0;">${JSON.stringify(token.tokenRecord, null, 2)}</pre>
                    <br>
                    <h4>Database operations that will be performed:</h4>
                    <ul style="font-size: 0.9em; color: #ccc;">
                        <li><code>kv.set('token:${token.tokenRecord.txHash}', tokenRecord)</code></li>
                        <li>Add <code>${token.tokenRecord.txHash}</code> to <code>all_tokens</code> array</li>
                        <li>Add to <code>creator:${token.tokenRecord.creator.toLowerCase()}</code> index</li>
                        <li>Add to <code>factory:${token.tokenRecord.factoryVersion.toLowerCase()}</code> index</li>
                    </ul>
                </div>
            </details>
        </div>
    `).join('')}

    ${results.alreadyExists.map(token => `
        <div class="token-card exists">
            <h3>
                <span class="factory-badge ${token.factory.toLowerCase()}">${token.factory}</span>
                ✅ Already Exists
            </h3>
            <p><strong>Address:</strong> <code>${token.address}</code></p>
            <p><strong>Status:</strong> ${token.status}</p>
            <p><strong>TX Hash:</strong> <code>${token.txHash}</code></p>
        </div>
    `).join('')}

    ${results.errors.map(token => `
        <div class="token-card error">
            <h3>
                <span class="factory-badge ${token.factory.toLowerCase()}">${token.factory}</span>
                ❌ Error
            </h3>
            <p><strong>Address:</strong> <code>${token.address}</code></p>
            <p><strong>Error:</strong> ${token.error}</p>
        </div>
    `).join('')}

    ${totalToAdd > 0 ? `
        <div style="text-align: center; margin: 30px 0;">
            <button class="btn danger" onclick="confirmAdd()">
                🎯 Add ${totalToAdd} Genesis Token${totalToAdd > 1 ? 's' : ''} to Database
            </button>
            <div id="loading">⏳ Adding genesis tokens...</div>
        </div>
    ` : ''}

    <div style="margin-top: 30px; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 8px;">
        <p><strong><a href="/token-library.html" style="color: #06ffa5;">← Back to Token Library</a></strong></p>
        <p><small>Scan completed in ${results.duration}</small></p>
    </div>

    <script>
        async function confirmAdd() {
            if (!confirm('Are you sure you want to add the genesis tokens to the database?\\n\\nThis will add the first V3 and V4 tokens that were created during factory deployment.')) {
                return;
            }
            
            document.getElementById('loading').style.display = 'block';
            document.querySelector('.btn.danger').disabled = true;
            
            try {
                const response = await fetch(window.location.href, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'confirm',
                        confirmed: true
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert(\`Successfully added \${result.addedTokens} genesis tokens!\\n\\nDetails:\\n\${result.details.join('\\n')}\`);
                    window.location.href = '/token-library.html';
                } else {
                    alert('Error: ' + result.error);
                }
                
            } catch (error) {
                alert('Error: ' + error.message);
            } finally {
                document.getElementById('loading').style.display = 'none';
                document.querySelector('.btn.danger').disabled = false;
            }
        }
    </script>
</body>
</html>
    `;
}
