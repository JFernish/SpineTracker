import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  try {
    await kv.set('test', 'hello');
    const result = await kv.get('test');
    
    return res.status(200).json({
      success: true,
      test_value: result,
      redis_url: process.env.REDIS_URL ? 'present' : 'missing'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
