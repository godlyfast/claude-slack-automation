#!/usr/bin/env node

/**
 * Claude Slack Bot - End-to-End Test Runner
 * 
 * Comprehensive test suite for validating all bot functionality
 * 
 * Usage:
 *   npm run test:e2e                    # Run all tests
 *   npm run test:e2e -- --scenario basic   # Run specific scenario
 *   npm run test:e2e -- --verbose          # Verbose output
 *   npm run test:e2e -- --quiet            # Minimal output
 */

const TestFramework = require('./TestFramework');
const BasicMessagingScenarios = require('./scenarios/BasicMessaging');
const FileHandlingScenarios = require('./scenarios/FileHandling');
const AdvancedFeaturesScenarios = require('./scenarios/AdvancedFeatures');
const chalk = require('chalk');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  scenario: args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : 'all',
  logLevel: args.includes('--quiet') ? 'quiet' : args.includes('--verbose') ? 'verbose' : 'normal',
  failFast: args.includes('--fail-fast'),
  help: args.includes('--help') || args.includes('-h')
};

// Display help
if (options.help) {
  console.log(`
${chalk.bold('Claude Slack Bot - E2E Test Suite')}

${chalk.yellow('Usage:')}
  npm run test:e2e [options]

${chalk.yellow('Options:')}
  --scenario <name>   Run specific scenario (basic, files, advanced, or all)
  --verbose          Show detailed output
  --quiet            Show minimal output
  --fail-fast        Stop on first failure
  --help, -h         Show this help

${chalk.yellow('Examples:')}
  npm run test:e2e                       # Run all tests
  npm run test:e2e -- --scenario basic   # Run basic messaging tests only
  npm run test:e2e -- --verbose          # Run with detailed logging
  `);
  process.exit(0);
}

// Main test runner
async function runTests() {
  console.log(chalk.bold.blue('\n🧪 Claude Slack Bot - End-to-End Test Suite\n'));
  console.log(chalk.gray(`Starting at: ${new Date().toISOString()}`));
  console.log(chalk.gray(`Log level: ${options.logLevel}`));
  console.log(chalk.gray(`Scenario: ${options.scenario}`));
  console.log(chalk.gray('═'.repeat(80) + '\n'));
  
  // Initialize test framework
  const framework = new TestFramework({
    logLevel: options.logLevel,
    failFast: options.failFast
  });
  
  try {
    // Setup test environment
    await framework.setup();
    
    // Run selected scenarios
    if (options.scenario === 'all' || options.scenario === 'basic') {
      console.log(chalk.bold.yellow('\n📦 Basic Messaging Scenarios\n'));
      const basicScenarios = new BasicMessagingScenarios(framework);
      await basicScenarios.runAll();
    }
    
    if (options.scenario === 'all' || options.scenario === 'files') {
      console.log(chalk.bold.yellow('\n📎 File Handling Scenarios\n'));
      const fileScenarios = new FileHandlingScenarios(framework);
      await fileScenarios.runAll();
    }
    
    if (options.scenario === 'all' || options.scenario === 'advanced') {
      console.log(chalk.bold.yellow('\n⚡ Advanced Features Scenarios\n'));
      const advancedScenarios = new AdvancedFeaturesScenarios(framework);
      await advancedScenarios.runAll();
    }
    
    // Additional scenario: Performance testing
    if (options.scenario === 'performance') {
      console.log(chalk.bold.yellow('\n🚀 Performance Scenarios\n'));
      await runPerformanceTests(framework);
    }
    
  } catch (error) {
    console.error(chalk.red('\n💥 Critical test failure:'), error.message);
    if (options.logLevel === 'verbose') {
      console.error(error.stack);
    }
  } finally {
    // Cleanup test environment
    await framework.teardown();
    
    // Generate and display report
    const exitCode = framework.generateReport();
    
    // Show tips if there were failures
    if (framework.results.failed > 0) {
      console.log(chalk.yellow('\n💡 Troubleshooting Tips:'));
      console.log('  • Ensure the bot service is running: ./bot_control.sh status');
      console.log('  • Check service logs: tail -f logs/slack-service.log');
      console.log('  • Verify database: sqlite3 data/slack-bot.db ".schema"');
      console.log('  • Run with --verbose for detailed output');
    }
    
    process.exit(exitCode);
  }
}

// Performance testing scenarios
async function runPerformanceTests(framework) {
  await framework.runScenario('Concurrent Message Processing', async () => {
    const messageCount = 10;
    
    const messages = await framework.step(`Create ${messageCount} concurrent messages`, async () => {
      const msgs = [];
      for (let i = 0; i < messageCount; i++) {
        msgs.push(await framework.createTestMessage({
          text: `AI Performance test message ${i}: Calculate ${i} * ${i}`,
          messageId: `test-perf-${Date.now()}-${i}`
        }));
      }
      return msgs;
    });
    
    const startTime = Date.now();
    
    await framework.step('Process all messages concurrently', async () => {
      const response = await framework.processMessages(messages);
      framework.assertEquals(response.processed, messageCount, `Should process all ${messageCount} messages`);
    });
    
    const duration = Date.now() - startTime;
    
    await framework.step('Verify performance metrics', async () => {
      const avgTime = duration / messageCount;
      framework.log('detail', 'Performance', `Processed ${messageCount} messages in ${duration}ms (avg: ${avgTime.toFixed(2)}ms/msg)`);
      
      // Performance should be reasonable
      framework.assert(
        avgTime < 5000, // 5 seconds per message max
        `Average processing time (${avgTime.toFixed(2)}ms) should be under 5000ms`
      );
    });
  });
  
  await framework.runScenario('Large Channel History', async () => {
    // Create messages to simulate channel history
    const historySize = 50;
    
    await framework.step(`Create ${historySize} historical messages`, async () => {
      for (let i = 0; i < historySize; i++) {
        await framework.createTestMessage({
          text: `Historical message ${i}`,
          messageId: `test-history-${Date.now()}-${i}`,
          userId: 'HISTORY_USER'
        });
      }
    });
    
    const message = await framework.step('Create message requiring history context', async () => {
      return await framework.createTestMessage({
        text: 'AI Based on the channel history, what topics have been discussed?'
      });
    });
    
    const startTime = Date.now();
    
    await framework.step('Process with large history', async () => {
      const response = await framework.processMessages([message]);
      framework.assert(response.results[0].success, 'Should handle large history');
    });
    
    const duration = Date.now() - startTime;
    
    await framework.step('Verify history handling performance', async () => {
      framework.log('detail', 'Performance', `Processed with ${historySize} history messages in ${duration}ms`);
      framework.assert(duration < 10000, 'Should process within 10 seconds even with large history');
    });
  });
}

// Run the tests
runTests().catch(error => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});