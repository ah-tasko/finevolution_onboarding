exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const CLICKUP_TOKEN = process.env.CLICKUP_TOKEN;

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  async function cuPost(path, data) {
    const r = await fetch(`https://api.clickup.com/api/v2${path}`, {
      method: 'POST',
      headers: { 'Authorization': CLICKUP_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return r.json();
  }

  async function cuGet(path) {
    const r = await fetch(`https://api.clickup.com/api/v2${path}`, {
      headers: { 'Authorization': CLICKUP_TOKEN }
    });
    return r.json();
  }

  // Всі задачі призначаються Олені — вона розподіляє вручну
  const ASSIGNEES = ['106604125'];

  const SERVICES_LISTS = {
    'ESTONIA':        '901522300107',
    'USA':            '901522318620',
    'Cyrpus':         '901522378371',
    'UK':             '901522378372',
    'Switzerland':    '901522378373',
    'Hong Kong':      '901522378374',
    'Spain':          '901522378375',
    'Czech Republic': '901522378376',
    'Portugal':       '901522378377',
    'Romania':        '901522378378',
    'Hungary':        '901522378379',
    'Lithuania':      '901522378380',
    'Slovakia':       '901522378381',
    'Germany':        '901522378382',
    'UAE':            '901522378383',
    'Singapore':      '901522378384',
    'Ukraine':        '901522378385',
    'Poland':         '901522378386',
    'Latvia':         '901522378387',
    'Ireland':        '901522378546',
  };

  const CITIZENSHIP_MAP = {
    'Україна':0,'Болгарія':1,'Велика Британія':2,'Гонконг':3,'Естонія':4,
    'Ірландія':5,'Іспанія':6,'Італія':7,'Індонезія':8,'Канада':9,'Кіпр':10,
    'Мальта':11,'Німеччина':12,'ОАЕ (UAE)':13,'Польща':14,'Румунія':15,
    'США':16,'Угорщина':17,'Франція':18,'Чехія':19,'Швейцарія':20,'Литва':21,
  };
  const TAX_RESIDENCY_MAP = {
    'Україна':0,'Кіпр':1,'Естонія':2,'Польща':3,'Велика Британія':4,'США':5,
    'ОАЕ':6,'Нідерланди':7,'Німеччина':8,'Австрія':9,'Швейцарія':10,'Мальта':11,
    'Люксембург':12,'Ірландія':13,'Інше':14,
  };
  const CHANNEL_MAP = { 'Signal':0, 'Telegram':1, 'WhatsApp':2 };
  const REG_COUNTRY_MAP = {
    'Україна':0,'Болгарія':1,'Велика Британія':2,'Гонконг':3,'Естонія':4,
    'Ірландія':5,'Іспанія':6,'Італія':7,'Індонезія':8,'Канада':9,'Кіпр':10,
    'Мальта':11,'Німеччина':12,'ОАЕ (UAE)':13,'Польща':14,'Румунія':15,
    'США':16,'Угорщина':17,'Франція':18,'Чехія':19,'Швейцарія':20,
    'Литва':21,'Португалія':22,'Словаччина':23,'Латвія':24,'Сінгапур':25,
  };

  if (body.action === 'onboard') {
    const { person, company, services, otherService, founders } = body;
    const results = { created: [], errors: [] };

    try {
      const foName = [person.lastName, person.firstName, person.middleName]
        .filter(Boolean).join(' ');

      // ── Кастомні поля ФО ──
      const foCustomFields = [];

      if (person.phone)
        foCustomFields.push({ id: '4450f80a-854f-48b5-84b4-145e324474a1', value: person.phone });
      if (person.email)
        foCustomFields.push({ id: '919eef7e-f220-4d9a-87f7-d104df8e63ea', value: person.email });
      if (person.channel && CHANNEL_MAP[person.channel] !== undefined)
        foCustomFields.push({ id: '51cc21fe-e3ff-4daa-885d-bdb5305456b9', value: CHANNEL_MAP[person.channel] });
      if (person.chatName)
        foCustomFields.push({ id: '669ba179-3fad-45c3-9c83-9a557f46a7ea', value: person.chatName });
      if (person.citizenship && CITIZENSHIP_MAP[person.citizenship] !== undefined)
        foCustomFields.push({ id: '092a8da6-3b4e-47ef-97a6-902eb10bc5b8', value: CITIZENSHIP_MAP[person.citizenship] });
      if (person.taxResidency && TAX_RESIDENCY_MAP[person.taxResidency] !== undefined)
        foCustomFields.push({ id: 'e1c1ccc2-ab7a-42e7-b305-1cf08a036a59', value: TAX_RESIDENCY_MAP[person.taxResidency] });
      // Host AM = Olena автоматично
      foCustomFields.push({ id: 'c6589add-5d8d-4a21-903f-0e4f6ee9903b', value: [{ id: 106604125 }] });
      // Client Onboarding Date = сьогодні
      foCustomFields.push({ id: 'fe92b020-8b72-4c96-8216-bff0758791f3', value: Date.now() });
      if (person.notes)
        foCustomFields.push({ id: '3dd54127-2750-4ef4-ae8d-ac61cfc0243c', value: person.notes });

      // 1. Створити ФО
      const foTask = await cuPost('/list/901521194778/task', {
        name: foName,
        assignees: ASSIGNEES,
        custom_fields: foCustomFields,
      });
      if (!foTask.id) throw new Error(`ФО не створено: ${JSON.stringify(foTask)}`);
      results.created.push({ label: `👤 ${foName}`, url: foTask.url });

      // 2. Перевірити дублі компанії
      let companyTaskId = null;
      const searchResp = await cuGet(
        `/team/90152314463/task?list_id[]=901520817116&search=${encodeURIComponent(company.name)}&page=0`
      );
      const existing = (searchResp.tasks || []).find(t =>
        t.name.toLowerCase().trim() === company.name.toLowerCase().trim()
      );

      if (existing) {
        companyTaskId = existing.id;
        results.created.push({ label: `🏢 Компанія (існуюча): ${company.name}`, url: existing.url });
      } else {
        // ── Кастомні поля Компанії ──
        const compCustomFields = [];

        if (company.regCountry && REG_COUNTRY_MAP[company.regCountry] !== undefined)
          compCustomFields.push({ id: '5eefba69-8e39-4b99-9097-937140c7fc92', value: REG_COUNTRY_MAP[company.regCountry] });
        // Host AM = Olena автоматично
        compCustomFields.push({ id: 'c6589add-5d8d-4a21-903f-0e4f6ee9903b', value: [{ id: 106604125 }] });
        if (person.channel && CHANNEL_MAP[person.channel] !== undefined)
          compCustomFields.push({ id: '51cc21fe-e3ff-4daa-885d-bdb5305456b9', value: CHANNEL_MAP[person.channel] });
        if (person.chatName)
          compCustomFields.push({ id: '669ba179-3fad-45c3-9c83-9a557f46a7ea', value: person.chatName });
        // В послугах = Новий
        compCustomFields.push({ id: 'b9d0306f-1a0d-4e80-9faf-6cff2e7e73d7', value: 1 });

        // Засновники (до 5)
        const founderNameFields = [
          'd5c651c0-d603-44f1-8ab1-73b7b641710d',
          '3f84861a-55d0-4190-8f75-9badc24fe0a5',
          '8c8db650-c594-4be9-ae83-1db534aa9e74',
          '7be35d79-270c-47a9-90d4-e11eef8b65b6',
          '74d51780-7746-4e01-bc57-670f6943c4ea',
        ];
        const founderShareFields = [
          'ed53f2c2-cad9-4ae0-ac16-c75a013e8829',
          '3d858a57-9def-4d88-bc7b-53960c722aca',
          '662cfe04-8e63-49f5-8053-2ab60aac9cbb',
          '489e3a92-c65f-4a66-bf58-722866d92b45',
          'e06d411c-8ad5-4870-b56f-4b63143134a1',
        ];
        (founders || []).slice(0, 5).forEach((f, i) => {
          if (f.name) compCustomFields.push({ id: founderNameFields[i], value: f.name });
          if (f.share) compCustomFields.push({ id: founderShareFields[i], value: parseFloat(f.share) });
        });
        if (founders && founders.length > 0)
          compCustomFields.push({ id: '316a1806-d5ec-43e8-8f0c-44d9508ddce6', value: Math.min(founders.length - 1, 2) });

        const compTask = await cuPost('/list/901520817116/task', {
          name: company.name,
          assignees: ASSIGNEES,
          custom_fields: compCustomFields,
        });
        if (!compTask.id) throw new Error(`Компанія не створена: ${JSON.stringify(compTask)}`);
        companyTaskId = compTask.id;
        results.created.push({ label: `🏢 Компанія: ${company.name}`, url: compTask.url });
      }

      // 3. Зв'язати ФО ↔ Компанія
      await cuPost(`/task/${foTask.id}/field/c52dabd5-ab4d-435a-a619-bc5dbc3fbc59`, {
        value: { add: [companyTaskId] }
      });
      await cuPost(`/task/${companyTaskId}/field/93402ad8-68c0-4e9f-9c9a-f5b799dfb50c`, {
        value: { add: [foTask.id] }
      });

      // 4. Задачі послуг в JURISDICTIONS
      for (const service of (services || [])) {
        const sTask = await cuPost(`/list/${service.listId}/task`, {
          name: `${company.name} — ${service.name}`,
          assignees: ASSIGNEES,
          description: `👤 ${foName}`,
        });
        if (sTask.id) {
          results.created.push({ label: `📋 ${service.name}`, url: sTask.url });
        } else {
          results.errors.push(`${service.name}: ${JSON.stringify(sTask)}`);
        }
      }

      // 5. Інша послуга
      const servicesListId = SERVICES_LISTS[company.jurisdiction];
      if (otherService && servicesListId) {
        const otherTask = await cuPost(`/list/${servicesListId}/task`, {
          name: `⚡ НОВА: ${company.name} — ${otherService}`,
          assignees: ASSIGNEES,
          description: `👤 ${foName}\n⚠️ Потребує уточнення шаблону`,
        });
        if (otherTask.id)
          results.created.push({ label: `⚡ ${otherService}`, url: otherTask.url });
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
      };

    } catch(err) {
      console.error('Onboard error:', err.message);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message, created: results.created }),
      };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
