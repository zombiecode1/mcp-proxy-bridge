import { testAutoConnectedServer } from './test-auto-connected.js';
import { testLocalMCPServer } from './test-local-mcp.js';
import { testProxyBridgeServer } from './test-proxy-bridge.js';
import { testProxyServer } from './test-proxy.js';
import fs from 'fs';

async function runAllTests() {
    const masterReport = {
        testRunId: Date.now(),
        timestamp: new Date().toISOString(),
        summary: {
            totalTests: 4,
            passed: 0,
            failed: 0,
            errors: []
        },
        servers: []
    };

    console.log("╔" + "═".repeat(58) + "╗");
    console.log("║" + " ".repeat(15) + "MCP SERVER TEST SUITE" + " ".repeat(21) + "║");
    console.log("╚" + "═".repeat(58) + "╝");
    console.log("");

    // Test 1: Auto-connected Server
    try {
        console.log("\n▶ Running Test 1/4: Auto-connected Server");
        const result1 = await testAutoConnectedServer();
        masterReport.servers.push(result1);
        if (result1.connectionStatus === "connected") {
            masterReport.summary.passed++;
        } else {
            masterReport.summary.failed++;
        }
    } catch (error) {
        masterReport.summary.failed++;
        masterReport.summary.errors.push({
            server: "Auto-connected Server",
            error: error.message
        });
    }

    // Test 2: Local MCP Server
    try {
        console.log("\n▶ Running Test 2/4: Local MCP Server");
        const result2 = await testLocalMCPServer();
        masterReport.servers.push(result2);
        if (result2.connectionStatus === "connected") {
            masterReport.summary.passed++;
        } else {
            masterReport.summary.failed++;
        }
    } catch (error) {
        masterReport.summary.failed++;
        masterReport.summary.errors.push({
            server: "Local MCP Server",
            error: error.message
        });
    }

    // Test 3: Proxy Bridge
    try {
        console.log("\n▶ Running Test 3/4: Proxy Bridge");
        const result3 = await testProxyBridgeServer();
        masterReport.servers.push(result3);
        if (result3.connectionStatus === "connected") {
            masterReport.summary.passed++;
        } else {
            masterReport.summary.failed++;
        }
    } catch (error) {
        masterReport.summary.failed++;
        masterReport.summary.errors.push({
            server: "Proxy Bridge",
            error: error.message
        });
    }

    // Test 4: Proxy Server
    try {
        console.log("\n▶ Running Test 4/4: Proxy Server");
        const result4 = await testProxyServer();
        masterReport.servers.push(result4);
        if (result4.connectionStatus === "connected") {
            masterReport.summary.passed++;
        } else {
            masterReport.summary.failed++;
        }
    } catch (error) {
        masterReport.summary.failed++;
        masterReport.summary.errors.push({
            server: "Proxy Server",
            error: error.message
        });
    }

    // Print final summary
    console.log("\n" + "╔" + "═".repeat(58) + "╗");
    console.log("║" + " ".repeat(18) + "FINAL SUMMARY" + " ".repeat(26) + "║");
    console.log("╚" + "═".repeat(58) + "╝");
    console.log(`Total Tests: ${masterReport.summary.totalTests}`);
    console.log(`Passed: ${masterReport.summary.passed}`);
    console.log(`Failed: ${masterReport.summary.failed}`);
    console.log("");

    // Print JSON master report
    console.log("=".repeat(60));
    console.log("MASTER TEST REPORT (JSON)");
    console.log("=".repeat(60));
    console.log(JSON.stringify(masterReport, null, 2));

    // Save to file
    const reportFileName = `test-report-${Date.now()}.json`;
    fs.writeFileSync(reportFileName, JSON.stringify(masterReport, null, 2));
    console.log(`\nReport saved to: ${reportFileName}`);

    return masterReport;
}

// Run all tests
runAllTests().catch(console.error);
