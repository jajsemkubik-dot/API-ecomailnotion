/**
 * Diagnostic script to troubleshoot Notion-Ecomail sync issues
 *
 * This script will:
 * 1. Test connection to Notion API
 * 2. Fetch a sample contact and show its raw structure
 * 3. Test connection to Ecomail API
 * 4. Show exactly what the Subscribe field looks like
 * 5. Test the status normalization logic
 *
 * Usage: node diagnose.mjs
 */

import { Client } from '@notionhq/client';

// Configuration from environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ECOMAIL_API_KEY = process.env.ECOMAIL_API_KEY;
const ECOMAIL_LIST_ID = process.env.ECOMAIL_LIST_ID;

console.log('🔧 DIAGNOSTIC TOOL - Notion-Ecomail Sync\n');
console.log('='.repeat(60));

// Test 1: Environment Variables
console.log('\n📋 TEST 1: Environment Variables');
console.log('-'.repeat(60));
console.log(`NOTION_TOKEN: ${NOTION_TOKEN ? '✓ Set (length: ' + NOTION_TOKEN.length + ')' : '✗ Missing'}`);
console.log(`NOTION_DATABASE_ID: ${NOTION_DATABASE_ID ? '✓ Set' : '✗ Missing'}`);
console.log(`ECOMAIL_API_KEY: ${ECOMAIL_API_KEY ? '✓ Set (length: ' + ECOMAIL_API_KEY.length + ')' : '✗ Missing'}`);
console.log(`ECOMAIL_LIST_ID: ${ECOMAIL_LIST_ID ? '✓ Set' : '✗ Missing'}`);

if (!NOTION_TOKEN || !NOTION_DATABASE_ID || !ECOMAIL_API_KEY || !ECOMAIL_LIST_ID) {
  console.error('\n❌ Missing required environment variables!');
  process.exit(1);
}

// Initialize Notion client
const notion = new Client({ auth: NOTION_TOKEN });

// Test 2: Notion API Connection
console.log('\n📖 TEST 2: Notion API Connection');
console.log('-'.repeat(60));

try {
  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    page_size: 3
  });

  console.log(`✓ Connected successfully`);
  console.log(`✓ Found ${response.results.length} contacts (showing first 3)`);

  if (response.results.length === 0) {
    console.log('\n⚠️  No contacts in database!');
  } else {
    console.log('\n📄 Sample Contact Properties:');

    for (const page of response.results) {
      const properties = page.properties;

      console.log('\n' + '─'.repeat(60));
      console.log(`Contact ID: ${page.id}`);
      console.log(`\nAvailable Properties: ${Object.keys(properties).join(', ')}`);

      // Show Email
      console.log(`\n📧 Email Property:`);
      if (properties.Email) {
        console.log(`   Type: ${properties.Email.type}`);
        console.log(`   Value: ${properties.Email.email || 'null'}`);
      } else {
        console.log(`   ✗ Email property not found!`);
      }

      // Show Marketingový status field - THIS IS KEY
      console.log(`\n✅ Marketingový status Property:`);
      if (properties['Marketingový status']) {
        console.log(`   Type: ${properties['Marketingový status'].type}`);
        console.log(`   Raw JSON:`, JSON.stringify(properties['Marketingový status'], null, 4));

        if (properties['Marketingový status'].select) {
          console.log(`   → select.name: "${properties['Marketingový status'].select.name}"`);
          console.log(`   → Boolean conversion (Ano=true): ${properties['Marketingový status'].select.name === 'Ano'}`);
        } else if (properties['Marketingový status'].checkbox !== undefined) {
          console.log(`   → checkbox value: ${properties['Marketingový status'].checkbox}`);
        } else {
          console.log(`   ⚠️  Unexpected structure!`);
        }
      } else {
        console.log(`   ✗ Marketingový status property not found!`);
        console.log(`   Available properties: ${Object.keys(properties).join(', ')}`);
      }

      // Show Tags
      if (properties.Tags) {
        const tags = properties.Tags.multi_select?.map(t => t.name) || [];
        console.log(`\n🏷️  Tags: [${tags.join(', ')}]`);
      }

      // Show other fields
      console.log(`\n👤 Other Fields:`);
      console.log(`   Jméno: ${properties.Jméno?.rich_text?.[0]?.plain_text || 'null'}`);
      console.log(`   Příjmení: ${properties.Příjmení?.rich_text?.[0]?.plain_text || 'null'}`);
      console.log(`   Firma: ${properties.Firma?.rich_text?.[0]?.plain_text || 'null'}`);
    }
  }
} catch (error) {
  console.error('❌ Failed to connect to Notion:', error.message);
  console.error(error);
  process.exit(1);
}

// Test 3: Ecomail API Connection
console.log('\n\n📬 TEST 3: Ecomail API Connection');
console.log('-'.repeat(60));

try {
  // Try to fetch list info
  const listUrl = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}`;
  const listResponse = await fetch(listUrl, {
    method: 'GET',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (listResponse.ok) {
    const listData = await listResponse.json();
    console.log(`✓ Connected successfully`);
    console.log(`✓ List ID: ${ECOMAIL_LIST_ID}`);
    console.log(`✓ List name: ${listData.name || 'N/A'}`);
  } else {
    console.log(`⚠️  List endpoint returned: ${listResponse.status} ${listResponse.statusText}`);
    const errorText = await listResponse.text();
    console.log(`   Response: ${errorText}`);
  }

  // Try to fetch a subscriber
  console.log('\n📝 Testing Subscriber Fetch:');
  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    page_size: 1
  });

  if (response.results.length > 0) {
    const email = response.results[0].properties.Email?.email;

    if (email) {
      console.log(`   Testing with email: ${email}`);

      const subUrl = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscriber/${encodeURIComponent(email)}`;
      const subResponse = await fetch(subUrl, {
        method: 'GET',
        headers: {
          'key': ECOMAIL_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      console.log(`   Status: ${subResponse.status} ${subResponse.statusText}`);

      if (subResponse.ok) {
        const subData = await subResponse.json();
        console.log(`   Subscriber exists in Ecomail:`);
        console.log(`   → Email: ${subData.email}`);
        console.log(`   → Status: ${subData.status} (type: ${typeof subData.status})`);
        console.log(`   → Status is string: ${typeof subData.status === 'string'}`);
        console.log(`   → Status is number: ${typeof subData.status === 'number'}`);
        console.log(`   → Raw data:`, JSON.stringify(subData, null, 2));
      } else {
        console.log(`   Subscriber not found in Ecomail (this is OK if not synced yet)`);
      }
    } else {
      console.log(`   ⚠️  No email found in first contact`);
    }
  }
} catch (error) {
  console.error('❌ Failed to connect to Ecomail:', error.message);
  console.error(error);
}

// Test 4: Status Normalization Logic
console.log('\n\n🔄 TEST 4: Status Normalization Logic');
console.log('-'.repeat(60));

const STATUS_STRING_TO_CODE = {
  'SUBSCRIBED': 1,
  'UNSUBSCRIBED': 2,
  'HARD_BOUNCE': 4,
  'SPAM_COMPLAINT': 5,
  'UNCONFIRMED': 6
};

function normalizeEcomailStatus(status) {
  if (status === null || status === undefined) {
    return 'NOT_FOUND';
  }
  if (typeof status === 'number') {
    return status;
  }
  if (typeof status === 'string') {
    return STATUS_STRING_TO_CODE[status] || status;
  }
  return status;
}

const testCases = [
  { input: null, expected: 'NOT_FOUND' },
  { input: undefined, expected: 'NOT_FOUND' },
  { input: 'SUBSCRIBED', expected: 1 },
  { input: 'UNSUBSCRIBED', expected: 2 },
  { input: 1, expected: 1 },
  { input: 2, expected: 2 }
];

console.log('Testing normalizeEcomailStatus():');
for (const test of testCases) {
  const result = normalizeEcomailStatus(test.input);
  const pass = result === test.expected;
  console.log(`   ${pass ? '✓' : '✗'} normalizeEcomailStatus(${JSON.stringify(test.input)}) = ${JSON.stringify(result)} ${pass ? '' : `(expected ${JSON.stringify(test.expected)})`}`);
}

console.log('\n' + '='.repeat(60));
console.log('✅ DIAGNOSTICS COMPLETE\n');
console.log('📊 Summary:');
console.log('   1. Check if Marketingový status property exists and has correct type');
console.log('   2. Check if Marketingový status values are "Ano" and "Ne" (case-sensitive)');
console.log('   3. Check if Ecomail API returns string or numeric status');
console.log('   4. Review the raw JSON structures above');
console.log('\n💡 Next steps:');
console.log('   - If Marketingový status property is missing, add it to Notion database');
console.log('   - If type is wrong, change it to Select with "Ano"/"Ne" options');
console.log('   - Share the output above for further debugging');
console.log('');
