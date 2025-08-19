import {
  getClient, clearTokens, saveTokens, tryRefresh, getSavedTokens,
  SOCIOS_COLLECTION, SOCIOS_PK,
  APORTES_COLLECTION, APORTES_PK,
  COLLECTION, PRIMARY_KEY,
} from './config.js';

import {
  readItems, createItem, updateItem, deleteItem
} from 'https://cdn.jsdelivr.net/npm/@directus/sdk@latest/+esm';

// --- Gate de sesión ---
const saved = JSON.parse(localStorage.getItem('directus_auth') || 'null');
if (!saved?.access_token || !saved?.refresh_token) {
  location.href = 'login.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  const client = getClient();

  async function ensureSession() {
    try {
      await client.request(readItems(SOCIOS_COLLECTION, { limit: 1 }));
    } catch (e) {
      const ok = await tryRefresh(client);
      if (!ok) {
        try { await client.logout(); } catch {}
        clearTokens();
        location.href = 'login.html';
        throw e;
      }
    }
  }
  await ensureSession();

  // ---------- Estado ----------
  const app = {
    activeModule: null,
    modules: {
      socios:   { container: null, data: [], page: 1, pageSize: 8 },
      aportes:  { container: null, data: [], page: 1, pageSize: 8 },
    },
    sociosIndex: new Map(), // clave SIEMPRE string: ID -> "Nombre Apellido"
    sociosList:  [],        // [{id (string), label}]
  };

  // ---------- DOM ----------
  const mainContent   = document.getElementById('contenido-principal');
  const moduleTitle   = document.getElementById('module-title');
  const navLinks      = document.querySelectorAll('.nav-link');
  const screenBlocker = document.getElementById('screen-blocker');
  const logoutBtn     = document.getElementById('logout-btn');

  // ---------- Logout ----------
  logoutBtn.addEventListener('click', async () => {
    try { await client.logout(); } catch {}
    clearTokens();
    location.href = 'login.html';
  });

  // ---------- Nav ----------
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const moduleName = e.currentTarget.id.split('-')[1];
      switchView(moduleName);
    });
  });

  async function switchView(moduleName) {
    if (app.activeModule === moduleName) return;

    if (app.activeModule && app.modules[app.activeModule]?.container) {
      app.modules[app.activeModule].container.classList.add('hidden');
    }

    app.activeModule = moduleName;
    const module = app.modules[moduleName];

    if (module && module.container) {
      module.container.classList.remove('hidden');
      if (moduleName === 'socios')  fetchAndRenderSocios(true);
      if (moduleName === 'aportes') fetchAndRenderAportes(true);
    } else {
      try {
        const response = await fetch(`${moduleName}.html`);
        if (!response.ok) {
          mainContent.innerHTML = `<div class="p-4 text-center text-slate-500">El módulo "${moduleName}" aún no ha sido creado.</div>`;
          return;
        }
        const moduleHtml = await response.text();
        const container = document.createElement('div');
        container.id = `module-${moduleName}`;
        container.innerHTML = moduleHtml;
        mainContent.appendChild(container);
        if (module) module.container = container;

        if (moduleName === 'socios')  initSociosModule();
        if (moduleName === 'aportes') initAportesModule();
      } catch (error) {
        console.error(`Error al cargar el módulo ${moduleName}:`, error);
      }
    }

    moduleTitle.textContent = `Módulo de ${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)}`;
    navLinks.forEach(l => l.classList.toggle('active', l.id === `nav-${moduleName}`));
  }

  // Utilidad: extraer ID de mensajes realtime
  function extractIdFromMsg(msg, pk) {
    const d = msg?.data;
    if (Array.isArray(d) && d.length) {
      const first = d[0];
      if (typeof first === 'object' && first != null) {
        return first[pk] ?? first.id ?? undefined;
      } else if (typeof first === 'number' || typeof first === 'string') {
        return first;
      }
    }
    const k = msg?.keys ?? d?.keys;
    if (Array.isArray(k) && k.length)  return k[0];
    if (k && typeof k === 'object')    return k[pk] ?? k.id ?? undefined;
    if (d && typeof d === 'object')    return d[pk] ?? d.id ?? undefined;
    return undefined;
  }

  // Normalización de clave para Map (siempre string)
  const keyify = (v) => String(v ?? '');

  // ========== SOCIOS ==========
  const SOCIOS_FIELDS = [
    'ID_Socio','Nombres_Completos','Apellidos_Completos','Cedula_Identidad',
    'Fecha_Nacimiento','Direccion_Domicilio','Telefono_Celular',
    'Correo_Electronico','Fecha_Ingreso','Estado_Socio',
  ];

  function ensurePager(container, modKey) {
    if (container.querySelector(`#pager-${modKey}`)) return;
    const pager = document.createElement('div');
    pager.id = `pager-${modKey}`;
    pager.className = 'flex items-center justify-between mt-4 text-sm text-slate-600';
    pager.innerHTML = `
      <div><span id="total-reg-${modKey}"></span></div>
      <div class="flex items-center gap-2">
        <button id="prev-page-${modKey}" class="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300">Anterior</button>
        <span id="page-indicator-${modKey}" class="px-2"></span>
        <button id="next-page-${modKey}" class="px-3 py-1 rounded bg-slate-200 hover:bg-slate-300">Siguiente</button>
        <select id="page-size-${modKey}" class="ml-3 border rounded px-2 py-1">
          <option value="5">5</option>
          <option value="8" selected>8</option>
          <option value="10">10</option>
          <option value="20">20</option>
        </select>
      </div>`;
    container.querySelector('.bg-white.p-6').appendChild(pager);

    pager.querySelector(`#prev-page-${modKey}`).addEventListener('click', () => changePage(modKey, -1));
    pager.querySelector(`#next-page-${modKey}`).addEventListener('click', () => changePage(modKey, +1));
    pager.querySelector(`#page-size-${modKey}`).addEventListener('change', (e) => {
      const m = app.modules[modKey];
      m.pageSize = Number(e.target.value) || 8;
      m.page = 1;
      if (modKey === 'socios')  renderSocios(m.data);
      if (modKey === 'aportes') renderAportes(m.data);
    });
  }
  function changePage(modKey, delta) {
    const m = app.modules[modKey];
    const totalPages = Math.max(1, Math.ceil(m.data.length / m.pageSize));
    m.page = Math.min(totalPages, Math.max(1, m.page + delta));
    if (modKey === 'socios')  renderSocios(m.data);
    if (modKey === 'aportes') renderAportes(m.data);
  }

  function initSociosModule() {
    const container = app.modules.socios.container;
    container.querySelector('#add-socio-btn').addEventListener('click', () => openEditSocio(null));
    container.querySelector('#socio-form').addEventListener('submit', handleSocioSubmit);
    container.querySelector('#cancel-btn').addEventListener('click', () => container.querySelector('#socio-modal').classList.replace('flex','hidden'));
    ensurePager(container, 'socios');
    fetchAndRenderSocios();
    subscribeRealtimeGeneric({
      collection: SOCIOS_COLLECTION, pk: SOCIOS_PK, fields: SOCIOS_FIELDS,
      onCreateOrUpdate: (row) => {
        const m = app.modules.socios;
        const i = m.data.findIndex(r => r[SOCIOS_PK] === row[SOCIOS_PK]);
        if (i >= 0) m.data[i] = row; else m.data.unshift(row);
        renderSocios(m.data);
        indexSocio(row);
      },
      onDelete: (id) => {
        const m = app.modules.socios;
        m.data = m.data.filter(r => r[SOCIOS_PK] !== id);
        renderSocios(m.data);
        app.sociosIndex.delete(keyify(id));
        app.sociosList = app.sociosList.filter(o => o.id !== keyify(id));
      },
      onPoll: () => (app.activeModule === 'socios') && fetchAndRenderSocios(true),
    });
  }

  function renderSocios(all) {
    const container = app.modules.socios.container;
    const tableBody = container?.querySelector('#socios-table-body');
    if (!tableBody) return;

    const m = app.modules.socios;
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / m.pageSize));
    const start = (m.page - 1) * m.pageSize;
    const pageRows = all.slice(start, start + m.pageSize);

    const totalEl = container.querySelector('#total-reg-socios');
    const indEl   = container.querySelector('#page-indicator-socios');
    if (totalEl) totalEl.textContent = `Total: ${total}`;
    if (indEl)   indEl.textContent   = `Página ${m.page} / ${totalPages}`;

    tableBody.innerHTML = '';
    if (!pageRows.length) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center p-8">No hay socios registrados.</td></tr>';
      return;
    }

    pageRows.forEach((s) => {
      const fullName = `${s?.Nombres_Completos ?? ''} ${s?.Apellidos_Completos ?? ''}`.trim() || '—';
      const cedula   = s?.Cedula_Identidad ?? '';
      const tel      = s?.Telefono_Celular ?? '';
      const fechaIng = s?.Fecha_Ingreso ? new Date(s.Fecha_Ingreso).toLocaleDateString() : '';
      const estado   = (s?.Estado_Socio ?? 'Activo');

      const tr = document.createElement('tr');
      tr.className = 'bg-white border-b hover:bg-slate-50';
      tr.innerHTML = `
        <td class="py-4 px-6 font-medium text-slate-900">${fullName}</td>
        <td class="py-4 px-6">${cedula}</td>
        <td class="py-4 px-6">${tel}</td>
        <td class="py-4 px-6">${fechaIng}</td>
        <td class="py-4 px-6">
          <span class="px-2 py-1 font-semibold leading-tight ${estado === 'Activo' ? 'text-green-700 bg-green-100' : 'text-red-700 bg-red-100'} rounded-full">
            ${estado}
          </span>
        </td>
        <td class="py-4 px-6 flex gap-3">
          <button class="edit-btn font-medium text-blue-600 hover:underline">Editar</button>
          <button class="del-btn font-medium text-red-600 hover:underline">Eliminar</button>
        </td>
      `;
      tr.querySelector('.edit-btn').addEventListener('click', () => openEditSocio(s));
      tr.querySelector('.del-btn').addEventListener('click', () => confirmDeleteSocio(s));
      tableBody.appendChild(tr);

      indexSocio(s);
    });
  }

  function renderSociosSkeleton(rows = 5) {
    const container = app.modules.socios.container;
    const tableBody = container?.querySelector('#socios-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    for (let i = 0; i < rows; i++) {
      const tr = document.createElement('tr');
      tr.className = 'bg-white border-b skeleton-row';
      tr.innerHTML = `
        <td class="py-4 px-6"><div class="skeleton h-4 w-3/4"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-full"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-full"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-full"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-1/2"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>`;
      tableBody.appendChild(tr);
    }
  }

  async function fetchAndRenderSocios(isBackground = false) {
    if (!isBackground) renderSociosSkeleton();
    try {
      const data = await client.request(readItems(SOCIOS_COLLECTION, {
        fields: SOCIOS_FIELDS, sort: ['-ID_Socio'], limit: 500
      }));
      const m = app.modules.socios;
      m.data = data ?? [];
      const totalPages = Math.max(1, Math.ceil(m.data.length / m.pageSize));
      if (m.page > totalPages) m.page = totalPages;
      renderSocios(m.data);
    } catch (e) {
      console.error('Error al obtener socios:', e?.message);
      const tableBody = app.modules.socios.container?.querySelector('#socios-table-body');
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="6" class="text-center p-8 text-red-500">Error al cargar datos.</td></tr>`;
    }
  }

  function indexSocio(s) {
    const idRaw = s?.[SOCIOS_PK];
    if (idRaw == null) return;
    const id = keyify(idRaw);
    const label = `${s?.Nombres_Completos ?? ''} ${s?.Apellidos_Completos ?? ''}`.trim() || `Socio ${id}`;
    app.sociosIndex.set(id, label);
    const exists = app.sociosList.find(x => x.id === id);
    if (!exists) app.sociosList.push({ id, label });
  }

  function openEditSocio(socio) {
    const container = app.modules.socios.container;
    const modal = container.querySelector('#socio-modal');
    const form = container.querySelector('#socio-form');
    form.reset();
    container.querySelector('#modal-title').textContent = socio ? 'Editar Socio' : 'Añadir Nuevo Socio';
    if (!socio) form.querySelector('#ID_Socio').value = '';
    if (socio) {
      form.querySelector('#ID_Socio').value        = socio.ID_Socio;
      form.querySelector('#nombres').value         = socio.Nombres_Completos ?? '';
      form.querySelector('#apellidos').value       = socio.Apellidos_Completos ?? '';
      form.querySelector('#cedula').value          = socio.Cedula_Identidad ?? '';
      form.querySelector('#fechaNacimiento').value = socio.Fecha_Nacimiento ?? '';
      form.querySelector('#telefono').value        = socio.Telefono_Celular ?? '';
      form.querySelector('#email').value           = socio.Correo_Electronico ?? '';
      form.querySelector('#direccion').value       = socio.Direccion_Domicilio ?? '';
    }
    modal.classList.replace('hidden','flex');
  }

  async function handleSocioSubmit(e) {
    e.preventDefault();
    screenBlocker.classList.remove('hidden');
    const form = e.target;
    const id = form.querySelector('#ID_Socio').value;
    const socioData = {
      Nombres_Completos:   form.querySelector('#nombres').value,
      Apellidos_Completos: form.querySelector('#apellidos').value,
      Cedula_Identidad:    form.querySelector('#cedula').value,
      Fecha_Nacimiento:    form.querySelector('#fechaNacimiento').value || null,
      Direccion_Domicilio: form.querySelector('#direccion').value,
      Telefono_Celular:    form.querySelector('#telefono').value,
      Correo_Electronico:  form.querySelector('#email').value,
    };
    try {
      if (id) {
        await client.request(updateItem(SOCIOS_COLLECTION, id, socioData));
      } else {
        socioData.Fecha_Ingreso = new Date().toISOString();
        await client.request(createItem(SOCIOS_COLLECTION, socioData));
      }
      app.modules.socios.container.querySelector('#socio-modal').classList.replace('flex','hidden');
      await fetchAndRenderSocios();
    } catch (err) {
      alert('Error al guardar: ' + (err?.message || 'desconocido'));
      console.error(err);
    } finally {
      screenBlocker.classList.add('hidden');
    }
  }

  function confirmDeleteSocio(socio) {
    if (!confirm(`¿Eliminar al socio #${socio[SOCIOS_PK]} (${socio.Nombres_Completos} ${socio.Apellidos_Completos})?`)) return;
    doDeleteSocio(socio[SOCIOS_PK]);
  }
  async function doDeleteSocio(idVal) {
    try {
      await client.request(deleteItem(SOCIOS_COLLECTION, idVal));
      await fetchAndRenderSocios(true);
    } catch (err) {
      console.error(err);
      alert('Error al eliminar. Revisa permisos y PRIMARY_KEY.');
    }
  }

  // ========== APORTES ==========
  const APORTES_FIELDS = [
    'ID_Aporte','ID_Socio','Monto_Aporte','Fecha_Aporte','Tipo_Aporte'
  ];

  function initAportesModule() {
    const container = app.modules.aportes.container;
    container.querySelector('#add-aporte-btn').addEventListener('click', () => openEditAporte(null));
    container.querySelector('#aporte-cancel-btn').addEventListener('click', () => container.querySelector('#aporte-modal').classList.replace('flex','hidden'));
    container.querySelector('#aporte-form').addEventListener('submit', handleAporteSubmit);
    ensurePager(container, 'aportes');

    ensureSociosIndex().then(() => {
      populateSocioSelect(container.querySelector('#ID_Socio'));
    });

    fetchAndRenderAportes();

    subscribeRealtimeGeneric({
      collection: APORTES_COLLECTION, pk: APORTES_PK, fields: APORTES_FIELDS,
      onCreateOrUpdate: (row) => {
        const m = app.modules.aportes;
        const i = m.data.findIndex(r => r[APORTES_PK] === row[APORTES_PK]);
        if (i >= 0) m.data[i] = row; else m.data.unshift(row);
        renderAportes(m.data);
      },
      onDelete: (id) => {
        const m = app.modules.aportes;
        m.data = m.data.filter(r => r[APORTES_PK] !== id);
        renderAportes(m.data);
      },
      onPoll: () => (app.activeModule === 'aportes') && fetchAndRenderAportes(true),
    });
  }

  async function ensureSociosIndex() {
    if (app.sociosList.length) return;
    const rows = await client.request(readItems(SOCIOS_COLLECTION, {
      fields: ['ID_Socio','Nombres_Completos','Apellidos_Completos'],
      limit: 1000, sort: ['Nombres_Completos','Apellidos_Completos']
    }));
    (rows || []).forEach(indexSocio);
  }

  function populateSocioSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="" disabled selected>Seleccione un socio…</option>';
    app.sociosList
      .sort((a,b) => a.label.localeCompare(b.label))
      .forEach(({id,label}) => {
        const opt = document.createElement('option');
        opt.value = id;                 // id como string
        opt.textContent = label;
        selectEl.appendChild(opt);
      });
  }

  function renderAportes(all) {
    const container = app.modules.aportes.container;
    const tableBody = container?.querySelector('#aportes-table-body');
    if (!tableBody) return;

    const m = app.modules.aportes;
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / m.pageSize));
    const start = (m.page - 1) * m.pageSize;
    const pageRows = all.slice(start, start + m.pageSize);

    const totalEl = container.querySelector('#total-reg-aportes');
    const indEl   = container.querySelector('#page-indicator-aportes');
    if (totalEl) totalEl.textContent = `Total: ${total}`;
    if (indEl)   indEl.textContent   = `Página ${m.page} / ${totalPages}`;

    tableBody.innerHTML = '';
    if (!pageRows.length) {
      tableBody.innerHTML = '<tr><td colspan="5" class="text-center p-8">No hay aportes registrados.</td></tr>';
      return;
    }

    pageRows.forEach((a) => {
      const socioName = app.sociosIndex.get(keyify(a.ID_Socio)) ?? `#${a.ID_Socio}`;
      const monto     = Number(a?.Monto_Aporte ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const fecha     = a?.Fecha_Aporte ? new Date(a.Fecha_Aporte).toLocaleDateString() : '';
      const tipo      = a?.Tipo_Aporte ?? '—';

      const tr = document.createElement('tr');
      tr.className = 'bg-white border-b hover:bg-slate-50';
      tr.innerHTML = `
        <td class="py-4 px-6 font-medium text-slate-900">${socioName}</td>
        <td class="py-4 px-6">$ ${monto}</td>
        <td class="py-4 px-6">${fecha}</td>
        <td class="py-4 px-6">${tipo}</td>
        <td class="py-4 px-6 flex gap-3">
          <button class="edit-btn font-medium text-blue-600 hover:underline">Editar</button>
          <button class="del-btn font-medium text-red-600 hover:underline">Eliminar</button>
        </td>
      `;
      tr.querySelector('.edit-btn').addEventListener('click', () => openEditAporte(a));
      tr.querySelector('.del-btn').addEventListener('click', () => confirmDeleteAporte(a));
      tableBody.appendChild(tr);
    });
  }

  function renderAportesSkeleton(rows=5) {
    const container = app.modules.aportes.container;
    const tableBody = container?.querySelector('#aportes-table-body');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    for (let i=0;i<rows;i++){
      const tr = document.createElement('tr');
      tr.className = 'bg-white border-b skeleton-row';
      tr.innerHTML = `
        <td class="py-4 px-6"><div class="skeleton h-4 w-3/4"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-1/2"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-1/3"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>
        <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>`;
      tableBody.appendChild(tr);
    }
  }

  async function fetchAndRenderAportes(isBackground = false) {
    if (!isBackground) renderAportesSkeleton();
    try {
      await ensureSociosIndex();
      const data = await client.request(readItems(APORTES_COLLECTION, {
        fields: APORTES_FIELDS, sort: ['-Fecha_Aporte','-ID_Aporte'], limit: 1000
      }));
      const m = app.modules.aportes;
      m.data = data ?? [];
      const totalPages = Math.max(1, Math.ceil(m.data.length / m.pageSize));
      if (m.page > totalPages) m.page = totalPages;
      renderAportes(m.data);
    } catch (e) {
      console.error('Error al obtener aportes:', e?.message);
      const tableBody = app.modules.aportes.container?.querySelector('#aportes-table-body');
      if (tableBody) tableBody.innerHTML = `<tr><td colspan="5" class="text-center p-8 text-red-500">Error al cargar datos.</td></tr>`;
    }
  }

  function openEditAporte(aporte) {
    const container = app.modules.aportes.container;
    const modal = container.querySelector('#aporte-modal');
    const form  = container.querySelector('#aporte-form');

    form.reset();
    container.querySelector('#aporte-modal-title').textContent = aporte ? 'Editar Aporte' : 'Añadir Aporte';
    populateSocioSelect(form.querySelector('#ID_Socio')); // refrescar opciones

    if (!aporte) {
      form.querySelector('#ID_Aporte').value = '';
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth()+1).padStart(2,'0');
      const dd = String(today.getDate()).padStart(2,'0');
      form.querySelector('#Fecha_Aporte').value = `${yyyy}-${mm}-${dd}`;
    } else {
      form.querySelector('#ID_Aporte').value   = aporte.ID_Aporte;
      form.querySelector('#ID_Socio').value    = keyify(aporte.ID_Socio);
      form.querySelector('#Monto_Aporte').value= aporte.Monto_Aporte ?? '';
      form.querySelector('#Fecha_Aporte').value= (aporte.Fecha_Aporte ?? '').slice(0,10);
      form.querySelector('#Tipo_Aporte').value = aporte.Tipo_Aporte ?? '';
    }

    modal.classList.replace('hidden','flex');
  }

  async function handleAporteSubmit(e) {
    e.preventDefault();
    screenBlocker.classList.remove('hidden');

    const form = e.target;
    const idAporte = form.querySelector('#ID_Aporte').value;
    const socioIdStr = form.querySelector('#ID_Socio').value || null;

    const payload = {
      ID_Socio:      socioIdStr ? (isNaN(Number(socioIdStr)) ? socioIdStr : Number(socioIdStr)) : null,
      Monto_Aporte:  form.querySelector('#Monto_Aporte').value ? Number(form.querySelector('#Monto_Aporte').value) : 0,
      Fecha_Aporte:  form.querySelector('#Fecha_Aporte').value || null,
      Tipo_Aporte:   form.querySelector('#Tipo_Aporte').value || null,
    };

    try {
      if (idAporte) {
        await client.request(updateItem(APORTES_COLLECTION, idAporte, payload));
      } else {
        await client.request(createItem(APORTES_COLLECTION, payload));
      }
      app.modules.aportes.container.querySelector('#aporte-modal').classList.replace('flex','hidden');
      await fetchAndRenderAportes(true);
    } catch (err) {
      alert('Error al guardar aporte: ' + (err?.message || 'desconocido'));
      console.error(err);
    } finally {
      screenBlocker.classList.add('hidden');
    }
  }

  function confirmDeleteAporte(aporte) {
    const socioName = app.sociosIndex.get(keyify(aporte.ID_Socio)) ?? `#${aporte.ID_Socio}`;
    if (!confirm(`¿Eliminar el aporte #${aporte[APORTES_PK]} de ${socioName}?`)) return;
    doDeleteAporte(aporte[APORTES_PK]);
  }
  async function doDeleteAporte(idVal) {
    try {
      await client.request(deleteItem(APORTES_COLLECTION, idVal));
      await fetchAndRenderAportes(true);
    } catch (err) {
      console.error(err);
      alert('Error al eliminar el aporte.');
    }
  }

  // ========== Realtime genérico (WS + watchdog + polling) ==========
  const pollers = {};  // por colección

  function startPolling(collection, fn) {
    stopPolling(collection);
    pollers[collection] = setInterval(fn, 10000);
    console.info(`[POLL ${collection}] activo cada 10s`);
  }
  function stopPolling(collection) {
    if (pollers[collection]) clearInterval(pollers[collection]), (pollers[collection] = null);
  }

  async function subscribeRealtimeGeneric({ collection, pk, fields, onCreateOrUpdate, onDelete, onPoll }) {
    stopPolling(collection);

    // 1) Conectar WS (si ya está open, ignorar el error y continuar)
    let wsReady = false;
    try {
      await client.connect();
      wsReady = true;
      console.info(`[RT] WebSocket conectado (${collection})`);
    } catch (e) {
      const msg = String(e?.message || e || '');
      if (msg.includes('state is "open"') || msg.includes('already open')) {
        wsReady = true; // ya conectado
        console.info(`[RT] WebSocket ya estaba conectado (${collection})`);
      } else {
        console.warn(`[RT ${collection}] no se pudo abrir WS ahora (${msg}). Intento suscribirme igualmente…`);
      }
    }

    // 2) Intentar suscripciones; si falla, caer a polling
    try {
      const mkSub = async (event) => {
        try {
          const { subscription } = await client.subscribe(collection, { event, query:{ fields } });
          return subscription;
        } catch {
          const { subscription } = await client.subscribe('items', { collection, event, query:{ fields } });
          return subscription;
        }
      };

      const subs = await Promise.all(['create','update','delete'].map(mkSub));
      let lastEventAt = 0;

      subs.forEach((subscription) => {
        (async () => {
          for await (const msg of subscription) {
            lastEventAt = Date.now();
            const evt = msg?.event;
            const id  = extractIdFromMsg(msg, pk);
            if (!evt || id == null) continue;

            if (evt === 'delete') {
              onDelete?.(id);
            } else {
              const full = msg?.data?.[0];
              if (full && typeof full === 'object') {
                onCreateOrUpdate?.(full);
              } else {
                try {
                  const rows = await client.request(readItems(collection, {
                    fields, filter: { [pk]: { _eq: id } }, limit: 1
                  }));
                  if (rows?.[0]) onCreateOrUpdate?.(rows[0]);
                } catch (e) {
                  console.warn(`[RT ${collection}] rehidrata falló`, id, e);
                }
              }
            }
          }
        })().catch(e => console.warn(`[RT ${collection}] stream error`, e));
      });

      // watchdog → si no hay eventos en 12 s, activa polling
      setTimeout(() => {
        if (!lastEventAt) {
          console.warn(`[RT ${collection}] sin eventos tras 12s → polling`);
          startPolling(collection, onPoll);
        }
      }, 12000);

    } catch (e) {
      console.warn(`[RT ${collection}] suscripción falló; uso polling.`, e?.message || e);
      startPolling(collection, onPoll);
    }
  }

  // ========== Monitoreo de token ==========
  async function monitorToken() {
    while (true) {
      const saved = getSavedTokens();
      if (saved?.access_token) {
        try {
          await tryRefresh(client);
          console.info('[RT] Token renovado');
        } catch (e) {
          console.warn('[RT] Fallo al renovar el token → login', e);
          clearTokens();
          location.href = 'login.html';
          break;
        }
      }
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    }
  }
  await ensureSession();
  monitorToken();

  // ---------- Inicio ----------
  switchView('socios');
});
