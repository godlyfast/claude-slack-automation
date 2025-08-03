/**
 * File Handling Scenarios
 * 
 * Tests file attachment processing:
 * - Text file analysis
 * - Code file processing
 * - PDF handling (limitations)
 * - Multiple file attachments
 * - Large file handling
 */

const path = require('path');

class FileHandlingScenarios {
  constructor(framework) {
    this.framework = framework;
  }
  
  async runAll() {
    await this.testTextFileAnalysis();
    await this.testCodeFileProcessing();
    await this.testPDFLimitations();
    await this.testMultipleFiles();
    await this.testLargeFile();
  }
  
  async testTextFileAnalysis() {
    await this.framework.runScenario('Text File Analysis', async () => {
      // Step 1: Create test file
      const filePath = await this.framework.step('Create test text file', async () => {
        const content = `PROJECT INFORMATION
==================

Project Name: TestBot Pro
Version: 3.1.4
Status: Production

STATISTICS:
- Active Users: 2,543
- Daily Requests: 15,432
- Average Response Time: 0.8s
- Uptime: 99.95%

CONFIGURATION:
- Primary Language: TypeScript
- Database: PostgreSQL
- Cache: Redis
- Deployment: Kubernetes

SECURITY:
- API Key: TEST-KEY-12345-ABCDEF
- Environment: Production
- SSL: Enabled
- Rate Limiting: 100 req/min

Please analyze this file and provide:
1. The project name and version
2. Number of active users
3. The API key`;
        
        return await this.framework.createTestFile('test_project_info.txt', content);
      });
      
      // Step 2: Create message with file
      const message = await this.framework.step('Create message with file attachment', async () => {
        return await this.framework.createTestMessage({
          text: 'AI Please analyze this project information file and answer the questions at the end.',
          hasAttachments: true,
          filePaths: [filePath]
        });
      });
      
      // Step 3: Process the message
      const result = await this.framework.step('Process message with file', async () => {
        const response = await this.framework.processMessages([message]);
        return response.results[0];
      });
      
      // Step 4: Verify file content extraction
      await this.framework.step('Verify correct information extracted', async () => {
        this.framework.assert(result.success, 'File processing should succeed');
        
        const response = result.response.toLowerCase();
        
        // Check for project name
        this.framework.assertContains(response, 'testbot pro', 'Should identify project name');
        
        // Check for version
        this.framework.assertContains(response, '3.1.4', 'Should identify version');
        
        // Check for user count
        this.framework.assertContains(response, '2,543', 'Should identify user count');
        
        // Check for API key
        this.framework.assertContains(response, 'test-key-12345-abcdef', 'Should identify API key');
      });
    });
  }
  
  async testCodeFileProcessing() {
    await this.framework.runScenario('Code File Analysis', async () => {
      const codeContent = `// UserService.js
class UserService {
  constructor(database) {
    this.db = database;
    this.cache = new Map();
  }
  
  async getUser(id) {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }
    
    // Query database
    const user = await this.db.query('SELECT * FROM users WHERE id = ?', [id]);
    
    if (user) {
      this.cache.set(id, user);
    }
    
    return user;
  }
  
  async createUser(data) {
    // Validate data
    if (!data.email || !data.name) {
      throw new Error('Email and name are required');
    }
    
    // Insert into database
    const result = await this.db.insert('users', data);
    return result.insertId;
  }
  
  clearCache() {
    this.cache.clear();
  }
}

module.exports = UserService;`;
      
      const filePath = await this.framework.step('Create JavaScript file', async () => {
        return await this.framework.createTestFile('UserService.js', codeContent);
      });
      
      const message = await this.framework.step('Create message asking about code', async () => {
        return await this.framework.createTestMessage({
          text: 'AI Can you review this code and tell me: 1) What pattern does it implement? 2) What are the main methods? 3) Are there any issues?',
          hasAttachments: true,
          filePaths: [filePath]
        });
      });
      
      const result = await this.framework.step('Process code review request', async () => {
        const response = await this.framework.processMessages([message]);
        return response.results[0];
      });
      
      await this.framework.step('Verify code analysis', async () => {
        this.framework.assert(result.success, 'Code analysis should succeed');
        
        const response = result.response.toLowerCase();
        
        // Should identify caching pattern
        this.framework.assert(
          response.includes('cache') || response.includes('caching'),
          'Should identify caching pattern'
        );
        
        // Should identify methods
        this.framework.assert(
          response.includes('getuser') && response.includes('createuser'),
          'Should identify main methods'
        );
        
        // Should provide some analysis
        this.framework.assert(
          response.length > 200,
          'Should provide detailed analysis'
        );
      });
    });
  }
  
  async testPDFLimitations() {
    await this.framework.runScenario('PDF File Limitations', async () => {
      // Note: We'll simulate a PDF by using a .pdf extension
      // In real scenario, this would be an actual PDF file
      const pdfPath = await this.framework.step('Create simulated PDF file', async () => {
        // Create a file with .pdf extension
        // In production, this would be actual PDF binary data
        const fakePdfPath = path.join(
          path.dirname(await this.framework.createTestFile('dummy.txt', 'temp')),
          'test_document.pdf'
        );
        
        // For testing, we'll use the existing PDF path from temp directory
        // or create a message that simulates PDF handling
        return '/fake/path/test_document.pdf';
      });
      
      const message = await this.framework.step('Create message with PDF', async () => {
        return await this.framework.createTestMessage({
          text: 'AI Can you analyze this PDF document?',
          hasAttachments: true,
          filePaths: [pdfPath]
        });
      });
      
      const result = await this.framework.step('Process PDF message', async () => {
        const response = await this.framework.processMessages([message]);
        return response.results[0];
      });
      
      await this.framework.step('Verify PDF limitation message', async () => {
        const response = result.response;
        
        // Should indicate PDF limitations
        this.framework.assert(
          response.includes('PDF') || 
          response.includes('unable') || 
          response.includes('cannot') ||
          response.includes('not available'),
          'Should indicate PDF processing limitations'
        );
      });
    });
  }
  
  async testMultipleFiles() {
    await this.framework.runScenario('Multiple File Attachments', async () => {
      // Create multiple files
      const files = await this.framework.step('Create 3 different files', async () => {
        const file1 = await this.framework.createTestFile('config.json', JSON.stringify({
          name: 'TestApp',
          version: '1.0.0',
          port: 3000,
          features: {
            auth: true,
            logging: true,
            cache: false
          }
        }, null, 2));
        
        const file2 = await this.framework.createTestFile('README.md', `# TestApp

## Overview
This is a test application for demonstration purposes.

## Features
- Authentication
- Logging
- Real-time updates

## Installation
\`\`\`bash
npm install
npm start
\`\`\`
`);
        
        const file3 = await this.framework.createTestFile('data.csv', `Name,Age,City
John Doe,30,New York
Jane Smith,25,San Francisco
Bob Johnson,35,Chicago`);
        
        return [file1, file2, file3];
      });
      
      const message = await this.framework.step('Create message with multiple files', async () => {
        return await this.framework.createTestMessage({
          text: 'AI Can you analyze these files and summarize what this project is about?',
          hasAttachments: true,
          filePaths: files
        });
      });
      
      const result = await this.framework.step('Process multi-file message', async () => {
        const response = await this.framework.processMessages([message]);
        return response.results[0];
      });
      
      await this.framework.step('Verify comprehensive analysis', async () => {
        this.framework.assert(result.success, 'Multi-file processing should succeed');
        
        const response = result.response.toLowerCase();
        
        // Should reference content from multiple files
        this.framework.assert(
          response.includes('testapp') || response.includes('test app'),
          'Should identify app name from config'
        );
        
        this.framework.assert(
          response.includes('auth') || response.includes('log'),
          'Should mention features'
        );
        
        // Should provide comprehensive summary
        this.framework.assert(
          response.length > 150,
          'Should provide substantial analysis of multiple files'
        );
      });
    });
  }
  
  async testLargeFile() {
    await this.framework.runScenario('Large File Handling', async () => {
      // Create a large text file (but within limits)
      const largeContent = await this.framework.step('Create large text file', async () => {
        const lines = [];
        for (let i = 1; i <= 1000; i++) {
          lines.push(`Line ${i}: This is test data for line number ${i} with some random content ${Math.random()}`);
        }
        
        const content = lines.join('\n');
        const filePath = await this.framework.createTestFile('large_file.txt', content);
        
        this.framework.log('detail', 'Large file size', `${content.length} bytes`);
        return filePath;
      });
      
      const message = await this.framework.step('Create message with large file', async () => {
        return await this.framework.createTestMessage({
          text: 'AI This is a large file. Can you tell me how many lines it has and what the first and last lines say?',
          hasAttachments: true,
          filePaths: [largeContent]
        });
      });
      
      const result = await this.framework.step('Process large file', async () => {
        const response = await this.framework.processMessages([message]);
        return response.results[0];
      });
      
      await this.framework.step('Verify large file handling', async () => {
        this.framework.assert(result.success, 'Large file processing should succeed');
        
        const response = result.response;
        
        // Should identify line count
        this.framework.assertContains(response, '1000', 'Should identify 1000 lines');
        
        // Should reference first line
        this.framework.assertContains(response, 'Line 1', 'Should reference first line');
        
        // Should reference last line
        this.framework.assertContains(response, 'Line 1000', 'Should reference last line');
      });
    });
  }
}

module.exports = FileHandlingScenarios;