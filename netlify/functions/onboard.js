exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN;

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action } = body;

  try {
    // ── CLAUDE ──────────────────────────────────────────
    if (action === 'claude') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          system: body.system,
          messages: body.messages,
        })
      });
      const data = await resp.json();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    // ── CLICKUP CREATE TASK ──────────────────────────────
    if (action === 'clickup_create_task') {
      const resp = await fetch(`https://api.clickup.com/api/v2/list/${body.listId}/task`, {
        method: 'POST',
        headers: {
          'Authorization': CLICKUP_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: body.name, description: body.description || '' }),
      });
      const data = await resp.json();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    // ── CLICKUP SEARCH (перевірка дублів) ────────────────
    if (action === 'clickup_search') {
      const resp = await fetch(
        `https://api.clickup.com/api/v2/team/${body.workspaceId}/task?list_id[]=${body.listId}&search=${encodeURIComponent(body.query)}`,
        {
          headers: { 'Authorization': CLICKUP_TOKEN },
        }
      );
      const data = await resp.json();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch(err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
