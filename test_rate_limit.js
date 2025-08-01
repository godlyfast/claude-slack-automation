#!/usr/bin/env node

const axios = require('axios');
const logger = require('./slack-service/src/logger');

const SERVICE_URL = process.env.SERVICE_URL || 'http://localhost:3030';

async function testRateLimit() {
  console.log('\n🧪 Testing Global Rate Limiter\n');
  
  try {
    // First, check current rate limit status
    console.log('1. Checking current rate limit status...');
    const statusResponse = await axios.get(`${SERVICE_URL}/rate-limit/status`);
    console.log('Current status:', JSON.stringify(statusResponse.data.rateLimitStats, null, 2));
    
    // Reset the rate limiter to start fresh
    console.log('\n2. Resetting rate limiter...');
    await axios.post(`${SERVICE_URL}/rate-limit/reset`);
    console.log('✅ Rate limiter reset');
    
    // Try to fetch messages from a channel (first API call)
    console.log('\n3. Making first API call (should succeed immediately)...');
    const start1 = Date.now();
    try {
      const response1 = await axios.get(`${SERVICE_URL}/messages/unresponded`);
      const duration1 = Date.now() - start1;
      console.log(`✅ First call succeeded in ${duration1}ms`);
      console.log(`   Found ${response1.data.messages.length} unresponded messages`);
    } catch (error) {
      console.log(`❌ First call failed: ${error.response?.data?.error || error.message}`);
    }
    
    // Try to make another API call immediately (should be delayed)
    console.log('\n4. Making second API call immediately (should be delayed ~60s)...');
    console.log('   This call should wait for the rate limit window to pass...');
    const start2 = Date.now();
    try {
      const response2 = await axios.get(`${SERVICE_URL}/messages/unresponded`);
      const duration2 = Date.now() - start2;
      console.log(`✅ Second call succeeded after ${Math.round(duration2/1000)}s delay`);
      
      if (duration2 < 55000) {
        console.log('⚠️  WARNING: Second call completed too quickly! Rate limiter may not be working.');
      } else {
        console.log('✅ Rate limiter is working correctly (enforced ~60s delay)');
      }
    } catch (error) {
      console.log(`❌ Second call failed: ${error.response?.data?.error || error.message}`);
    }
    
    // Check final rate limit status
    console.log('\n5. Checking final rate limit status...');
    const finalStatus = await axios.get(`${SERVICE_URL}/rate-limit/status`);
    console.log('Final status:', JSON.stringify(finalStatus.data.rateLimitStats, null, 2));
    
  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
console.log('Starting rate limit test...');
console.log('Note: This test will take at least 60 seconds to complete due to rate limiting.');
testRateLimit().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});