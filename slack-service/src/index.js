// Load config.env from project root
require('dotenv').config({ path: require('path').join(__dirname, '../../config.env') });
const SlackService = require('./slack-service');
const API = require('./api');
const logger = require('./logger');

function loadConfig() {
  // All config is already loaded into process.env by dotenv
  return {
    channels: (process.env.SLACK_CHANNELS || '').split(',').map(c => c.trim()).filter(c => c),
    triggerKeywords: (process.env.TRIGGER_KEYWORDS || '').split(',').map(k => k.trim()).filter(k => k),
    responseMode: process.env.RESPONSE_MODE || 'mentions',
    maxMessages: parseInt(process.env.MAX_MESSAGES) || 15,
    checkWindow: parseInt(process.env.CHECK_WINDOW) || 5,
    // Cache configuration
    channelCacheTTL: parseInt(process.env.CHANNEL_CACHE_TTL) || 300,
    messageCacheTTL: parseInt(process.env.MESSAGE_CACHE_TTL) || 30,
    cacheEnabled: process.env.CACHE_ENABLED !== 'false',
    // Bot token for reading
    botToken: process.env.SLACK_BOT_TOKEN || null,
    // LLM configuration
    llm: {
      provider: process.env.LLM_PROVIDER || 'anthropic',
      apiKey: process.env.LLM_API_KEY || null,
      model: process.env.LLM_MODEL || 'claude-2.1',
    },
  };
}

async function main() {
  try {
    const slackToken = process.env.SLACK_BOT_TOKEN;
    if (!slackToken) {
      throw new Error('SLACK_BOT_TOKEN environment variable is required');
    }

    // Log token type for debugging
    const tokenType = slackToken.startsWith('xoxb-') ? 'bot' : 'user';
    logger.info(`Using Slack ${tokenType} token`);
    
    if (tokenType === 'bot') {
      logger.warn('Bot tokens (xoxb) cannot access private channels. User tokens (xoxp) are required for private channel access.');
    }

    const config = loadConfig();
    logger.info('Starting Claude Slack Service with config:', config);

    const slackService = new SlackService(slackToken, config);
    await slackService.init(); // Initialize file handler
    
    const api = new API(slackService);

    const port = process.env.SERVICE_PORT || process.env.PORT || 3030;
    api.start(port);

    // Warm up the cache on startup
    if (config.cacheEnabled) {
      setTimeout(async () => {
        try {
          await slackService.warmCache();
          logger.info('Initial cache warming completed');
        } catch (error) {
          logger.warn('Failed to warm cache on startup:', error);
        }
      }, 2000); // Wait 2 seconds for service to fully start
    }

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      api.stop();
      slackService.close();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      api.stop();
      slackService.close();
      process.exit(0);
    });

  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadConfig, SlackService, API };
