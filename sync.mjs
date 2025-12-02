import { Client } from '@notionhq/client';

// Configuration from environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ECOMAIL_API_KEY = process.env.ECOMAIL_API_KEY;
const ECOMAIL_LIST_ID = process.env.ECOMAIL_LIST_ID;

// Initialize Notion client
const notion = new Client({ auth: NOTION_TOKEN });

/**
 * Query Notion database for contacts with Subscribe = true
 */
async function queryNotionDatabase() {
  console.log('📖 Querying Notion database...');

  const response = await notion.databases.query({
    database_id: NOTION_DATABASE_ID,
    filter: {
      property: 'Subscribe',
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

  // Extract tags from multiselect property
  const tags = properties.Tag?.multi_select?.map(tag => tag.name) || [];

  return {
    email: properties.Email?.email || null,
    name: properties.Jméno?.rich_text?.[0]?.plain_text || null,
    surname: properties.Příjmení?.rich_text?.[0]?.plain_text || null,
    company: properties.Firma?.rich_text?.[0]?.plain_text || null,
    tags: tags.length > 0 ? tags : null
  };
}

/**
 * Fetch existing subscriber from Ecomail to check for changes
 */
async function fetchEcomailSubscriber(email) {
  const url = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscriber/${encodeURIComponent(email)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    }
  });

  if (response.ok) {
    return await response.json();
  }

  // Subscriber doesn't exist or error - return null
  return null;
}

/**
 * Check if contact needs update in Ecomail
 */
function needsEcomailUpdate(notionContact, ecomailSubscriber) {
  if (!ecomailSubscriber) {
    // Subscriber doesn't exist in Ecomail, needs to be created
    return true;
  }

  // Compare tags
  const notionTags = (notionContact.tags || []).sort();
  const ecomailTags = (ecomailSubscriber.tags || []).sort();

  if (notionTags.length !== ecomailTags.length) {
    return true;
  }

  for (let i = 0; i < notionTags.length; i++) {
    if (notionTags[i] !== ecomailTags[i]) {
      return true;
    }
  }

  // Compare other fields
  if (notionContact.name !== ecomailSubscriber.name) return true;
  if (notionContact.surname !== ecomailSubscriber.surname) return true;
  if (notionContact.company !== ecomailSubscriber.company) return true;

  return false;
}

/**
 * Add or update subscriber in Ecomail list
 */
async function addToEcomail(contact) {
  // Try both API endpoints (api2.ecomailapp.cz is the official one from PHP library)
  const url = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscribe`;

  // Build subscriber_data object, only including non-null values
  const subscriber_data = {
    email: contact.email
  };

  if (contact.name) subscriber_data.name = contact.name;
  if (contact.surname) subscriber_data.surname = contact.surname;
  if (contact.company) subscriber_data.company = contact.company;

  const payload = {
    subscriber_data,
    update_existing: true,
    trigger_autoresponders: true
  };

  // Add tags if they exist (tags must be sent separately according to Ecomail API)
  if (contact.tags && contact.tags.length > 0) {
    payload.tags = contact.tags;
  }

  console.log(`🔍 Request URL: ${url}`);
  console.log(`🔍 Payload:`, JSON.stringify(payload, null, 2));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'key': ECOMAIL_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  console.log(`🔍 Response status: ${response.status} ${response.statusText}`);

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
    let skippedCount = 0;

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
        console.log(`📧 Processing: ${contact.email}`, JSON.stringify(contact, null, 2));

        // Check if subscriber exists in Ecomail and if update is needed
        const ecomailSubscriber = await fetchEcomailSubscriber(contact.email);

        if (!needsEcomailUpdate(contact, ecomailSubscriber)) {
          console.log(`⏭️  No changes needed: ${contact.email}`);
          skippedCount++;
          continue;
        }

        const response = await addToEcomail(contact);

        if (response.ok) {
          const responseBody = await response.text();
          console.log(`✅ Synced: ${contact.email}`);
          console.log(`   Response body: ${responseBody}`);
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
    console.log(`   ⏭️  Skipped (no changes): ${skippedCount}`);
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
