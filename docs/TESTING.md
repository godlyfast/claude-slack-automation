# 🧪 Testing Guide

Comprehensive testing documentation for the Claude Slack Bot.

## Test Suites Overview

The bot includes multiple levels of testing to ensure reliability:

1. **Unit Tests** - Component-level testing
2. **Integration Tests** - End-to-end functionality
3. **Manual Tests** - Quick verification scripts

## Unit Tests

Located in `slack-service/tests/`, these tests cover individual components.

### Running Unit Tests

```bash
cd slack-service

# Run all unit tests
npm test

# Run with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch

# Run specific test file
npm test slack-service.test.js
```

### Test Coverage

Current coverage includes:
- `slack-service.js` - Slack API interactions
- `db.js` - Database operations
- `file-handler.js` - File processing
- `loop-prevention.js` - Anti-loop system
- `cache.js` - Caching functionality
- `llm-processor.js` - LLM integration
- `api.js` - REST API endpoints

## End-to-End Tests

The E2E test suite provides comprehensive testing of real-world scenarios.

### Running E2E Tests

```bash
cd slack-service

# Run all E2E tests
npm run test:e2e

# Run specific scenarios
npm run test:e2e:basic      # Basic messaging
npm run test:e2e:files      # File handling
npm run test:e2e:advanced   # Advanced features

# Run with options
npm run test:e2e -- --verbose     # Detailed output
npm run test:e2e -- --quiet       # Minimal output
npm run test:e2e -- --fail-fast   # Stop on first failure
```

### E2E Test Scenarios

#### Basic Messaging (5 tests)
- Simple message processing
- Ukrainian keyword detection (ШІ)
- Thread reply handling
- Messages without keywords ignored
- Batch message processing

#### File Handling (5 tests)
- Text file analysis
- Code file processing
- PDF limitations
- Multiple file attachments
- Large file handling

#### Advanced Features (5 tests)
- Loop prevention system
- Rate limiting enforcement
- MCP message handling
- Cache functionality
- Error recovery

### Test Framework Features

The E2E test framework (`tests/integration/TestFramework.js`) provides:

- **Scenario Management**: Organize tests into logical groups
- **Step Tracking**: Break down tests into verifiable steps
- **Verbose Logging**: Color-coded output for easy debugging
- **Database Helpers**: Direct database manipulation for testing
- **API Helpers**: Simplified HTTP requests to service endpoints
- **Assertions**: Clear, meaningful test assertions
- **Reporting**: Comprehensive test results with timing

### Writing New E2E Tests

Example test scenario:

```javascript
await framework.runScenario('My Test Scenario', async () => {
  // Step 1: Setup
  const message = await framework.step('Create test message', async () => {
    return await framework.createTestMessage({
      text: 'AI Test question?'
    });
  });
  
  // Step 2: Action
  const result = await framework.step('Process message', async () => {
    return await framework.processMessages([message]);
  });
  
  // Step 3: Verify
  await framework.step('Verify response', async () => {
    framework.assert(result.success, 'Processing should succeed');
    framework.assertContains(
      result.response,
      'expected text',
      'Response should contain expected text'
    );
  });
});
```

## Manual Testing

Quick verification scripts for specific functionality.

### Bot Operation Test

```bash
# Test single bot cycle
./queue_operations.sh priority

# Test with specific operation
./queue_operations.sh fetch   # Fetch only
./queue_operations.sh process # Process only
./queue_operations.sh send    # Send only
```

### Service Health Check

```bash
# Check service status
curl http://localhost:3030/health

# Check pending messages
curl http://localhost:3030/queue/messages/pending

# Check rate limit status
curl http://localhost:3030/rate-limit/status
```

### Integration Test Scripts

```bash
# Simple integration test (no Slack posting)
./test_integration_simple.sh

# Safe integration test
./test_integration_safe.sh

# Cleanup test messages
./test_integration_cleanup.sh
```

## Test Database

The test suite uses the same SQLite database as production but with test-specific prefixes:

- Test messages use IDs starting with `test-`
- Test users use IDs starting with `TEST_`
- Automatic cleanup after tests

## Continuous Integration

The test suite is designed for CI/CD integration:

```yaml
# Example GitHub Actions
- name: Install Dependencies
  run: cd slack-service && npm install

- name: Run Unit Tests
  run: cd slack-service && npm test

- name: Start Service
  run: cd slack-service && npm start &

- name: Run E2E Tests
  run: cd slack-service && npm run test:e2e -- --fail-fast
```

## Troubleshooting Tests

### Common Test Issues

1. **Service not running**
   ```bash
   Error: Service not available at http://localhost:3030
   Solution: ./bot_control.sh start
   ```

2. **Database locked**
   ```bash
   Error: SQLITE_BUSY: database is locked
   Solution: Stop other processes using the database
   ```

3. **Test data conflicts**
   ```bash
   Error: UNIQUE constraint failed
   Solution: Clean test data before running
   ```

### Debug Mode

Enable verbose logging for debugging:

```bash
# Set log level
export LOG_LEVEL=debug

# Run tests with full output
npm run test:e2e -- --verbose
```

### Test Artifacts

Test results and logs are saved in:
- `slack-service/logs/` - Service logs during tests
- `slack-service/coverage/` - Code coverage reports
- `slack-service/tests/integration/fixtures/` - Test files

## Best Practices

1. **Run tests before commits** - Ensure changes don't break functionality
2. **Keep tests isolated** - Each test should be independent
3. **Use meaningful names** - Test names should describe what they verify
4. **Clean up after tests** - Remove test data and files
5. **Test edge cases** - Include error scenarios and boundary conditions

## Performance Testing

For load testing and performance verification:

```bash
# Run performance scenario
npm run test:e2e -- --scenario performance

# Custom load test
node tests/integration/run-e2e-tests.js --scenario performance --verbose
```

This tests:
- Concurrent message processing
- Large channel history handling
- Response time metrics
- Memory usage patterns