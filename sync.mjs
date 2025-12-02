import { Client } from '@notionhq/client';

// Initialize Notion client
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Configuration from environment variables
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ECOMAIL_API_KEY = process.env.ECOMAIL_API_KEY;
const ECOMAIL_LIST_ID = process.env.ECOMAIL_LIST_ID;

/**
 * Query Notion database for all contacts with Subscribed = true
 */
async function queryNotionDatabase() {
  console.log('📖 Querying Notion database...');

  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'Subscribed',
      checkbox: {
        equals: true
      }
    }
  });

  console.log(`✅ Found ${response.results.length} subscribed contacts`);
  return response.results;
}

/**
 * Extract contact data from Notion page properties
 */
function extractContactData(page) {
  const properties = page.properties;

  return {
    email: properties.Email?.email || null,
    name: properties.Jméno?.rich_text?.[0]?.plain_text || null,
    surname: properties.Příjmení?.rich_text?.[0]?.plain_text || null,
    company: properties.Firma?.rich_text?.[0]?.plain_text || null
  };
}

/**
 * Add or update subscriber in Ecomail list
 */
async function addToEcomail(contact) {
  const url = `https://api.ecomail.app/lists/${ECOMAIL_LIST_ID}/subscribe`;

  const payload = {
    subscriber_data: {
      email: contact.email,
      name: contact.name,
      surname: contact.surname,
      company: contact.company
    },
    update_existing: true,
    trigger_autoresponders: true
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return response;
}

/**
 * Main sync function
 */
async function main() {
  console.log('🚀 Starting Notion to Ecomail sync...\n');

  // Validate environment variables
  if (!NOTION_TOKEN) {
    console.error('❌ Error: NOTION_TOKEN environment variable is not set');
    process.exit(1);
  }
  if (!NOTION_DATABASE_ID) {
    console.error('❌ Error: NOTION_DATABASE_ID environment variable is not set');
    process.exit(1);
  }
  if (!ECOMAIL_API_KEY) {
    console.error('❌ Error: ECOMAIL_API_KEY environment variable is not set');
    process.exit(1);
  }
  if (!ECOMAIL_LIST_ID) {
    console.error('❌ Error: ECOMAIL_LIST_ID environment variable is not set');
    process.exit(1);
  }

  try {
    // Query Notion for subscribed contacts
    const pages = await queryNotionDatabase();

    if (pages.length === 0) {
      console.log('ℹ️  No subscribed contacts found');
      return;
    }

    console.log('\n📤 Syncing to Ecomail...\n');

    let successCount = 0;
    let errorCount = 0;

    // Process each contact
    for (const page of pages) {
      const contact = extractContactData(page);

      // Skip if no email
      if (!contact.email) {
        console.log(`⚠️  Skipping contact without email`);
        errorCount++;
        continue;
      }

      try {
        const response = await addToEcomail(contact);

        if (response.ok) {
          console.log(`✅ Synced: ${contact.email}`);
          successCount++;
        } else {
          const errorText = await response.text();
          console.error(`❌ Failed: ${contact.email} - ${response.status} ${response.statusText}`);
          console.error(`   Response: ${errorText}`);
          errorCount++;
        }
      } catch (error) {
        console.error(`❌ Error syncing ${contact.email}:`, error.message);
        errorCount++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Sync Summary:');
    console.log(`   Total contacts: ${pages.length}`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log('='.repeat(50));

    // Exit with error code if there were failures
    if (errorCount > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the sync
main();
