const { MongoMemoryReplSet } = require('mongodb-memory-server');

async function main() {
  console.log('Starting local MongoDB replica set on port 27017...');
  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [
      {
        port: 27017,
        dbName: 'namviek',
      },
    ],
  });

  const uri = replSet.getUri();
  console.log(`Local MongoDB running at: ${uri}`);
  console.log('Database ready for Namviek!');
}

main().catch((err) => {
  console.error('Failed to start local MongoDB:', err);
  process.exit(1);
});
