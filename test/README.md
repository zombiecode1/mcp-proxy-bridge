# MCP Server Test Suite

Comprehensive testing suite for MCP (Model Context Protocol) servers with JSON output for all tests.

## Overview

This test suite provides automated testing for 4 MCP servers with real-world usage scenarios and detailed JSON reporting.

## Tested Servers

1. **Auto-connected Server** - http://localhost:3000/mcp
2. **Local MCP Server** - https://zombiecoder.my.id/mcp  
3. **Proxy Bridge** - https://zombiecoder.my.id/sse
4. **Proxy Server** (Main) - https://s.zombiecoder.my.id/mcp ⭐

## Prerequisites

```bash
npm install
```

## Test Scripts

### Individual Server Tests

- `test-auto-connected.js` - Tests Auto-connected Server
- `test-local-mcp.js` - Tests Local MCP Server
- `test-proxy-bridge.js` - Tests Proxy Bridge
- `test-proxy.js` - Tests Main Proxy Server

### Real-World Usage Tests

- `test-real-usage.js` - Tests realistic user scenarios on main server

### Master Test Runner

- `run-all-tests.js` - Runs all server tests and generates comprehensive report

## Running Tests

### Run Individual Tests

```bash
# Test specific server
node test-auto-connected.js
node test-local-mcp.js
node test-proxy-bridge.js
node test-proxy.js

# Test real-world scenarios
node test-real-usage.js
```

### Run All Tests

```bash
node run-all-tests.js
```

### Using npm scripts

```bash
# Individual tests
npm run test:auto
npm run test:local
npm run test:proxy-bridge
npm run test:proxy

# All tests
npm run test:all
```

## Test Output

Each test script outputs:

1. **Console Output** - Human-readable test progress and results
2. **JSON Output** - Machine-readable test results (printed at end)
3. **Report Files** - JSON reports saved to disk with timestamps

### JSON Output Format

Each test generates structured JSON including:

```json
{
  "serverName": "Server Name",
  "serverUrl": "https://...",
  "timestamp": "2026-06-02T...",
  "connectionStatus": "connected",
  "availableTools": [
    {
      "name": "tool_name",
      "description": "Tool description"
    }
  ],
  "availableResources": [
    {
      "name": "resource_name",
      "uri": "resource://uri"
    }
  ],
  "toolTests": [
    {
      "toolName": "tool_name",
      "status": "success",
      "result": {...},
      "error": null
    }
  ],
  "resourceTests": [
    {
      "resourceName": "resource_name",
      "uri": "resource://uri",
      "status": "success", 
      "content": {...},
      "error": null
    }
  ],
  "errors": []
}
```

## Test Coverage

### Server Connection Tests
- MCP session creation
- Tool listing
- Resource listing
- Session cleanup

### Tool Functionality Tests
- Tool availability verification
- Tool execution with parameters
- Error handling for missing parameters
- Response validation

### Resource Access Tests
- Resource availability verification
- Resource reading
- Content validation
- Error handling

### Real-World Scenarios (test-real-usage.js)
- Developer checking project status
- User creating conversations
- User viewing conversation history
- Developer checking agent routes
- User reading SSOT
- Monitor reading agent status
- Admin checking vector index stats
- Analytics reading conversation data

## Report Files

Generated report files:

- `COMPREHENSIVE-TEST-REPORT.md` - Detailed markdown report
- `test-report-<timestamp>.json` - Master test results JSON
- `real-usage-test-<timestamp>.json` - Real-world usage test results JSON

## Key Findings Summary

**Main Server (https://s.zombiecoder.my.id/mcp):**
- 8 tools available
- 4 resources available  
- 100% success rate on real-world scenarios
- Full ZombieCoder platform functionality

**Other Servers:**
- 3 basic agent tools each
- No resources available
- Suitable for simple agent execution

## User Experience

The tests demonstrate typical user workflows:

1. **Check system status** using `project_status` tool
2. **Create conversations** using `conversation_create` tool
3. **Search indexed workspaces** using `workspace_index` and `workspace_search`
4. **Monitor performance** using resource endpoints
5. **Review history** using `conversation_list` and `conversation_history`

## Troubleshooting

### Connection Issues
- Verify server URLs are accessible
- Check network connectivity
- Ensure MCP server is running

### Dependency Issues
```bash
npm install
```

### JSON Parsing Errors
- Ensure all test output includes JSON at the end
- Check for truncated output in terminal
- Review saved JSON report files

## Support

For detailed analysis, see `COMPREHENSIVE-TEST-REPORT.md`

## License

ISC
