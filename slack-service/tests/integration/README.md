# Claude Slack Bot - End-to-End Test Suite

A comprehensive test framework for validating the complete functionality of the Claude Slack Bot.

## Overview

This test suite provides thorough end-to-end testing of:
- **Basic Messaging**: Message processing, keyword detection, thread handling
- **File Handling**: Text/code file analysis, PDF limitations, multiple attachments
- **Advanced Features**: Loop prevention, rate limiting, MCP messages, caching

## Architecture

```
tests/integration/
├── TestFramework.js        # Core testing framework with utilities
├── scenarios/              # Test scenario implementations
│   ├── BasicMessaging.js   # Basic message processing tests
│   ├── FileHandling.js     # File attachment tests
│   └── AdvancedFeatures.js # Advanced feature tests
├── fixtures/               # Test files (created during tests)
└── run-e2e-tests.js       # Main test runner
```

## Running Tests

### Prerequisites
1. Bot service must be running:
   ```bash
   ./bot_control.sh status  # Check status
   ./bot_control.sh start   # Start if needed
   ```

2. Clean database recommended:
   ```bash
   sqlite3 data/slack-bot.db "DELETE FROM message_queue; DELETE FROM response_queue;"
   ```

### Test Commands

```bash
# Run all tests
npm run test:e2e

# Run specific scenario
npm run test:e2e:basic      # Basic messaging only
npm run test:e2e:files      # File handling only
npm run test:e2e:advanced   # Advanced features only

# Run with options
npm run test:e2e -- --verbose     # Detailed output
npm run test:e2e -- --quiet       # Minimal output
npm run test:e2e -- --fail-fast   # Stop on first failure
```

## Test Framework Features

### Verbose Logging
The framework provides detailed logging at multiple levels:
- **Scenario**: High-level test progress
- **Step**: Individual test steps
- **Detail**: Implementation details
- **API**: HTTP request/response logging

### Comprehensive Assertions
```javascript
framework.assert(condition, message);
framework.assertEquals(actual, expected, message);
framework.assertContains(text, substring, message);
```

### Database Helpers
```javascript
await framework.dbRun(sql, params);    // Execute query
await framework.dbGet(sql, params);    // Get single row
await framework.dbAll(sql, params);    // Get all rows
```

### API Helpers
```javascript
await framework.apiGet(endpoint);      // GET request
await framework.apiPost(endpoint, data); // POST request
```

### Test Data Management
```javascript
// Create test message
const message = await framework.createTestMessage({
  text: 'AI Test message',
  hasAttachments: true,
  filePaths: ['/path/to/file']
});

// Create test file
const filePath = await framework.createTestFile('test.txt', 'content');
```

## Test Scenarios

### Basic Messaging (5 tests)
1. **Simple Message Processing**: Basic AI keyword detection and response
2. **Ukrainian Keyword Detection**: ШІ keyword handling
3. **Thread Reply Handling**: Context awareness in threads
4. **No Keyword Ignored**: Messages without triggers ignored
5. **Batch Message Processing**: Multiple messages at once

### File Handling (5 tests)
1. **Text File Analysis**: Extract information from text files
2. **Code File Processing**: Analyze code structure and patterns
3. **PDF Limitations**: Verify PDF handling with current limitations
4. **Multiple Files**: Process multiple attachments
5. **Large File Handling**: Handle files near size limits

### Advanced Features (5 tests)
1. **Loop Prevention**: Detect and prevent response loops
2. **Rate Limiting**: API rate limit enforcement
3. **MCP Message Handling**: Process MCP bot messages
4. **Cache Functionality**: Verify caching behavior
5. **Error Recovery**: Graceful error handling

## Understanding Test Output

### Success Output
```
[11:23:45] 📋 Scenario: Simple Message Processing Starting...
[11:23:45]   📍 Create test message with AI keyword
[11:23:45]      ✓ Create test message with AI keyword
[11:23:46]   📍 Process message with LLM
[11:23:47]      ✓ Process message with LLM
[11:23:47] ✅ Scenario Passed Simple Message Processing completed successfully
```

### Failure Output
```
[11:23:48] 📋 Scenario: PDF File Analysis Starting...
[11:23:48]   📍 Create PDF file
[11:23:48]      ✗ Create PDF file File creation failed
[11:23:48] ❌ Scenario Failed PDF File Analysis: File creation failed
```

## Test Report

After all tests complete, a comprehensive report is generated:

```
════════════════════════════════════════════════════════════════════════════════
TEST EXECUTION REPORT
════════════════════════════════════════════════════════════════════════════════

Summary:
  Total Scenarios: 15
  ✅ Passed: 14
  ❌ Failed: 1
  ⏭️  Skipped: 0
  Duration: 45.23s

Detailed Results:
...
```

## Troubleshooting

### Common Issues

1. **Service not running**
   ```bash
   Error: Service not available at http://localhost:3030
   Solution: ./bot_control.sh start
   ```

2. **Database locked**
   ```bash
   Error: database is locked
   Solution: Stop other processes accessing the database
   ```

3. **Test data conflicts**
   ```bash
   Error: UNIQUE constraint failed
   Solution: Clean test data before running
   ```

### Debug Mode

Run with verbose output to see detailed information:
```bash
npm run test:e2e -- --verbose
```

Check logs during test execution:
```bash
tail -f logs/slack-service.log
tail -f logs/combined.log
```

## Extending Tests

### Adding New Scenarios

1. Create new scenario file in `scenarios/`:
```javascript
class CustomScenarios {
  constructor(framework) {
    this.framework = framework;
  }
  
  async runAll() {
    await this.testCustomFeature();
  }
  
  async testCustomFeature() {
    await this.framework.runScenario('Custom Feature Test', async () => {
      // Test implementation
    });
  }
}
```

2. Import and run in `run-e2e-tests.js`:
```javascript
const CustomScenarios = require('./scenarios/Custom');
// ...
const customScenarios = new CustomScenarios(framework);
await customScenarios.runAll();
```

### Adding Framework Utilities

Extend `TestFramework.js` with new helper methods:
```javascript
async customHelper() {
  // Implementation
}
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Cleanup**: Always clean up test data
3. **Assertions**: Use meaningful assertion messages
4. **Timeouts**: Set appropriate timeouts for async operations
5. **Logging**: Use appropriate log levels for clarity

## CI/CD Integration

The test suite can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Start Bot Service
  run: ./bot_control.sh start
  
- name: Run E2E Tests
  run: npm run test:e2e -- --fail-fast
  
- name: Upload Test Results
  if: failure()
  uses: actions/upload-artifact@v2
  with:
    name: test-results
    path: logs/
```