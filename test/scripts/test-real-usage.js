import { MCPClient } from "mcp-use";
import fs from 'fs';

async function testRealWorldUsage() {
    const testResults = {
        testName: "Real-World Usage Scenarios",
        serverUrl: "https://s.zombiecoder.my.id/mcp",
        timestamp: new Date().toISOString(),
        scenarios: [],
        summary: {
            totalScenarios: 0,
            passed: 0,
            failed: 0
        }
    };

    try {
        console.log("╔" + "═".repeat(58) + "╗");
        console.log("║" + " ".repeat(10) + "REAL-WORLD USAGE SCENARIOS" + " ".repeat(21) + "║");
        console.log("╚" + "═".repeat(58) + "╝");
        console.log("");

        const client = new MCPClient({
            mcpServers: {
                "zombiecoder": {
                    "url": "https://s.zombiecoder.my.id/mcp"
                }
            }
        });

        console.log("1. Connecting to ZombieCoder MCP server...");
        await client.createAllSessions();
        console.log("✓ Connected successfully");

        const session = client.getSession("zombiecoder");

        // Scenario 1: Check Project Status
        console.log("\n▶ Scenario 1: Developer checks project status");
        const scenario1 = {
            name: "Check Project Status",
            description: "Developer wants to know the current status of agent, RAG, and index",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario1.steps.push("Calling project_status tool");
            const statusResult = await session.callTool("project_status", {});
            scenario1.result = statusResult;
            scenario1.status = "success";
            console.log("✓ Project status retrieved successfully");
            console.log(`  Response: ${JSON.stringify(statusResult).substring(0, 200)}...`);
            testResults.summary.passed++;
        } catch (error) {
            scenario1.status = "failed";
            scenario1.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario1);
        testResults.summary.totalScenarios++;

        // Scenario 2: Create a new conversation
        console.log("\n▶ Scenario 2: User starts a new conversation");
        const scenario2 = {
            name: "Create New Conversation",
            description: "User wants to start a new conversation for their project",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario2.steps.push("Calling conversation_create tool");
            const conversationResult = await session.callTool("conversation_create", {});
            scenario2.result = conversationResult;
            scenario2.status = "success";
            console.log("✓ New conversation created successfully");
            console.log(`  Conversation ID: ${JSON.stringify(conversationResult).substring(0, 100)}...`);
            testResults.summary.passed++;
        } catch (error) {
            scenario2.status = "failed";
            scenario2.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario2);
        testResults.summary.totalScenarios++;

        // Scenario 3: List all conversations
        console.log("\n▶ Scenario 3: User views conversation history");
        const scenario3 = {
            name: "List Conversations",
            description: "User wants to see all their conversations",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario3.steps.push("Calling conversation_list tool");
            const listResult = await session.callTool("conversation_list", {});
            scenario3.result = listResult;
            scenario3.status = "success";
            console.log("✓ Conversation list retrieved successfully");
            
            // Parse the conversation list
            const conversationsData = JSON.parse(listResult.content[0].text);
            console.log(`  Total conversations: ${conversationsData.length}`);
            testResults.summary.passed++;
        } catch (error) {
            scenario3.status = "failed";
            scenario3.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario3);
        testResults.summary.totalScenarios++;

        // Scenario 4: Read agent routes
        console.log("\n▶ Scenario 4: Developer checks available agent routes");
        const scenario4 = {
            name: "Check Agent Routes",
            description: "Developer wants to know what routing decisions are available",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario4.steps.push("Calling agent_routes tool");
            const routesResult = await session.callTool("agent_routes", {});
            scenario4.result = routesResult;
            scenario4.status = "success";
            console.log("✓ Agent routes retrieved successfully");
            console.log(`  Response: ${JSON.stringify(routesResult).substring(0, 200)}...`);
            testResults.summary.passed++;
        } catch (error) {
            scenario4.status = "failed";
            scenario4.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario4);
        testResults.summary.totalScenarios++;

        // Scenario 5: Read SSOT
        console.log("\n▶ Scenario 5: User reads Single Source of Truth");
        const scenario5 = {
            name: "Read SSOT",
            description: "User wants to read the current SSOT file",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario5.steps.push("Calling ssot_read tool");
            const ssotResult = await session.callTool("ssot_read", {});
            scenario5.result = ssotResult;
            scenario5.status = "success";
            console.log("✓ SSOT read successfully");
            console.log(`  Response: ${JSON.stringify(ssotResult).substring(0, 200)}...`);
            testResults.summary.passed++;
        } catch (error) {
            scenario5.status = "failed";
            scenario5.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario5);
        testResults.summary.totalScenarios++;

        // Scenario 6: Read Agent Status Resource
        console.log("\n▶ Scenario 6: Monitor reads agent status from resources");
        const scenario6 = {
            name: "Read Agent Status Resource",
            description: "Monitoring system reads agent status via resource endpoint",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario6.steps.push("Reading zombiecoder://status resource");
            const statusResource = await session.readResource("zombiecoder://status");
            scenario6.result = statusResource;
            scenario6.status = "success";
            console.log("✓ Agent status resource read successfully");
            console.log(`  Response type: ${typeof statusResource}`);
            testResults.summary.passed++;
        } catch (error) {
            scenario6.status = "failed";
            scenario6.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario6);
        testResults.summary.totalScenarios++;

        // Scenario 7: Read Vector Index Stats
        console.log("\n▶ Scenario 7: Admin checks vector index statistics");
        const scenario7 = {
            name: "Read Vector Index Stats",
            description: "Administrator checks the vector index performance metrics",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario7.steps.push("Reading zombiecoder://index resource");
            const indexResource = await session.readResource("zombiecoder://index");
            scenario7.result = indexResource;
            scenario7.status = "success";
            console.log("✓ Vector index stats read successfully");
            console.log(`  Response type: ${typeof indexResource}`);
            testResults.summary.passed++;
        } catch (error) {
            scenario7.status = "failed";
            scenario7.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario7);
        testResults.summary.totalScenarios++;

        // Scenario 8: Read Conversation List Resource
        console.log("\n▶ Scenario 8: Analytics reads conversation data");
        const scenario8 = {
            name: "Read Conversation List Resource",
            description: "Analytics system reads conversation list for reporting",
            steps: [],
            result: null,
            status: "pending"
        };

        try {
            scenario8.steps.push("Reading zombiecoder://conversations resource");
            const conversationsResource = await session.readResource("zombiecoder://conversations");
            scenario8.result = conversationsResource;
            scenario8.status = "success";
            console.log("✓ Conversation list resource read successfully");
            console.log(`  Response type: ${typeof conversationsResource}`);
            testResults.summary.passed++;
        } catch (error) {
            scenario8.status = "failed";
            scenario8.error = error.message;
            console.log(`✗ Failed: ${error.message}`);
            testResults.summary.failed++;
        }

        testResults.scenarios.push(scenario8);
        testResults.summary.totalScenarios++;

        // Cleanup
        console.log("\n9. Cleaning up session...");
        await client.closeAllSessions();
        console.log("✓ Session closed");

    } catch (error) {
        console.log(`✗ Connection failed: ${error.message}`);
        testResults.errors = [{ error: error.message }];
    }

    // Print summary
    console.log("\n" + "╔" + "═".repeat(58) + "╗");
    console.log("║" + " ".repeat(18) + "SUMMARY" + " ".repeat(28) + "║");
    console.log("╚" + "═".repeat(58) + "╝");
    console.log(`Total Scenarios: ${testResults.summary.totalScenarios}`);
    console.log(`Passed: ${testResults.summary.passed}`);
    console.log(`Failed: ${testResults.summary.failed}`);
    console.log(`Success Rate: ${((testResults.summary.passed / testResults.summary.totalScenarios) * 100).toFixed(1)}%`);

    // Print JSON results
    console.log("\n" + "=".repeat(60));
    console.log("REAL-WORLD USAGE TEST RESULTS (JSON)");
    console.log("=".repeat(60));
    console.log(JSON.stringify(testResults, null, 2));

    // Save to file
    const reportFileName = `real-usage-test-${Date.now()}.json`;
    fs.writeFileSync(reportFileName, JSON.stringify(testResults, null, 2));
    console.log(`\nReport saved to: ${reportFileName}`);

    return testResults;
}

// Run the test
testRealWorldUsage().catch(console.error);
