import { createClient } from 'redis';

export default async function handler(req, res) {
  try {
    console.log('Testing Redis connection...');
    console.log('REDIS_URL present:', !!process.env.REDIS_URL);
    
    const client = createClient({
      url: process.env.REDIS_URL
    });
    
    console.log('Attempting to connect...');
    await client.connect();
    
    console.log('Connected! Testing set/get...');
    await client.set('test', 'hello');
    const result = await client.get('test');
    
    await client.quit();
    
    return res.status(200).json({
      success: true,
      message: 'Redis connection works!',
      testResult: result
    });
    
  } catch (error) {
    console.error('Redis connection error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
