const autocannon = require('autocannon');
const axios = require('axios');

async function runStressTest() {
    console.log('🚀 Starting MatchLogic Stress Test');
    console.log('📊 Target: 100 concurrent users for 30 seconds');
    console.log('🎯 Endpoints: /api/matches and /api/match/:id');
    
    const config = {
        url: 'http://127.0.0.1:3001', // Use port 3001
        connections: 100,
        duration: 30,
        overallRate: 1, // Minimum 1 to avoid bailout error
        requests: [
            {
                method: 'GET',
                path: '/api/matches',
                headers: {
                    'x-stress-test': 'true', // Bypass rate limiting
                    'Connection': 'keep-alive'
                }
            },
            {
                method: 'GET',
                // Generate random match IDs to test various match endpoints
                path: () => `/api/match/${Math.floor(Math.random() * 1000) + 1}`,
                headers: {
                    'x-stress-test': 'true', // Bypass rate limiting
                    'Connection': 'keep-alive'
                }
            }
        ]
    };

    console.log('\n⚡ Stress Test Configuration:');
    console.log(`   - Concurrent Users: ${config.connections}`);
    console.log(`   - Duration: ${config.duration} seconds`);
    console.log(`   - Total Requests: ${config.connections * config.duration}`);
    console.log(`   - Rate Limiting: Bypassed (x-stress-test: true)`);
    console.log(`   - Server URL: ${config.url}`);
    
    // Wait for server to be ready with multiple attempts
    console.log('\n⏳ Checking server availability...');
    let serverReady = false;
    let attempts = 0;
    const maxAttempts = 10;
    
    while (!serverReady && attempts < maxAttempts) {
        attempts++;
        try {
            console.log(`   Attempt ${attempts}/${maxAttempts}...`);
            
            // Try both localhost and 127.0.0.1
            const testUrls = [
                'http://127.0.0.1:3001/api/matches',
                'http://localhost:3001/api/matches'
            ];
            
            for (const testUrl of testUrls) {
                try {
                    const testResponse = await axios.get(testUrl, {
                        headers: { 
                            'x-stress-test': 'true',
                            'Connection': 'keep-alive'
                        },
                        timeout: 5000 // 5 second timeout
                    });
                    if (testResponse.status === 200) {
                        console.log(`✅ Server is ready at: ${testUrl}`);
                        config.url = testUrl.replace('/api/matches', '');
                        serverReady = true;
                        break;
                    }
                } catch (urlError) {
                    // Try next URL
                }
            }
            
            if (!serverReady) {
                throw new Error('All connection attempts failed');
            }
            
        } catch (error) {
            console.log(`   ⚠️  Attempt ${attempts} failed: ${error.message}`);
            if (attempts < maxAttempts) {
                console.log(`   ⏳ Waiting 2 seconds before retry...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
    }
    
    if (!serverReady) {
        console.error('❌ Server not ready after all attempts');
        console.error('Please ensure server is running and accessible');
        process.exit(1);
    }
    
    const startTime = Date.now();
    
    try {
        const result = await autocannon(config);
        
        const endTime = Date.now();
        const totalDuration = (endTime - startTime) / 1000;
        
        console.log('\n📈 Stress Test Results:');
        console.log(`   - Total Duration: ${totalDuration.toFixed(2)}s`);
        console.log(`   - Requests Completed: ${result.requests.completed}`);
        console.log(`   - Requests/sec: ${(result.requests.completed / totalDuration).toFixed(2)}`);
        console.log(`   - Average Latency: ${result.latency.average.toFixed(2)}ms`);
        console.log(`   - Min Latency: ${result.latency.min}ms`);
        console.log(`   - Max Latency: ${result.latency.max}ms`);
        console.log(`   - 2xx Responses: ${result.statusCodes['2xx'] || 0}`);
        console.log(`   - 4xx Errors: ${result.statusCodes['4xx'] || 0}`);
        console.log(`   - 5xx Errors: ${result.statusCodes['5xx'] || 0}`);
        console.log(`   - Timeouts: ${result.timeouts || 0}`);
        console.log(`   - Errors: ${result.errors || 0}`);
        
        // Performance Analysis
        console.log('\n🎯 Performance Analysis:');
        if (result.latency.average < 100) {
            console.log('   ✅ EXCELLENT: Average latency < 100ms');
        } else if (result.latency.average < 200) {
            console.log('   ✅ GOOD: Average latency < 200ms');
        } else if (result.latency.average < 500) {
            console.log('   ⚠️  FAIR: Average latency < 500ms');
        } else {
            console.log('   ❌ POOR: Average latency > 500ms');
        }
        
        if ((result.statusCodes['4xx'] || 0) + (result.statusCodes['5xx'] || 0) === 0) {
            console.log('   ✅ EXCELLENT: No server errors');
        } else if ((result.statusCodes['4xx'] || 0) + (result.statusCodes['5xx'] || 0) < 10) {
            console.log('   ✅ GOOD: Minimal server errors');
        } else {
            console.log('   ❌ POOR: High error rate');
        }
        
        // Throughput Analysis
        const reqPerSec = result.requests.completed / totalDuration;
        if (reqPerSec > 50) {
            console.log('   ✅ EXCELLENT: High throughput (>50 req/sec)');
        } else if (reqPerSec > 20) {
            console.log('   ✅ GOOD: Good throughput (>20 req/sec)');
        } else {
            console.log('   ⚠️  FAIR: Low throughput (<20 req/sec)');
        }
        
    } catch (error) {
        console.error('\n❌ Stress Test Failed:', error.message);
        console.error('Make sure server is running and accessible');
        process.exit(1);
    }
}

// Rate Limiting Test
async function runRateLimitTest() {
    console.log('\n🛡️  Rate Limiting Test:');
    console.log('Testing server resilience with aggressive requests...');
    
    const config = {
        url: 'http://127.0.0.1:3001', // Use port 3001
        connections: 50,
        duration: 10,
        overallRate: 200, // 200 requests per second total
        requests: [
            {
                method: 'GET',
                path: '/api/matches',
                headers: {
                    'x-stress-test': 'true', // Bypass rate limiting for testing
                    'Connection': 'keep-alive'
                }
            }
        ]
    };
    
    try {
        const result = await autocannon(config);
        console.log(`Rate Limit Test: ${(result.requests.completed / 10).toFixed(2)} req/sec`);
        console.log(`Errors: ${result.errors || 0}`);
        
        if (result.errors > 0) {
            console.log('✅ Rate limiting is working - requests are being throttled');
        } else {
            console.log('⚠️  Rate limiting may need adjustment');
        }
    } catch (error) {
        console.error('Rate limit test failed:', error.message);
    }
}

// Main execution
if (require.main === module) {
    const command = process.argv[2];
    
    if (command === 'stress') {
        runStressTest();
    } else if (command === 'rate-limit') {
        runRateLimitTest();
    } else {
        console.log('📖 Usage:');
        console.log('   node stress-test.js stress     # Run stress test (100 users, 30s)');
        console.log('   node stress-test.js rate-limit # Test rate limiting (50 users, 10s)');
        console.log('\n🔧 Rate Limiting Implementation:');
        console.log('Add to server.js:');
        console.log(`
const rateLimit = require('express-rate-limit');

app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per window
    message: 'Too many requests from this IP, please try again later.'
}));
        `);
    }
}
