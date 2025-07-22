import { kv } from '../lib/redis.js';

const TOKEN_ABI = [
    {"type":"function","name":"symbol","inputs":[],"outputs":[{"name":"","type":"string"}],"stateMutability":"view"},
    {"type":"function","name":"token0","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"},
    {"type":"function","name":"token1","inputs":[],"outputs":[{"name":"","type":"address"}],"stateMutability":"view"}
];

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const startTime = Date.now();
    
    try {
        console.log('🚀 Starting PLP components backfill...');
        
        const { ethers } = await import('ethers');
        const provider = new ethers.JsonRpcProvider('https://rpc-pulsechain.g4mm4.io');
        
        // 1. Get all token hashes from database
        const allTokenHashes = await kv.get('all_tokens') || [];
        console.log(`📊 Found ${allTokenHashes.length} total tokens in database`);
        
        // 2. Load all tokens and find ones with PLP parents
        const tokensWithPLPParents = [];
        const uniquePLPAddresses = new Set();
        
        console.log('🔍 Scanning for PLP parent tokens...');
        for (const hash of allTokenHashes) {
            const tokenData = await kv.get(`token:${hash}`);
            if (tokenData && 
                tokenData.parent && 
                tokenData.parent !== '0x0000000000000000000000000000000000000000' &&
                tokenData.parentName && 
                (tokenData.parentName.includes('PulseX LP') || 
                 tokenData.parentName.includes('PLP') ||
                 tokenData.parentName.toLowerCase().includes('lp'))) {
                
                tokensWithPLPParents.push({ hash, ...tokenData });
                uniquePLPAddresses.add(tokenData.parent.toLowerCase());
            }
        }
        
        console.log(`📍 Found ${tokensWithPLPParents.length} tokens with PLP parents`);
        console.log(`🔗 Found ${uniquePLPAddresses.size} unique PLP addresses to process`);
        
        if (uniquePLPAddresses.size === 0) {
            return res.status(200).json({
                success: true,
                message: 'No PLP tokens found - nothing to backfill',
                uniquePLPCount: 0,
                updatedTokens: 0,
                duration: `${Date.now() - startTime}ms`
            });
        }
        
        // 3. Process each unique PLP address
        let processed = 0;
        let totalUpdated = 0;
        
        for (const plpAddress of uniquePLPAddresses) {
            processed++;
            console.log(`🔧 Processing PLP ${processed}/${uniquePLPAddresses.size}: ${plpAddress}`);
            
            try {
                // Get PLP components
                const components = await getPLPComponents(plpAddress, provider);
                console.log(`✅ Got components: ${components}`);
                
                // Update all tokens with this parent address
                let updatedCount = 0;
                for (const token of tokensWithPLPParents) {
                    if (token.parent.toLowerCase() === plpAddress) {
                        // Update the token record with PLP component info
                        const updatedTokenData = {
                            ...token,
                            parentDisplayName: `${token.parentName}<br><small style="font-size: 0.75em; color: #888;">${components}</small>`,
                            plpComponents: components,
                            isPLP: true,
                            backfillUpdatedAt: new Date().toISOString()
                        };
                        
                        await kv.set(`token:${token.txHash}`, updatedTokenData);
                        updatedCount++;
                    }
                }
                
                totalUpdated += updatedCount;
                console.log(`📝 Updated ${updatedCount} token records`);
                
                // Small delay to be nice to RPC
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.error(`❌ Failed to process ${plpAddress}:`, error.message);
                // Continue with other PLPs even if one fails
            }
        }
        
        const duration = Date.now() - startTime;
        console.log(`🎉 Backfill complete! Processed ${uniquePLPAddresses.size} unique PLP addresses in ${duration}ms`);
        
        return res.status(200).json({
            success: true,
            message: 'PLP backfill completed successfully',
            uniquePLPCount: uniquePLPAddresses.size,
            updatedTokens: totalUpdated,
            totalTokensScanned: allTokenHashes.length,
            plpTokensFound: tokensWithPLPParents.length,
            duration: `${duration}ms`
        });
        
    } catch (error) {
        console.error('💥 Backfill failed:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            duration: `${Date.now() - startTime}ms`
        });
    }
}

async function getPLPComponents(plpAddress, provider) {
    const { ethers } = await import('ethers');
    
    try {
        const plpContract = new ethers.Contract(plpAddress, TOKEN_ABI, provider);
        
        // Get token addresses
        const [token0Address, token1Address] = await Promise.all([
            plpContract.token0(),
            plpContract.token1()
        ]);
        
        // Get token symbols
        const token0Contract = new ethers.Contract(token0Address, TOKEN_ABI, provider);
        const token1Contract = new ethers.Contract(token1Address, TOKEN_ABI, provider);
        
        const [token0Symbol, token1Symbol] = await Promise.all([
            token0Contract.symbol(),
            token1Contract.symbol()
        ]);
        
        // Return formatted components
        return `(${token0Symbol} + ${token1Symbol})`;
        
    } catch (error) {
        console.error(`Error getting PLP components for ${plpAddress}:`, error);
        throw error;
    }
}
