// worker.js
import 'dotenv/config';
import { Worker } from 'bullmq';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const pubClient = redis;
const subClient = redis.duplicate();

// Create HTTP server for Socket.io
const httpServer = createServer();
const io = new Server(httpServer, {
  adapter: createAdapter(pubClient, subClient),
  cors: { origin: 'http://localhost:3000' }
});

// Start HTTP server on a different port (or unused port)
const WORKER_PORT = process.env.WORKER_PORT || 3004;
httpServer.listen(WORKER_PORT, () => {
  console.log(`Worker Socket.io server listening on port ${WORKER_PORT}`);
});

// Consumer for each stream (backpressure via consumer groups)
const hackathons = ['ethindia-2024', 'tinkerquest-2025'];  // Expand as needed

console.log('Starting notification workers...');
hackathons.forEach(hackathonId => {
  const streamKey = `notifications:${hackathonId}`;
  const consumerGroup = `fanout-group-${hackathonId}`;

  // Create consumer group if not exists
  redis.xgroup('CREATE', streamKey, consumerGroup, '$', 'MKSTREAM').catch(() => {});

  const worker = new Worker(`notifications-${hackathonId}`, async (job) => {
    console.log(`Processing job ${job.id} for hackathon ${hackathonId}`);
    const { notificationId, hackathonId, message, type } = job.data;

    try {
      // Get users in this tenant
      const { rows: users } = await pool.query(
        'SELECT socket_id FROM users WHERE hackathon_id = $1',
        [hackathonId]
      );

      console.log(`Found ${users.length} users for hackathon ${hackathonId}`);

      // Fan-out via Socket.io (only to this room)
      users.forEach(user => {
        if (user.socket_id) {
          io.to(hackathonId).to(user.socket_id).emit('notification:received', {
            id: notificationId,
            message,
            type
          });
        }
      });

      // Add to stream for backpressure/retry (consumer groups handle pending)
      await redis.xadd(streamKey, '*', 'notificationId', notificationId, 'hackathonId', hackathonId);

      // ACK (update delivered)
      await redis.publish('notifications:delivered', JSON.stringify({ notificationId, hackathonId, userId: users.length }));

      return { delivered: users.length };
    } catch (error) {
      console.error(`Error processing job ${job.id}:`, error);
      throw error;
    }
  }, { connection: redis, concurrency: 20 });  // 20 parallel fans-outs

  worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed for hackathon ${hackathonId}`);
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed for hackathon ${hackathonId}:`, err);
  });

  console.log(`Worker started for hackathon: ${hackathonId}`);
});

console.log('All workers started successfully!');