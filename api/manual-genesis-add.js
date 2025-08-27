import { kv } from '../lib/redis.js';

// COMPLETE HARD-CODED DATA - Ready to preview and add to database
const GENESIS_TOKENS_DATA = [
    {
        address: '0xac57300da6e17e9e83e71b9f6f75d08dc3836532',
        txHash: '0x1b5c3a71262c46e316f094695a00e54294342c30c9643ede035af3bdfa013b56',
        initialSupplyHuman: '1',
        factory: 'V4',
        factoryAddress: '0x394c3D5990cEfC7Be36B82FDB07a7251ACe61cc7',
        creator: '0xBF182955401aF3f2f7e244cb31184E93E74a2501'
    },
    {
        address: '0x3BC7AB48aD7b6BFdCaC1281C8b49861823452460',
        txHash: '0x1b5c3a71262c46e316f094695a00e54294342c30c9643ede035af3bdfa013b56-1',
        initialSupplyHuman: '1111111111',
        factory: 'V4',
        factoryAddress: '0x394c3D5990cEfC7Be36B82FDB07a7251ACe61cc7',
        creator: '0xBF182955401aF3f2f7e244cb31184E93E74a2501'
    },
    {
        address: '0x628F327a4645145A0D27E155f5fFD5Fd9E30AFf5',
        txHash: '0x1b5c3a71262c46e316f094695a00e54294342c30c9643ede035af3bdfa013b56-2',
        initialSupplyHuman: '1111111111',
        factory: 'V4',
        factoryAddress: '0x394c3D5990cEfC7Be36B82FDB07a7251ACe61cc7',
        creator: '0xBF182955401aF3f2f7e244cb31184E93E74a2501'
    }
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

    const startTime = Date.now();
    
    try {
        console.log('🔍 Starting genesis token handler...');
        
        const { action, confirmed } = req.body || {};
        
        if (action === 'preview' || req.method === 'GET') {
            console.log('🔍 PREVIEW: Manual genesis token data...');
            const previewResults = await previewManualData();
            
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
            console.log('✅ CONFIRMED: Adding manual genesis tokens...');
            const confirmResults = await addManualGenesisTokens();
            
            return res.status(200).json({
                success: true,
                mode: 'confirmed',
                ...confirmResults,
                duration: `${Date.now() - startTime}ms`
            });
        }
        
        // Default: preview
        const previewResults = await previewManualData();
        return res.status(200).send(generatePreviewHTML(previewResults));
        
    } catch (error) {
        console.error('💥 Manual genesis add failed:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            duration: `${Date.now() - startTime}ms`
        });
    }
}

async function previewManualData() {
    const startTime = Date.now();
    
    try {
        console.log('🔍 Checking manual genesis token data...');
        const provider = await getProvider();
        
        const results = {
            tokensToAdd: [],
            alreadyExists: [],
            missingData: [],
            errors: []
        };
        
        for (const tokenData of GENESIS_TOKENS_DATA) {
            try {
                console.log(`   🔡 Checking ${tokenData.factory} genesis token: ${tokenData.address}`);
                
                // Check if already exists in database
                const allTokens = await kv.get('all_tokens') || [];
                let existsInDb = false;
                let existingTxHash = null;
                
                for (const txHash of allTokens) {
                    const existingTokenData = await kv.get(`token:${txHash}`);
                    if (existingTokenData && existingTokenData.tokenContractAddress && 
                        existingTokenData.tokenContractAddress.toLowerCase() === tokenData.address.toLowerCase()) {
                        existsInDb = true;
                        existingTxHash = txHash;
                        break;
                    }
                }
                
                if (existsInDb) {
                    results.alreadyExists.push({
                        ...tokenData,
                        txHash: existingTxHash,
                        status: 'Already exists in database'
                    });
                    continue;
                }
                
                // All data is now hard-coded, so check if we can process
                if (!tokenData.txHash || tokenData.initialSupplyHuman === undefined) {
                    results.missingData.push({
                        ...tokenData,
                        missingFields: ['Data should be hard-coded'],
                        status: 'Configuration error'
                    });
                    continue;
                }
                
                // Get transaction details and token info from blockchain
                const [txDetails, tokenInfo] = await Promise.all([
                    getTransactionDetails(tokenData.txHash, provider),
                    getTokenInfoFromContract(tokenData.address, provider)
                ]);
                
                if (!txDetails) {
                    results.errors.push({
                        ...tokenData,
                        error: 'Could not fetch transaction details'
                    });
                    continue;
                }
                
                if (!tokenInfo) {
                    results.errors.push({
                        ...tokenData,
                        error: 'Could not fetch token contract info'
                    });
                    continue;
                }
                
                // Convert human readable supply to wei
                const initialSupplyWei = convertToWei(tokenData.initialSupplyHuman, tokenInfo.decimals);
                
                // Create the complete token data with ALL fields populated
                const completeTokenData = {
                    ...tokenData,
                    tokenName: tokenInfo.name,
                    tokenSymbol: tokenInfo.symbol,
                    decimals: tokenInfo.decimals,
                    blockNumber: txDetails.blockNumber,
                    timestamp: txDetails.timestamp,
                    gasUsed: txDetails.gasUsed,
                    initialSupply: initialSupplyWei,
                    initialSupplyFormatted: tokenData.initialSupplyHuman,
                    parentAddress: tokenInfo.parentAddress,
                    parentName: tokenInfo.parentName,
                    parentDisplayName: tokenInfo.parentDisplayName
                };
                
                const tokenRecord = createTokenRecord(completeTokenData);
                
                results.tokensToAdd.push({
                    ...completeTokenData,
                    tokenRecord,
                    status: 'Ready to add'
                });
                
            } catch (error) {
                console.error(`   ❌ Error checking ${tokenData.address}:`, error.message);
                results.errors.push({
                    ...tokenData,
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

async function getTransactionDetails(txHash, provider) {
    try {
        console.log(`   🔗 Fetching transaction details for ${txHash}`);
        
        const [transaction, receipt] = await Promise.all([
            provider.getTransaction(txHash),
            provider.getTransactionReceipt(txHash)
        ]);
        
        if (!transaction || !receipt) {
            throw new Error('Transaction or receipt not found');
        }
        
        const block = await provider.getBlock(receipt.blockNumber);
        if (!block) {
            throw new Error('Block not found');
        }
        
        return {
            blockNumber: receipt.blockNumber,
            timestamp: new Date(block.timestamp * 1000).toISOString(),
            gasUsed: receipt.gasUsed.toString()
        };
        
    } catch (error) {
        console.error(`Error fetching transaction details:`, error);
        return null;
    }
}

async function getTokenInfoFromContract(tokenAddress, provider) {
    try {
        console.log(`   🔗 Getting complete token info from contract ${tokenAddress}`);
        const { ethers } = await import('ethers');
        
        const TOKEN_ABI = [
            {"type":"function","name":"name","inputs":[],"outputs":[{"name":"","type":"string"}],"stateMutability":"view"},
            {"type":"function","name":"symbol","inputs":[],"outputs":[{"name":"","type":"string"}],"stateMutability":"view"},
            {"type":"function","name":"decimals","inputs":[],"outputs":[{"name":"","type":"uint8"}],"stateMutability":"view"},
            {"type":"function","name":"Parent","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
            {"type":"function","name":"parent","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"}
        ];
        
        const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
        
        const [name, symbol, decimals] = await Promise.all([
            tokenContract.name().catch(() => 'Unknown Token'),
            tokenContract.symbol().catch(() => 'UNKNOWN'),
            tokenContract.decimals().catch(() => 18)
        ]);
        
        console.log(`   🔋 Token info: ${symbol} (${name}), decimals: ${decimals}`);
        
        let parentAddress = '0x0000000000000000000000000000000000000000';
        try {
            parentAddress = await tokenContract.Parent().catch(async () => {
                return await tokenContract.parent().catch(() => '0x0000000000000000000000000000000000000000');
            });
            console.log(`   🔗 Parent address from token contract: ${parentAddress}`);
        } catch (error) {
            console.log(`   ℹ️ No parent found for ${tokenAddress}`);
        }
        
        let parentName = 'None';
        let parentDisplayName = 'None';
        
        if (parentAddress && parentAddress !== '0x0000000000000000000000000000000000000000') {
            try {
                const parentContract = new ethers.Contract(parentAddress, TOKEN_ABI, provider);
                parentName = await parentContract.name().catch(() => 'Unknown Parent');
                parentDisplayName = parentName;
                console.log(`   🔋 Parent token name: ${parentName}`);
            } catch (error) {
                console.log(`   ⚠️ Could not get parent name for ${parentAddress}`);
                parentName = 'Unknown Parent';
                parentDisplayName = 'Unknown Parent';
            }
        }
        
        return {
            name: name || 'Unknown Token',
            symbol: symbol || 'UNKNOWN', 
            decimals: Number(decimals) || 18,
            parentAddress: parentAddress,
            parentName: parentName,
            parentDisplayName: parentDisplayName
        };
        
    } catch (error) {
        console.error(`Error getting token info:`, error);
        return null;
    }
}

function convertToWei(humanAmount, decimals) {
    try {
        if (!humanAmount || humanAmount === '0') return '0';
        
        const multiplier = Math.pow(10, decimals);
        const weiAmount = (parseFloat(humanAmount) * multiplier).toString();
        return weiAmount;
    } catch (error) {
        console.error('Error converting to wei:', error);
        return '0';
    }
}

function createTokenRecord(tokenData) {
    return {
        txHash: tokenData.txHash,
        creator: tokenData.creator,
        factoryVersion: tokenData.factory,
        factoryAddress: tokenData.factoryAddress,
        timestamp: tokenData.timestamp,
        blockNumber: tokenData.blockNumber,
        gasUsed: tokenData.gasUsed,
        tokenContractAddress: tokenData.address.toLowerCase(),
        tokenName: tokenData.tokenName,
        tokenSymbol: tokenData.tokenSymbol,
        initialSupply: tokenData.initialSupply,
        initialSupplyFormatted: tokenData.initialSupplyFormatted,
        parent: tokenData.parentAddress,
        parentName: tokenData.parentName,
        parentDisplayName: tokenData.parentDisplayName,
        status: 'complete',
        addedAt: new Date().toISOString(),
        discoveredBy: 'manual-genesis-add',
        isGenesisToken: true,
        note: `First ${tokenData.factory} token - manually added`
    };
}

async function addManualGenesisTokens() {
    const startTime = Date.now();
    
    try {
        console.log('✅ Adding manual genesis tokens to database...');
        
        const results = {
            addedTokens: 0,
            skipped: 0,
            errors: 0,
            details: []
        };
        
        for (const tokenData of GENESIS_TOKENS_DATA) {
            try {
                console.log(`   🔍 Processing ${tokenData.factory} genesis token...`);
                
                const allTokens = await kv.get('all_tokens') || [];
                let existsInDb = false;
                
                for (const txHash of allTokens) {
                    const existingTokenData = await kv.get(`token:${txHash}`);
                    if (existingTokenData && existingTokenData.tokenContractAddress && 
                        existingTokenData.tokenContractAddress.toLowerCase() === tokenData.address.toLowerCase()) {
                        existsInDb = true;
                        break;
                    }
                }
                
                if (existsInDb) {
                    results.skipped++;
                    results.details.push(`${tokenData.factory}: Already exists`);
                    continue;
                }
                
                if (!tokenData.txHash || tokenData.initialSupplyHuman === undefined) {
                    results.errors++;
                    results.details.push(`${tokenData.factory}: Configuration error - data should be hard-coded`);
                    continue;
                }
                
                const provider = await getProvider();
                const [txDetails, tokenInfo] = await Promise.all([
                    getTransactionDetails(tokenData.txHash, provider),
                    getTokenInfoFromContract(tokenData.address, provider)
                ]);
                
                if (!txDetails) {
                    results.errors++;
                    results.details.push(`${tokenData.factory}: Could not fetch transaction details`);
                    continue;
                }
                
                if (!tokenInfo) {
                    results.errors++;
                    results.details.push(`${tokenData.factory}: Could not fetch token contract info`);
                    continue;
                }
                
                const initialSupplyWei = convertToWei(tokenData.initialSupplyHuman, tokenInfo.decimals);
                
                const completeTokenData = {
                    ...tokenData,
                    tokenName: tokenInfo.name,
                    tokenSymbol: tokenInfo.symbol,
                    decimals: tokenInfo.decimals,
                    blockNumber: txDetails.blockNumber,
                    timestamp: txDetails.timestamp,
                    gasUsed: txDetails.gasUsed,
                    initialSupply: initialSupplyWei,
                    initialSupplyFormatted: tokenData.initialSupplyHuman,
                    parentAddress: tokenInfo.parentAddress,
                    parentName: tokenInfo.parentName,
                    parentDisplayName: tokenInfo.parentDisplayName
                };
                
                const tokenRecord = createTokenRecord(completeTokenData);
                
                await kv.set(`token:${tokenData.txHash}`, tokenRecord);
                
                const updatedAllTokens = await kv.get('all_tokens') || [];
                if (!updatedAllTokens.includes(tokenData.txHash)) {
                    updatedAllTokens.push(tokenData.txHash);
                    await kv.set('all_tokens', updatedAllTokens);
                }
                
                if (tokenRecord.creator) {
                    const creatorKey = `creator:${tokenRecord.creator.toLowerCase()}`;
                    const creatorTokens = await kv.get(creatorKey) || [];
                    if (!creatorTokens.includes(tokenData.txHash)) {
                        creatorTokens.push(tokenData.txHash);
                        await kv.set(creatorKey, creatorTokens);
                    }
                }
                
                if (tokenRecord.factoryVersion) {
                    const factoryKey = `factory:${tokenRecord.factoryVersion.toLowerCase()}`;
                    const factoryTokens = await kv.get(factoryKey) || [];
                    if (!factoryTokens.includes(tokenData.txHash)) {
                        factoryTokens.push(tokenData.txHash);
                        await kv.set(factoryKey, factoryTokens);
                    }
                }
                
                results.addedTokens++;
                results.details.push(`${tokenData.factory}: Added ${tokenInfo.symbol} (${tokenData.address})`);
                console.log(`   ✅ Successfully added ${tokenInfo.symbol} genesis token`);
                
            } catch (error) {
                console.error(`   ❌ Failed to add ${tokenData.address}:`, error.message);
                results.errors++;
                results.details.push(`${tokenData.factory}: Error - ${error.message}`);
            }
        }
        
        return {
            ...results,
            duration: `${Date.now() - startTime}ms`
        };
        
    } catch (error) {
        console.error('✅ Add manual genesis tokens failed:', error);
        throw error;
    }
}

function generatePreviewHTML(results) {
    const totalToAdd = results.tokensToAdd.length;
    const totalExists = results.alreadyExists.length;
    const totalMissing = results.missingData.length;
    const totalErrors = results.errors.length;

    return `
<!DOCTYPE html>
<html>
<head>
    <title>🎯 Genesis Token Data Preview</title>
    <style>
        body { 
            font-family: 'Segoe UI', sans-serif; 
            max-width: 1000px; 
            margin: 20px auto; 
            padding: 20px;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
            color: #e0e0e0;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #9b59b6, #8e44ad);
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
        .btn.danger { background: linear-gradient(135deg, #e74c3c, #c0392b); }
        code { 
            background: rgba(255, 255, 255, 0.1); 
            padding: 2px 6px; 
            border-radius: 4px; 
            font-family: monospace;
        }
        details { margin-top: 10px; }
        summary {
            padding: 8px;
            background: rgba(6, 255, 165, 0.1);
            border: 1px solid rgba(6, 255, 165, 0.3);
            border-radius: 5px;
            cursor: pointer;
        }
        pre {
            background: rgba(0, 0, 0, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 5px;
            padding: 15px;
            overflow-x: auto;
            font-size: 0.85em;
        }
        #loading { display: none; color: #06ffa5; font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎯 Genesis Token Data Preview</h1>
        <p>Complete data for NotdotsQ, Skill and Larp V4 genesis tokens - ready to add to database</p>
    </div>

    <div class="summary">
        <h2>📊 Hard-Coded Genesis Data</h2>
        <ul>
            <li><strong>NotdotsQ Token:</strong> 0xac57300da6e17e9e83e71b9f6f75d08dc3836532</li>
            <li><strong>NotdotsQ TX Hash:</strong> 0x1b5c3a71262c46e316f094695a00e54294342c30c9643ede035af3bdfa013b56</li>
            <li><strong>NotdotsQ Initial Supply:</strong> 1 (human readable)</li>
            <li><strong>Skill Token:</strong> 0x3BC7AB48aD7b6BFdCaC1281C8b49861823452460</li>
            <li><strong>Skill TX Hash:</strong> 0x1b5c3a71262c46e316f094695a00e54294342c30c9643ede035af3bdfa013b56-1</li>
            <li><strong>Skill Initial Supply:</strong> 1,111,111,111 (human readable)</li>
            <li><strong>Larp Token:</strong> 0x628F327a4645145A0D27E155f5fFD5Fd9E30AFf5</li>
            <li><strong>Larp TX Hash:</strong> 0x1b5c3a71262c46e316f094695a00e54294342c30c9643ede035af3bdfa013b56-2</li>
            <li><strong>Larp Initial Supply:</strong> 1,111,111,111 (human readable)</li>
        </ul>
        <p><strong>Ready to Add:</strong> ${totalToAdd} | <strong>Already Exist:</strong> ${totalExists} | <strong>Errors:</strong> ${totalErrors}</p>
    </div>

    ${results.tokensToAdd.map(token => `
        <div class="token-card">
            <h3>
                <span class="factory-badge ${token.factory.toLowerCase()}">${token.factory}</span>
                ${token.tokenSymbol} - ${token.tokenName}
            </h3>
            <p><strong>Address:</strong> <code>${token.address}</code></p>
            <p><strong>TX Hash:</strong> <code>${token.txHash}</code></p>
            <p><strong>Block:</strong> ${token.blockNumber}</p>
            <p><strong>Creator:</strong> <code>${token.creator}</code></p>
            
            <details style="margin-top: 15px;">
                <summary style="cursor: pointer; font-weight: bold; color: #06ffa5;">🔍 Show Complete Database Record</summary>
                <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-top: 10px;">
                    <h4>Exact data that will be stored:</h4>
                    <pre>${JSON.stringify(token.tokenRecord, null, 2)}</pre>
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
        <p><small>Preview completed in ${results.duration}</small></p>
    </div>

    <script>
        async function confirmAdd() {
            if (!confirm('Are you sure you want to add the genesis tokens to the database?')) {
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
                    alert('Successfully added ' + result.addedTokens + ' genesis tokens!');
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
