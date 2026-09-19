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
            teachers: env.BASEROW_TEACHERS_TABLE_ID || '1207505',
            plans: env.BASEROW_PLANS_TABLE_ID || '1207504',
            notes: env.BASEROW_NOTES_TABLE_ID || '1207506',
            reminders: env.BASEROW_REMINDERS_TABLE_ID || '1207507',
          },
        }, corsHeaders);
      }

      // ── Debug: Test Baserow Connection ────────────────────────────
      if (path === '/api/debug/baserow') {
        const token = env.BASEROW_API_TOKEN;
        const teachersTable = env.BASEROW_TEACHERS_TABLE_ID || '1207505';
        
        // Test read
        const listResult = await baserowRequest(env, 'GET', `/api/database/rows/table/${teachersTable}/?user_field_names=true&page=1&size=5`);
        const canRead = listResult && listResult.results;
        
        // Test write
        const writeResult = await baserowRequest(env, 'POST', `/api/database/rows/table/${teachersTable}/?user_field_names=true`, {
          'Teacher Name': 'Debug Test',
          'Email': 'debug@test.com',
          'Enrollment Status': 'Pending'
        });
        const canWrite = writeResult && !writeResult.error && writeResult.id;
        
        // Cleanup: delete the test row if created
        if (canWrite) {
          await baserowRequest(env, 'DELETE', `/api/database/rows/table/${teachersTable}/${writeResult.id}/`);
        }
        
        return jsonResponse({
          has_token: !!token,
          token_preview: token ? token.substring(0, 8) + '...' : null,
          teachers_table: teachersTable,
          can_read: !!canRead,
          read_count: canRead ? listResult.results.length : 0,
          can_write: !!canWrite,
          write_result: writeResult,
          read_result: canRead ? 'OK' : listResult,
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
        const errors = [];
        for (const lead of leads) {
          const row = {
            'Teacher Name': lead.name || `${lead.first_name} ${lead.last_name}`.trim(),
            'Email': lead.email || '',
            'Phone': lead.phone || '',
            'Enrollment Status': 'Pending',
            'Address': [lead.company || lead.company_name, lead.city, lead.state].filter(Boolean).join(', ') || '',
          };

          const stored = await baserowCreate(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505', row);
          if (stored && !stored.error) results.push(stored);
          else errors.push(stored);
        }

        return jsonResponse({
          received: leads.length,
          stored: results.length,
          leads: results,
          errors: errors.length > 0 ? errors : undefined,
        }, corsHeaders);
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
            'Teacher Name': lead.name || `${lead.first_name} ${lead.last_name}`.trim(),
            'Email': lead.email || '',
            'Phone': lead.phone || '',
            'Enrollment Status': 'Pending',
            'Address': [lead.company || lead.company_name, lead.city, lead.state].filter(Boolean).join(', ') || '',
          };

          const stored = await baserowCreate(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505', row);
          if (stored) results.push(stored);
        }

        return jsonResponse({
          imported: leads.length,
          stored: results.length,
        }, corsHeaders);
      }

      // ── Clay Webhook (Enrichment Results) ────────────────────────
      if (path === '/api/webhook/clay' && method === 'POST') {
        const body = await request.json();

        const secret = request.headers.get('X-Webhook-Secret');
        if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
          return jsonResponse({ error: 'Invalid webhook secret' }, corsHeaders, 401);
        }

        // Find teacher by name or email
        const teachers = await baserowList(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505');
        const match = teachers.find(t =>
          t['Email'] === body.email ||
          t['Teacher Name']?.toLowerCase().includes(body.prospect_name?.toLowerCase() || '')
        );

        if (match) {
          const update = {
            'Email': body.email || match['Email'],
            'Phone': body.phone || match['Phone'],
            'Address': body.company_name || match['Address'],
            'Enrollment Status': 'Pending',
          };
          await baserowUpdate(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505', match.id, update);
        }

        // Log enrichment note
        await baserowCreate(env, env.BASEROW_NOTES_TABLE_ID || '1207506', {
          'Note Title': `Enrichment: ${body.company_name || 'Unknown'}`,
          'Note': `Source: ${body.enrichment_source || 'clay'}\nConfidence: ${body.confidence_score || 'N/A'}\nEmail: ${body.email || 'N/A'}\nPhone: ${body.phone || 'N/A'}`,
          'Teacher': match ? match.id : null,
        });

        return jsonResponse({
          received: true,
          matched: match !== null,
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

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isValid = emailRegex.test(email);
        const disposableDomains = ['tempmail.com', 'throwaway.com', 'guerrillamail.com', 'mailinator.com'];
        const domain = email.split('@')[1];
        const isDisposable = disposableDomains.includes(domain);
        const status = !isValid ? 'invalid' : isDisposable ? 'risky' : 'valid';

        if (lead_id) {
          await baserowUpdate(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505', lead_id, {
            'Enrollment Status': status === 'valid' ? 'Pending' : 'Not Enrolled',
          });
        }

        return jsonResponse({ email, status, is_valid: isValid, is_disposable: isDisposable }, corsHeaders);
      }

      // ── Approval ─────────────────────────────────────────────────
      if (path === '/api/leads/approve' && method === 'POST') {
        const body = await request.json();
        const { lead_id, action, notes } = body;

        if (!lead_id || !action) {
          return jsonResponse({ error: 'lead_id and action required' }, corsHeaders, 400);
        }

        const statusMap = { approve: 'Enrolled', reject: 'Not Enrolled' };
        const status = statusMap[action] || 'Pending';

        await baserowUpdate(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505', lead_id, {
          'Enrollment Status': status,
        });

        // Log approval note
        if (notes) {
          const teachers = await baserowList(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505');
          const teacher = teachers.find(t => t.id === lead_id);
          await baserowCreate(env, env.BASEROW_NOTES_TABLE_ID || '1207506', {
            'Note Title': `Approval: ${action}`,
            'Note': notes,
            'Teacher': lead_id,
          });
        }

        return jsonResponse({ lead_id, status, action }, corsHeaders);
      }

      // ── Bulk Approval ────────────────────────────────────────────
      if (path === '/api/leads/approve-bulk' && method === 'POST') {
        const body = await request.json();
        const { lead_ids, action } = body;

        if (!lead_ids || !Array.isArray(lead_ids) || !action) {
          return jsonResponse({ error: 'lead_ids array and action required' }, corsHeaders, 400);
        }

        const statusMap = { approve: 'Enrolled', reject: 'Not Enrolled' };
        const status = statusMap[action] || 'Pending';
        const results = [];

        for (const id of lead_ids) {
          await baserowUpdate(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505', id, {
            'Enrollment Status': status,
          });
          results.push({ id, status });
        }

        return jsonResponse({ processed: results.length, results }, corsHeaders);
      }

      // ── Get Leads (with filters) ─────────────────────────────────
      if (path === '/api/leads' && method === 'GET') {
        const urlParams = new URLSearchParams(url.search);
        const status = urlParams.get('status');
        const page = parseInt(urlParams.get('page') || '1');
        const size = parseInt(urlParams.get('size') || '100');

        let teachers = await baserowList(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505', page, size);

        if (status) {
          teachers = teachers.filter(t => {
            const s = t['Enrollment Status']?.value || t['Enrollment Status'];
            return s === status;
          });
        }

        return jsonResponse({
          leads: teachers,
          total: teachers.length,
        }, corsHeaders);
      }

      // ── Plans (Campaigns) ────────────────────────────────────────
      if (path === '/api/plans' && method === 'GET') {
        const plans = await baserowList(env, env.BASEROW_PLANS_TABLE_ID || '1207504');
        return jsonResponse({ plans }, corsHeaders);
      }

      if (path === '/api/plans' && method === 'POST') {
        const body = await request.json();
        const plan = await baserowCreate(env, env.BASEROW_PLANS_TABLE_ID || '1207504', {
          'Plan Name': body.name || 'New Plan',
          'Description': body.description || '',
        });
        return jsonResponse({ plan }, corsHeaders);
      }

      // ── Reminders ────────────────────────────────────────────────
      if (path === '/api/reminders' && method === 'GET') {
        const reminders = await baserowList(env, env.BASEROW_REMINDERS_TABLE_ID || '1207507');
        return jsonResponse({ reminders }, corsHeaders);
      }

      if (path === '/api/reminders' && method === 'POST') {
        const body = await request.json();
        const reminder = await baserowCreate(env, env.BASEROW_REMINDERS_TABLE_ID || '1207507', {
          'Reminder Title': body.title || 'Follow-up',
          'Reminder': body.message || '',
          'Due Date': body.due_date || new Date().toISOString().split('T')[0],
          'Teacher': body.teacher_id || null,
        });
        return jsonResponse({ reminder }, corsHeaders);
      }

      // ── Notes ────────────────────────────────────────────────────
      if (path === '/api/notes' && method === 'GET') {
        const notes = await baserowList(env, env.BASEROW_NOTES_TABLE_ID || '1207506');
        return jsonResponse({ notes }, corsHeaders);
      }

      if (path === '/api/notes' && method === 'POST') {
        const body = await request.json();
        const note = await baserowCreate(env, env.BASEROW_NOTES_TABLE_ID || '1207506', {
          'Note Title': body.title || 'Note',
          'Note': body.content || '',
          'Teacher': body.teacher_id || null,
        });
        return jsonResponse({ note }, corsHeaders);
      }

      // ── Reporting ────────────────────────────────────────────────
      if (path === '/api/reports/pipeline' && method === 'GET') {
        const teachers = await baserowList(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505');

        const report = {
          total_leads: teachers.length,
          by_status: {},
          by_department: {},
          generated_at: new Date().toISOString(),
        };

        for (const t of teachers) {
          const status = t['Enrollment Status']?.value || t['Enrollment Status'] || 'Unknown';
          report.by_status[status] = (report.by_status[status] || 0) + 1;
          const dept = t['Department']?.value || t['Department'] || 'Unknown';
          report.by_department[dept] = (report.by_department[dept] || 0) + 1;
        }

        return jsonResponse({ report }, corsHeaders);
      }

      if (path === '/api/reports/activity' && method === 'GET') {
        const notes = await baserowList(env, env.BASEROW_NOTES_TABLE_ID || '1207506');
        const reminders = await baserowList(env, env.BASEROW_REMINDERS_TABLE_ID || '1207507');

        return jsonResponse({
          report: {
            total_notes: notes.length,
            total_reminders: reminders.length,
            recent_notes: notes.slice(-10).reverse(),
            upcoming_reminders: reminders.slice(0, 10),
            generated_at: new Date().toISOString(),
          },
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

    try {
      // Check for upcoming reminders
      const reminders = await baserowList(env, env.BASEROW_REMINDERS_TABLE_ID || '1207507');
      const today = new Date().toISOString().split('T')[0];
      const dueReminders = reminders.filter(r => r['Due Date'] <= today);

      console.log(`Found ${dueReminders.length} reminders due today`);

      // Check for leads needing follow-up
      const teachers = await baserowList(env, env.BASEROW_TEACHERS_TABLE_ID || '1207505');
      const pending = teachers.filter(t =>
        t['Enrollment Status']?.value === 'Pending'
      );

      console.log(`Found ${pending.length} leads needing attention`);
    } catch (err) {
      console.error('Cron error:', err);
    }
  },
};

// ── Baserow Helpers ──────────────────────────────────────────────

function jsonResponse(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

const BASEROW_API = 'https://api.baserow.io';

async function baserowRequest(env, method, path, body = null) {
  const token = env.BASEROW_API_TOKEN;
  if (!token) {
    console.error('BASEROW_API_TOKEN not set');
    return { error: 'BASEROW_API_TOKEN not set' };
  }

  const headers = {
    'Authorization': `Token ${token}`,
    'Content-Type': 'application/json',
  };

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASEROW_API}${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    console.error(`Baserow API error: ${res.status} ${err}`);
    return { error: `Baserow ${res.status}: ${err}` };
  }
  const text = await res.text();
  if (!text || text.trim() === '') {
    return { success: true, empty: true };
  }
  return JSON.parse(text);
}

async function baserowCreate(env, tableId, data) {
  if (!tableId) return null;
  return baserowRequest(env, 'POST', `/api/database/rows/table/${tableId}/?user_field_names=true`, data);
}

async function baserowList(env, tableId, page = 1, size = 200) {
  if (!tableId) return [];
  const res = await baserowRequest(env, 'GET', `/api/database/rows/table/${tableId}/?user_field_names=true&page=${page}&size=${size}`);
  return res ? res.results || [] : [];
}

async function baserowUpdate(env, tableId, rowId, data) {
  if (!tableId || !rowId) return null;
  return baserowRequest(env, 'PATCH', `/api/database/rows/table/${tableId}/${rowId}/?user_field_names=true`, data);
}

async function baserowDelete(env, tableId, rowId) {
  if (!tableId || !rowId) return null;
  return baserowRequest(env, 'DELETE', `/api/database/rows/table/${tableId}/${rowId}/`);
}
