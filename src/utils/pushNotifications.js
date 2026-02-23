const axios = require('axios');

/**
 * Send push notifications via Expo
 * @param {Array<string>|string} tokens - Single push token or array of push tokens
 * @param {string} title - Title of notification
 * @param {string} body - Body content
 * @param {object} data - Extra data to send
 */
const sendPushNotification = async (tokens, title, body, data = {}) => {
    if (!tokens || (Array.isArray(tokens) && tokens.length === 0)) {
        return;
    }

    const pushTokens = Array.isArray(tokens) ? tokens : [tokens];

    // Filter out invalid tokens
    const validTokens = pushTokens.filter(t => t && t.startsWith('ExporterPushToken'));

    // Note: Actually Expo tokens often start with "ExponentPushToken" or just push tokens from newer Expo
    // We'll just filter for non-empty strings and let Expo API handle the rest
    const finalTokens = pushTokens.filter(t => typeof t === 'string' && t.trim().length > 0);

    if (finalTokens.length === 0) return;

    const messages = finalTokens.map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
    }));

    try {
        const response = await axios.post('https://exp.host/--/api/v2/push/send', messages, {
            headers: {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error sending Expo push notification:', error.response?.data || error.message);
    }
};

module.exports = { sendPushNotification };
