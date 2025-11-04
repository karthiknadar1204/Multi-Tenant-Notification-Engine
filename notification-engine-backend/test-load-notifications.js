// test-load-notifications.js
import axios from 'axios';

const HACKATHONS = ['ethindia-2024', 'tinkerquest-2025', 'codezen-2025'];
const USERS_PER_EVENT = 50;
const TOTAL_NOTIFICATIONS = 100;

async function simulateUsers(event, userCount) {
  for (let i = 0; i < userCount; i++) {
    // Simulate user joining (via frontend, but mock here)
    console.log(`User ${i + 1} joined ${event}`);
  }
}

async function sendNotification(event) {
  await axios.post(`http://localhost:3003/notify/${event}`, {
    message: `Deadline for ${event}!`,
    type: 'deadline'
  });
  console.log(`Notification sent to ${event} (50 users)`);
}

async function runDemo() {
  // Simulate 50 users per event
  for (const event of HACKATHONS) {
    await simulateUsers(event, USERS_PER_EVENT);
  }

  // Send 100 notifications (bursts)
  for (let i = 0; i < TOTAL_NOTIFICATIONS; i++) {
    const event = HACKATHONS[i % HACKATHONS.length];
    await sendNotification(event);
  }
}

runDemo();