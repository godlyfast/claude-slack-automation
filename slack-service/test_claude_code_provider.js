// Test script for claude-code provider
const { createLLMService } = require('./src/llm-service/factory');

async function testClaudeCodeProvider() {
  console.log('Testing claude-code provider...\n');
  
  // Create the service
  const llmService = createLLMService({
    provider: 'claude-code'
  });
  
  try {
    // Test 1: Simple prompt
    console.log('Test 1: Simple prompt');
    const response1 = await llmService.generateResponse('What is 2 + 2?');
    console.log('Response:', response1);
    console.log('\n---\n');
    
    // Test 2: With file context
    console.log('Test 2: With file context');
    const response2 = await llmService.generateResponse(
      'What does this configuration file contain?',
      [{
        name: 'test-config.json',
        path: __filename // Using this file as a test
      }]
    );
    console.log('Response:', response2);
    
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the test
testClaudeCodeProvider();