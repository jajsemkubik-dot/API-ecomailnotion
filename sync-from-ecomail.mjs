import { Client } from '@notionhq/client';

// Configuration from environment variables
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const ECOMAIL_API_KEY = process.env.ECOMAIL_API_KEY;
const ECOMAIL_LIST_ID = process.env.ECOMAIL_LIST_ID;

// Initialize Notion client
const notion = new Client({ auth: NOTION_TOKEN });

/**
 * Fetch all subscribers from Ecomail list
 */
async function fetchEcomailSubscribers() {
  console.log('📥 Fetching ALL subscribers (including unsubscribed) from Ecomail...');

  const subscribers = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    // Add skip_unsubscribed=false to include unsubscribed contacts
    const url = `https://api2.ecomailapp.cz/lists/${ECOMAIL_LIST_ID}/subscribers?page=${page}&skip_unsubscribed=false`;

    console.log(`🔍 Fetching page ${page}: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'key': ECOMAIL_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch subscribers: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`📦 Received data structure:`, JSON.stringify(Object.keys(data)));

    // Ecomail returns data in a specific structure - adjust based on actual API response
    if (data.data && Array.isArray(data.data)) {
      console.log(`   Page ${page}: ${data.data.length} contacts`);
      subscribers.push(...data.data);

      // Check if there are more pages
      hasMore = data.last_page ? page < data.last_page : false;
      page++;
    } else {
      console.log(`   No more data found`);
      hasMore = false;
    }
  }

  console.log(`✅ Fetched ${subscribers.length} total subscribers from Ecomail`);

  // Count statuses
  const statusCounts = subscribers.reduce((acc, sub) => {
    const status = sub.status || 'UNKNOWN';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  console.log(`   Status breakdown:`, statusCounts);

  return subscribers;
}

/**
 * Get all contacts from Notion database
 */
async function fetchNotionContacts() {
  console.log('📖 Fetching contacts from Notion...');

  const pages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: startCursor
    });

    pages.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  console.log(`✅ Fetched ${pages.length} contacts from Notion`);
  return pages;
}

/**
 * Find Notion page by email
 */
function findNotionPageByEmail(notionPages, email) {
  return notionPages.find(page => {
    const pageEmail = page.properties.Email?.email;
    return pageEmail && pageEmail.toLowerCase() === email.toLowerCase();
  });
}

/**
 * Update Notion page with Ecomail data
 * ONLY updates subscription status - Notion is source of truth for everything else
 */
async function updateNotionPage(pageId, ecomailSubscriber) {
  const updates = {};

  // ONLY update Subcribe status based on Ecomail status
  // Ecomail is the source of truth for subscription status
  if (ecomailSubscriber.status) {
    updates.Subcribe = {
      checkbox: ecomailSubscriber.status === 'SUBSCRIBED'
    };
  }

  // DO NOT update tags - Notion is the source of truth for tags
  // DO NOT update name/surname/company - Notion is the source of truth

  if (Object.keys(updates).length > 0) {
    await notion.pages.update({
      page_id: pageId,
      properties: updates
    });
    return true;
  }

  return false;
}

/**
 * Compare and determine if update is needed
 * ONLY check subscription status - Notion is source of truth for everything else
 */
function needsUpdate(notionPage, ecomailSubscriber) {
  const props = notionPage.properties;

  // ONLY check subscription status
  // Ecomail is the source of truth for subscription status
  const notionSubscribed = props.Subcribe?.checkbox || false;
  const ecomailSubscribed = ecomailSubscriber.status === 'SUBSCRIBED';

  return notionSubscribed !== ecomailSubscribed;
}

/**
 * Main sync function
 */
async function main() {
  console.log('🔄 Starting Ecomail to Notion sync...\n');

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
    // Fetch data from both systems
    const [ecomailSubscribers, notionPages] = await Promise.all([
      fetchEcomailSubscribers(),
      fetchNotionContacts()
    ]);

    console.log('\n🔍 Comparing and updating...\n');

    let updatedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;

    // Process each Ecomail subscriber
    for (const subscriber of ecomailSubscribers) {
      if (!subscriber.email) {
        console.log('⚠️  Skipping subscriber without email');
        skippedCount++;
        continue;
      }

      // Find corresponding Notion page
      const notionPage = findNotionPageByEmail(notionPages, subscriber.email);

      if (!notionPage) {
        console.log(`⚠️  Contact not found in Notion: ${subscriber.email}`);
        notFoundCount++;
        continue;
      }

      // Check if update is needed
      if (needsUpdate(notionPage, subscriber)) {
        try {
          await updateNotionPage(notionPage.id, subscriber);
          console.log(`✅ Updated: ${subscriber.email}`);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Failed to update ${subscriber.email}:`, error.message);
        }
      } else {
        console.log(`⏭️  No changes needed: ${subscriber.email}`);
        skippedCount++;
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Sync Summary:');
    console.log(`   Total Ecomail subscribers: ${ecomailSubscribers.length}`);
    console.log(`   ✅ Updated in Notion: ${updatedCount}`);
    console.log(`   ⏭️  Skipped (no changes): ${skippedCount}`);
    console.log(`   ⚠️  Not found in Notion: ${notFoundCount}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the sync
main();
