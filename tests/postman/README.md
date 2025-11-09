# Postman Collection for TTS API

This directory contains a Postman collection for testing the TTS Project API.

## 📦 Collection File

- **`TTS_API.postman_collection.json`** - Complete Postman collection with all API endpoints

## 🚀 Quick Start

### 1. Import Collection

1. Open Postman
2. Click **Import** button
3. Select `TTS_API.postman_collection.json`
4. Collection will be imported with all requests

### 2. Set Environment Variables

The collection uses the following variables:

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `base_url` | `http://localhost:8085` | Base URL for API requests |
| `conversation_id` | (auto-set) | Conversation ID for chat requests |
| `long_text` | (auto-generated) | Long text for validation tests |

**To set variables:**
1. Click on the collection
2. Go to **Variables** tab
3. Update `base_url` if your server runs on a different port
4. Variables are automatically set during test execution

### 3. Start the Server

```bash
# Start the TTS server
cargo run -p server
```

The server should be running on `http://localhost:8085`

### 4. Run Requests

1. Open the collection in Postman
2. Select a request
3. Click **Send**
4. View response and test results

## 📋 Collection Structure

### Health & Information
- **Health Check** - Verify server is running
- **List Available Voices** - Get list of supported languages
- **List Voices Detail** - Get detailed voice information

### Text-to-Speech
- **Synthesize Speech - German** - Test German TTS
- **Synthesize Speech - French** - Test French TTS
- **Synthesize Speech - No Language** - Test default language
- **TTS - Validation Error (Empty Text)** - Test empty text validation
- **TTS - Validation Error (Text Too Long)** - Test text length validation
- **TTS - Validation Error (Invalid Language)** - Test language code validation

### Chat
- **Chat - New Conversation** - Start new conversation
- **Chat - Continue Conversation** - Continue existing conversation
- **Chat - Validation Error (Empty Message)** - Test empty message validation
- **Chat - Validation Error (Invalid Conversation ID)** - Test UUID validation

## ✅ Test Scripts

Each request includes automated test scripts that verify:
- HTTP status codes
- Response structure
- Data types
- Business logic validation

### Example Test Script

```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response contains audio", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('audio_base64');
});
```

## 🔄 Automated Workflows

### Conversation Flow

1. **Chat - New Conversation** creates a conversation and saves the `conversation_id`
2. **Chat - Continue Conversation** uses the saved `conversation_id` to continue the conversation

The `conversation_id` is automatically saved to the environment variable for subsequent requests.

## 📊 Running the Collection

### Run All Requests

1. Click on the collection
2. Click **Run** button
3. Select requests to run
4. Click **Run TTS API Collection**
5. View test results

### Run Individual Requests

1. Select a request
2. Click **Send**
3. View response in **Body** tab
4. View test results in **Test Results** tab

## 🔧 Customization

### Change Base URL

1. Click on collection
2. Go to **Variables** tab
3. Update `base_url` value
4. All requests will use the new URL

### Add New Requests

1. Right-click on a folder
2. Select **Add Request**
3. Configure request (method, URL, headers, body)
4. Add test scripts in **Tests** tab

## 📝 Request Examples

### Health Check

```http
GET http://localhost:8085/health
```

### Synthesize Speech

```http
POST http://localhost:8085/tts
Content-Type: application/json

{
    "text": "Hello, world!",
    "language": "de_DE"
}
```

### Chat

```http
POST http://localhost:8085/chat
Content-Type: application/json

{
    "message": "Hello, how are you?",
    "conversation_id": null
}
```

## 🐛 Troubleshooting

### Server Not Responding

1. Verify server is running: `curl http://localhost:8085/health`
2. Check server logs for errors
3. Verify port 8085 is not in use

### Test Failures

1. Check response status code
2. Verify response structure matches expected format
3. Check server logs for errors
4. Verify environment variables are set correctly

### Conversation ID Issues

1. Ensure "Chat - New Conversation" runs first
2. Check that `conversation_id` is saved in environment
3. Verify UUID format is correct

## 📚 Additional Resources

- [Postman Documentation](https://learning.postman.com/docs/)
- [API Documentation](../../README.md)
- [Quick Start Guide](../../QUICKSTART.md)

---

**Collection Version:** 1.0  
**Last Updated:** 2024  
**Server Port:** 8085

