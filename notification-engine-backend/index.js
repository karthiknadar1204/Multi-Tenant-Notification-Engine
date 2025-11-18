// index.js
import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { Queue } from 'bullmq';


const app = express();
app.use(express.json()); // Parse JSON request bodies
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: 'http://localhost:3000' }
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const pubClient = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));

// Tenant-sharded queues (one per hackathon)
const queues = {};
function getQueue(hackathonId) {
  if (!queues[hackathonId]) {
    queues[hackathonId] = new Queue(`notifications-${hackathonId}`, { connection: pubClient });
  }
  return queues[hackathonId];
}

// === Shared Subscriber for Streams (backpressure via consumer groups) ===
const subscriber = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
subscriber.subscribe('notifications:delivered');  // For ACKs
subscriber.on('message', async (channel, message) => {
  const { hackathonId, notificationId, userId } = JSON.parse(message);
  // Update delivered count
  await pool.query(
    'UPDATE notifications SET delivered_count = delivered_count + 1 WHERE id = $1 AND hackathon_id = $2',
    [notificationId, hackathonId]
  );
});

// === Socket.io Rooms (per hackathon) ===
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-hackathon', async (hackathonId) => {
    socket.join(hackathonId);
    console.log(`Socket ${socket.id} joined ${hackathonId}`);

    // Save socket ID for fan-out
    await pool.query(
      'UPDATE users SET socket_id = $1 WHERE id = (SELECT id FROM users WHERE hackathon_id = $2 AND socket_id IS NULL LIMIT 1)',  // Simple assignment
      [socket.id, hackathonId]
    );

    // Send initial unread notifications
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE hackathon_id = $1 ORDER BY sent_at DESC LIMIT 10',
      [hackathonId]
    );
    socket.emit('notifications:initial', rows);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Clean up socket ID
    pool.query('UPDATE users SET socket_id = NULL WHERE socket_id = $1', [socket.id]);
  });
});

// === API: Add Notification (queues it) ===
app.post('/notify/:hackathonId', async (req, res) => {
  const { hackathonId } = req.params;
  const { message, type = 'deadline' } = req.body;

  // Save to DB
  const { rows } = await pool.query(
    'INSERT INTO notifications (hackathon_id, message, type) VALUES ($1, $2, $3) RETURNING id',
    [hackathonId, message, type]
  );
  const notificationId = rows[0].id;

  // Queue for fan-out (tenant-sharded)
  const queue = getQueue(hackathonId);
  await queue.add('send-notification', { notificationId, hackathonId, message, type }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
  });

  res.json({ success: true, notificationId });
});

const PORT = process.env.PORT || 3003;
server.listen(PORT, () => console.log(`Notification Engine on :${PORT}`));