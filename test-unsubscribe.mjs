/**
 * Test script to diagnose unsubscribe issues
 *
 * This script helps identify why unsubscribe might not be working:
 * 1. Tests if the Notion Subscribe field is being read correctly
 * 2. Tests if the Ecomail unsubscribe API endpoint is working
 * 3. Shows detailed debugging information
 *
 * Usage: node test-unsubscribe.mjs
 */

import { Client } from '@notionhq/client';

// Configuration from environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ECOMAIL_API_KEY = process.env.ECOMAIL_API_KEY;
const ECOMAIL_LIST_ID = process.env.ECOMAIL_LIST_ID;

// Initialize Notion client
const notion = new Client({ auth: NOTION_TOKEN });

console.log('🧪 Test Script: Unsubscribe Diagnostics\n');
console.log('=' .repeat(60));

// Validate environment variables
if (!NOTION_TOKEN || !NOTION_DATABASE_ID || !ECOMAIL_API_KEY || !ECOMAIL_LIST_ID) {
  console.error('❌ Missing environment variables!');
  console.log('Required:');
  console.log(`  NOTION_TOKEN: ${NOTION_TOKEN ? '✓' : '✗'}`);
  console.log(`  NOTION_DATABASE_ID: ${NOTION_DATABASE_ID ? '✓' : '✗'}`);
  console.log(`  ECOMAIL_API_KEY: ${ECOMAIL_API_KEY ? '✓' : '✗'}`);
  console.log(`  ECOMAIL_LIST_ID: ${ECOMAIL_LIST_ID ? '✓' : '✗'}`);
  process.exit(1);
}

console.log('✓ Environment variables loaded\n');

// Test 1: Fetch one page from Notion and inspect Subscribe field
async function testNotionSubscribeField() {
  console.log('TEST 1: Reading Subscribe field from Notion');
  console.log('-'.repeat(60));

  try {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      page_size: 5  // Just get first 5 contacts
    });

    if (response.results.length === 0) {
      console.log('⚠️  No contacts found in database\n');
      return;
    }

    console.log(`Found ${response.results.length} contacts. Inspecting first few...\n`);

    for (const page of response.results) {
      const properties = page.properties;

      console.log(`\n📄 Contact:`);
      console.log(`   Email: ${properties.Email?.email || 'N/A'}`);

      // Show all available property names
      console.log(`   Available properties: ${Object.keys(properties).join(', ')}`);

      // Check if Subscribe property exists
      if (properties.Subscribe) {
        console.log(`   ✓ Subscribe property found`);
        console.log(`   Subscribe property type: ${properties.Subscribe.type}`);
        console.log(`   Subscribe raw data:`, JSON.stringify(properties.Subscribe, null, 4));

        // Try to extract the value
        if (properties.Subscribe.select) {
          const value = properties.Subscribe.select?.name;
          console.log(`   → Extracted value: "${value}"`);
          console.log(`   → Boolean conversion: ${value === 'Yes'}`);
        } else if (properties.Subscribe.checkbox !== undefined) {
          console.log(`   → Checkbox value: ${properties.Subscribe.checkbox}`);
        } else {
          console.log(`   ⚠️  Unknown Subscribe field structure`);
        }
      } else {
        console.log(`   ✗ Subscribe property NOT found`);
      }
    }

    console.log('\n' + '='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error fetching from Notion:', error.message);
    console.error(error);
  }
}

// Test 2: Test Ecomail unsubscribe API endpoint directly
async function testEcomailUnsubscribe(testEmail) {
  console.log('TEST 2: Testing Ecomail Unsubscribe API');
  console.log('-'.repeat(60));

  if (!testEmail) {
    console.log('ℹ️  No test email provided, skipping API test\n');
    return;
  }

  console.log(`Testing with email: ${testEmail}\n`);

  // First, check if subscriber exists
  console.log('Step 1: Check if subscriber exists in Ecomail...');
  const checkUrl = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscriber/${encodeURIComponent(testEmail)}`;
  console.log(`GET ${checkUrl}`);

  try {
    const checkResponse = await fetch(checkUrl, {
      method: 'GET',
      headers: {
        'key': ECOMAIL_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log(`Response: ${checkResponse.status} ${checkResponse.statusText}`);

    if (checkResponse.ok) {
      const data = await checkResponse.json();
      console.log(`Current status: ${data.status || 'UNKNOWN'}`);
      console.log(`Subscriber data:`, JSON.stringify(data, null, 2));
    } else {
      const errorText = await checkResponse.text();
      console.log(`Error: ${errorText}`);
    }

    console.log('\nStep 2: Attempting to unsubscribe (setting status=2)...');
    const unsubUrl = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/update-subscriber`;
    console.log(`PUT ${unsubUrl}`);

    const payload = {
      subscriber_data: {
        email: testEmail,
        status: 2  // 2 = unsubscribed (1=subscribed, 2=unsubscribed, 4=hard bounce, 5=spam, 6=unconfirmed)
      }
    };

    console.log('Payload:', JSON.stringify(payload, null, 2));

    const unsubResponse = await fetch(unsubUrl, {
      method: 'PUT',
      headers: {
        'key': ECOMAIL_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    console.log(`Response: ${unsubResponse.status} ${unsubResponse.statusText}`);
    const responseBody = await unsubResponse.text();
    console.log(`Response body: ${responseBody}`);

    if (unsubResponse.ok) {
      console.log('✅ Unsubscribe API call succeeded!');
    } else {
      console.log('❌ Unsubscribe API call failed!');
    }

    console.log('\n' + '='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Error testing Ecomail API:', error.message);
    console.error(error);
  }
}

// Run tests
async function runTests() {
  await testNotionSubscribeField();

  // Get test email from command line or prompt
  const testEmail = process.argv[2];

  if (testEmail) {
    await testEcomailUnsubscribe(testEmail);
  } else {
    console.log('ℹ️  To test Ecomail API, run: node test-unsubscribe.mjs <email>\n');
  }

  console.log('✅ Diagnostics complete!\n');
  console.log('Next steps:');
  console.log('1. Check the Subscribe field structure above');
  console.log('2. Verify it matches what the code expects');
  console.log('3. If testing with an email, check if the API calls succeed');
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
