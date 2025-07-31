const FileHandler = require('../src/file-handler');
const path = require('path');
const fs = require('fs').promises;

describe('FileHandler', () => {
  let fileHandler;
  
  beforeEach(() => {
    fileHandler = new FileHandler('test-token');
  });

  describe('getFileExtension', () => {
    test('should extract file extensions correctly', () => {
      expect(fileHandler.getFileExtension('test.txt')).toBe('txt');
      expect(fileHandler.getFileExtension('image.PNG')).toBe('png');
      expect(fileHandler.getFileExtension('script.js')).toBe('js');
      expect(fileHandler.getFileExtension('file.tar.gz')).toBe('gz');
    });
  });

  describe('getFileType', () => {
    test('should categorize file types correctly', () => {
      expect(fileHandler.getFileType('txt')).toBe('text');
      expect(fileHandler.getFileType('js')).toBe('code');
      expect(fileHandler.getFileType('png')).toBe('image');
      expect(fileHandler.getFileType('pdf')).toBe('document');
      expect(fileHandler.getFileType('unknown')).toBe(null);
    });
  });

  describe('getFileMetadata', () => {
    test('should extract metadata from Slack file object', () => {
      const slackFile = {
        id: 'F123456',
        name: 'test.txt',
        title: 'Test File',
        mimetype: 'text/plain',
        size: 1024,
        created: 1234567890,
        user: 'U123456',
        mode: 'hosted',
        is_external: false,
        permalink: 'https://slack.com/file/123',
        pretty_type: 'Plain Text'
      };

      const metadata = fileHandler.getFileMetadata(slackFile);
      
      expect(metadata.id).toBe('F123456');
      expect(metadata.name).toBe('test.txt');
      expect(metadata.size).toBe(1024);
      expect(metadata.mimetype).toBe('text/plain');
    });
  });

  describe('processAttachments', () => {
    test('should return empty array for message without files', async () => {
      const message = { text: 'Hello world' };
      const result = await fileHandler.processAttachments(message);
      expect(result).toEqual([]);
    });

    test('should process unsupported file types', async () => {
      const message = {
        files: [{
          id: 'F123',
          name: 'document.docx',
          size: 1024,
          mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        }]
      };

      const result = await fileHandler.processAttachments(message);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('unsupported');
      expect(result[0].name).toBe('document.docx');
      expect(result[0].extension).toBe('docx');
    });

    test('should handle files that are too large', async () => {
      const message = {
        files: [{
          id: 'F123',
          name: 'large.txt',
          size: 11 * 1024 * 1024, // 11MB
          mimetype: 'text/plain'
        }]
      };

      const result = await fileHandler.processAttachments(message);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('error');
      expect(result[0].error).toBe('File too large (max 10MB)');
    });
  });

  describe('formatAttachmentsForClaude', () => {
    test('should return empty object for no attachments', () => {
      const result = fileHandler.formatAttachmentsForClaude([]);
      expect(result).toEqual({ context: '', filePaths: [] });
    });

    test('should format text file attachments', () => {
      const attachments = [{
        name: 'script.js',
        type: 'code',
        extension: 'js',
        size: 500,
        content: 'console.log("Hello world");'
      }];

      const result = fileHandler.formatAttachmentsForClaude(attachments);
      expect(result.context).toContain('📎 **Message Attachments:**');
      expect(result.context).toContain('**script.js**');
      expect(result.context).toContain('```js');
      expect(result.context).toContain('console.log("Hello world");');
    });

    test('should format image attachments', () => {
      const attachments = [{
        name: 'photo.png',
        type: 'image',
        extension: 'png',
        size: 2048,
        content: { type: 'image', data: 'base64data', mimeType: 'image/png' }
      }];

      const result = fileHandler.formatAttachmentsForClaude(attachments);
      expect(result.context).toContain('**photo.png**');
      expect(result.context).toContain('[File processing incomplete - photo.png]');
    });

    test('should format error attachments', () => {
      const attachments = [{
        name: 'error.txt',
        type: 'error',
        error: 'File too large (max 10MB)'
      }];

      const result = fileHandler.formatAttachmentsForClaude(attachments);
      expect(result.context).toContain('**error.txt**');
      expect(result.context).toContain('❌ File too large (max 10MB)');
    });

    test('should format unsupported attachments', () => {
      const attachments = [{
        name: 'document.docx',
        type: 'unsupported',
        extension: 'docx'
      }];

      const result = fileHandler.formatAttachmentsForClaude(attachments);
      expect(result.context).toContain('**document.docx**');
      expect(result.context).toContain('⚠️ Unsupported file type (.docx)');
    });
  });

  describe('formatFileSize', () => {
    test('should format file sizes correctly', () => {
      expect(fileHandler.formatFileSize(500)).toBe('500 B');
      expect(fileHandler.formatFileSize(1536)).toBe('1.5 KB');
      expect(fileHandler.formatFileSize(2097152)).toBe('2.0 MB');
    });
  });
});