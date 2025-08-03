#!/usr/bin/env node

/**
 * Demo script to showcase the E2E test framework capabilities
 * 
 * This demonstrates how to use the test framework for custom testing
 */

const TestFramework = require('./TestFramework');
const chalk = require('chalk');

async function runDemo() {
  console.log(chalk.bold.blue('\n🎯 Claude Slack Bot - Test Framework Demo\n'));
  
  const framework = new TestFramework({
    logLevel: 'verbose'  // Show all details
  });
  
  try {
    await framework.setup();
    
    // Demo 1: Simple message test
    await framework.runScenario('Demo: Simple AI Question', async () => {
      const message = await framework.step('Create a simple question', async () => {
        return await framework.createTestMessage({
          text: 'AI What is 2 + 2?'
        });
      });
      
      const result = await framework.step('Process and get answer', async () => {
        const response = await framework.processMessages([message]);
        return response.results[0];
      });
      
      await framework.step('Verify correct answer', async () => {
        framework.assertContains(result.response, '4', 'Bot should answer 4');
      });
    });
    
    // Demo 2: File handling test
    await framework.runScenario('Demo: File Analysis', async () => {
      const filePath = await framework.step('Create a sample file', async () => {
        const content = `Sample Data File
================
Name: Demo Project
Version: 1.0.0
Users: 100
Status: Active`;
        
        return await framework.createTestFile('demo_data.txt', content);
      });
      
      const message = await framework.step('Ask about file content', async () => {
        return await framework.createTestMessage({
          text: 'AI Can you tell me the project name from this file?',
          hasAttachments: true,
          filePaths: [filePath]
        });
      });
      
      const result = await framework.step('Get file analysis', async () => {
        const response = await framework.processMessages([message]);
        return response.results[0];
      });
      
      await framework.step('Verify file was analyzed', async () => {
        framework.assertContains(
          result.response.toLowerCase(),
          'demo project',
          'Should identify project name from file'
        );
      });
    });
    
  } finally {
    await framework.teardown();
    framework.generateReport();
  }
}

// Run the demo
console.log(chalk.gray('This demo shows basic usage of the test framework.'));
console.log(chalk.gray('For full test suite, run: npm run test:e2e\n'));

runDemo().catch(error => {
  console.error(chalk.red('Demo failed:'), error);
  process.exit(1);
});