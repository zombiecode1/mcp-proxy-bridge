import { MCPClient } from "mcp-use";

async function testLocalMCPServer() {
    const testResults = {
        serverName: "Local MCP Server",
        serverUrl: "https://zombiecoder.my.id/mcp",
        timestamp: new Date().toISOString(),
        connectionStatus: null,
        availableTools: [],
        availableResources: [],
        toolTests: [],
        resourceTests: [],
        errors: []
    };

    try {
        console.log("=".repeat(60));
        console.log("Testing Local MCP Server");
        console.log("URL: https://zombiecoder.my.id/mcp");
        console.log("=".repeat(60));

        const client = new MCPClient({
            mcpServers: {
                "local_mcp": {
                    "url": "https://zombiecoder.my.id/mcp"
                }
            }
        });

        // Create session
        console.log("\n1. Creating MCP session...");
        await client.createAllSessions();
        testResults.connectionStatus = "connected";
        console.log("✓ Session created successfully");

        const session = client.getSession("local_mcp");

        // List available tools
        console.log("\n2. Listing available tools...");
        const tools = await session.listTools();
        testResults.availableTools = tools.map(tool => ({
            name: tool.name,
            description: tool.description
        }));
        console.log(`✓ Found ${tools.length} tools:`);
        tools.forEach(tool => console.log(`  - ${tool.name}: ${tool.description}`));

        // List available resources
        console.log("\n3. Listing available resources...");
        const resourcesResponse = await session.listResources();

        // Handle different response formats
        let resources = [];
        if (Array.isArray(resourcesResponse)) {
            resources = resourcesResponse;
        } else if (resourcesResponse && resourcesResponse.resources && Array.isArray(resourcesResponse.resources)) {
            resources = resourcesResponse.resources;
        }

        if (resources.length > 0) {
            testResults.availableResources = resources.map(resource => ({
                name: resource.name,
                uri: resource.uri
            }));
            console.log(`✓ Found ${resources.length} resources:`);
            resources.forEach(resource => console.log(`  - ${resource.name}: ${resource.uri}`));
        } else {
            console.log(`✓ No resources found`);
            testResults.availableResources = [];
        }

        // Test tools if available
        if (tools.length > 0) {
            console.log("\n4. Testing tools...");
            for (const tool of tools) {
                try {
                    console.log(`  Testing tool: ${tool.name}`);
                    const toolTest = {
                        toolName: tool.name,
                        status: "skipped",
                        result: null,
                        error: null
                    };

                    // Skip tools that might require specific parameters
                    if (tool.name.includes("search") || tool.name.includes("query")) {
                        console.log(`    ⊘ Skipped (requires parameters)`);
                        testResults.toolTests.push(toolTest);
                        continue;
                    }

                    // Try calling tool with empty parameters
                    const result = await session.callTool(tool.name, {});
                    toolTest.status = "success";
                    toolTest.result = result;
                    console.log(`    ✓ Success`);
                    testResults.toolTests.push(toolTest);

                } catch (error) {
                    const toolTest = {
                        toolName: tool.name,
                        status: "error",
                        result: null,
                        error: error.message
                    };
                    console.log(`    ✗ Error: ${error.message}`);
                    testResults.toolTests.push(toolTest);
                }
            }
        }

        // Test resources if available
        if (Array.isArray(resources) && resources.length > 0) {
            console.log("\n5. Testing resources...");
            for (const resource of resources) {
                try {
                    console.log(`  Reading resource: ${resource.name}`);
                    const resourceTest = {
                        resourceName: resource.name,
                        uri: resource.uri,
                        status: "success",
                        content: null,
                        error: null
                    };

                    const content = await session.readResource(resource.uri);
                    resourceTest.content = content;
                    console.log(`    ✓ Success`);
                    console.log(`    Content type: ${typeof content}`);
                    testResults.resourceTests.push(resourceTest);

                } catch (error) {
                    const resourceTest = {
                        resourceName: resource.name,
                        uri: resource.uri,
                        status: "error",
                        content: null,
                        error: error.message
                    };
                    console.log(`    ✗ Error: ${error.message}`);
                    testResults.resourceTests.push(resourceTest);
                }
            }
        }

        // Cleanup
        console.log("\n6. Cleaning up session...");
        await client.closeAllSessions();
        console.log("✓ Session closed");

    } catch (error) {
        testResults.connectionStatus = "failed";
        testResults.errors.push({
            step: "connection",
            error: error.message
        });
        console.log(`✗ Connection failed: ${error.message}`);
    }

    // Print JSON results
    console.log("\n" + "=".repeat(60));
    console.log("TEST RESULTS (JSON)");
    console.log("=".repeat(60));
    console.log(JSON.stringify(testResults, null, 2));

    return testResults;
}

// Export function for use in master test runner
export { testLocalMCPServer };

// Run the test if called directly
testLocalMCPServer().catch(console.error);
