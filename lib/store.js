const { createClient } = require('redis');

let clientPromise;

function getRedis() {
  if (clientPromise) return clientPromise;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Redis database is not configured');
  const client = createClient({ url });
  client.on('error', err => console.error('Redis client error', err));
  clientPromise = client.connect().then(() => client);
  return clientPromise;
}

module.exports = { getRedis };
