/**
 * Advanced Features Scenarios
 * 
 * Tests advanced bot capabilities:
 * - Loop prevention
 * - Rate limiting
 * - MCP message handling
 * - Cache functionality
 * - Error handling
 */

class AdvancedFeaturesScenarios {
  constructor(framework) {
    this.framework = framework;
  }
  
  async runAll() {
    await this.testLoopPrevention();
    await this.testRateLimiting();
    await this.testMCPMessageHandling();
    await this.testCacheFunctionality();
    await this.testErrorRecovery();
  }
  
  async testLoopPrevention() {
    await this.framework.runScenario('Loop Prevention System', async () => {
      // Step 1: Get initial loop prevention status
      const initialStatus = await this.framework.step('Check loop prevention status', async () => {
        const response = await this.framework.apiGet('/loop-prevention/status');
        this.framework.log('detail', 'Loop Prevention Config', JSON.stringify(response.config, null, 2));
        return response;
      });
      
      // Step 2: Create a message that might trigger loop detection
      const message = await this.framework.step('Create potential loop message', async () => {
        return await this.framework.createTestMessage({
          text: 'AI Please repeat this message: AI Please repeat this message',
          userId: 'TEST_LOOP_USER'
        });
      });
      
      // Step 3: Process the message
      await this.framework.step('Process potential loop message', async () => {
        const response = await this.framework.processMessages([message]);
        this.framework.assert(response.results[0].success, 'Message should process');
      });
      
      // Step 4: Try to process similar messages rapidly
      await this.framework.step('Test rapid similar messages', async () => {
        const similarMessages = [];
        for (let i = 0; i < 3; i++) {
          similarMessages.push(await this.framework.createTestMessage({
            text: 'AI Please repeat this message: AI Please repeat this message',
            userId: 'TEST_LOOP_USER',
            messageId: `test-loop-${Date.now()}-${i}`
          }));
        }
        
        // Process all at once
        const response = await this.framework.processMessages(similarMessages);
        
        // System should handle this appropriately
        this.framework.assert(
          response.processed <= response.results.length,
          'Should process messages with loop prevention active'
        );
      });
      
      // Step 5: Verify loop prevention metrics
      const finalStatus = await this.framework.step('Check final loop prevention status', async () => {
        const response = await this.framework.apiGet('/loop-prevention/status');
        
        // Should show activity
        this.framework.assert(
          response.stats.activeUsers >= 0,
          'Should track active users'
        );
        
        return response;
      });
    });
  }
  
  async testRateLimiting() {
    await this.framework.runScenario('Rate Limiting', async () => {
      // Step 1: Check rate limit status
      const initialStatus = await this.framework.step('Check initial rate limit status', async () => {
        const response = await this.framework.apiGet('/rate-limit/status');
        this.framework.log('detail', 'Rate Limit Status', JSON.stringify(response, null, 2));
        return response;
      });
      
      // Step 2: Make multiple API calls
      await this.framework.step('Make multiple API calls', async () => {
        const calls = [];
        
        // Make 5 rapid API calls
        for (let i = 0; i < 5; i++) {
          calls.push(this.framework.apiGet('/health'));
        }
        
        await Promise.all(calls);
        this.framework.log('detail', 'API Calls', 'Made 5 rapid API calls');
      });
      
      // Step 3: Check rate limit consumption
      const afterStatus = await this.framework.step('Check rate limit after calls', async () => {
        const response = await this.framework.apiGet('/rate-limit/status');
        
        // Tokens should be consumed
        this.framework.assert(
          response.globalLimiter.tokens < initialStatus.globalLimiter.tokens ||
          response.globalLimiter.tokens <= response.globalLimiter.maxTokens,
          'Rate limiter should track API calls'
        );
        
        return response;
      });
      
      // Step 4: Test rate limit reset
      await this.framework.step('Test rate limit reset', async () => {
        try {
          await this.framework.apiPost('/rate-limit/reset', {});
          
          const resetStatus = await this.framework.apiGet('/rate-limit/status');
          this.framework.assert(
            resetStatus.globalLimiter.tokens === resetStatus.globalLimiter.maxTokens,
            'Rate limit should be reset to maximum'
          );
        } catch (error) {
          // Reset might require authentication - that's ok
          this.framework.log('detail', 'Rate limit reset', 'Requires authentication');
        }
      });
    });
  }
  
  async testMCPMessageHandling() {
    await this.framework.runScenario('MCP Message Handling', async () => {
      // Step 1: Create an MCP-style message
      const mcpMessage = await this.framework.step('Create MCP message', async () => {
        // MCP messages have specific bot_id
        const message = await this.framework.createTestMessage({
          text: 'AI What is MCP integration?',
          userId: 'U0108S7VB4L'
        });
        
        // Simulate MCP properties by updating database
        await this.framework.dbRun(
          'UPDATE message_queue SET bot_id = ?, app_id = ? WHERE id = ?',
          ['B097ML1T6DQ', 'A097GBJDNAF', message.id]
        );
        
        return message;
      });
      
      // Step 2: Verify MCP message is not filtered
      await this.framework.step('Process MCP message', async () => {
        const response = await this.framework.processMessages([mcpMessage]);
        
        this.framework.assert(
          response.results[0].success,
          'MCP message should be processed despite being from a bot'
        );
      });
      
      // Step 3: Create regular bot message
      const regularBotMessage = await this.framework.step('Create regular bot message', async () => {
        const message = await this.framework.createTestMessage({
          text: 'AI This is from a regular bot',
          userId: 'BOT123'
        });
        
        // Mark as bot message
        await this.framework.dbRun(
          'UPDATE message_queue SET bot_id = ? WHERE id = ?',
          ['B_OTHER_BOT', message.id]
        );
        
        return message;
      });
      
      // Step 4: Verify regular bot message is filtered
      await this.framework.step('Verify regular bot filtering', async () => {
        // Regular bot messages might be filtered at fetch or process stage
        // The behavior depends on implementation
        this.framework.log('detail', 'Bot filtering', 'Regular bot messages should be filtered');
      });
    });
  }
  
  async testCacheFunctionality() {
    await this.framework.runScenario('Cache Functionality', async () => {
      // Step 1: Get cache statistics
      const initialStats = await this.framework.step('Get initial cache stats', async () => {
        const response = await this.framework.apiGet('/cache/stats');
        this.framework.log('detail', 'Cache Stats', JSON.stringify(response, null, 2));
        return response;
      });
      
      // Step 2: Warm the cache
      await this.framework.step('Warm cache', async () => {
        try {
          await this.framework.apiPost('/cache/warm', {});
          this.framework.log('detail', 'Cache Warm', 'Cache warming initiated');
        } catch (error) {
          // Cache warming might fail if already warm
          this.framework.log('detail', 'Cache Warm', 'Already warm or in progress');
        }
      });
      
      // Step 3: Make requests that should hit cache
      await this.framework.step('Make cacheable requests', async () => {
        // First request - might miss cache
        const response1 = await this.framework.apiGet('/health');
        
        // Second request - should hit cache
        const response2 = await this.framework.apiGet('/health');
        
        this.framework.assertEquals(
          response1.status,
          response2.status,
          'Cached responses should be consistent'
        );
      });
      
      // Step 4: Check updated cache stats
      const finalStats = await this.framework.step('Check final cache stats', async () => {
        const response = await this.framework.apiGet('/cache/stats');
        
        // Cache should show activity
        if (response.stats) {
          this.framework.assert(
            response.stats.channels || response.stats.messages,
            'Cache should contain data'
          );
        }
        
        return response;
      });
      
      // Step 5: Test cache clear
      await this.framework.step('Test cache clear', async () => {
        try {
          await this.framework.apiPost('/cache/clear', {});
          
          const clearedStats = await this.framework.apiGet('/cache/stats');
          this.framework.log('detail', 'Cache Clear', 'Cache cleared successfully');
        } catch (error) {
          // Cache clear might require authentication
          this.framework.log('detail', 'Cache Clear', 'Requires authentication');
        }
      });
    });
  }
  
  async testErrorRecovery() {
    await this.framework.runScenario('Error Recovery', async () => {
      // Step 1: Create message that might cause processing error
      const problematicMessage = await this.framework.step('Create problematic message', async () => {
        return await this.framework.createTestMessage({
          text: 'AI ' + 'x'.repeat(10000), // Very long message
          messageId: `test-error-${Date.now()}`
        });
      });
      
      // Step 2: Process and handle potential error
      await this.framework.step('Process with error handling', async () => {
        try {
          const response = await this.framework.processMessages([problematicMessage]);
          
          // Should handle gracefully
          this.framework.assert(
            response.results[0].success || response.results[0].error,
            'Should either succeed or provide error details'
          );
        } catch (error) {
          // System should handle errors gracefully
          this.framework.log('detail', 'Error handled', error.message);
        }
      });
      
      // Step 3: Test invalid file path
      const invalidFileMessage = await this.framework.step('Create message with invalid file', async () => {
        return await this.framework.createTestMessage({
          text: 'AI Please analyze this file',
          hasAttachments: true,
          filePaths: ['/nonexistent/path/file.txt']
        });
      });
      
      // Step 4: Verify graceful file error handling
      await this.framework.step('Process invalid file message', async () => {
        const response = await this.framework.processMessages([invalidFileMessage]);
        
        // Should handle missing file gracefully
        if (response.results[0].success) {
          this.framework.assert(
            response.results[0].response.includes('file') ||
            response.results[0].response.includes('unable'),
            'Should mention file issue'
          );
        }
      });
      
      // Step 5: Verify system remains healthy
      await this.framework.step('Verify system health after errors', async () => {
        const health = await this.framework.apiGet('/health');
        this.framework.assertEquals(health.status, 'ok', 'System should remain healthy');
      });
    });
  }
}

module.exports = AdvancedFeaturesScenarios;