/**
 * Basic Messaging Scenarios
 * 
 * Tests fundamental message processing capabilities:
 * - Simple text messages
 * - Keyword detection
 * - Response generation
 * - Thread handling
 */

class BasicMessagingScenarios {
  constructor(framework) {
    this.framework = framework;
  }
  
  async runAll() {
    await this.testSimpleMessage();
    await this.testUkrainianKeyword();
    await this.testThreadReply();
    await this.testNoKeywordIgnored();
    await this.testMultipleMessages();
  }
  
  async testSimpleMessage() {
    await this.framework.runScenario('Simple Message Processing', async () => {
      // Step 1: Create a test message
      const message = await this.framework.step('Create test message with AI keyword', async () => {
        return await this.framework.createTestMessage({
          text: 'AI What is the capital of France?'
        });
      });
      
      // Step 2: Get pending messages
      const pendingMessages = await this.framework.step('Fetch pending messages', async () => {
        const response = await this.framework.apiGet('/queue/messages/pending');
        this.framework.assert(response.count > 0, 'Should have pending messages');
        return response.messages;
      });
      
      // Step 3: Process the message
      const processResult = await this.framework.step('Process message with LLM', async () => {
        const response = await this.framework.processMessages([message]);
        this.framework.assert(response.success, 'Processing should succeed');
        this.framework.assertEquals(response.processed, 1, 'Should process 1 message');
        return response.results[0];
      });
      
      // Step 4: Verify response
      await this.framework.step('Verify response contains answer', async () => {
        this.framework.assert(processResult.success, 'Message processing should succeed');
        this.framework.assertContains(
          processResult.response.toLowerCase(),
          'paris',
          'Response should mention Paris'
        );
      });
      
      // Step 5: Check response queue
      const queuedResponse = await this.framework.step('Check response is queued', async () => {
        const response = await this.framework.getQueuedResponse(message.messageId);
        this.framework.assert(response, 'Response should be queued');
        this.framework.assertEquals(response.status, 'pending', 'Response should be pending');
        return response;
      });
    });
  }
  
  async testUkrainianKeyword() {
    await this.framework.runScenario('Ukrainian Keyword Detection', async () => {
      const message = await this.framework.step('Create message with ШІ keyword', async () => {
        return await this.framework.createTestMessage({
          text: 'ШІ, що таке штучний інтелект?'
        });
      });
      
      const processResult = await this.framework.step('Process Ukrainian message', async () => {
        const response = await this.framework.processMessages([message]);
        return response.results[0];
      });
      
      await this.framework.step('Verify response in appropriate language', async () => {
        this.framework.assert(processResult.success, 'Should process Ukrainian message');
        // Response might be in English or Ukrainian depending on LLM
        this.framework.assert(
          processResult.response.length > 50,
          'Should provide substantial response'
        );
      });
    });
  }
  
  async testThreadReply() {
    await this.framework.runScenario('Thread Reply Handling', async () => {
      // Create parent message
      const parentMessage = await this.framework.step('Create parent message', async () => {
        return await this.framework.createTestMessage({
          text: 'AI What is machine learning?'
        });
      });
      
      // Process parent
      await this.framework.step('Process parent message', async () => {
        await this.framework.processMessages([parentMessage]);
      });
      
      // Create thread reply
      const threadMessage = await this.framework.step('Create thread reply', async () => {
        return await this.framework.createTestMessage({
          text: 'AI Can you give me an example?',
          threadTs: parentMessage.messageId
        });
      });
      
      // Process thread reply
      const threadResult = await this.framework.step('Process thread reply', async () => {
        const response = await this.framework.processMessages([threadMessage]);
        return response.results[0];
      });
      
      await this.framework.step('Verify thread context awareness', async () => {
        this.framework.assert(threadResult.success, 'Thread message should process');
        // Response should be contextual to ML discussion
        this.framework.assert(
          threadResult.response.toLowerCase().includes('example') ||
          threadResult.response.toLowerCase().includes('instance') ||
          threadResult.response.toLowerCase().includes('for'),
          'Response should acknowledge the request for an example'
        );
      });
    });
  }
  
  async testNoKeywordIgnored() {
    await this.framework.runScenario('Messages Without Keywords Ignored', async () => {
      const message = await this.framework.step('Create message without keyword', async () => {
        return await this.framework.createTestMessage({
          text: 'Hello team, how is everyone doing today?',
          messageId: `test-nokeyword-${Date.now()}`
        });
      });
      
      await this.framework.step('Verify message not queued', async () => {
        const queuedMessage = await this.framework.dbGet(
          'SELECT * FROM message_queue WHERE message_id = ?',
          [message.messageId]
        );
        
        // Message might be in queue but should be marked as processed/ignored
        if (queuedMessage) {
          this.framework.assert(
            queuedMessage.status !== 'pending',
            'Message without keyword should not be pending'
          );
        }
      });
    });
  }
  
  async testMultipleMessages() {
    await this.framework.runScenario('Batch Message Processing', async () => {
      // Create multiple messages
      const messages = await this.framework.step('Create 3 test messages', async () => {
        const msgs = [];
        for (let i = 1; i <= 3; i++) {
          msgs.push(await this.framework.createTestMessage({
            text: `AI Question ${i}: What is ${i} + ${i}?`,
            messageId: `test-batch-${Date.now()}-${i}`
          }));
        }
        return msgs;
      });
      
      // Process all messages
      const results = await this.framework.step('Process batch of messages', async () => {
        const response = await this.framework.processMessages(messages);
        this.framework.assertEquals(response.processed, 3, 'Should process all 3 messages');
        return response.results;
      });
      
      // Verify all responses
      await this.framework.step('Verify all responses are correct', async () => {
        for (let i = 0; i < 3; i++) {
          const result = results[i];
          this.framework.assert(result.success, `Message ${i + 1} should succeed`);
          
          const expectedAnswer = (i + 1) * 2;
          this.framework.assertContains(
            result.response,
            expectedAnswer.toString(),
            `Response ${i + 1} should contain answer ${expectedAnswer}`
          );
        }
      });
      
      // Check response queue
      await this.framework.step('Verify all responses queued', async () => {
        const queuedResponses = await this.framework.dbAll(
          'SELECT * FROM response_queue WHERE message_id LIKE ? AND status = ?',
          ['test-batch-%', 'pending']
        );
        
        this.framework.assertEquals(
          queuedResponses.length,
          3,
          'Should have 3 queued responses'
        );
      });
    });
  }
}

module.exports = BasicMessagingScenarios;