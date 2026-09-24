const { Redis } = require('@upstash/redis');

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis database is not configured');
  return new Redis({ url, token });
}

module.exports = { getRedis };
