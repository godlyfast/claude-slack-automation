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
    // 🚨 CRITICAL: This endpoint MUST fetch channel history and queue responses
    // Claude should NEVER directly interact with Slack API
    this.app.post('/messages/process-with-claude', async (req, res) => {
      try {
        const { messages } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
          return res.status(400).json({
            success: false,
            error: 'Missing or invalid messages array'
          });
        }

        // 🚨 ENABLE PROCESSING MODE - NO SLACK API CALLS ALLOWED FROM HERE
        this.slackService.setProcessingMode(true);
        
        try {
          // Get unique channels for pre-fetching
          const uniqueChannels = [...new Set(messages
            .map(m => m.channelName)
            .filter(c => c))];

          // Pre-fetch channel histories FROM DATABASE (not Slack API)
          // This is critical for reducing API usage
          const channelHistories = await this.claudeService.prefetchChannelHistories(
            uniqueChannels,
            (channel, limit) => this.slackService.db.getChannelHistoryFromDB(channel, limit)
          );

        const results = [];
        
        for (const message of messages) {
          try {
            // Mark message as processing
            await this.slackService.db.updateMessageStatus(message.message_id, 'processing');
            
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
            
            // 🚨 CRITICAL: Queue the response - NEVER send directly to Slack
            // Claude must remain isolated from Slack API
            await this.slackService.db.queueResponse(
              message.message_id,  // Use Slack message ID, not DB row ID
              message.channel_id || message.channel,
              message.thread_ts || message.message_id,  // Use message_id as thread_ts if not in a thread
              response
            );
            
            // Update message status to processed
            await this.slackService.db.updateMessageStatus(message.message_id, 'processed');
            
            results.push({
              messageId: message.id,
              success: true,
              response
            });
            
          } catch (error) {
            logger.error(`Failed to process message ${message.id}:`, error);
            
            // Update message status to error
            await this.slackService.db.updateMessageStatus(message.message_id, 'error', error.message);
            
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
        } finally {
          // 🚨 DISABLE PROCESSING MODE - SLACK API CALLS ALLOWED AGAIN
          this.slackService.setProcessingMode(false);
        }
        
      } catch (error) {
        // Ensure processing mode is disabled on error
        this.slackService.setProcessingMode(false);
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

    // Queue Management Endpoints
    this.app.post('/queue/messages', async (req, res) => {
      try {
        // Fetch and queue unresponded messages
        const messages = await this.slackService.getUnrespondedMessages();
        
        if (messages.length === 0) {
          return res.json({
            success: true,
            fetched: 0,
            queued: 0,
            message: 'No new messages to queue'
          });
        }
        
        // Queue all messages in parallel
        const results = await Promise.all(
          messages.map(async (message) => {
            try {
              await this.slackService.db.queueMessage(message);
              return { success: true, messageId: message.id };
            } catch (error) {
              // Ignore duplicate key errors
              if (error.message.includes('UNIQUE constraint')) {
                return { success: false, messageId: message.id, duplicate: true };
              }
              logger.error(`Error queuing message ${message.id}:`, error);
              return { success: false, messageId: message.id, error: error.message };
            }
          })
        );
        
        const queued = results.filter(r => r.success).length;
        const duplicates = results.filter(r => r.duplicate).length;
        
        res.json({
          success: true,
          fetched: messages.length,
          queued,
          duplicates,
          results: results.filter(r => !r.success && !r.duplicate)
        });
      } catch (error) {
        handleErrorResponse(res, error, 'fetching messages for queue');
      }
    });

    this.app.get('/queue/messages/pending', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 10;
        const messages = await this.slackService.db.getPendingMessages(limit);
        res.json({
          success: true,
          count: messages.length,
          messages
        });
      } catch (error) {
        handleErrorResponse(res, error, 'getting pending messages');
      }
    });

    this.app.post('/queue/process', async (req, res) => {
      try {
        // Get batch size from request or use default
        const batchSize = parseInt(req.body.batchSize) || 5;
        
        // Process pending messages from queue (DB only, no API calls)
        const messages = await this.slackService.db.getPendingMessages(batchSize);
        
        if (messages.length === 0) {
          return res.json({
            success: true,
            processed: 0,
            message: 'No pending messages to process'
          });
        }
        
        // 🚨 ENABLE PROCESSING MODE - NO SLACK API CALLS ALLOWED
        this.slackService.setProcessingMode(true);
        
        try {
          // Mark all messages as processing first (in parallel)
          await Promise.all(
            messages.map(msg => 
              this.slackService.db.updateMessageStatus(msg.message_id, 'processing')
            )
          );
          
          // Process all messages in parallel
          const results = await Promise.all(
            messages.map(async (message) => {
              try {
                // Prepare message object (no API calls, just DB data)
                const messageObj = {
                  id: message.message_id,
                  text: message.text,
                  user: message.user_id,
                  channel: message.channel_id,
                  channelName: message.channel_name,
                  ts: message.message_id,
                  thread_ts: message.thread_ts,
                  isThreadReply: !!message.thread_ts,
                  hasAttachments: message.has_attachments,
                  filePaths: message.file_paths ? JSON.parse(message.file_paths) : []
                };
                
                // Process with Claude (this is the only external call)
                const response = await this.claudeService.processMessage(messageObj, []);
                
                // Queue the response (parallel DB operations)
                await Promise.all([
                  this.slackService.db.queueResponse(
                    message.message_id,
                    message.channel_id,
                    message.thread_ts,
                    response
                  ),
                  this.slackService.db.updateMessageStatus(message.message_id, 'processed')
                ]);
                
                return {
                  messageId: message.message_id,
                  success: true
                };
              } catch (error) {
                logger.error(`Failed to process message ${message.message_id}:`, error);
                await this.slackService.db.updateMessageStatus(message.message_id, 'error', error.message);
                return {
                  messageId: message.message_id,
                  success: false,
                  error: error.message
                };
              }
            })
          );
          
          // 🚨 DISABLE PROCESSING MODE
          this.slackService.setProcessingMode(false);
          
          res.json({
            success: true,
            processed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results
          });
        } finally {
          // ALWAYS disable processing mode, even on error
          this.slackService.setProcessingMode(false);
        }
      } catch (error) {
        // Ensure processing mode is disabled on error
        this.slackService.setProcessingMode(false);
        handleErrorResponse(res, error, 'processing queue messages');
      }
    });

    this.app.post('/queue/send-responses', async (req, res) => {
      try {
        // Get batch size from request or use default
        const batchSize = parseInt(req.body.batchSize) || 5;
        
        // Get pending responses from queue
        const responses = await this.slackService.db.getPendingResponses(batchSize);
        
        if (responses.length === 0) {
          return res.json({
            success: true,
            sent: 0,
            message: 'No pending responses to send'
          });
        }
        
        // Mark all responses as sending first (in parallel)
        await Promise.all(
          responses.map(resp => 
            this.slackService.db.updateResponseStatus(resp.id, 'sending')
          )
        );
        
        // Send all responses in parallel
        const results = await Promise.all(
          responses.map(async (response) => {
            try {
              // Post to Slack
              const message = {
                channel: response.channel_id,
                ts: response.message_id,
                thread_ts: response.thread_ts
              };
              
              await this.slackService.postResponse(message, response.response_text);
              
              // Update status to sent
              await this.slackService.db.updateResponseStatus(response.id, 'sent');
              
              return {
                id: response.id,
                messageId: response.message_id,
                success: true
              };
            } catch (error) {
              logger.error(`Failed to send response ${response.id}:`, error);
              
              // Check if it's a rate limit error
              if (error.message && error.message.includes('rate limit')) {
                // Mark as pending again to retry later
                await this.slackService.db.updateResponseStatus(response.id, 'pending');
              } else {
                // Mark as error for other failures
                await this.slackService.db.updateResponseStatus(response.id, 'error', error.message);
              }
              
              return {
                id: response.id,
                messageId: response.message_id,
                success: false,
                error: error.message
              };
            }
          })
        );
        
        res.json({
          success: true,
          sent: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          results
        });
      } catch (error) {
        handleErrorResponse(res, error, 'sending queued responses');
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