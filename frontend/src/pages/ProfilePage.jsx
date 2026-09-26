import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import api from '../api/client.js';

export default function ProfilePage() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState('posts');
  const [followStatus, setFollowStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load user profile
  useEffect(() => {
    if (!id || !currentUser) return;

    const loadProfile = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.get(`/users/${id}/profile`);
        setProfile(res.data);
        
        // Set initial follow status
        if (res.data.isFollowing) {
          setFollowStatus('following');
        } else if (res.data.status === 'pending') {
          setFollowStatus('pending');
        } else {
          setFollowStatus('not_following');
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
        setError('Unable to load profile');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [id, currentUser]);

  // Handle follow/unfollow
  const handleFollowToggle = async () => {
    if (!id || !currentUser || id === String(currentUser.id)) return;

    try {
      setLoading(true);
      setError(null);

      const res = await api.post(`/users/follow/${id}`);

      if (res.data.following) {
        setFollowStatus('following');
      } else if (res.data.status === 'pending') {
        setFollowStatus('pending');
      } else {
        setFollowStatus('not_following');
      }

      // Refresh profile to update follower count
      const profileRes = await api.get(`/users/${id}/profile`);
      setProfile(profileRes.data);
    } catch (error) {
      console.error('Failed to toggle follow:', error);
      setError(error.response?.data?.message || 'Failed to update follow status');
    } finally {
      setLoading(false);
    }
  };

  // Handle follow request acceptance
  const handleAcceptRequest = async () => {
    if (!id || !currentUser) return;

    try {
      setLoading(true);
      setError(null);

      await api.post(`/users/follow-request/${id}`, { action: 'accept' });
      setFollowStatus('following');

      // Refresh profile
      const profileRes = await api.get(`/users/${id}/profile`);
      setProfile(profileRes.data);
    } catch (error) {
      console.error('Failed to accept request:', error);
      setError('Failed to accept follow request');
    } finally {
      setLoading(false);
    }
  };

  // Handle follow request rejection
  const handleRejectRequest = async () => {
    if (!id || !currentUser) return;

    try {
      setLoading(true);
      setError(null);

      await api.post(`/users/follow-request/${id}`, { action: 'decline' });
      setFollowStatus('not_following');

      // Refresh profile
      const profileRes = await api.get(`/users/${id}/profile`);
      setProfile(profileRes.data);
    } catch (error) {
      console.error('Failed to reject request:', error);
      setError('Failed to reject follow request');
    } finally {
      setLoading(false);
    }
  };

  if (!profile) {
    return (
      <div className="profile-page loading">
        <p>{loading ? 'Loading profile...' : 'Profile not found'}</p>
      </div>
    );
  }

  const isOwnProfile = currentUser && profile.id === currentUser.id;

  return (
    <div className="profile-page">
      <header className="profile-header">
        <img src={profile.avatar} alt={profile.username} className="profile-avatar" />
        <div className="profile-meta">
          <div className="profile-top-row">
            <div>
              <h2>{profile.username}</h2>
              {profile.isVerified && <span className="verified-badge">✓</span>}
            </div>
            
            <div className="profile-actions">
              {isOwnProfile ? (
                <button className="primary-btn">Edit Profile</button>
              ) : (
                <>
                  {followStatus === 'not_following' && (
                    <button 
                      className="primary-btn"
                      onClick={handleFollowToggle}
                      disabled={loading}
                    >
                      {loading ? '...' : 'Follow'}
                    </button>
                  )}

                  {followStatus === 'following' && (
                    <button 
                      className="ghost-btn"
                      onClick={handleFollowToggle}
                      disabled={loading}
                    >
                      {loading ? '...' : 'Unfollow'}
                    </button>
                  )}

                  {followStatus === 'pending' && (
                    <button 
                      className="ghost-btn"
                      onClick={handleFollowToggle}
                      disabled={loading}
                    >
                      {loading ? '...' : 'Pending'}
                    </button>
                  )}

                  <button className="ghost-btn">Message</button>
                </>
              )}
            </div>
          </div>

          <div className="profile-stats">
            <span>
              <strong>{profile.postsCount || 0}</strong> posts
            </span>
            <span>
              <strong>{profile.followersCount || profile.followers || 0}</strong> followers
            </span>
            <span>
              <strong>{profile.followingCount || profile.following || 0}</strong> following
            </span>
          </div>

          <div className="profile-bio">
            {profile.fullName && <strong>{profile.fullName}</strong>}
            {profile.bio && <p>{profile.bio}</p>}
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noopener noreferrer">
                {profile.website}
              </a>
            )}
          </div>

          {profile.isPrivate && !isOwnProfile && followStatus !== 'following' && (
            <div className="private-notice">
              This account is private. Follow to see their posts.
            </div>
          )}

          {error && (
            <div className="error-banner">
              <p>{error}</p>
            </div>
          )}
        </div>
      </header>

      <div className="profile-tabs">
        {['posts', 'reels', 'bookmarks'].map((key) => (
          <button
            key={key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => setTab(key)}
          >
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </div>

      <div className="profile-grid">
        {(profile[tab] || []).length > 0 ? (
          (profile[tab] || []).map((item, index) => (
            <div key={`${tab}-${index}`} className="profile-grid-item">
              <img src={item} alt={`${tab} media`} />
            </div>
          ))
        ) : (
          <div className="empty-tab">
            <p>No {tab} yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
