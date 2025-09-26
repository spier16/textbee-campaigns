#!/usr/bin/env node

// Debug script to simulate incoming SMS messages
// Usage: node debug-incoming-message.js "Your message here" "+15551234567"

const https = require('https');
const http = require('http');

const deviceId = '68c59f79aee0de6eda7d982b';
const baseUrl = 'http://localhost:3000'; // Change to https://yourdomain.com if needed

// Get auth token from environment or command line
const authToken = process.env.AUTH_TOKEN || 'YOUR_JWT_TOKEN_HERE';

const message = process.argv[2] || 'Debug test message from script';
const sender = process.argv[3] || '+15551234567';

const payload = {
  message: message,
  sender: sender,
  receivedAt: new Date().toISOString(),
  receivedAtInMillis: Date.now()
};

const url = new URL(`/api/gateway/devices/${deviceId}/receive-sms`, baseUrl);
const isHttps = url.protocol === 'https:';
const client = isHttps ? https : http;

const options = {
  hostname: url.hostname,
  port: url.port || (isHttps ? 443 : 3000),
  path: url.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
    'Content-Length': Buffer.byteLength(JSON.stringify(payload))
  }
};

console.log('Simulating incoming message:');
console.log('From:', sender);
console.log('Message:', message);
console.log('Timestamp:', new Date().toISOString());

const req = client.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\nResponse status:', res.statusCode);
    console.log('Response:', data);

    if (res.statusCode === 200) {
      console.log('✅ Message successfully simulated!');
    } else {
      console.log('❌ Failed to simulate message');
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
});

req.write(JSON.stringify(payload));
req.end();