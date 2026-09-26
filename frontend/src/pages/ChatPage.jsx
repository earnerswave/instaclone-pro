import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';

export default function ChatPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const socketRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    if (!user) return;

    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { 
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5
    });

    socketRef.current = socket;

    // Emit user online status
    socket.on('connect', () => {
      console.log('Socket connected:', socket.id);
      socket.emit('user:online', user.id);
    });

    // Receive incoming messages
    socket.on('message:receive', (message) => {
      setMessages((prev) => [...prev, { 
        ...message, 
        mine: false,
        createdAt: message.createdAt || new Date().toISOString()
      }]);
    });

    // Receive typing indicator
    socket.on('typing:indicator', (payload) => {
      if (payload?.userId === selectedUserId) {
        setTyping(payload?.typing || false);
      }
    });

    // Receive online users list
    socket.on('online:users', (userIds) => {
      setOnlineUsers(new Set(userIds));
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, [user, selectedUserId]);

  // Load conversation list
  useEffect(() => {
    if (!user) return;

    const loadUsers = async () => {
      try {
        const res = await api.get('/messages/conversations');
        setUsers(res.data.conversations || []);
        if (res.data.conversations?.length > 0 && !selectedUserId) {
          setSelectedUserId(res.data.conversations[0].id);
        }
      } catch (error) {
        console.error('Failed to load users:', error);
        // Fallback to sample data
        setUsers([
          { id: 1, username: 'sophia', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330' },
          { id: 2, username: 'alex', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e' }
        ]);
      }
    };

    loadUsers();
  }, [user]);

  // Load messages for selected conversation
  useEffect(() => {
    if (!selectedUserId || !user) return;

    const loadMessages = async () => {
      try {
        const res = await api.get(`/messages/conversation/${selectedUserId}`);
        setMessages(res.data.messages || []);
      } catch (error) {
        console.error('Failed to load messages:', error);
        setMessages([]);
      }
    };

    loadMessages();
  }, [selectedUserId, user]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle sending message
  const handleSend = async () => {
    if (!draft.trim() || !selectedUserId || !user) return;

    try {
      // Create local message immediately for UX
      const localMessage = {
        id: Date.now(),
        senderId: user.id,
        receiverId: selectedUserId,
        text: draft,
        mine: true,
        createdAt: new Date().toISOString()
      };

      setMessages((prev) => [...prev, localMessage]);
      setDraft('');

      // Emit via socket for real-time delivery
      socketRef.current?.emit('message:send', {
        senderId: user.id,
        receiverId: selectedUserId,
        text: draft,
        image: null,
        video: null,
        audio: null
      });

      // Save to database
      await api.post('/messages/send', {
        receiverId: selectedUserId,
        text: draft
      });

      // Stop typing indicator
      socketRef.current?.emit('typing:stop', { receiverId: selectedUserId });
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic message on failure
      setMessages((prev) => prev.slice(0, -1));
      setDraft(draft); // Restore draft
    }
  };

  // Handle typing indicator
  const handleTyping = (value) => {
    setDraft(value);

    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Emit typing start
    socketRef.current?.emit('typing:start', {
      receiverId: selectedUserId,
      userId: user.id,
      conversationId: `chat-${selectedUserId}`
    });

    // Emit typing stop after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      socketRef.current?.emit('typing:stop', { receiverId: selectedUserId });
    }, 2000);
  };

  // Mark message as seen
  const handleMessageSeen = (messageId) => {
    if (messageId) {
      socketRef.current?.emit('message:seen', messageId);
    }
  };

  const activeUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || users[0],
    [selectedUserId, users]
  );

  const isUserOnline = useMemo(
    () => onlineUsers.has(selectedUserId),
    [selectedUserId, onlineUsers]
  );

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <h2>Messages</h2>
        <div className="user-list">
          {users.map((u) => (
            <button
              key={u.id}
              className={`chat-user ${selectedUserId === u.id ? 'active' : ''}`}
              onClick={() => setSelectedUserId(u.id)}
            >
              <div className="user-avatar-wrapper">
                <img src={u.avatar} alt={u.username} className="avatar avatar-md" />
                {onlineUsers.has(u.id) && <span className="online-dot" />}
              </div>
              <div className="user-info">
                <strong>{u.username}</strong>
                <small>{onlineUsers.has(u.id) ? 'online' : 'offline'}</small>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-panel">
        {activeUser ? (
          <>
            <header className="chat-header">
              <div className="user-row">
                <img src={activeUser.avatar} alt={activeUser.username} className="avatar avatar-md" />
                <div>
                  <strong>{activeUser.username}</strong>
                  <small>{isUserOnline ? 'online now' : 'offline'}</small>
                </div>
              </div>
            </header>

            <div className="chat-messages">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <p>No messages yet. Start the conversation!</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`message-bubble ${msg.mine ? 'mine' : ''}`}
                    onLoad={() => !msg.mine && handleMessageSeen(msg.id)}
                  >
                    <div className="message-content">
                      {msg.text}
                    </div>
                    <span className="message-time">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                    {msg.mine && msg.isSeen && (
                      <span className="read-receipt">✓✓</span>
                    )}
                  </div>
                ))
              )}

              {typing && (
                <div className="message-bubble typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-row">
              <input
                value={draft}
                onChange={(e) => handleTyping(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Message..."
                className="chat-input"
              />
              <button onClick={handleSend} className="send-btn">
                Send
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <p>Select a conversation to start messaging</p>
          </div>
        )}
      </section>
    </div>
  );
}
