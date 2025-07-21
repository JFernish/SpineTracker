export default function handler(req, res) {
  res.status(200).json({
    hasRedis: !!process.env.REDIS_URL,
    nodeVersion: process.version,
    redisUrl: process.env.REDIS_URL ? "present" : "missing",
    allRedisVars: {
      REDIS_URL: process.env.REDIS_URL ? "present" : "missing",
      KV_URL: process.env.KV_URL ? "present" : "missing",
      // Check for other possible Redis variable names
      REDIS_PASSWORD: process.env.REDIS_PASSWORD ? "present" : "missing"
    },
    allEnvVars: Object.keys(process.env).filter(key => 
      key.includes('REDIS') || key.includes('KV')
    )
  });
}
