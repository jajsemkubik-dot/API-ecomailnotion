/**
 * Debug script to see exact property names in Notion database
 * This will help identify if property name has different characters
 */

import { Client } from '@notionhq/client';

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

console.log('🔍 DEBUG: Checking Notion property names\n');
console.log('='.repeat(60));

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error('❌ Missing NOTION_TOKEN or NOTION_DATABASE_ID');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

try {
  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    page_size: 1
  });

  if (response.results.length === 0) {
    console.log('⚠️  No contacts in database');
    process.exit(0);
  }

  const page = response.results[0];
  const properties = page.properties;

  console.log('\n📋 EXACT PROPERTY NAMES:\n');

  const propNames = Object.keys(properties);
  propNames.forEach((name, index) => {
    console.log(`${index + 1}. "${name}"`);
    console.log(`   Type: ${properties[name].type}`);
    console.log(`   Character codes: [${Array.from(name).map(c => c.charCodeAt(0)).join(', ')}]`);
    console.log('');
  });

  console.log('='.repeat(60));
  console.log('\n🔎 LOOKING FOR SUBSCRIPTION FIELD:\n');

  // Try different variations
  const variations = [
    'Marketingový status',
    'Marketingovy status',
    'Subscribe',
    'Status'
  ];

  variations.forEach(variant => {
    if (properties[variant]) {
      console.log(`✅ FOUND: "${variant}"`);
      console.log(`   Full structure:`, JSON.stringify(properties[variant], null, 2));
    } else {
      console.log(`❌ NOT FOUND: "${variant}"`);
    }
  });

  console.log('\n='.repeat(60));
  console.log('\n📄 FULL PROPERTY STRUCTURE FOR FIRST CONTACT:\n');
  console.log(JSON.stringify(properties, null, 2));

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error);
  process.exit(1);
}
