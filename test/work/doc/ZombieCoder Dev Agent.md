Invoke-RestMethod -Uri "https://a.smartearningplatformbd.net/memory-new/health" -Method GET | ConvertTo-Json








Invoke-RestMethod -Uri "https://a.smartearningplatformbd.net/memory-new/health" -Method GET | ConvertTo-Json





Invoke-RestMethod -Uri "https://a.smartearningplatformbd.net/memory-new/agent" -Method POST -ContentType "application/json" -Body '{"agentId": "test-agent-001", "content": "This is a test memory about machine learning and artificial intelligence concepts.", "sessionId": "test-session-001", "metadata": {"topic": "AI", "priority": "high"}}' | ConvertTo-Json


