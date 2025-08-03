const cron = require('node-cron');
const logger = require('./logger');
const LlmProcessor = require('./llm-processor');

class Orchestrator {
  constructor(slackService, api) {
    this.slackService = slackService;
    this.api = api;
    this.llmProcessor = new LlmProcessor(this.slackService.config);
    this.jobs = [];
  }

  start() {
    logger.info('Starting orchestrator...');

    // Schedule the priority queue job to run every 30 seconds
    const priorityJob = cron.schedule('*/30 * * * * *', async () => {
      logger.info('Running priority queue job...');
      await this.runPriorityQueue();
    });

    this.jobs.push(priorityJob);
    logger.info('Orchestrator started with priority queue job.');
  }

  stop() {
    logger.info('Stopping orchestrator...');
    this.jobs.forEach(job => job.stop());
    logger.info('Orchestrator stopped.');
  }

  async runPriorityQueue() {
    try {
      // 1. Send pending responses
      const pendingResponses = await this.slackService.db.getPendingResponses();
      if (pendingResponses.length > 0) {
        logger.info(`Sending ${pendingResponses.length} pending responses...`);
        await this.api.sendResponses(pendingResponses);
      } else {
        // 2. Fetch new messages if no responses are pending
        logger.info('No pending responses. Fetching new messages...');
        const messages = await this.slackService.getUnrespondedMessages();
        if (messages.length > 0) {
          await this.slackService.db.addMessagesToQueue(messages);
          logger.info(`Added ${messages.length} new messages to the queue.`);

          // 3. Process new messages
          const pendingMessages = await this.slackService.db.getPendingMessages();
          if (pendingMessages.length > 0) {
            // Mark messages as 'processing' to prevent re-fetching
            for (const message of pendingMessages) {
              await this.slackService.db.updateMessageStatus(message.message_id, 'processing');
            }

            logger.info(`Processing ${pendingMessages.length} messages...`);
            const results = await this.llmProcessor.processMessages(pendingMessages);
            logger.info(`Processing complete. Results: ${JSON.stringify(results)}`);

            for (let i = 0; i < pendingMessages.length; i++) {
              const message = pendingMessages[i];
              const response = results[i];
              if (response && !response.startsWith('Error')) {
                await this.slackService.db.queueResponse(message.message_id, message.channel_id, message.thread_ts, response);
                await this.slackService.db.updateMessageStatus(message.message_id, 'processed');
              } else {
                await this.slackService.db.updateMessageStatus(message.message_id, 'error', response);
              }
            }
          }
        } else {
          logger.info('No new messages to fetch.');
        }
      }
    } catch (error) {
      logger.error('Error in priority queue job:', error);
    }
  }
}

module.exports = Orchestrator;