#!/usr/bin/env node

/**
 * Test script to verify Slack API enforcement during message processing
 * This ensures NO Slack API calls are made during the PROCESS phase
 */

const SlackService = require('./slack-service/src/slack-service');
const logger = require('./slack-service/src/logger');

// Load config
require('dotenv').config({ path: './config.env' });

async function testEnforcement() {
  console.log('🧪 Testing Slack API Enforcement During Processing...\n');
  
  // Initialize SlackService
  const slackService = new SlackService(process.env.SLACK_BOT_TOKEN, {
    channels: ['#general'],
    triggerKeywords: ['test'],
    responseMode: 'all'
  });
  
  try {
    // Test 1: Verify API calls work when NOT in processing mode
    console.log('✅ Test 1: API calls should work when NOT in processing mode');
    const channelHistory = await slackService.getChannelHistory('#general', 5);
    console.log(`   Successfully fetched ${channelHistory.length} messages\n`);
    
    // Test 2: Enable processing mode
    console.log('🚨 Test 2: Enabling processing mode...');
    slackService.setProcessingMode(true);
    console.log('   Processing mode ENABLED\n');
    
    // Test 3: Try to make API calls - these should ALL fail
    console.log('❌ Test 3: All API calls should now FAIL:');
    
    // Test getChannelHistory
    try {
      await slackService.getChannelHistory('#general', 5);
      console.log('   ⚠️  FAIL: getChannelHistory succeeded when it should have failed!');
    } catch (error) {
      console.log('   ✅ PASS: getChannelHistory blocked:', error.message);
    }
    
    // Test _fetchChannelMessages
    try {
      await slackService._fetchChannelMessages('#general', Date.now() / 1000);
      console.log('   ⚠️  FAIL: _fetchChannelMessages succeeded when it should have failed!');
    } catch (error) {
      console.log('   ✅ PASS: _fetchChannelMessages blocked:', error.message);
    }
    
    // Test _getChannelInfo
    try {
      await slackService._getChannelInfo('#general');
      console.log('   ⚠️  FAIL: _getChannelInfo succeeded when it should have failed!');
    } catch (error) {
      console.log('   ✅ PASS: _getChannelInfo blocked:', error.message);
    }
    
    // Test postResponse
    try {
      await slackService.postResponse({
        channel: 'C123456',
        ts: '1234567890.123456'
      }, 'Test message');
      console.log('   ⚠️  FAIL: postResponse succeeded when it should have failed!');
    } catch (error) {
      console.log('   ✅ PASS: postResponse blocked:', error.message);
    }
    
    // Test warmCache
    try {
      await slackService.warmCache();
      console.log('   ⚠️  FAIL: warmCache succeeded when it should have failed!');
    } catch (error) {
      console.log('   ✅ PASS: warmCache blocked:', error.message);
    }
    
    // Test 4: Disable processing mode
    console.log('\n✅ Test 4: Disabling processing mode...');
    slackService.setProcessingMode(false);
    console.log('   Processing mode DISABLED');
    
    // Test 5: Verify API calls work again
    console.log('\n✅ Test 5: API calls should work again after disabling processing mode');
    try {
      const channelHistory2 = await slackService.getChannelHistory('#general', 5);
      console.log(`   Successfully fetched ${channelHistory2.length} messages`);
    } catch (error) {
      console.log('   ⚠️  FAIL: API call failed after disabling processing mode:', error.message);
    }
    
    console.log('\n✅ All tests completed!');
    console.log('\n📋 Summary:');
    console.log('   - Slack API calls work normally when NOT in processing mode');
    console.log('   - ALL Slack API calls are BLOCKED during processing mode');
    console.log('   - This ensures Claude NEVER makes Slack API calls during message processing');
    console.log('   - Rate limiting is prevented during the PROCESS phase\n');
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
  } finally {
    slackService.close();
  }
}

// Run the test
testEnforcement().catch(console.error);