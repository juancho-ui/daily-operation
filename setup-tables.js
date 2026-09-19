// setup-tables.js
// Run: node setup-tables.js
// Requires: BASEROW_API_TOKEN environment variable

const BASEROW_API = 'https://api.baserow.io';
const TOKEN = process.env.BASEROW_API_TOKEN;
const DATABASE_ID = 550766; // Prospects database

if (!TOKEN) {
  console.error('Set BASEROW_API_TOKEN environment variable');
  process.exit(1);
}

const headers = {
  'Authorization': `Token ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function createTable(name, fields) {
  const res = await fetch(`${BASEROW_API}/api/database/tables/database/${DATABASE_ID}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, fields }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create ${name}: ${res.status} ${err}`);
  }
  return res.json();
}

async function addField(tableId, field) {
  const res = await fetch(`${BASEROW_API}/api/database/fields/table/${tableId}/`, {
    method: 'POST',
    headers,
    body: JSON.stringify(field),
  });
  if (!res.ok) {
    const err = await res.text();
    console.warn(`Warning: Failed to add field: ${err}`);
    return null;
  }
  return res.json();
}

async function main() {
  console.log('Creating pipeline tables...\n');

  // ── 1. Lead Enrichment (Clay) Table ──────────────────────────────
  console.log('1. Creating Lead Enrichment table...');
  const enrichmentTable = await createTable('Lead Enrichment', [
    { name: 'First Name', type: 'text' },
    { name: 'Last Name', type: 'text' },
    { name: 'Company Name', type: 'text' },
    { name: 'Company Domain', type: 'text' },
    { name: 'Job Title', type: 'text' },
    { name: 'City', type: 'text' },
    { name: 'State', type: 'text' },
    { name: 'Email', type: 'email' },
    { name: 'Email Status', type: 'single_select', select_options: [
      { value: 'valid', color: 'green' },
      { value: 'invalid', color: 'red' },
      { value: 'risky', color: 'orange' },
      { value: 'unknown', color: 'gray' },
    ]},
    { name: 'Phone', type: 'phone_number' },
    { name: 'LinkedIn URL', type: 'url' },
    { name: 'Company Industry', type: 'text' },
    { name: 'Company Size', type: 'text' },
    { name: 'Company Revenue', type: 'text' },
    { name: 'Seniority', type: 'single_select', select_options: [
      { value: 'c_level', color: 'blue' },
      { value: 'vp', color: 'blue' },
      { value: 'director', color: 'purple' },
      { value: 'manager', color: 'yellow' },
      { value: 'individual_contributor', color: 'gray' },
    ]},
    { name: 'Technographics', type: 'long_text' },
    { name: 'Enrichment Source', type: 'single_select', select_options: [
      { value: 'clay', color: 'blue' },
      { value: 'apollo', color: 'purple' },
      { value: 'clearbit', color: 'green' },
      { value: 'tavily', color: 'orange' },
    ]},
    { name: 'Confidence Score', type: 'number', number_decimal_places: 0 },
    { name: 'Synced to Baserow', type: 'boolean' },
  ]);
  console.log(`   ✓ Created: ${enrichmentTable.name} (ID: ${enrichmentTable.id})\n`);

  // ── 2. Email Sequences Table ─────────────────────────────────────
  console.log('2. Creating Email Sequences table...');
  const sequencesTable = await createTable('Email Sequences', [
    { name: 'Lead', type: 'text' },
    { name: 'Campaign', type: 'text' },
    { name: 'Sequence Name', type: 'text' },
    { name: 'Status', type: 'single_select', select_options: [
      { value: 'not_started', color: 'gray' },
      { value: 'sending', color: 'blue' },
      { value: 'paused', color: 'yellow' },
      { value: 'completed', color: 'green' },
      { value: 'bounced', color: 'red' },
    ]},
    { name: 'Current Step', type: 'number', number_decimal_places: 0 },
    { name: 'Total Steps', type: 'number', number_decimal_places: 0 },
    { name: 'Last Sent', type: 'date', date_include_time: true },
    { name: 'Next Send', type: 'date', date_include_time: true },
    { name: 'Opens', type: 'number', number_decimal_places: 0 },
    { name: 'Replies', type: 'number', number_decimal_places: 0 },
    { name: 'Bounces', type: 'number', number_decimal_places: 0 },
  ]);
  console.log(`   ✓ Created: ${sequencesTable.name} (ID: ${sequencesTable.id})\n`);

  // ── 3. Campaigns Table ───────────────────────────────────────────
  console.log('3. Creating Campaigns table...');
  const campaignsTable = await createTable('Campaigns', [
    { name: 'Campaign Name', type: 'text' },
    { name: 'Status', type: 'single_select', select_options: [
      { value: 'draft', color: 'gray' },
      { value: 'active', color: 'blue' },
      { value: 'paused', color: 'yellow' },
      { value: 'completed', color: 'green' },
    ]},
    { name: 'Target Audience', type: 'text' },
    { name: 'Total Leads', type: 'number', number_decimal_places: 0 },
    { name: 'Sent', type: 'number', number_decimal_places: 0 },
    { name: 'Opened', type: 'number', number_decimal_places: 0 },
    { name: 'Replied', type: 'number', number_decimal_places: 0 },
    { name: 'Converted', type: 'number', number_decimal_places: 0 },
    { name: 'Start Date', type: 'date' },
    { name: 'End Date', type: 'date' },
  ]);
  console.log(`   ✓ Created: ${campaignsTable.name} (ID: ${campaignsTable.id})\n`);

  // ── 4. Add fields to existing Lead Extractor Output ──────────────
  console.log('4. Adding fields to Lead Extractor Output...');
  const leadsTableId = 1186838;

  const newFields = [
    { name: 'Email', type: 'email' },
    { name: 'Phone', type: 'phone_number' },
    { name: 'LinkedIn URL', type: 'url' },
    { name: 'Email Status', type: 'single_select', select_options: [
      { value: 'valid', color: 'green' },
      { value: 'invalid', color: 'red' },
      { value: 'risky', color: 'orange' },
      { value: 'unknown', color: 'gray' },
    ]},
    { name: 'Approval Status', type: 'single_select', select_options: [
      { value: 'pending_enrichment', color: 'gray' },
      { value: 'pending_approval', color: 'yellow' },
      { value: 'approved', color: 'green' },
      { value: 'rejected', color: 'red' },
    ]},
    { name: 'Company Industry', type: 'text' },
    { name: 'Company Size', type: 'text' },
    { name: 'Seniority', type: 'single_select', select_options: [
      { value: 'c_level', color: 'blue' },
      { value: 'vp', color: 'blue' },
      { value: 'director', color: 'purple' },
      { value: 'manager', color: 'yellow' },
      { value: 'individual_contributor', color: 'gray' },
    ]},
  ];

  for (const field of newFields) {
    const created = await addField(leadsTableId, field);
    if (created) {
      console.log(`   ✓ Added: ${field.name}`);
    }
  }

  console.log('\n─────────────────────────────────────────');
  console.log('Table IDs (update in wrangler.toml):');
  console.log(`  Lead Enrichment:  ${enrichmentTable.id}`);
  console.log(`  Email Sequences:  ${sequencesTable.id}`);
  console.log(`  Campaigns:        ${campaignsTable.id}`);
  console.log(`  Lead Extractor:   ${leadsTableId} (existing)`);
  console.log('─────────────────────────────────────────');
}

main().catch(console.error);
