const express = require('express');
const SlackService = require('./slack-service');
const ClaudeService = require('./claude-service');
const logger = require('./logger');
const { withTimeout, handleErrorResponse } = require('./utils');

class API {
  constructor(slackService) {
    this.app = express();
    this.slackService = slackService;
    this.claudeService = new ClaudeService(slackService.config);
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    this.app.get('/messages/unresponded', async (req, res) => {
      try {
        // Add timeout from config - use API_TIMEOUT (in seconds) or REQUEST_TIMEOUT_MS (in ms)
        // Don't wrap Slack API calls in timeout - let the SDK handle rate limiting
        const messages = await this.slackService.getUnrespondedMessages();
        
        res.json({
          success: true,
          count: messages.length,
          messages
        });
      } catch (error) {
        handleErrorResponse(res, error, 'getting unresponded messages');
      }
    });

    this.app.post('/messages/respond', async (req, res) => {
      try {
        const { message, response } = req.body;
        
        if (!message || !response) {
          return res.status(400).json({
            success: false,
            error: 'Missing message or response'
          });
        }

        const result = await this.slackService.postResponse(message, response);
        res.json({
          success: true,
          result
        });
      } catch (error) {
        handleErrorResponse(res, error, 'posting response');
      }
    });

    this.app.get('/messages/responded', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 100;
        const messages = await this.slackService.db.getRespondedMessages(limit);
        res.json({
          success: true,
          count: messages.length,
          messages
        });
      } catch (error) {
        handleErrorResponse(res, error, 'getting responded messages');
      }
    });

    // Loop prevention endpoints
    this.app.get('/loop-prevention/status', (req, res) => {
      try {
        const status = this.slackService.getLoopPreventionStatus();
        res.json({
          success: true,
          loopPrevention: status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        handleErrorResponse(res, error, 'getting loop prevention status');
      }
    });

    this.app.post('/loop-prevention/emergency-stop', (req, res) => {
      try {
        const { reason = 'api_request' } = req.body;
        this.slackService.activateEmergencyStop(reason);
        res.json({
          success: true,
          message: 'Emergency stop activated',
          reason: reason,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        handleErrorResponse(res, error, 'activating emergency stop');
      }
    });

    this.app.delete('/loop-prevention/emergency-stop', (req, res) => {
      try {
        this.slackService.deactivateEmergencyStop();
        res.json({
          success: true,
          message: 'Emergency stop deactivated',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        handleErrorResponse(res, error, 'deactivating emergency stop');
      }
    });

    // Cache management endpoints
    this.app.get('/cache/stats', (req, res) => {
      const stats = this.slackService.getCacheStats();
      res.json({
        success: true,
        stats
      });
    });

    // File attachment endpoints
    this.app.get('/attachments/supported-types', (req, res) => {
      const supportedTypes = this.slackService.fileHandler.supportedTypes;
      res.json({
        success: true,
        supportedTypes,
        maxFileSize: this.slackService.fileHandler.maxFileSize,
        maxFileSizeMB: Math.round(this.slackService.fileHandler.maxFileSize / 1024 / 1024)
      });
    });

    // Process messages with Claude
    this.app.post('/messages/process-with-claude', async (req, res) => {
      try {
        const { messages } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
          return res.status(400).json({
            success: false,
            error: 'Missing or invalid messages array'
          });
        }

        // Get unique channels for pre-fetching
        const uniqueChannels = [...new Set(messages
          .map(m => m.channelName)
          .filter(c => c))];

        // Pre-fetch channel histories
        const channelHistories = await this.claudeService.prefetchChannelHistories(
          uniqueChannels,
          (channel, limit) => this.slackService.getChannelHistory(channel, limit)
        );

        const results = [];
        
        for (const message of messages) {
          try {
            // Get channel history for this message
            const channelHistory = channelHistories[message.channelName] || [];
            
            // Filter file paths by channel
            if (message.filePaths && message.filePaths.length > 0) {
              message.filePaths = this.claudeService.filterFilePathsByChannel(
                message.filePaths,
                message.channel
              );
            }

            // Add channel file paths if available
            const channelFiles = channelHistories[`${message.channelName}_files`] || [];
            if (channelFiles.length > 0) {
              const filteredChannelFiles = this.claudeService.filterFilePathsByChannel(
                channelFiles,
                message.channel
              );
              message.filePaths = [...(message.filePaths || []), ...filteredChannelFiles];
              // Remove duplicates
              message.filePaths = message.filePaths.filter((file, index, self) => 
                index === self.findIndex(f => (f.path || f) === (file.path || file))
              );
            }

            // Process message with Claude
            const response = await this.claudeService.processMessage(message, channelHistory);
            
            results.push({
              messageId: message.id,
              success: true,
              response
            });

            // Post the response back to Slack
            await this.slackService.postResponse(message, response);
            
          } catch (error) {
            logger.error(`Failed to process message ${message.id}:`, error);
            results.push({
              messageId: message.id,
              success: false,
              error: error.message
            });
          }
        }

        res.json({
          success: true,
          processed: results.length,
          results
        });
        
      } catch (error) {
        handleErrorResponse(res, error, 'processing messages with Claude');
      }
    });

    // Get channel history endpoint
    this.app.get('/messages/channel-history/:channel', async (req, res) => {
      try {
        const { channel } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        
        // Don't wrap Slack API calls in timeout - let the SDK handle rate limiting
        const history = await this.slackService.getChannelHistory(channel, limit);
        
        res.json({
          success: true,
          channel: channel,
          count: history.length,
          messages: history
        });
      } catch (error) {
        handleErrorResponse(res, error, 'getting channel history');
      }
    });

    this.app.post('/cache/clear', (req, res) => {
      this.slackService.clearCache();
      res.json({
        success: true,
        message: 'Cache cleared'
      });
    });

    this.app.post('/cache/warm', async (req, res) => {
      try {
        await this.slackService.warmCache();
        res.json({
          success: true,
          message: 'Cache warmed up'
        });
      } catch (error) {
        handleErrorResponse(res, error, 'warming cache');
      }
    });

    this.app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', err);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    });
  }

  start(port = process.env.SERVICE_PORT || process.env.PORT || 3030) {
    this.server = this.app.listen(port, () => {
      logger.info(`API server listening on port ${port}`);
    });
    return this.server;
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = API;