export default async function handler(req, res) {
  try {
    // Try to import the KV package
    const { kv } = await import('@vercel/kv');
    
    return res.status(200).json({
      success: true,
      message: "@vercel/kv imported successfully",
      redis_url: process.env.REDIS_URL ? 'present' : 'missing'
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Failed to import @vercel/kv: ${error.message}`,
      redis_url: process.env.REDIS_URL ? 'present' : 'missing'
    });
  }
}
