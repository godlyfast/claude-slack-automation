// Load config.env from project root instead of local .env
require('dotenv').config({ path: require('path').join(__dirname, '../../config.env') });
const SlackService = require('./slack-service');
const API = require('./api');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

async function loadConfig() {
  const configPath = path.join(__dirname, '../../config.env');
  
  if (!fs.existsSync(configPath)) {
    throw new Error('config.env not found');
  }

  const configContent = fs.readFileSync(configPath, 'utf8');
  const config = {};

  configContent.split('\n').forEach(line => {
    if (line && !line.startsWith('#') && line.includes('=')) {
      const [key, value] = line.split('=').map(s => s.trim());
      config[key] = value.replace(/["']/g, '');
      // Also set as environment variable for loop prevention config
      process.env[key] = config[key];
    }
  });

  return {
    channels: (config.SLACK_CHANNELS || config.SLACK_CHANNEL || '').split(',').map(c => c.trim()),
    triggerKeywords: (config.TRIGGER_KEYWORDS || '').split(',').map(k => k.trim()),
    responseMode: config.RESPONSE_MODE || 'mentions',
    maxMessages: parseInt(config.MAX_MESSAGES) || 15,
    checkWindow: parseInt(config.CHECK_WINDOW) || 5,
    // Cache configuration from environment
    channelCacheTTL: parseInt(process.env.CHANNEL_CACHE_TTL) || 300,
    messageCacheTTL: parseInt(process.env.MESSAGE_CACHE_TTL) || 30,
    cacheEnabled: process.env.CACHE_ENABLED !== 'false',
    // Bot token for reading (optional)
    botToken: config.SLACK_BOT_TOKEN || null
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
    
    if (tokenType === 'user') {
      logger.warn('Using user token (xoxp). Some features may be limited. Consider using a bot token (xoxb) for full functionality.');
    }

    const config = await loadConfig();
    logger.info('Starting Claude Slack Service with config:', config);

    const slackService = new SlackService(slackToken, config);
    await slackService.init(); // Initialize file handler
    
    const api = new API(slackService);

    const port = process.env.PORT || 3030;
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