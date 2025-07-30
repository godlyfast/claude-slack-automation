const express = require('express');
const SlackService = require('./slack-service');
const logger = require('./logger');

class API {
  constructor(slackService) {
    this.app = express();
    this.slackService = slackService;
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
        // Add 3 second timeout
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timed out after 3 seconds')), 3000)
        );
        
        const messagesPromise = this.slackService.getUnrespondedMessages();
        const messages = await Promise.race([messagesPromise, timeoutPromise]);
        
        res.json({
          success: true,
          count: messages.length,
          messages
        });
      } catch (error) {
        logger.error('Error getting unresponded messages:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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
        logger.error('Error posting response:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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
        logger.error('Error getting responded messages:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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
        logger.error('Error getting loop prevention status:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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
        logger.error('Error activating emergency stop:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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
        logger.error('Error deactivating emergency stop:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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

    // Get channel history endpoint
    this.app.get('/messages/channel-history/:channel', async (req, res) => {
      try {
        const { channel } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        
        // Add 10 second timeout for history fetch
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timed out after 10 seconds')), 10000)
        );
        
        const historyPromise = this.slackService.getChannelHistory(channel, limit);
        const history = await Promise.race([historyPromise, timeoutPromise]);
        
        res.json({
          success: true,
          channel: channel,
          count: history.length,
          messages: history
        });
      } catch (error) {
        logger.error('Error getting channel history:', error);
        res.status(500).json({ 
          success: false, 
          error: error.message 
        });
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
        logger.error('Error warming cache:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
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

  start(port = 3030) {
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