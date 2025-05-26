// dynamic-channel-handler.js
// SIMPLIFIED VERSION: Only provides basic channel utilities, NO program context extraction
const NodeCache = require('node-cache');

// Cache channel information with 24-hour TTL
const channelCache = new NodeCache({ stdTTL: 24 * 60 * 60 });

/**
 * Get basic channel information without program context extraction
 * @param {string} channelId - The channel ID
 * @param {object} client - Slack client
 * @returns {Promise<object>} - Basic channel info
 */
async function getBasicChannelInfo(channelId, client) {
  // Check cache first
  const cachedInfo = channelCache.get(channelId);
  if (cachedInfo) {
    return cachedInfo;
  }
  
  try {
    // Get channel info
    const channelInfo = await client.conversations.info({ channel: channelId });
    
    if (!channelInfo.channel) {
      throw new Error(`Could not find channel with ID ${channelId}`);
    }
    
    // Create basic info object without program extraction
    const basicInfo = {
      channelId,
      channelName: channelInfo.channel.name || 'unknown',
      isPrivate: channelInfo.channel.is_private || false,
      isMember: channelInfo.channel.is_member || false
    };
    
    // Store in cache
    channelCache.set(channelId, basicInfo);
    
    return basicInfo;
  } catch (error) {
    console.error(`Error getting basic channel info for ${channelId}:`, error);
    
    // Return a default basic info
    return {
      channelId,
      channelName: 'unknown',
      isPrivate: false,
      isMember: false
    };
  }
}

/**
 * Check if bot is a member of specific channels
 * @param {Array} channelIds - Array of channel IDs to check
 * @param {object} client - Slack client
 * @returns {Promise<Array>} - Array of channel IDs where bot is a member
 */
async function getBotMemberChannels(channelIds, client) {
  const memberChannels = [];
  
  for (const channelId of channelIds) {
    try {
      const channelInfo = await getBasicChannelInfo(channelId, client);
      if (channelInfo.isMember) {
        memberChannels.push(channelId);
      }
    } catch (error) {
      console.error(`Error checking membership for channel ${channelId}:`, error);
    }
  }
  
  return memberChannels;
}

/**
 * Get list of all channels where bot is a member
 * @param {object} client - Slack client
 * @returns {Promise<Array>} - Array of channels where bot is a member
 */
async function getAllBotMemberChannels(client) {
  try {
    const channelsResult = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 1000
    });
    
    if (!channelsResult.channels || channelsResult.channels.length === 0) {
      return [];
    }
    
    // Filter to only channels where the bot is a member
    return channelsResult.channels.filter(channel => channel.is_member === true);
  } catch (error) {
    console.error('Error getting bot member channels:', error);
    return [];
  }
}

/**
 * Simple utility to check if a channel is private
 * @param {string} channelId - Channel ID
 * @param {object} client - Slack client
 * @returns {Promise<boolean>} - Whether channel is private
 */
async function isPrivateChannel(channelId, client) {
  try {
    const channelInfo = await getBasicChannelInfo(channelId, client);
    return channelInfo.isPrivate;
  } catch (error) {
    console.error(`Error checking if channel ${channelId} is private:`, error);
    return false;
  }
}

module.exports = {
  getBasicChannelInfo,
  getBotMemberChannels,
  getAllBotMemberChannels,
  isPrivateChannel
};
