const { RedisMemoryServer } = require('redis-memory-server');

async function main() {
  console.log('Starting local Redis server on port 6379...');
  const redisServer = new RedisMemoryServer({
    instance: {
      port: 6379,
    },
  });

  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  console.log(`Local Redis server running at ${host}:${port}`);
}

main().catch((err) => {
  console.error('Failed to start local Redis:', err);
  process.exit(1);
});
