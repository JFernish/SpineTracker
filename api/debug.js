import { kv } from '../lib/redis.js';

export default async function handler(req, res) {
  try {
    // Try to use our Redis helper
    await kv.set('test-key', 'test-value');
    const result = await kv.get('test-key');
    
    return res.status(200).json({
      success: true,
      message: "Redis connection successful",
      test_result: result,
      redis_url: process.env.REDIS_URL ? 'present' : 'missing'
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Redis connection failed: ${error.message}`,
      redis_url: process.env.REDIS_URL ? 'present' : 'missing'
    });
  }
}
