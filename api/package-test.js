export default function handler(req, res) {
  try {
    // Test if we can import redis at all
    console.log('Attempting to require redis...');
    const redis = require('redis');
    
    return res.status(200).json({
      success: true,
      message: 'Redis package imported successfully',
      hasCreateClient: typeof redis.createClient === 'function'
    });
    
  } catch (error) {
    console.log('Redis import failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      message: 'Redis package import failed'
    });
  }
}
