# 📎 File Attachment Processing

The Claude Slack Bot now supports reading and processing file attachments from Slack messages! The bot can analyze text files, code files, images, and more.

## 🎯 Supported File Types

### ✅ Fully Supported (Content Analysis)

**Code Files:**
- `.js`, `.ts`, `.jsx`, `.tsx` - JavaScript/TypeScript
- `.py` - Python scripts
- `.sh` - Shell scripts
- `.go` - Go source code
- `.rs` - Rust source code
- `.cpp`, `.c` - C/C++ source code
- `.java` - Java source code

**Text Files:**
- `.txt` - Plain text files
- `.md` - Markdown documents
- `.json` - JSON data files
- `.yml`, `.yaml` - YAML configuration files
- `.xml` - XML documents
- `.csv` - CSV data files

**Images:** *(Visual analysis ready)*
- `.png`, `.jpg`, `.jpeg` - Standard image formats
- `.gif` - Animated images
- `.webp` - Modern image format

### ⚠️ Limited Support

**Documents:**
- `.pdf` - Limited support depending on LLM provider:
  - **Google Gemini**: Cannot analyze PDF content (will inform user)
  - **Anthropic/OpenAI**: Better PDF support
  - **Claude Code CLI**: Can read PDFs

### ❌ Unsupported
- `.docx`, `.xlsx`, `.pptx` - Microsoft Office documents
- `.zip`, `.tar`, `.gz` - Archive files
- `.mp4`, `.mov`, `.avi` - Video files
- `.mp3`, `.wav` - Audio files

## 🚀 How It Works

### 1. **Automatic Detection**
When a message contains file attachments, the bot automatically:
- Detects attached files
- Downloads supported file types (up to 10MB each)
- Analyzes file content
- Includes content in the response context

### 2. **Content Processing**
- **Text/Code Files**: Full content is read and included in context
- **Images**: Downloaded and prepared for visual analysis
- **Large Files**: Rejected with helpful error message
- **Unsupported Types**: Acknowledged but not processed

### 3. **Claude Integration**
File content is seamlessly integrated into Claude's context:
```
Current message: Hey AI, can you review this code?

📎 **Message Attachments:**

**app.js** (code, 2.4 KB)
```js
const express = require('express');
const app = express();
// ... rest of code
```
```

## 💻 Usage Examples

### Code Review
**User uploads:** `bug-fix.js`
**Bot response:** "I can see the JavaScript code you've uploaded. The bug fix looks good, but I noticed a potential issue on line 15..."

### Data Analysis
**User uploads:** `sales-data.csv`
**Bot response:** "I can see your CSV data with sales figures. Based on the data, here are some insights..."

### Image Analysis
**User uploads:** `chart.png`
**Bot response:** "I can see the chart image you've shared. The trends show..."

### Documentation Review
**User uploads:** `README.md`
**Bot response:** "I've reviewed your README file. The documentation is comprehensive, but you might want to add..."

## 🔧 Configuration

### File Size Limits
- **Maximum file size**: 10MB per file
- **Multiple files**: All files in a message are processed
- **Memory management**: Temporary files are cleaned up automatically

### Security Features
- **Token-based downloads**: Uses Slack bot token for secure file access
- **Temporary storage**: Files are downloaded to secure temp directory
- **Auto-cleanup**: Temporary files are deleted after 1 hour

### Reliability Features
- **Retry logic**: Failed downloads are retried up to 3 times with increasing delays
- **Graceful degradation**: Bot responds even when some/all files fail to process
- **Error transparency**: Users see specific error messages for failed files
- **Thread safety**: File processing errors don't prevent thread responses
- **Size validation**: Files are checked for size limits during download to prevent memory issues

## 🔍 Technical Details

### API Endpoints

**Get supported file types:**
```bash
curl http://localhost:3030/attachments/supported-types
```

**Response:**
```json
{
  "success": true,
  "supportedTypes": {
    "code": ["js", "py", "sh", "ts", "jsx", "tsx", "go", "rs", "cpp", "c", "java"],
    "text": ["txt", "md", "json", "yml", "yaml", "xml", "csv"],
    "image": ["png", "jpg", "jpeg", "gif", "webp"],
    "document": ["pdf"]
  },
  "maxFileSize": 10485760,
  "maxFileSizeMB": 10
}
```

### Message Object Structure
Messages with attachments include additional fields:
```json
{
  "id": "channel-123456",
  "text": "Can you review this code?",
  "attachments": [
    {
      "name": "app.js",
      "type": "code",
      "extension": "js",
      "size": 2048,
      "content": "const express = require('express');...",
      "metadata": { "id": "F123456", "mimetype": "text/javascript" }
    }
  ],
  "attachmentContext": "\n\n📎 **Message Attachments:**...",
  "hasAttachments": true
}
```

### File Processing Pipeline
1. **Detection**: Check for `message.files` array
2. **Validation**: File size and type checking
3. **Download**: Secure download using Slack API
4. **Processing**: Content extraction based on file type
5. **Context**: Format for Claude integration
6. **Cleanup**: Remove temporary files

## 🐛 Error Handling

### Common Issues

**File too large:**
```
📎 **Message Attachments:**
**large-file.txt** - ❌ File too large (max 10MB)
```

**Unsupported file type:**
```
📎 **Message Attachments:**
**document.docx** - ⚠️ Unsupported file type (.docx)
```

**Download failures (with specific error messages):**
```
📎 **Message Attachments:**
**restricted.pdf** - ❌ Processing failed: HTTP 403: Forbidden - Token may lack file access permissions
**missing.pdf** - ❌ Processing failed: HTTP 404: Not Found - File not found or expired
**large.pdf** - ❌ Processing failed: Download timeout (45s) - file may be too large or network slow
```

**Network issues:**
```
📎 **Message Attachments:**
**example.pdf** - ❌ Processing failed: Network error: ECONNREFUSED
```

### Troubleshooting

1. **Bot can't access files**: Ensure bot has proper Slack permissions
2. **Files not processing**: Check service logs for download errors
3. **Large files rejected**: Use file sharing services for files >10MB
4. **Unsupported formats**: Convert to supported format (e.g., .docx → .txt)

## 🔐 Permissions Required

The bot needs these Slack permissions to process files:
- `files:read` - Read file metadata
- `files:write` - Access file content (for user tokens)
- Access to channels where files are shared

## 🚀 Recent Improvements

- **Better error handling**: Clear messages when files can't be processed
- **PDF awareness**: Bot now explicitly states PDF limitations with Google Gemini
- **Multiple LLM support**: Different providers have different file capabilities
- **Improved file filtering**: Security improvements for channel-specific files
- **E2E test coverage**: Comprehensive testing for file handling scenarios

## 💡 Tips for Users

1. **Code reviews**: Upload your code files directly for instant analysis
2. **Data questions**: Share .csv or .json files for data insights
3. **Image analysis**: Upload charts, diagrams, or screenshots
4. **Documentation**: Share .md files for writing feedback
5. **Multiple files**: Upload multiple related files in one message

The bot will analyze all files and provide comprehensive responses based on their content!