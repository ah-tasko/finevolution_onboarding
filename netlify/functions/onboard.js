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

  // ── Helpers ──────────────────────────────────────────
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

  // ── «Послуги клієнтам» — жорстка прив'язка list_id ──
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

  // ── ПОВНИЙ ОНБОРДИНГ ─────────────────────────────────
  if (body.action === 'onboard') {
    const { person, company, services, otherService } = body;
    const results = { created: [], errors: [] };

    try {
      // 1. Побудувати ім'я ФО
      const foName = [person.lastName, person.firstName, person.middleName]
        .filter(Boolean).join(' ');

      const foDesc = [
        person.phone       ? `📞 ${person.phone}` : '',
        person.email       ? `📧 ${person.email}` : '',
        person.channel     ? `💬 ${person.channel}${person.chatName ? ' — ' + person.chatName : ''}` : '',
        person.citizenship ? `🌍 Громадянство: ${person.citizenship}` : '',
        person.taxResidency? `🏦 Податкове резидентство: ${person.taxResidency}` : '',
        company.name       ? `🏢 Компанія: ${company.name} (${company.jurisdiction})` : '',
        person.notes       ? `📝 ${person.notes}` : '',
      ].filter(Boolean).join('\n');

      // 2. Створити ФО в «Фізичні особи»
      const foTask = await cuPost('/list/901521194778/task', {
        name: foName,
        description: foDesc,
      });
      if (!foTask.id) throw new Error(`ФО не створено: ${JSON.stringify(foTask)}`);
      results.created.push({ label: `👤 ${foName}`, url: foTask.url });

      // 3. Перевірити дублі компанії в «Компанії»
      let companyTaskId = null;
      let companyTaskUrl = null;

      const searchResp = await cuGet(
        `/team/90152314463/task?list_id[]=901520817116&search=${encodeURIComponent(company.name)}&page=0`
      );
      const existing = (searchResp.tasks || []).find(t =>
        t.name.toLowerCase().trim() === company.name.toLowerCase().trim()
      );

      if (existing) {
        companyTaskId = existing.id;
        companyTaskUrl = existing.url;
        results.created.push({ label: `🏢 Компанія (існуюча): ${company.name}`, url: existing.url });
      } else {
        // Створити нову компанію в «Компанії» (MASTER DATABASE)
        const compDesc = [
          `🌍 Юрисдикція: ${company.jurisdiction}`,
          company.regCountry ? `📍 Країна реєстрації: ${company.regCountry}` : '',
          `👤 Засновник: ${foName}`,
          `👔 Host AM: ${person.hostAm}`,
        ].filter(Boolean).join('\n');

        const compTask = await cuPost('/list/901520817116/task', {
          name: company.name,
          description: compDesc,
        });
        if (!compTask.id) throw new Error(`Компанія не створена: ${JSON.stringify(compTask)}`);
        companyTaskId = compTask.id;
        companyTaskUrl = compTask.url;
        results.created.push({ label: `🏢 Компанія: ${company.name}`, url: compTask.url });
      }

      // 4. Зв'язати ФО ↔ Компанія (обидва боки)
      await cuPost(`/task/${foTask.id}/field/c52dabd5-ab4d-435a-a619-bc5dbc3fbc59`, {
        value: { add: [companyTaskId] }
      });
      await cuPost(`/task/${companyTaskId}/field/93402ad8-68c0-4e9f-9c9a-f5b799dfb50c`, {
        value: { add: [foTask.id] }
      });

      // 5. Отримати services_list_id для юрисдикції
      const servicesListId = SERVICES_LISTS[company.jurisdiction];

      // 6. Динамічно отримати field map: subcategory_id → field_id
      // з списку «Послуги клієнтам/[Юрисдикція]»
      let fieldMap = {}; // subcategory_id → field_id
      if (servicesListId) {
        const fieldsResp = await cuGet(`/list/${servicesListId}/field`);
        const fields = fieldsResp.fields || [];
        for (const f of fields) {
          if (f.type === 'list_relationship' && f.type_config?.subcategory_id) {
            fieldMap[f.type_config.subcategory_id] = f.id;
          }
        }
      }

      // 7. Створити задачу компанії в «Послуги клієнтам/[Юрисдикція]»
      //    (це буде "профіль" компанії в контексті послуг)
      let serviceCompanyTaskId = null;
      if (servicesListId) {
        const scTask = await cuPost(`/list/${servicesListId}/task`, {
          name: company.name,
          description: `👤 ${foName}\n👔 ${person.hostAm}\n🌍 ${company.jurisdiction}`,
        });
        if (scTask.id) {
          serviceCompanyTaskId = scTask.id;
          results.created.push({ label: `📁 ${company.name} (послуги)`, url: scTask.url });
        }
      }

      // 8. По кожній послузі → створити задачу в JURISDICTIONS + прив'язати
      for (const service of (services || [])) {
        // Задача послуги іде в список з JURISDICTIONS (service.listId)
        const sTask = await cuPost(`/list/${service.listId}/task`, {
          name: `${company.name} — ${service.name}`,
          description: `👤 Клієнт: ${foName}\n👔 Менеджер: ${person.hostAm}`,
        });

        if (sTask.id) {
          results.created.push({ label: `📋 ${service.name}`, url: sTask.url });

          // Прив'язати задачу послуги → задача компанії в «Послуги клієнтам»
          // через динамічно знайдений field_id
          if (serviceCompanyTaskId) {
            const fieldId = fieldMap[service.listId];
            if (fieldId) {
              await cuPost(`/task/${serviceCompanyTaskId}/field/${fieldId}`, {
                value: { add: [sTask.id] }
              });
            }
          }
        } else {
          results.errors.push(`Послуга ${service.name}: ${JSON.stringify(sTask)}`);
        }
      }

      // 9. Інша послуга
      if (otherService && servicesListId) {
        const otherTask = await cuPost(`/list/${servicesListId}/task`, {
          name: `⚡ НОВА: ${company.name} — ${otherService}`,
          description: `👤 Клієнт: ${foName}\n👔 Менеджер: ${person.hostAm}\n⚠️ Потребує уточнення шаблону`,
        });
        if (otherTask.id) {
          results.created.push({ label: `⚡ ${otherService}`, url: otherTask.url });
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results),
      };

    } catch(err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: err.message, created: results.created }),
      };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
