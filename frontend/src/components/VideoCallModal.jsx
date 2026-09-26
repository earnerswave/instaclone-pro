import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export default function VideoCallModal({ visible, roomId, callerId, receiverId, onClose, onEndCall }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const socketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [callConnected, setCallConnected] = useState(false);
  const [error, setError] = useState(null);

  // Initialize socket connection and ICE candidate handling
  useEffect(() => {
    if (!visible) return;

    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { 
      transports: ['websocket'] 
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Socket connected for video call');
    });

    socket.on('call:offer', async (data) => {
      try {
        if (!peerConnectionRef.current) {
          createPeerConnection();
        }
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(data.offer)
        );
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        socket.emit('call:answer', { 
          roomId, 
          answer,
          from: callerId || receiverId 
        });
      } catch (error) {
        console.error('Error handling offer:', error);
        setError('Failed to handle call offer');
      }
    });

    socket.on('call:answer', async (data) => {
      try {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(data.answer)
        );
        setCallConnected(true);
      } catch (error) {
        console.error('Error handling answer:', error);
        setError('Failed to handle call answer');
      }
    });

    socket.on('call:ice-candidate', async (data) => {
      try {
        if (data.candidate && peerConnectionRef.current) {
          await peerConnectionRef.current.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    });

    socket.on('call:ended', () => {
      console.log('Call ended by remote peer');
      handleEndCall();
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    return () => {
      socket.disconnect();
    };
  }, [visible, roomId, callerId, receiverId]);

  // Create and configure RTCPeerConnection
  const createPeerConnection = async () => {
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Handle local stream tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          peerConnection.addTrack(track, localStreamRef.current);
        });
      }

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('Remote track received:', event.track.kind);
        if (remoteStreamRef.current) {
          remoteStreamRef.current.addTrack(event.track);
        } else {
          remoteStreamRef.current = event.streams[0];
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = remoteStreamRef.current;
          }
        }
      };

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit('call:ice-candidate', {
            roomId,
            candidate: event.candidate,
            from: callerId || receiverId
          });
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed' || 
            peerConnection.connectionState === 'disconnected') {
          setError('Connection lost. Call ending...');
          handleEndCall();
        }
      };

      peerConnectionRef.current = peerConnection;
    } catch (error) {
      console.error('Error creating peer connection:', error);
      setError('Failed to create peer connection');
    }
  };

  // Get local media stream
  useEffect(() => {
    if (!visible) return;

    const getMediaStream = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true
        });

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Create peer connection after getting media
        await createPeerConnection();

        // Create and send offer if this is the caller
        if (callerId && receiverId) {
          const offer = await peerConnectionRef.current.createOffer();
          await peerConnectionRef.current.setLocalDescription(offer);
          socketRef.current?.emit('call:offer', {
            roomId,
            offer,
            from: callerId,
            to: receiverId
          });
        }
      } catch (error) {
        console.error('Error accessing media devices:', error);
        setError('Unable to access camera/microphone. Check permissions.');
      }
    };

    getMediaStream();

    return () => {
      // Stop media tracks on unmount
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [visible, callerId, receiverId, roomId]);

  // Toggle audio mute
  const handleMuteAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
      });
      setIsMuted(!isMuted);
    }
  };

  // Toggle video on/off
  const handleToggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !isCameraOn;
      });
      setIsCameraOn(!isCameraOn);
    }
  };

  // End call and cleanup
  const handleEndCall = () => {
    socketRef.current?.emit('call:end', { roomId, from: callerId || receiverId });

    // Stop all tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setCallConnected(false);
    onEndCall?.();
  };

  if (!visible) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card call-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Video Call</h3>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        {error && (
          <div className="error-banner">
            <p>{error}</p>
          </div>
        )}

        <div className="video-container">
          <div className="video-box local-video">
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline
              className="video-stream"
            />
            <span className="video-label">You</span>
          </div>

          <div className="video-box remote-video">
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline
              className="video-stream"
            />
            <span className="video-label">Caller</span>
          </div>
        </div>

        <div className="call-controls">
          <button 
            className={`control-btn ${isMuted ? 'muted' : ''}`}
            onClick={handleMuteAudio}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>

          <button 
            className={`control-btn ${!isCameraOn ? 'off' : ''}`}
            onClick={handleToggleVideo}
            title={isCameraOn ? 'Hide camera' : 'Show camera'}
          >
            {isCameraOn ? '📹' : '📷'}
          </button>

          <button 
            className="control-btn danger-btn" 
            onClick={handleEndCall}
            title="End call"
          >
            📞
          </button>

          <span className={`call-status ${callConnected ? 'connected' : ''}`}>
            {callConnected ? 'Connected' : 'Connecting...'}
          </span>
        </div>
      </div>
    </div>
  );
}
