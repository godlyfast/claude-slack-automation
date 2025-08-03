/**
 * Claude Slack Bot - End-to-End Test Framework
 * 
 * A comprehensive testing framework for validating the complete bot functionality
 * from Slack message reception to response delivery.
 */

const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const chalk = require('chalk');

class TestFramework {
  constructor(config = {}) {
    this.config = {
      serviceUrl: config.serviceUrl || 'http://localhost:3030',
      dbPath: config.dbPath || path.join(__dirname, '../../data/slack-bot.db'),
      tempDir: config.tempDir || path.join(__dirname, '../../temp'),
      logLevel: config.logLevel || 'verbose',
      timeout: config.timeout || 30000,
      ...config
    };
    
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      startTime: null,
      endTime: null,
      scenarios: []
    };
    
    this.db = null;
    this.currentScenario = null;
  }

  // ==================== Core Test Lifecycle ====================
  
  async setup() {
    this.log('info', '🚀 Test Framework Setup', 'Initializing test environment...');
    this.results.startTime = new Date();
    
    try {
      // 1. Verify service is running
      await this.verifyService();
      
      // 2. Initialize database connection
      await this.initDatabase();
      
      // 3. Create test fixtures directory
      await fs.mkdir(path.join(__dirname, 'fixtures'), { recursive: true });
      
      // 4. Clean up any existing test data
      await this.cleanupTestData();
      
      this.log('success', '✅ Setup Complete', 'Test environment ready');
    } catch (error) {
      this.log('error', '❌ Setup Failed', error.message);
      throw error;
    }
  }
  
  async teardown() {
    this.log('info', '🧹 Test Framework Teardown', 'Cleaning up test environment...');
    
    try {
      // Clean up test data
      await this.cleanupTestData();
      
      // Close database connection
      if (this.db) {
        await new Promise((resolve) => this.db.close(resolve));
      }
      
      // Remove test fixtures
      await this.cleanupTestFixtures();
      
      this.results.endTime = new Date();
      this.log('success', '✅ Teardown Complete', 'Test environment cleaned');
    } catch (error) {
      this.log('error', '❌ Teardown Failed', error.message);
    }
  }
  
  // ==================== Test Execution ====================
  
  async runScenario(name, testFn) {
    this.results.total++;
    this.currentScenario = {
      name,
      startTime: new Date(),
      status: 'running',
      steps: [],
      errors: []
    };
    
    this.log('scenario', `📋 Scenario: ${name}`, 'Starting...');
    
    try {
      // Run the test function with timeout
      await this.withTimeout(testFn.bind(this), this.config.timeout);
      
      this.currentScenario.status = 'passed';
      this.results.passed++;
      this.log('success', `✅ Scenario Passed`, `${name} completed successfully`);
    } catch (error) {
      this.currentScenario.status = 'failed';
      this.currentScenario.errors.push(error.message);
      this.results.failed++;
      this.log('error', `❌ Scenario Failed`, `${name}: ${error.message}`);
      
      if (this.config.failFast) {
        throw error;
      }
    } finally {
      this.currentScenario.endTime = new Date();
      this.currentScenario.duration = this.currentScenario.endTime - this.currentScenario.startTime;
      this.results.scenarios.push({ ...this.currentScenario });
      this.currentScenario = null;
    }
  }
  
  async step(description, action) {
    if (!this.currentScenario) {
      throw new Error('No active scenario - use runScenario()');
    }
    
    const step = {
      description,
      startTime: new Date(),
      status: 'running'
    };
    
    this.log('step', `  📍 ${description}`, '');
    
    try {
      const result = await action();
      step.status = 'passed';
      step.result = result;
      this.log('detail', `     ✓ ${description}`, typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
    } catch (error) {
      step.status = 'failed';
      step.error = error.message;
      this.log('error', `     ✗ ${description}`, error.message);
      throw error;
    } finally {
      step.endTime = new Date();
      step.duration = step.endTime - step.startTime;
      this.currentScenario.steps.push(step);
    }
    
    return step.result;
  }
  
  // ==================== Test Utilities ====================
  
  async verifyService() {
    try {
      const response = await axios.get(`${this.config.serviceUrl}/health`);
      if (response.data.status !== 'ok') {
        throw new Error('Service is not healthy');
      }
      this.log('detail', '🏥 Service Health', 'OK');
    } catch (error) {
      throw new Error(`Service not available at ${this.config.serviceUrl}: ${error.message}`);
    }
  }
  
  async initDatabase() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.config.dbPath, (err) => {
        if (err) {
          reject(new Error(`Failed to connect to database: ${err.message}`));
        } else {
          this.log('detail', '🗄️  Database Connected', this.config.dbPath);
          resolve();
        }
      });
    });
  }
  
  async cleanupTestData() {
    const queries = [
      "DELETE FROM message_queue WHERE message_id LIKE 'test-%'",
      "DELETE FROM response_queue WHERE message_id LIKE 'test-%'",
      "DELETE FROM message_queue WHERE user_id LIKE 'TEST%'",
      "DELETE FROM response_queue WHERE message_id IN (SELECT message_id FROM message_queue WHERE user_id LIKE 'TEST%')"
    ];
    
    for (const query of queries) {
      await this.dbRun(query);
    }
    
    this.log('detail', '🧹 Test Data Cleaned', 'Database cleared of test records');
  }
  
  async cleanupTestFixtures() {
    try {
      const fixturesDir = path.join(__dirname, 'fixtures');
      const files = await fs.readdir(fixturesDir);
      
      for (const file of files) {
        if (file.startsWith('test_')) {
          await fs.unlink(path.join(fixturesDir, file));
        }
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
  
  // ==================== Database Helpers ====================
  
  async dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
  
  async dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
  
  async dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
  
  // ==================== API Helpers ====================
  
  async apiGet(endpoint) {
    const url = `${this.config.serviceUrl}${endpoint}`;
    this.log('api', '🔵 GET', url);
    
    try {
      const response = await axios.get(url);
      this.log('api', '✅ Response', `Status: ${response.status}`);
      return response.data;
    } catch (error) {
      this.log('api', '❌ Error', error.message);
      throw error;
    }
  }
  
  async apiPost(endpoint, data) {
    const url = `${this.config.serviceUrl}${endpoint}`;
    this.log('api', '🔵 POST', url);
    this.log('api', '📤 Request', JSON.stringify(data, null, 2));
    
    try {
      const response = await axios.post(url, data);
      this.log('api', '✅ Response', `Status: ${response.status}`);
      return response.data;
    } catch (error) {
      this.log('api', '❌ Error', error.message);
      throw error;
    }
  }
  
  // ==================== Message Helpers ====================
  
  async createTestMessage(options = {}) {
    const defaults = {
      messageId: `test-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      channelId: 'C097WE5JS2X',
      channelName: '#ai-test',
      userId: 'TEST_USER_001',
      text: 'AI Test message',
      hasAttachments: false,
      filePaths: []
    };
    
    const message = { ...defaults, ...options };
    
    const result = await this.dbRun(`
      INSERT INTO message_queue (
        message_id, channel_id, channel_name, thread_ts,
        user_id, text, has_attachments, file_paths, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      message.messageId,
      message.channelId,
      message.channelName,
      message.threadTs || null,
      message.userId,
      message.text,
      message.hasAttachments ? 1 : 0,
      JSON.stringify(message.filePaths),
      'pending'
    ]);
    
    return { ...message, id: result.lastID };
  }
  
  async processMessages(messages) {
    return await this.apiPost('/messages/process-with-llm', { messages });
  }
  
  async getQueuedResponse(messageId) {
    return await this.dbGet(
      'SELECT * FROM response_queue WHERE message_id = ? AND status = ?',
      [messageId, 'pending']
    );
  }
  
  // ==================== File Helpers ====================
  
  async createTestFile(filename, content) {
    const filePath = path.join(__dirname, 'fixtures', filename);
    await fs.writeFile(filePath, content);
    this.log('detail', '📄 Test File Created', filename);
    return filePath;
  }
  
  // ==================== Assertions ====================
  
  assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }
  
  assertEquals(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
  }
  
  assertContains(text, substring, message) {
    if (!text.includes(substring)) {
      throw new Error(`${message}\nText does not contain: ${substring}`);
    }
  }
  
  // ==================== Logging ====================
  
  log(level, title, message) {
    if (this.config.logLevel === 'quiet' && level !== 'error') return;
    if (this.config.logLevel === 'normal' && ['detail', 'api'].includes(level)) return;
    
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    
    switch (level) {
      case 'info':
        console.log(chalk.blue(`[${timestamp}] ${title}`), message);
        break;
      case 'success':
        console.log(chalk.green(`[${timestamp}] ${title}`), message);
        break;
      case 'error':
        console.log(chalk.red(`[${timestamp}] ${title}`), message);
        break;
      case 'scenario':
        console.log(chalk.yellow.bold(`\n[${timestamp}] ${title}`), message);
        break;
      case 'step':
        console.log(chalk.cyan(`[${timestamp}] ${title}`));
        break;
      case 'detail':
        console.log(chalk.gray(`[${timestamp}] ${title}`), chalk.gray(message));
        break;
      case 'api':
        console.log(chalk.magenta(`[${timestamp}] ${title}`), chalk.gray(message));
        break;
      default:
        console.log(`[${timestamp}] ${title}`, message);
    }
  }
  
  // ==================== Reporting ====================
  
  generateReport() {
    const duration = this.results.endTime - this.results.startTime;
    const durationSeconds = (duration / 1000).toFixed(2);
    
    console.log('\n' + chalk.bold('═'.repeat(80)));
    console.log(chalk.bold.white('TEST EXECUTION REPORT'));
    console.log(chalk.bold('═'.repeat(80)));
    
    console.log(chalk.white('\nSummary:'));
    console.log(`  Total Scenarios: ${this.results.total}`);
    console.log(chalk.green(`  ✅ Passed: ${this.results.passed}`));
    console.log(chalk.red(`  ❌ Failed: ${this.results.failed}`));
    console.log(chalk.yellow(`  ⏭️  Skipped: ${this.results.skipped}`));
    console.log(`  Duration: ${durationSeconds}s`);
    
    if (this.results.failed > 0) {
      console.log(chalk.red('\nFailed Scenarios:'));
      this.results.scenarios
        .filter(s => s.status === 'failed')
        .forEach(scenario => {
          console.log(chalk.red(`  ❌ ${scenario.name}`));
          scenario.errors.forEach(error => {
            console.log(chalk.gray(`     ${error}`));
          });
        });
    }
    
    console.log('\nDetailed Results:');
    this.results.scenarios.forEach(scenario => {
      const icon = scenario.status === 'passed' ? '✅' : '❌';
      const color = scenario.status === 'passed' ? chalk.green : chalk.red;
      console.log(color(`\n${icon} ${scenario.name} (${(scenario.duration / 1000).toFixed(2)}s)`));
      
      scenario.steps.forEach(step => {
        const stepIcon = step.status === 'passed' ? '✓' : '✗';
        const stepColor = step.status === 'passed' ? chalk.green : chalk.red;
        console.log(stepColor(`   ${stepIcon} ${step.description} (${step.duration}ms)`));
      });
    });
    
    console.log('\n' + chalk.bold('═'.repeat(80)));
    
    const exitCode = this.results.failed > 0 ? 1 : 0;
    return exitCode;
  }
  
  // ==================== Utility Methods ====================
  
  async withTimeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout)
      )
    ]);
  }
  
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = TestFramework;