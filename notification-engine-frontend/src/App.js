// src/App.js
import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3003';

function App() {
  const [hackathonId, setHackathonId] = useState('ethindia-2024');
  const [notifications, setNotifications] = useState([]);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);

    newSocket.emit('join-hackathon', hackathonId);

    newSocket.on('notifications:initial', (initial) => {
      setNotifications(initial);
    });

    newSocket.on('notification:received', (notif) => {
      setNotifications(prev => [notif, ...prev].slice(0, 50));
    });

    return () => newSocket.disconnect();
  }, [hackathonId]);

  const sendNotification = async () => {
    await fetch(`http://localhost:3003/notify/${hackathonId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Deadline approaching!', type: 'deadline' })
    });
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Multi-Tenant Notifier</h1>
      <select value={hackathonId} onChange={(e) => setHackathonId(e.target.value)}>
        <option value="ethindia-2024">ETHIndia 2024</option>
        <option value="tinkerquest-2025">TinkerQuest 2025</option>
        <option value="codezen-2025">CodeZen 2025</option>
      </select>
      <br /><br />
      <button onClick={sendNotification}>Send Notification to {hackathonId}</button>
      <h3>Notifications for {hackathonId}:</h3>
      <ul>
        {notifications.map((notif) => (
          <li key={notif.id} style={{ padding: 10, border: '1px solid #ccc', margin: 5 }}>
            <strong>{notif.type.toUpperCase()}:</strong> {notif.message} <em>({new Date(notif.sent_at).toLocaleTimeString()})</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default App;