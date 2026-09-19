export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── Health & Status ──────────────────────────────────────────
      if (path === '/' || path === '/health') {
        return jsonResponse({
          status: 'ok',
          worker: env.WORKER_NAME || 'dailysolutions-automation',
          environment: env.ENVIRONMENT || 'production',
          timestamp: new Date().toISOString(),
        }, corsHeaders);
      }

      if (path === '/api/status') {
        return jsonResponse({
          uptime: Date.now(),
          pipelines: {
            lead_sourcing: 'ready',
            enrichment: 'ready',
            email_validation: 'ready',
            approval: 'ready',
            email_sequences: 'ready',
            reporting: 'ready',
          },
          tables: {
            lead_extractor_output: env.BASEROW_LEADS_TABLE_ID || '1186838',
            lead_enrichment: env.BASEROW_ENRICHMENT_TABLE_ID || '',
            email_sequences: env.BASEROW_SEQUENCES_TABLE_ID || '',
            campaigns: env.BASEROW_CAMPAIGNS_TABLE_ID || '',
          },
        }, corsHeaders);
      }

      // ── Lead Sourcing ────────────────────────────────────────────
      if (path === '/api/leads/source' && method === 'POST') {
        const body = await request.json();
        const { source, leads } = body;

        if (!leads || !Array.isArray(leads)) {
          return jsonResponse({ error: 'leads array required' }, corsHeaders, 400);
        }

        const results = [];
        for (const lead of leads) {
          const enriched = {
            ...lead,
            source_platform: source || 'manual',
            discovered_at: new Date().toISOString(),
            qualification_status: 'pending_enrichment',
          };
          results.push(enriched);
        }

        // Store in Baserow
        const stored = await bulkCreateRows(env, env.BASEROW_LEADS_TABLE_ID || '1186838', results);

        return jsonResponse({
          received: leads.length,
          stored: stored.length,
          leads: stored,
        }, corsHeaders);
      }

      // ── Clay Webhook (Enrichment Results) ────────────────────────
      if (path === '/api/webhook/clay' && method === 'POST') {
        const body = await request.json();

        // Validate webhook secret
        const secret = request.headers.get('X-Webhook-Secret');
        if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
          return jsonResponse({ error: 'Invalid webhook secret' }, corsHeaders, 401);
        }

        const enrichedLead = {
          email: body.email || '',
          email_status: body.email_status || 'unknown',
          phone: body.phone || '',
          linkedin_url: body.linkedin_url || '',
          company_name: body.company_name || '',
          company_domain: body.company_domain || '',
          company_industry: body.company_industry || '',
          company_size: body.company_size || '',
          company_revenue: body.company_revenue || '',
          seniority: body.seniority || '',
          technographics: body.technographics || '',
          enrichment_source: body.enrichment_source || 'clay',
          confidence_score: body.confidence_score || 0,
        };

        // Update lead in Baserow by prospect_name + company
        const updated = await updateLeadByEmail(env, enrichedLead);

        return jsonResponse({
          received: true,
          updated: updated !== null,
          processed_at: new Date().toISOString(),
        }, corsHeaders);
      }

      // ── Email Validation ─────────────────────────────────────────
      if (path === '/api/leads/validate' && method === 'POST') {
        const body = await request.json();
        const { lead_id, email } = body;

        if (!email) {
          return jsonResponse({ error: 'email required' }, corsHeaders, 400);
        }

        // Basic validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isValid = emailRegex.test(email);

        // Check for disposable domains
        const disposableDomains = ['tempmail.com', 'throwaway.com', 'guerrillamail.com', 'mailinator.com'];
        const domain = email.split('@')[1];
        const isDisposable = disposableDomains.includes(domain);

        const status = !isValid ? 'invalid' : isDisposable ? 'risky' : 'valid';

        // Update lead in Baserow
        if (lead_id) {
          await updateRow(env, env.BASEROW_LEADS_TABLE_ID || '1186838', lead_id, {
            email_status: status,
          });
        }

        return jsonResponse({
          email,
          status,
          is_valid: isValid,
          is_disposable: isDisposable,
        }, corsHeaders);
      }

      // ── Approval ─────────────────────────────────────────────────
      if (path === '/api/leads/approve' && method === 'POST') {
        const body = await request.json();
        const { lead_id, action, notes } = body;

        if (!lead_id || !action) {
          return jsonResponse({ error: 'lead_id and action required' }, corsHeaders, 400);
        }

        if (!['approve', 'reject'].includes(action)) {
          return jsonResponse({ error: 'action must be approve or reject' }, corsHeaders, 400);
        }

        const status = action === 'approve' ? 'approved' : 'rejected';
        const updated = await updateRow(env, env.BASEROW_LEADS_TABLE_ID || '1186838', lead_id, {
          qualification_status: status,
          assignment_reason: notes || '',
        });

        return jsonResponse({
          lead_id,
          status,
          updated: updated !== null,
        }, corsHeaders);
      }

      // ── Bulk Approval ────────────────────────────────────────────
      if (path === '/api/leads/approve-bulk' && method === 'POST') {
        const body = await request.json();
        const { lead_ids, action } = body;

        if (!lead_ids || !Array.isArray(lead_ids) || !action) {
          return jsonResponse({ error: 'lead_ids array and action required' }, corsHeaders, 400);
        }

        const status = action === 'approve' ? 'approved' : 'rejected';
        const results = [];

        for (const id of lead_ids) {
          const updated = await updateRow(env, env.BASEROW_LEADS_TABLE_ID || '1186838', id, {
            qualification_status: status,
          });
          results.push({ id, updated: updated !== null });
        }

        return jsonResponse({
          processed: results.length,
          results,
        }, corsHeaders);
      }

      // ── Email Sequences ──────────────────────────────────────────
      if (path === '/api/sequences' && method === 'GET') {
        const sequences = await listRows(env, env.BASEROW_SEQUENCES_TABLE_ID);
        return jsonResponse({ sequences }, corsHeaders);
      }

      if (path === '/api/sequences' && method === 'POST') {
        const body = await request.json();
        const { lead_id, campaign_id, sequence_name, steps } = body;

        const sequence = {
          lead: lead_id,
          campaign: campaign_id || '',
          sequence_name: sequence_name || 'default',
          status: 'not_started',
          current_step: 0,
          total_steps: steps || 3,
          opens: 0,
          replies: 0,
          bounces: 0,
        };

        const created = await createRow(env, env.BASEROW_SEQUENCES_TABLE_ID, sequence);

        return jsonResponse({ sequence: created }, corsHeaders);
      }

      if (path === '/api/sequences/next-send' && method === 'POST') {
        const body = await request.json();
        const { lead_id } = body;

        // Get sequences for this lead
        const sequences = await listRows(env, env.BASEROW_SEQUENCES_TABLE_ID);
        const leadSequence = sequences.find(s => s.lead === lead_id && s.status === 'sending');

        if (!leadSequence) {
          return jsonResponse({ error: 'No active sequence for this lead' }, corsHeaders, 404);
        }

        return jsonResponse({
          sequence: leadSequence,
          next_step: leadSequence.current_step + 1,
          total_steps: leadSequence.total_steps,
        }, corsHeaders);
      }

      // ── Campaigns ────────────────────────────────────────────────
      if (path === '/api/campaigns' && method === 'GET') {
        const campaigns = await listRows(env, env.BASEROW_CAMPAIGNS_TABLE_ID);
        return jsonResponse({ campaigns }, corsHeaders);
      }

      if (path === '/api/campaigns' && method === 'POST') {
        const body = await request.json();
        const { name, target_audience } = body;

        const campaign = {
          campaign_name: name,
          status: 'draft',
          target_audience: target_audience || '',
          total_leads: 0,
          sent: 0,
          opened: 0,
          replied: 0,
          converted: 0,
        };

        const created = await createRow(env, env.BASEROW_CAMPAIGNS_TABLE_ID, campaign);

        return jsonResponse({ campaign: created }, corsHeaders);
      }

      // ── Reporting ────────────────────────────────────────────────
      if (path === '/api/reports/pipeline' && method === 'GET') {
        const leads = await listRows(env, env.BASEROW_LEADS_TABLE_ID || '1186838');

        const report = {
          total_leads: leads.length,
          by_status: {
            pending_enrichment: leads.filter(l => l.qualification_status === 'pending_enrichment').length,
            pending_approval: leads.filter(l => l.qualification_status === 'pending_approval').length,
            approved: leads.filter(l => l.qualification_status === 'approved').length,
            rejected: leads.filter(l => l.qualification_status === 'rejected').length,
          },
          by_source: {},
          by_email_status: {
            valid: leads.filter(l => l.email_status === 'valid').length,
            invalid: leads.filter(l => l.email_status === 'invalid').length,
            risky: leads.filter(l => l.email_status === 'risky').length,
            unknown: leads.filter(l => l.email_status === 'unknown').length,
          },
          generated_at: new Date().toISOString(),
        };

        // Count by source
        for (const lead of leads) {
          const src = lead.source_platform || 'unknown';
          report.by_source[src] = (report.by_source[src] || 0) + 1;
        }

        return jsonResponse({ report }, corsHeaders);
      }

      if (path === '/api/reports/campaign' && method === 'GET') {
        const urlParams = new URLSearchParams(url.search);
        const campaignId = urlParams.get('id');

        if (!campaignId) {
          return jsonResponse({ error: 'campaign id required' }, corsHeaders, 400);
        }

        const campaigns = await listRows(env, env.BASEROW_CAMPAIGNS_TABLE_ID);
        const campaign = campaigns.find(c => c.id === parseInt(campaignId));

        if (!campaign) {
          return jsonResponse({ error: 'Campaign not found' }, corsHeaders, 404);
        }

        const sequences = await listRows(env, env.BASEROW_SEQUENCES_TABLE_ID);
        const campaignSequences = sequences.filter(s => s.campaign === parseInt(campaignId));

        const report = {
          campaign,
          sequences: {
            total: campaignSequences.length,
            sending: campaignSequences.filter(s => s.status === 'sending').length,
            completed: campaignSequences.filter(s => s.status === 'completed').length,
            paused: campaignSequences.filter(s => s.status === 'paused').length,
          },
          metrics: {
            total_opens: campaignSequences.reduce((sum, s) => sum + (s.opens || 0), 0),
            total_replies: campaignSequences.reduce((sum, s) => sum + (s.replies || 0), 0),
            total_bounces: campaignSequences.reduce((sum, s) => sum + (s.bounces || 0), 0),
          },
          generated_at: new Date().toISOString(),
        };

        return jsonResponse({ report }, corsHeaders);
      }

      // ── CSV Import ───────────────────────────────────────────────
      if (path === '/api/leads/import-csv' && method === 'POST') {
        const body = await request.json();
        const { leads } = body;

        if (!leads || !Array.isArray(leads)) {
          return jsonResponse({ error: 'leads array required' }, corsHeaders, 400);
        }

        const results = [];
        for (const lead of leads) {
          const row = {
            prospect_name: lead.name || `${lead.first_name} ${lead.last_name}`.trim(),
            job_title: lead.title || lead.job_title || '',
            employer: lead.company || lead.company_name || '',
            city: lead.city || '',
            state: lead.state || '',
            source_platform: 'csv_import',
            discovered_at: new Date().toISOString(),
            qualification_status: 'pending_enrichment',
            email: lead.email || '',
            phone: lead.phone || '',
            linkedin_url: lead.linkedin || lead.linkedin_url || '',
          };
          results.push(row);
        }

        const stored = await bulkCreateRows(env, env.BASEROW_LEADS_TABLE_ID || '1186838', results);

        return jsonResponse({
          imported: leads.length,
          stored: stored.length,
        }, corsHeaders);
      }

      // ── Generic Webhook Receiver ─────────────────────────────────
      if (path === '/api/webhook' && method === 'POST') {
        const body = await request.json();
        const { trigger, data } = body;

        console.log(`Webhook received: trigger=${trigger}`, JSON.stringify(data));

        return jsonResponse({
          received: true,
          trigger,
          processed_at: new Date().toISOString(),
        }, corsHeaders);
      }

      return jsonResponse({ error: 'Not found', path }, corsHeaders, 404);
    } catch (err) {
      console.error('Worker error:', err);
      return jsonResponse({ error: 'Internal error', message: err.message }, corsHeaders, 500);
    }
  },

  async scheduled(event, env, ctx) {
    console.log(`Cron triggered at ${event.cron}`);

    const tasks = [
      processLeadEnrichment,
      processEmailFollowups,
      processApprovalQueue,
      processReporting,
    ];

    for (const task of tasks) {
      try {
        await task(env);
        console.log(`Task completed: ${task.name}`);
      } catch (err) {
        console.error(`Task failed: ${task.name}`, err);
      }
    }
  },
};

// ── Helpers ────────────────────────────────────────────────────────

function jsonResponse(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

const BASEROW_API = 'https://api.baserow.io';

async function baserowRequest(env, method, path, body = null) {
  const headers = {
    'Authorization': `Token ${env.BASEROW_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASEROW_API}${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    console.error(`Baserow API error: ${res.status} ${err}`);
    return null;
  }
  return res.json();
}

async function createRow(env, tableId, data) {
  if (!tableId) return null;
  return baserowRequest(env, 'POST', `/api/database/rows/table/${tableId}/`, data);
}

async function bulkCreateRows(env, tableId, rows) {
  if (!tableId || !rows.length) return [];
  const results = [];
  // Baserow bulk limit is 200
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const res = await baserowRequest(env, 'POST', `/api/database/rows/table/${tableId}/batch-create/`, { items: batch });
    if (res && res.items) results.push(...res.items);
  }
  return results;
}

async function updateRow(env, tableId, rowId, data) {
  if (!tableId || !rowId) return null;
  return baserowRequest(env, 'PATCH', `/api/database/rows/table/${tableId}/${rowId}/`, data);
}

async function listRows(env, tableId, page = 1, size = 200) {
  if (!tableId) return [];
  const res = await baserowRequest(env, 'GET', `/api/database/rows/table/${tableId}/?page=${page}&size=${size}`);
  return res ? res.results || [] : [];
}

async function updateLeadByEmail(env, enrichedLead) {
  const leadsTableId = env.BASEROW_LEADS_TABLE_ID || '1186838';
  const leads = await listRows(env, leadsTableId);

  // Find lead by name + company match
  const match = leads.find(l =>
    l.prospect_name?.toLowerCase().includes(enrichedLead.company_name?.toLowerCase() || '') ||
    l.employer?.toLowerCase() === enrichedLead.company_name?.toLowerCase()
  );

  if (!match) return null;

  return updateRow(env, leadsTableId, match.id, {
    email: enrichedLead.email,
    email_status: enrichedLead.email_status,
    phone: enrichedLead.phone,
    linkedin_url: enrichedLead.linkedin_url,
    qualification_status: 'pending_approval',
  });
}

// ── Scheduled Tasks ────────────────────────────────────────────────

async function processLeadEnrichment(env) {
  const leads = await listRows(env, env.BASEROW_LEADS_TABLE_ID || '1186838');
  const pending = leads.filter(l => l.qualification_status === 'pending_enrichment');

  console.log(`Found ${pending.length} leads pending enrichment`);

  // Trigger enrichment for each lead via Apollo/Clay
  for (const lead of pending) {
    // This would call Apollo enrichment API or Clay webhook
    // For now, just log
    console.log(`Enriching: ${lead.prospect_name} at ${lead.employer}`);
  }
}

async function processEmailFollowups(env) {
  const sequences = await listRows(env, env.BASEROW_SEQUENCES_TABLE_ID);
  const active = sequences.filter(s => s.status === 'sending');

  console.log(`Found ${active.length} active sequences`);

  for (const seq of active) {
    // Check if it's time to send next email
    // This would integrate with your email provider (Apollo, Smartlead, etc.)
    console.log(`Processing sequence ${seq.id} for lead ${seq.lead}`);
  }
}

async function processApprovalQueue(env) {
  const leads = await listRows(env, env.BASEROW_LEADS_TABLE_ID || '1186838');
  const pending = leads.filter(l => l.qualification_status === 'pending_approval');

  console.log(`Found ${pending.length} leads pending approval`);

  // Could send notification email/Slack here
}

async function processReporting(env) {
  console.log('Running reporting aggregation...');
  // Could push daily stats to a dashboard or send summary email
}
