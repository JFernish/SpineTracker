import { createClient } from 'redis';

let redis = null;

export async function getRedisClient() {
  if (!redis) {
    redis = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            return new Error('Max retries exceeded');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redis.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    await redis.connect();
  }
   
  return redis;
}

// KV-like interface using Redis
export const kv = {
  async get(key) {
    const client = await getRedisClient();
    const result = await client.get(key);
    try {
      return result ? JSON.parse(result) : null;
    } catch {
      return result;
    }
  },

  async set(key, value) {
    const client = await getRedisClient();
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    return await client.set(key, stringValue);
  },

  async del(key) {
    const client = await getRedisClient();
    return await client.del(key);
  }
};
