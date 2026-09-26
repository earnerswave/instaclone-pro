import http from 'http';
import { Server } from 'socket.io';
import { Message, VideoCall, Notification, User } from '../models/index.js';

let onlineUsers = new Map();
let inCallUsers = new Map();

const createSocketServer = (app) => {
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    console.log('🟢 User connected:', socket.id);

    // Track user online status
    socket.on('user:online', async (userId) => {
      onlineUsers.set(userId, socket.id);
      socket.userId = userId;
      socket.join(`user:${userId}`);
      
      // Broadcast online users list
      io.emit('online:users', Array.from(onlineUsers.keys()));
      
      // Update user's lastOnline timestamp
      try {
        const user = await User.findByPk(userId);
        if (user) {
          user.lastOnline = new Date();
          await user.save();
        }
      } catch (error) {
        console.error('Error updating lastOnline:', error);
      }
    });

    // Handle sending messages with persistence
    socket.on('message:send', async (data) => {
      try {
        const { senderId, receiverId, text, image, video, audio } = data;

        // Validate required fields
        if (!senderId || !receiverId || !text) {
          console.warn('Invalid message data received');
          return;
        }

        // Save message to database
        const message = await Message.create({
          senderId,
          receiverId,
          text,
          image: image || null,
          video: video || null,
          audio: audio || null,
          isRead: false,
          isSeen: false
        });

        console.log('📨 Message saved:', message.id);

        // Get receiver's socket and emit message in real-time
        const receiverSocket = onlineUsers.get(receiverId);
        if (receiverSocket) {
          io.to(receiverSocket).emit('message:receive', {
            ...message.toJSON(),
            mine: false
          });
        }

        // Emit notification if receiver is not in the conversation
        if (!socket.handshake.query.conversationId) {
          await Notification.create({
            userId: receiverId,
            fromUserId: senderId,
            type: 'message',
            title: 'New message',
            message: `You have a new message from user ${senderId}`,
            actionUrl: `/chat`
          });

          if (receiverSocket) {
            io.to(receiverSocket).emit('notification:receive', {
              type: 'message',
              title: 'New message'
            });
          }
        }
      } catch (error) {
        console.error('❌ Message error:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Mark message as seen (read receipt)
    socket.on('message:seen', async (messageId) => {
      try {
        await Message.update(
          { isSeen: true, seenAt: new Date() },
          { where: { id: messageId } }
        );
        console.log('✓ Message marked as seen:', messageId);
      } catch (error) {
        console.error('Error marking message as seen:', error);
      }
    });

    // Typing indicator - start
    socket.on('typing:start', (data) => {
      const { conversationId, userId, receiverId } = data;
      const receiverSocket = onlineUsers.get(receiverId);
      
      if (receiverSocket) {
        io.to(receiverSocket).emit('typing:indicator', {
          conversationId,
          userId,
          typing: true
        });
      }
    });

    // Typing indicator - stop
    socket.on('typing:stop', (data) => {
      const { receiverId } = data;
      const receiverSocket = onlineUsers.get(receiverId);
      
      if (receiverSocket) {
        io.to(receiverSocket).emit('typing:indicator', {
          typing: false
        });
      }
    });

    // WebRTC: Call initiation
    socket.on('call:initiate', async (data) => {
      try {
        const { callerId, receiverId, roomId, callType } = data;
        const receiverSocket = onlineUsers.get(receiverId);

        // Create video call record in database
        const call = await VideoCall.create({
          callerId,
          receiverId,
          roomId,
          callType,
          status: 'ringing'
        });

        console.log('📞 Call initiated:', call.id, 'Room:', roomId);

        // Notify receiver if online
        if (receiverSocket) {
          io.to(receiverSocket).emit('call:incoming', {
            roomId,
            callerId,
            callType,
            callId: call.id
          });
        }

        // Create notification for missed call if receiver is offline
        if (!receiverSocket) {
          await Notification.create({
            userId: receiverId,
            fromUserId: callerId,
            type: 'call',
            title: 'Missed call',
            message: `You missed a ${callType} call`,
            actionUrl: `/chat`
          });
        }
      } catch (error) {
        console.error('❌ Call initiation error:', error);
      }
    });

    // WebRTC: Answer call
    socket.on('call:answer', async (data) => {
      try {
        const { roomId, callerId, answer } = data;
        const callerSocket = onlineUsers.get(callerId);

        // Update call status to ongoing
        await VideoCall.update(
          { status: 'ongoing', startedAt: new Date() },
          { where: { roomId } }
        );

        console.log('✓ Call answered:', roomId);

        // Send answer to caller
        if (callerSocket) {
          io.to(callerSocket).emit('call:answer', {
            roomId,
            answer
          });
        }

        // Track participants in call
        inCallUsers.set(roomId, [callerId, socket.userId]);
        socket.join(roomId);
      } catch (error) {
        console.error('❌ Call answer error:', error);
      }
    });

    // WebRTC: ICE Candidate exchange
    socket.on('call:ice-candidate', (data) => {
      const { roomId, candidate, from } = data;

      if (roomId && candidate) {
        // Broadcast ICE candidate to all peers in the call room
        socket.to(roomId).emit('call:ice-candidate', {
          candidate,
          from
        });
      }
    });

    // WebRTC: Offer exchange
    socket.on('call:offer', (data) => {
      const { roomId, offer, to } = data;

      if (roomId && offer) {
        // Send offer to specific peer
        const toSocket = onlineUsers.get(to);
        if (toSocket) {
          io.to(toSocket).emit('call:offer', {
            roomId,
            offer,
            from: socket.userId
          });
        }
      }
    });

    // WebRTC: End call
    socket.on('call:end', async (data) => {
      try {
        const { roomId } = data;

        // Update call status to ended
        await VideoCall.update(
          { status: 'ended', endedAt: new Date() },
          { where: { roomId } }
        );

        console.log('📞 Call ended:', roomId);

        // Notify all participants in the room
        inCallUsers.delete(roomId);
        io.to(roomId).emit('call:ended', { roomId });
        socket.leave(roomId);
      } catch (error) {
        console.error('❌ Call end error:', error);
      }
    });

    // WebRTC: Reject call
    socket.on('call:reject', async (data) => {
      try {
        const { roomId, callerId } = data;
        const callerSocket = onlineUsers.get(callerId);

        // Update call status to declined
        await VideoCall.update(
          { status: 'declined' },
          { where: { roomId } }
        );

        console.log('❌ Call rejected:', roomId);

        // Notify caller
        if (callerSocket) {
          io.to(callerSocket).emit('call:rejected', { roomId });
        }
      } catch (error) {
        console.error('❌ Call reject error:', error);
      }
    });

    // Send notification
    socket.on('notification:send', async (data) => {
      try {
        const notification = await Notification.create(data);
        const userSocket = onlineUsers.get(data.userId);

        if (userSocket) {
          io.to(userSocket).emit('notification:receive', notification);
        }
      } catch (error) {
        console.error('❌ Notification error:', error);
      }
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      if (socket.userId) {
        onlineUsers.delete(socket.userId);
        io.emit('online:users', Array.from(onlineUsers.keys()));

        // Update user's lastOnline timestamp
        try {
          const user = await User.findByPk(socket.userId);
          if (user) {
            user.lastOnline = new Date();
            await user.save();
          }
        } catch (error) {
          console.error('Error updating lastOnline on disconnect:', error);
        }
      }

      console.log('🔴 User disconnected:', socket.id);
    });
  });

  return server;
};

export { createSocketServer, onlineUsers };
