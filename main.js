import {
  getClient, clearTokens, tryRefresh, getSavedTokens,
  // colecciones
  SOCIOS_COLLECTION, SOCIOS_PK,
  APORTES_COLLECTION, APORTES_PK,
  CREDITOS_COLLECTION, CREDITOS_PK,
  COBRANZAS_COLLECTION, COBRANZAS_PK,
  // compat (por si tu HTML aún lo usa en algún lado)
  COLLECTION, PRIMARY_KEY,
} from './config.js';

import {
  formatCurrency, formatDate, formatCompactNumber, 
  debounce, isMobile, initializeNumberFormatting,
  showCustomAlert, validateRequiredFields,
  saveFormProgress, restoreFormProgress, clearFormProgress,
  enableAutoSave, restoreFormData, showProgressRestoredAlert
} from './utils.js';

import { initReportes } from './reportes.js';

import {
  readItems, createItem, updateItem, deleteItem
} from 'https://cdn.jsdelivr.net/npm/@directus/sdk@latest/+esm';

// ---- Gate de sesión ----
console.log('Verificando tokens al cargar...');
const saved = JSON.parse(localStorage.getItem('directus_auth') || 'null');
if (!saved?.access_token || !saved?.refresh_token) {
  console.log('No hay tokens, redirigiendo al login');
  location.href = 'login.html';
}

// ---- Manejo centralizado de errores de token ----
function handleTokenExpiration(error) {
  console.log('🚨 MANEJANDO EXPIRACIÓN DE TOKEN:', error);
  
  // Verificar si ya se está mostrando una alerta de token
  if (window.tokenExpirationAlertShown) {
    console.log('Alerta de token ya mostrada, evitando duplicados');
    return;
  }
  
  window.tokenExpirationAlertShown = true;
  
  // Guardar progreso de formularios abiertos antes de redirigir
  const openForms = document.querySelectorAll('form:not([style*="display: none"]):not([style*="display:none"]):not(.hidden)');
  openForms.forEach(form => {
    if (form.offsetParent !== null) { // Solo formularios visibles
      const formId = form.id || `form_${Date.now()}`;
      const inputs = form.querySelectorAll('input, select, textarea');
      let hasData = false;
      
      // Verificar si hay datos en el formulario
      inputs.forEach(input => {
        if (input.value && input.value.trim() !== '') {
          hasData = true;
        }
      });
      
      if (hasData) {
        const formData = {};
        inputs.forEach(input => {
          if (input.type === 'checkbox') {
            formData[input.name || input.id] = input.checked;
          } else if (input.type === 'radio') {
            if (input.checked) {
              formData[input.name || input.id] = input.value;
            }
          } else {
            formData[input.name || input.id] = input.value;
          }
        });
        
        saveFormProgress(formId, formData);
        console.log(`📝 Progreso guardado automáticamente para formulario: ${formId}`);
      }
    }
  });
  
  // Función para mostrar la alerta
  const showAlert = () => {
    console.log('Ejecutando showAlert...');
    
    // Verificar si showCustomAlert está disponible
    if (typeof showCustomAlert === 'function') {
      console.log('showCustomAlert disponible, mostrando alerta personalizada');
      showCustomAlert({
        title: 'Sesión Expirada',
        message: 'Su tiempo de sesión ha expirado por seguridad.\n\nSu progreso ha sido guardado automáticamente.\nSerá redirigido al login para continuar.',
        type: 'warning',
        confirmText: 'Ir al Login',
        onConfirm: () => {
          console.log('Usuario confirmó redirección al login');
          try { getClient().logout(); } catch {}
          clearTokens();
          location.href = 'login.html';
        }
      });
    } else {
      // Fallback si showCustomAlert no está disponible
      console.log('showCustomAlert no disponible, usando alert nativo');
      alert('Su sesión ha expirado por seguridad. Su progreso ha sido guardado. Será redirigido al login.');
      try { getClient().logout(); } catch {}
      clearTokens();
      location.href = 'login.html';
    }
  };
  
  // Asegurar que DOM esté listo
  if (document.readyState === 'loading') {
    console.log('DOM no listo, esperando...');
    document.addEventListener('DOMContentLoaded', showAlert);
  } else {
    console.log('DOM listo, mostrando alerta inmediatamente');
    // Pequeño delay para asegurar que todo esté inicializado
    setTimeout(showAlert, 100);
  }
}

// ---- Wrapper para requests con manejo de errores ----
async function safeRequest(requestFn, showErrorAlert = true) {
  try {
    const result = await requestFn();
    return result;
  } catch (error) {
    console.error('Error en request:', error);
    console.log('Status del error:', error?.status);
    console.log('Mensaje del error:', error?.message);
    
    // Verificar si es un error de token/autenticación
    if (error?.status === 401 || 
        error?.status === 403 || 
        error?.message?.includes('token') ||
        error?.message?.includes('Unauthorized') ||
        error?.message?.includes('Forbidden')) {
      
      console.log('Detectado error de autenticación, intentando refresh...');
      
      // Intentar refrescar token una vez
      try {
        const client = getClient();
        const refreshSuccess = await tryRefresh(client);
        if (refreshSuccess) {
          console.log('Token refrescado exitosamente, reintentando request...');
          // Retry the original request after successful refresh
          return await requestFn();
        } else {
          console.log('Refresh falló, llamando handleTokenExpiration...');
          handleTokenExpiration(error);
          return null;
        }
      } catch (refreshError) {
        console.log('Error durante refresh, llamando handleTokenExpiration...', refreshError);
        handleTokenExpiration(error);
        return null;
      }
    }
    
    // Para otros errores, mostrar alerta si se solicita
    if (showErrorAlert) {
      showCustomAlert({
        title: 'Error',
        message: `Ha ocurrido un error: ${error?.message || 'Error desconocido'}`,
        type: 'error'
      });
    }
    
    throw error;
  }
}

// Hacer safeRequest disponible globalmente para otros módulos
window.safeRequest = safeRequest;
window.getClient = getClient;
window.readItems = readItems;

document.addEventListener('DOMContentLoaded', async () => {
  const client = getClient();
  const keyify = (v) => String(v ?? '');

  // Verificación inicial al cargar la página
  async function ensureSession() {
    return await safeRequest(async () => {
      await client.request(readItems(SOCIOS_COLLECTION, { limit: 1 }));
      return true;
    }, false);
  }
  
  const sessionValid = await ensureSession();
  if (!sessionValid) return; // handleTokenExpiration ya se encargó

  // Verificar token cuando el usuario regresa a la pestaña
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      console.log('Usuario regresó a la pestaña, verificando token...');
      const tokenValid = await safeRequest(async () => {
        await client.request(readItems(SOCIOS_COLLECTION, { limit: 1 }));
        return true;
      }, false);
      
      if (!tokenValid) {
        console.log('Token inválido al regresar a la pestaña');
        // handleTokenExpiration ya se llamó en safeRequest
      }
    }
  });

  // ---------- Estado SPA ----------
  const app = {
    activeModule: null,
    modules: {
      socios:    { container: null, data: [], page: 1, pageSize: 8 },
      aportes:   { container: null, data: [], page: 1, pageSize: 8 },
      creditos:  { container: null, data: [], page: 1, pageSize: 8 },
      cobranzas: { container: null, data: [], page: 1, pageSize: 8 },
    },
    sociosIndex: new Map(), // id(string) -> "Nombre Apellido"
    sociosList:  [],        // [{id(string), label}]
    creditosIndex: new Map(), // id(string) -> "Crédito info"
    creditosList: [],       // [{id(string), label, socioId}]
  };

  // ---------- DOM ----------
  const mainContent   = document.getElementById('contenido-principal');
  const moduleTitle   = document.getElementById('module-title');
  const navLinks      = document.querySelectorAll('.nav-link');
  const screenBlocker = document.getElementById('screen-blocker');
  const logoutBtn     = document.getElementById('logout-btn');

  // Mobile navigation elements
  const sidebar = document.getElementById('sidebar');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  const mobileNavOverlay = document.getElementById('mobile-nav-overlay');

  // Mobile navigation functionality
  function showMobileNav() {
    sidebar?.classList.remove('-translate-x-full');
    mobileNavOverlay?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function hideMobileNav() {
    sidebar?.classList.add('-translate-x-full');
    mobileNavOverlay?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  mobileMenuBtn?.addEventListener('click', showMobileNav);
  closeSidebarBtn?.addEventListener('click', hideMobileNav);
  mobileNavOverlay?.addEventListener('click', hideMobileNav);

  // Hide mobile nav when clicking nav links
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      hideMobileNav();
    });
  });

  logoutBtn?.addEventListener('click', async () => {
    try { await client.logout(); } catch {}
    clearTokens();
    
    // Limpiar todos los progresos guardados al hacer logout
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('form_progress_')) {
        localStorage.removeItem(key);
      }
    });
    console.log('✓ Progreso de formularios limpiado al hacer logout');
    
    location.href = 'login.html';
  });

  navLinks.forEach(link => link.addEventListener('click', (e) => {
    e.preventDefault();
    const moduleName = e.currentTarget.id.split('-')[1];
    switchView(moduleName);
  }));

  async function switchView(moduleName) {
    // Verificar token antes de cambiar de vista
    console.log(`Cambiando a vista: ${moduleName}, verificando token...`);
    const tokenValid = await safeRequest(async () => {
      await client.request(readItems(SOCIOS_COLLECTION, { limit: 1 }));
      return true;
    }, false);
    
    if (!tokenValid) {
      console.log('Token inválido al cambiar de vista, abortando...');
      return; // handleTokenExpiration ya se encargó
    }
    
    // Limpiar todas las vistas de módulos del contenedor principal
    const existingModules = mainContent.querySelectorAll('[id^="module-"]');
    existingModules.forEach(moduleEl => moduleEl.remove());
    
    if (app.activeModule && app.modules[app.activeModule]?.container) {
      app.modules[app.activeModule].container.classList.add('hidden');
    }
    app.activeModule = moduleName;
    const module = app.modules[moduleName];

    if (module?.container) {
      // Si el contenedor ya existe pero fue removido, necesitamos agregarlo de nuevo
      if (!document.getElementById('module-' + moduleName)) {
        mainContent.appendChild(module.container);
      }
      module.container.classList.remove('hidden');
      if (moduleName === 'socios')    fetchAndRenderSocios(true);
      if (moduleName === 'aportes')   fetchAndRenderAportes(true);
      if (moduleName === 'creditos')  fetchAndRenderCreditos(true);
      if (moduleName === 'cobranzas') fetchAndRenderCobranzas(true);
    } else {
      try {
        console.log('Cargando módulo: ' + moduleName + '.html');
        const res = await fetch('./' + moduleName + '.html');
        
        if (!res.ok) { 
          console.error('Error al cargar módulo ' + moduleName + ': ' + res.status + ' ' + res.statusText);
          mainContent.innerHTML = '<div class="p-4 text-center text-red-500">' +
            '<i class="fas fa-exclamation-triangle text-4xl mb-4"></i>' +
            '<p>Error al cargar el módulo "' + moduleName + '"</p>' +
            '<p class="text-sm">Código: ' + res.status + ' - ' + res.statusText + '</p>' +
            '<button onclick="location.reload()" class="mt-4 bg-blue-500 text-white px-4 py-2 rounded">Recargar página</button>' +
            '</div>'; 
          return; 
        }
        
        const html = await res.text();
        console.log('HTML del módulo ' + moduleName + ' cargado, longitud: ' + html.length);
        
        const container = document.createElement('div');
        container.id = 'module-' + moduleName;
        container.innerHTML = html;
        mainContent.appendChild(container);
        if (module) module.container = container;

        // Inicializar módulo después de añadirlo al DOM
        console.log('Inicializando módulo: ' + moduleName);
        if (moduleName === 'socios')    initSociosModule();
        if (moduleName === 'aportes')   initAportesModule();
        if (moduleName === 'creditos')  initCreditosModule();
        if (moduleName === 'cobranzas') initCobranzasModule();
        if (moduleName === 'reportes')  initReportes();
        
        console.log('Módulo ' + moduleName + ' cargado e inicializado exitosamente');
      } catch (error) {
        console.error('Error al cargar módulo ' + moduleName + ':', error);
        mainContent.innerHTML = '<div class="p-4 text-center text-red-500">' +
          '<i class="fas fa-wifi text-4xl mb-4"></i>' +
          '<p>Error de red al cargar el módulo "' + moduleName + '"</p>' +
          '<p class="text-sm">' + error.message + '</p>' +
          '<button onclick="location.reload()" class="mt-4 bg-blue-500 text-white px-4 py-2 rounded">Recargar página</button>' +
          '</div>';
        return;
      }
    }

    moduleTitle.textContent = 'Módulo de ' + moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
    navLinks.forEach(l => l.classList.toggle('active', l.id === 'nav-' + moduleName));
  }

  // ---------- Utils comunes ----------
  function extractIdFromMsg(msg, pk) {
    const d = msg?.data;
    if (Array.isArray(d) && d.length) {
      const first = d[0];
      if (typeof first === 'object' && first != null) return first[pk] ?? first.id;
      if (typeof first === 'number' || typeof first === 'string') return first;
    }
    const k = msg?.keys ?? d?.keys;
    if (Array.isArray(k) && k.length)  return k[0];
    if (k && typeof k === 'object')    return k[pk] ?? k.id;
    if (d && typeof d === 'object')    return d[pk] ?? d.id;
    return undefined;
  }

  const pollers = {};
  let wsConnectionState = { connected: false, reconnectAttempts: 0, maxReconnectAttempts: 5 };
  
  function startPolling(collection, fn){ 
    stopPolling(collection); 
    pollers[collection] = setInterval(fn, 15000); // Aumentado a 15s para reducir carga
    console.info(`[POLL ${collection}] activo cada 15s`); 
  }
  
  function stopPolling(collection){ 
    if(pollers[collection]) {
      clearInterval(pollers[collection]);
      pollers[collection] = null;
    }
  }

  // Optimized WebSocket connection with better error handling
  async function connectWebSocket() {
    if (wsConnectionState.connected) return true;
    
    try {
      await client.connect();
      wsConnectionState.connected = true;
      wsConnectionState.reconnectAttempts = 0;
      console.info(`[RT] WebSocket conectado exitosamente`);
      return true;
    } catch (e) {
      wsConnectionState.connected = false;
      wsConnectionState.reconnectAttempts++;
      
      const msg = String(e?.message || e || '');
      if (wsConnectionState.reconnectAttempts < wsConnectionState.maxReconnectAttempts) {
        console.warn(`[RT] Reconectando WebSocket (intento ${wsConnectionState.reconnectAttempts}/${wsConnectionState.maxReconnectAttempts})`);
        setTimeout(() => connectWebSocket(), 2000 * wsConnectionState.reconnectAttempts);
      } else {
        console.error(`[RT] Max intentos de reconexión alcanzados. Fallback a polling.`);
      }
      return false;
    }
  }

  async function subscribeRealtimeGeneric({ collection, pk, fields, onCreateOrUpdate, onDelete, onPoll }) {
    stopPolling(collection);
    
    const connected = await connectWebSocket();
    if (!connected) {
      console.warn(`[RT ${collection}] WebSocket no disponible, usando polling`);
      startPolling(collection, onPoll);
      return;
    }

    try {
      const mkSub = async (event) => {
        try { 
          return (await client.subscribe(collection, { event, query:{ fields } })).subscription; 
        } catch (err) { 
          return (await client.subscribe('items', { collection, event, query:{ fields } })).subscription; 
        }
      };
      
      const subs = await Promise.all(['create','update','delete'].map(mkSub));
      let lastEventAt = 0;
      const debounceMs = 300; // Debounce para evitar múltiples actualizaciones

      subs.forEach((subscription) => {
        (async () => {
          for await (const msg of subscription) {
            const now = Date.now();
            if (now - lastEventAt < debounceMs) continue; // Skip if too soon
            lastEventAt = now;
            
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
                // Fallback: fetch the updated item
                const itemData = await safeRequest(async () => {
                  const rows = await client.request(readItems(collection, { 
                    fields, 
                    filter:{ [pk]:{ _eq:id } }, 
                    limit:1 
                  }));
                  return rows?.data || rows;
                }, false);
                
                if (itemData && Array.isArray(itemData) && itemData[0]) {
                  onCreateOrUpdate?.(itemData[0]);
                }
              }
            }
          }
        })().catch(err => {
          console.error(`[RT ${collection}] Subscription error:`, err);
          wsConnectionState.connected = false;
          startPolling(collection, onPoll);
        });
      });

      console.info(`[RT ${collection}] Suscripciones activas (create, update, delete)`);

      // Timeout para detectar conexiones silenciosas
      setTimeout(() => {
        if (!lastEventAt) { 
          console.warn(`[RT ${collection}] sin eventos en 12s → polling`); 
          startPolling(collection, onPoll); 
        }
      }, 12000);

    } catch (err) {
      console.warn(`[RT ${collection}] Error en suscripción, usando polling:`, err);
      wsConnectionState.connected = false;
      startPolling(collection, onPoll);
    }
  }

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
    container.querySelector('.bg-white.p-6')?.appendChild(pager);
    pager.querySelector(`#prev-page-${modKey}`).addEventListener('click', () => changePage(modKey, -1));
    pager.querySelector(`#next-page-${modKey}`).addEventListener('click', () => changePage(modKey, +1));
    pager.querySelector(`#page-size-${modKey}`).addEventListener('change', (e) => {
      const m = app.modules[modKey]; m.pageSize = Number(e.target.value)||8; m.page=1;
      if (modKey==='socios')  renderSocios(m.data);
      if (modKey==='aportes') renderAportes(m.data);
      if (modKey==='creditos') renderCreditos(m.data);
    });
  }
  function changePage(modKey, delta) {
    const m = app.modules[modKey];
    const totalPages = Math.max(1, Math.ceil(m.data.length / m.pageSize));
    m.page = Math.min(totalPages, Math.max(1, m.page + delta));
    if (modKey==='socios')  renderSocios(m.data);
    if (modKey==='aportes') renderAportes(m.data);
    if (modKey==='creditos') renderCreditos(m.data);
  }

  // ===== FUNCIONES DE FILTROS =====
  
  function initSociosFilters(container) {
    const filterBtn = container.querySelector('#filter-socios-btn');
    const filtersPanel = container.querySelector('#socios-filters-panel');
    const clearBtn = container.querySelector('#clear-filters-socios');
    const applyBtn = container.querySelector('#apply-filters-socios');
    
    // Toggle panel de filtros
    filterBtn?.addEventListener('click', () => {
      filtersPanel.classList.toggle('hidden');
    });
    
    // Limpiar filtros
    clearBtn?.addEventListener('click', () => {
      container.querySelector('#filter-estado').value = '';
      container.querySelector('#filter-buscar').value = '';
      container.querySelector('#filter-fecha-desde').value = '';
      container.querySelector('#filter-fecha-hasta').value = '';
      applySociosFilters(container);
    });
    
    // Aplicar filtros
    applyBtn?.addEventListener('click', () => {
      applySociosFilters(container);
    });
    
    // Aplicar filtros en tiempo real al escribir
    container.querySelector('#filter-buscar')?.addEventListener('input', debounce(() => {
      applySociosFilters(container);
    }, 300));
  }
  
  function applySociosFilters(container) {
    const estado = container.querySelector('#filter-estado').value;
    const buscar = container.querySelector('#filter-buscar').value.toLowerCase();
    const fechaDesde = container.querySelector('#filter-fecha-desde').value;
    const fechaHasta = container.querySelector('#filter-fecha-hasta').value;
    
    const allData = app.modules.socios.data;
    let filtered = allData.filter(socio => {
      // Filtro por estado
      if (estado) {
        const socioActivo = socio.Estado_Socio === 'Activo';
        if (estado === 'activo' && !socioActivo) return false;
        if (estado === 'inactivo' && socioActivo) return false;
      }
      
      // Filtro por búsqueda
      if (buscar) {
        const nombres = (socio.Nombres_Completos || '').toLowerCase();
        const apellidos = (socio.Apellidos_Completos || '').toLowerCase();
        const cedula = (socio.Cedula_Identidad || '').toLowerCase();
        if (!nombres.includes(buscar) && !apellidos.includes(buscar) && !cedula.includes(buscar)) {
          return false;
        }
      }
      
      // Filtro por fecha
      if (fechaDesde || fechaHasta) {
        const fechaIngreso = new Date(socio.Fecha_Ingreso);
        if (fechaDesde && fechaIngreso < new Date(fechaDesde)) return false;
        if (fechaHasta && fechaIngreso > new Date(fechaHasta)) return false;
      }
      
      return true;
    });
    
    renderSocios(filtered);
  }

  function initAportesFilters(container) {
    const filterBtn = container.querySelector('#filter-aportes-btn');
    const filtersPanel = container.querySelector('#aportes-filters-panel');
    const clearBtn = container.querySelector('#clear-filters-aportes');
    const applyBtn = container.querySelector('#apply-filters-aportes');
    
    // Poblar select de socios
    ensureSociosIndex().then(() => {
      const socioSelect = container.querySelector('#filter-aporte-socio');
      if (socioSelect) {
        socioSelect.innerHTML = '<option value="">Todos los socios</option>';
        app.sociosList.forEach(({id, label}) => {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = label;
          socioSelect.appendChild(option);
        });
      }
    });
    
    // Toggle panel de filtros
    filterBtn?.addEventListener('click', () => {
      filtersPanel.classList.toggle('hidden');
    });
    
    // Limpiar filtros
    clearBtn?.addEventListener('click', () => {
      container.querySelector('#filter-aporte-socio').value = '';
      container.querySelector('#filter-tipo-aporte').value = '';
      container.querySelector('#filter-monto-min').value = '';
      container.querySelector('#filter-monto-max').value = '';
      container.querySelector('#filter-aporte-fecha-desde').value = '';
      container.querySelector('#filter-aporte-fecha-hasta').value = '';
      applyAportesFilters(container);
    });
    
    // Aplicar filtros
    applyBtn?.addEventListener('click', () => {
      applyAportesFilters(container);
    });
  }
  
  function applyAportesFilters(container) {
    const socioId = container.querySelector('#filter-aporte-socio').value;
    const tipo = container.querySelector('#filter-tipo-aporte').value;
    const montoMin = parseFloat(container.querySelector('#filter-monto-min').value) || 0;
    const montoMax = parseFloat(container.querySelector('#filter-monto-max').value) || Infinity;
    const fechaDesde = container.querySelector('#filter-aporte-fecha-desde').value;
    const fechaHasta = container.querySelector('#filter-aporte-fecha-hasta').value;
    
    const allData = app.modules.aportes.data;
    let filtered = allData.filter(aporte => {
      // Filtro por socio
      if (socioId && keyify(aporte.ID_Socio) !== socioId) return false;
      
      // Filtro por tipo
      if (tipo && aporte.Tipo_Aporte !== tipo) return false;
      
      // Filtro por monto
      const monto = parseFloat(aporte.Monto_Aporte) || 0;
      if (monto < montoMin || monto > montoMax) return false;
      
      // Filtro por fecha
      if (fechaDesde || fechaHasta) {
        const fechaAporte = new Date(aporte.Fecha_Aporte);
        if (fechaDesde && fechaAporte < new Date(fechaDesde)) return false;
        if (fechaHasta && fechaAporte > new Date(fechaHasta)) return false;
      }
      
      return true;
    });
    
    renderAportes(filtered);
  }

  function initCreditosFilters(container) {
    const filterBtn = container.querySelector('#filter-creditos-btn');
    const filtersPanel = container.querySelector('#creditos-filters-panel');
    const clearBtn = container.querySelector('#clear-filters-creditos');
    const applyBtn = container.querySelector('#apply-filters-creditos');
    
    // Poblar select de socios
    ensureSociosIndex().then(() => {
      const socioSelect = container.querySelector('#filter-credito-socio');
      if (socioSelect) {
        socioSelect.innerHTML = '<option value="">Todos los socios</option>';
        app.sociosList.forEach(({id, label}) => {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = label;
          socioSelect.appendChild(option);
        });
      }
    });
    
    // Toggle panel de filtros
    filterBtn?.addEventListener('click', () => {
      filtersPanel.classList.toggle('hidden');
    });
    
    // Limpiar filtros
    clearBtn?.addEventListener('click', () => {
      container.querySelector('#filter-credito-socio').value = '';
      container.querySelector('#filter-credito-estado').value = '';
      container.querySelector('#filter-credito-monto-min').value = '';
      container.querySelector('#filter-credito-monto-max').value = '';
      container.querySelector('#filter-credito-fecha-desde').value = '';
      container.querySelector('#filter-credito-fecha-hasta').value = '';
      applyCreditosFilters(container);
    });
    
    // Aplicar filtros
    applyBtn?.addEventListener('click', () => {
      applyCreditosFilters(container);
    });
  }
  
  function applyCreditosFilters(container) {
    const socioId = container.querySelector('#filter-credito-socio').value;
    const estado = container.querySelector('#filter-credito-estado').value;
    const montoMin = parseFloat(container.querySelector('#filter-credito-monto-min').value) || 0;
    const montoMax = parseFloat(container.querySelector('#filter-credito-monto-max').value) || Infinity;
    const fechaDesde = container.querySelector('#filter-credito-fecha-desde').value;
    const fechaHasta = container.querySelector('#filter-credito-fecha-hasta').value;
    
    const allData = app.modules.creditos.data;
    let filtered = allData.filter(credito => {
      // Filtro por socio
      if (socioId && keyify(credito.ID_Socio) !== socioId) return false;
      
      // Filtro por estado
      if (estado && credito.Estado !== estado) return false;
      
      // Filtro por monto
      const monto = parseFloat(credito.Monto_Solicitado) || 0;
      if (monto < montoMin || monto > montoMax) return false;
      
      // Filtro por fecha
      if (fechaDesde || fechaHasta) {
        const fechaSolicitud = new Date(credito.Fecha_Solicitud);
        if (fechaDesde && fechaSolicitud < new Date(fechaDesde)) return false;
        if (fechaHasta && fechaSolicitud > new Date(fechaHasta)) return false;
      }
      
      return true;
    });
    
    renderCreditos(filtered);
  }

  function initCobranzasFilters(container) {
    const filterBtn = container.querySelector('#filter-cobranzas-btn');
    const filtersPanel = container.querySelector('#cobranzas-filters-panel');
    const clearBtn = container.querySelector('#clear-filters-cobranzas');
    const applyBtn = container.querySelector('#apply-filters-cobranzas');
    
    // Poblar select de socios
    ensureSociosIndex().then(() => {
      const socioSelect = container.querySelector('#filter-cobranza-socio');
      if (socioSelect) {
        socioSelect.innerHTML = '<option value="">Todos los socios</option>';
        app.sociosList.forEach(({id, label}) => {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = label;
          socioSelect.appendChild(option);
        });
      }
    });
    
    // Toggle panel de filtros
    filterBtn?.addEventListener('click', () => {
      filtersPanel.classList.toggle('hidden');
    });
    
    // Limpiar filtros
    clearBtn?.addEventListener('click', () => {
      container.querySelector('#filter-cobranza-socio').value = '';
      container.querySelector('#filter-metodo-pago').value = '';
      container.querySelector('#filter-cobranza-monto-min').value = '';
      container.querySelector('#filter-cobranza-monto-max').value = '';
      container.querySelector('#filter-cobranza-fecha-desde').value = '';
      container.querySelector('#filter-cobranza-fecha-hasta').value = '';
      applyCobranzasFilters(container);
    });
    
    // Aplicar filtros
    applyBtn?.addEventListener('click', () => {
      applyCobranzasFilters(container);
    });
  }
  
  function applyCobranzasFilters(container) {
    const socioId = container.querySelector('#filter-cobranza-socio').value;
    const metodoPago = container.querySelector('#filter-metodo-pago').value;
    const montoMin = parseFloat(container.querySelector('#filter-cobranza-monto-min').value) || 0;
    const montoMax = parseFloat(container.querySelector('#filter-cobranza-monto-max').value) || Infinity;
    const fechaDesde = container.querySelector('#filter-cobranza-fecha-desde').value;
    const fechaHasta = container.querySelector('#filter-cobranza-fecha-hasta').value;
    
    const allData = app.modules.cobranzas.data;
    let filtered = allData.filter(cobranza => {
      // Filtro por socio
      if (socioId && keyify(cobranza.ID_Socio) !== socioId) return false;
      
      // Filtro por método de pago
      if (metodoPago && cobranza.Metodo_Pago !== metodoPago) return false;
      
      // Filtro por monto
      const monto = parseFloat(cobranza.Monto_Pagado) || 0;
      if (monto < montoMin || monto > montoMax) return false;
      
      // Filtro por fecha
      if (fechaDesde || fechaHasta) {
        const fechaPago = new Date(cobranza.Fecha_Pago);
        if (fechaDesde && fechaPago < new Date(fechaDesde)) return false;
        if (fechaHasta && fechaPago > new Date(fechaHasta)) return false;
      }
      
      return true;
    });
    
    renderCobranzas(filtered);
  }

  // ===== SOCIOS =====
  
  const SOCIOS_FIELDS = [
    'ID_Socio','Nombres_Completos','Apellidos_Completos','Cedula_Identidad',
    'Fecha_Nacimiento','Direccion_Domicilio','Telefono_Celular',
    'Correo_Electronico','Fecha_Ingreso','Estado_Socio',
  ];

  function indexSocio(s) {
    const id = keyify(s?.[SOCIOS_PK]);
    if (!id) return;
    const label = `${s?.Nombres_Completos ?? ''} ${s?.Apellidos_Completos ?? ''}`.trim() || `Socio ${id}`;
    app.sociosIndex.set(id, label);
    if (!app.sociosList.find(x => x.id === id)) app.sociosList.push({ id, label });
  }

  async function ensureSociosIndex() {
    if (app.sociosList.length) return;
    
    const result = await safeRequest(async () => {
      return await client.request(readItems(SOCIOS_COLLECTION, {
        fields: ['ID_Socio','Nombres_Completos','Apellidos_Completos'],
        limit: 1000, sort: ['Nombres_Completos','Apellidos_Completos']
      }));
    }, false);
    
    if (result !== null) {
      (result||[]).forEach(indexSocio);
    }
  }

  function initSociosModule() {
    const container = app.modules.socios.container;
    container.querySelector('#add-socio-btn').addEventListener('click', () => openEditSocio(null));
    container.querySelector('#socio-form').addEventListener('submit', handleSocioSubmit);
    container.querySelector('#cancel-btn').addEventListener('click', () => container.querySelector('#socio-modal').classList.replace('flex','hidden'));
    
    // Inicializar filtros
    initSociosFilters(container);
    
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
    const tb = app.modules.socios.container?.querySelector('#socios-table-body'); if (!tb) return;
    tb.innerHTML = '';
    for (let i=0;i<rows;i++){
      tb.innerHTML += `
        <tr class="bg-white border-b skeleton-row">
          <td class="py-4 px-6"><div class="skeleton h-4 w-3/4"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-full"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-full"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-full"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/2"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>
        </tr>`;
    }
  }

  async function fetchAndRenderSocios(isBackground = false) {
    if (!isBackground) renderSociosSkeleton();
    
    const result = await safeRequest(async () => {
      return await client.request(readItems(SOCIOS_COLLECTION, {
        fields: SOCIOS_FIELDS, sort: ['-ID_Socio'], limit: 500
      }));
    }, false);
    
    if (result !== null) {
      const m = app.modules.socios;
      m.data = result ?? [];
      const totalPages = Math.max(1, Math.ceil(m.data.length / m.pageSize));
      if (m.page > totalPages) m.page = totalPages;
      renderSocios(m.data);
    } else {
      const tb = app.modules.socios.container?.querySelector('#socios-table-body');
      if (tb) tb.innerHTML = `<tr><td colspan="6" class="text-center p-8 text-red-500">Error al cargar datos.</td></tr>`;
    }
  }

  function openEditSocio(socio) {
    const container = app.modules.socios.container;
    const modal = container.querySelector('#socio-modal');
    const form = container.querySelector('#socio-form');
    const aporteSection = container.querySelector('#aporte-inicial-section');
    
    form.reset();
    container.querySelector('#modal-title').textContent = socio ? 'Editar Socio' : 'Añadir Nuevo Socio';
    
    // Show/hide aporte section based on new vs edit
    if (aporteSection) {
      if (socio) {
        aporteSection.style.display = 'none'; // Hide for editing
      } else {
        aporteSection.style.display = 'block'; // Show for new socio
      }
    }
    
    // Form ID para auto-guardado
    const formId = socio ? `edit-socio-${socio.ID_Socio}` : 'new-socio';
    form.setAttribute('data-form-id', formId);
    
    if (!socio) {
      form.querySelector('#ID_Socio').value = '';
      
      // Verificar si hay progreso guardado para nuevo socio
      const savedProgress = restoreFormProgress(formId);
      if (savedProgress) {
        showProgressRestoredAlert(
          () => {
            restoreFormData(form, savedProgress);
            console.log('✓ Progreso restaurado en formulario de socio');
          },
          () => {
            clearFormProgress(formId);
            console.log('✓ Progreso descartado para formulario de socio');
          }
        );
      }
    } else {
      // Limpiar cualquier progreso guardado al editar socio existente
      clearFormProgress(formId);
      
      form.querySelector('#ID_Socio').value        = socio.ID_Socio;
      form.querySelector('#nombres').value         = socio.Nombres_Completos ?? '';
      form.querySelector('#apellidos').value       = socio.Apellidos_Completos ?? '';
      form.querySelector('#cedula').value          = socio.Cedula_Identidad ?? '';
      form.querySelector('#fechaNacimiento').value = socio.Fecha_Nacimiento ?? '';
      form.querySelector('#telefono').value        = socio.Telefono_Celular ?? '';
      form.querySelector('#email').value           = socio.Correo_Electronico ?? '';
      form.querySelector('#direccion').value       = socio.Direccion_Domicilio ?? '';
    }
    
    // Initialize number formatting for any number inputs in this modal
    initializeNumberFormatting(modal);
    
    // Habilitar auto-guardado (solo para nuevos socios)
    if (!socio) {
      enableAutoSave(form, formId, 15000); // Auto-guardar cada 15 segundos
    }
    
    modal.classList.replace('hidden','flex');
  }

  async function handleSocioSubmit(e) {
    e.preventDefault();
    
    const f = e.target;
    const id = f.querySelector('#ID_Socio').value;
    const isNewSocio = !id;
    
    // Validate required fields
    const requiredFields = ['nombres', 'apellidos', 'cedula'];
    const missingFields = validateRequiredFields(f, requiredFields);
    
    if (missingFields.length > 0) {
      showCustomAlert({
        title: 'Campos Obligatorios',
        message: `Por favor complete los siguientes campos:\n\n• ${missingFields.join('\n• ')}`,
        type: 'warning'
      });
      return;
    }
    
    const socioName = `${f.querySelector('#nombres').value} ${f.querySelector('#apellidos').value}`;
    const confirmMessage = isNewSocio 
      ? `¿Está seguro de ingresar a ${socioName} como nuevo socio?`
      : `¿Está seguro de guardar los cambios para ${socioName}?`;
    
    showCustomAlert({
      title: isNewSocio ? 'Confirmar Ingreso' : 'Confirmar Cambios',
      message: confirmMessage,
      type: 'confirm',
      onConfirm: async () => {
        await processSocioSubmit(f, id, isNewSocio);
      }
    });
  }
  
  async function processSocioSubmit(f, id, isNewSocio) {
    screenBlocker.classList.remove('hidden');
    
    const payload = {
      Nombres_Completos:   f.querySelector('#nombres').value,
      Apellidos_Completos: f.querySelector('#apellidos').value,
      Cedula_Identidad:    f.querySelector('#cedula').value,
      Fecha_Nacimiento:    f.querySelector('#fechaNacimiento').value || null,
      Direccion_Domicilio: f.querySelector('#direccion').value,
      Telefono_Celular:    f.querySelector('#telefono').value,
      Correo_Electronico:  f.querySelector('#email').value,
    };
    
    try {
      let socioId = id;
      
      if (id) {
        await safeRequest(async () => {
          return await client.request(updateItem(SOCIOS_COLLECTION, id, payload));
        });
        showCustomAlert({
          title: 'Éxito',
          message: 'Los datos del socio se han actualizado correctamente.',
          type: 'success'
        });
      } else {
        payload.Fecha_Ingreso = new Date().toISOString();
        const result = await safeRequest(async () => {
          return await client.request(createItem(SOCIOS_COLLECTION, payload));
        });
        
        if (result) {
          socioId = result.ID_Socio || result.id;
          
          // Check if should create initial aporte
          const ingresaConAporte = f.querySelector('#ingresar-con-aporte')?.checked;
          if (ingresaConAporte && socioId) {
            await createInitialAporte(socioId);
          }
          
          showCustomAlert({
            title: 'Éxito',
            message: ingresaConAporte 
              ? 'El socio se ha registrado correctamente y se ha creado la Cuota de Afiliación automáticamente.'
              : 'El socio se ha registrado correctamente.',
            type: 'success'
          });
        }
      }
      
      app.modules.socios.container.querySelector('#socio-modal').classList.replace('flex','hidden');
      await fetchAndRenderSocios();
      
    } catch (err) {
      // El safeRequest ya maneja errores de token, este catch es para otros errores
      console.error('Error no relacionado con token:', err);
    } finally { 
      screenBlocker.classList.add('hidden'); 
    }
  }
  
  async function createInitialAporte(socioId) {
    const aportePayload = {
      ID_Socio: socioId,
      Monto_Aporte: 20,
      Fecha_Aporte: new Date().toISOString().split('T')[0],
      Tipo_Aporte: 'Cuota de Afiliación'
    };
    
    await safeRequest(async () => {
      return await client.request(createItem(APORTES_COLLECTION, aportePayload));
    }, false); // No mostrar alerta de error pues la acción principal fue exitosa
  }

  function confirmDeleteSocio(socio) {
    const socioName = `${socio.Nombres_Completos} ${socio.Apellidos_Completos}`;
    showCustomAlert({
      title: 'Confirmar Eliminación',
      message: `¿Está seguro de eliminar al socio "${socioName}"?\n\nEsta acción no se puede deshacer.`,
      type: 'confirm',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      onConfirm: () => doDeleteSocio(socio[SOCIOS_PK])
    });
  }
  
  async function doDeleteSocio(idVal) {
    screenBlocker.classList.remove('hidden');
    
    const result = await safeRequest(async () => {
      return await client.request(deleteItem(SOCIOS_COLLECTION, idVal));
    });
    
    if (result !== null) {
      await fetchAndRenderSocios(true);
      showCustomAlert({
        title: 'Éxito',
        message: 'El socio ha sido eliminado correctamente.',
        type: 'success'
      });
    }
    
    screenBlocker.classList.add('hidden');
  }

  // ===== APORTES =====
  const APORTES_FIELDS = ['ID_Aporte','ID_Socio','Monto_Aporte','Fecha_Aporte','Tipo_Aporte'];

  function initAportesModule() {
    const container = app.modules.aportes.container;
    container.querySelector('#add-aporte-btn').addEventListener('click', () => openEditAporte(null));
    container.querySelector('#aporte-cancel-btn').addEventListener('click', () => container.querySelector('#aporte-modal').classList.replace('flex','hidden'));
    container.querySelector('#aporte-form').addEventListener('submit', handleAporteSubmit);
    
    // Inicializar filtros
    initAportesFilters(container);
    
    ensurePager(container, 'aportes');

    ensureSociosIndex().then(() => populateSocioSelect(container.querySelector('#ID_Socio')));
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

  function populateSocioSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="" disabled selected>Seleccione un socio…</option>';
    app.sociosList.sort((a,b)=>a.label.localeCompare(b.label)).forEach(({id,label})=>{
      const opt=document.createElement('option'); opt.value=id; opt.textContent=label; selectEl.appendChild(opt);
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
      const monto     = formatCurrency(a?.Monto_Aporte, { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      });
      const fecha     = formatDate(a?.Fecha_Aporte, { 
        includeTime: false, 
        compact: false 
      });
      const tipo      = a?.Tipo_Aporte ?? '—';

      const tr = document.createElement('tr');
      tr.className = 'bg-white border-b hover:bg-slate-50';
      tr.innerHTML = `
        <td class="py-4 px-6 font-medium text-slate-900">${socioName}</td>
        <td class="py-4 px-6 text-green-600 font-semibold">${monto}</td>
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
    const tb = app.modules.aportes.container?.querySelector('#aportes-table-body'); if (!tb) return;
    tb.innerHTML = '';
    for (let i=0;i<rows;i++){
      tb.innerHTML += `
        <tr class="bg-white border-b skeleton-row">
          <td class="py-4 px-6"><div class="skeleton h-4 w-3/4"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/2"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/3"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>
        </tr>`;
    }
  }

  async function fetchAndRenderAportes(isBackground = false) {
    if (!isBackground) renderAportesSkeleton();
    
    const result = await safeRequest(async () => {
      await ensureSociosIndex();
      return await client.request(readItems(APORTES_COLLECTION, {
        fields: APORTES_FIELDS, sort: ['-Fecha_Aporte','-ID_Aporte'], limit: 1000
      }));
    }, false);
    
    if (result !== null) {
      const m = app.modules.aportes;
      m.data = result ?? [];
      const totalPages = Math.max(1, Math.ceil(m.data.length / m.pageSize));
      if (m.page > totalPages) m.page = totalPages;
      renderAportes(m.data);
    } else {
      const tb = app.modules.aportes.container?.querySelector('#aportes-table-body');
      if (tb) tb.innerHTML = `<tr><td colspan="5" class="text-center p-8 text-red-500">Error al cargar datos.</td></tr>`;
    }
  }

  function openEditAporte(aporte) {
    const container = app.modules.aportes.container;
    const modal = container.querySelector('#aporte-modal');
    const form  = container.querySelector('#aporte-form');

    form.reset();
    container.querySelector('#aporte-modal-title').textContent = aporte ? 'Editar Aporte' : 'Añadir Aporte';
    populateSocioSelect(form.querySelector('#ID_Socio'));

    // Form ID para auto-guardado
    const formId = aporte ? `edit-aporte-${aporte.ID_Aporte}` : 'new-aporte';
    form.setAttribute('data-form-id', formId);

    if (!aporte) {
      form.querySelector('#ID_Aporte').value = '';
      const t = new Date(); const yyyy=t.getFullYear(); const mm=String(t.getMonth()+1).padStart(2,'0'); const dd=String(t.getDate()).padStart(2,'0');
      form.querySelector('#Fecha_Aporte').value = `${yyyy}-${mm}-${dd}`;
      
      // Verificar si hay progreso guardado
      const savedProgress = restoreFormProgress(formId);
      if (savedProgress) {
        showProgressRestoredAlert(
          () => {
            restoreFormData(form, savedProgress);
            console.log('✓ Progreso restaurado en formulario de aporte');
          },
          () => {
            clearFormProgress(formId);
            console.log('✓ Progreso descartado para formulario de aporte');
          }
        );
      }
    } else {
      // Limpiar progreso al editar aporte existente
      clearFormProgress(formId);
      
      form.querySelector('#ID_Aporte').value   = aporte.ID_Aporte;
      form.querySelector('#ID_Socio').value    = keyify(aporte.ID_Socio);
      form.querySelector('#Monto_Aporte').value= Number(aporte.Monto_Aporte || 0).toFixed(2);
      form.querySelector('#Fecha_Aporte').value= (aporte.Fecha_Aporte ?? '').slice(0,10);
      form.querySelector('#Tipo_Aporte').value = aporte.Tipo_Aporte ?? '';
    }

    // Initialize number formatting for any number inputs in this modal
    initializeNumberFormatting(modal);

    // Habilitar auto-guardado (solo para nuevos aportes)
    if (!aporte) {
      enableAutoSave(form, formId, 15000);
    }

    modal.classList.replace('hidden','flex');
  }

  async function handleAporteSubmit(e) {
    e.preventDefault();

    const f = e.target;
    const idAporte = f.querySelector('#ID_Aporte').value;
    const isNewAporte = !idAporte;

    // Validate required fields
    const requiredFields = ['ID_Socio', 'Monto_Aporte', 'Fecha_Aporte', 'Tipo_Aporte'];
    const missingFields = validateRequiredFields(f, requiredFields);

    if (missingFields.length > 0) {
      showCustomAlert({
        title: 'Campos Obligatorios',
        message: `Por favor complete los siguientes campos:\n\n• ${missingFields.join('\n• ')}`,
        type: 'warning'
      });
      return;
    }

    const socioName = app.sociosIndex.get(f.querySelector('#ID_Socio').value) || 'Socio';
    const monto = Number(f.querySelector('#Monto_Aporte').value || 0);
    const confirmMessage = isNewAporte 
      ? `¿Está seguro de registrar este aporte de $${monto.toLocaleString('es-CO')} para ${socioName}?`
      : `¿Está seguro de guardar los cambios en este aporte?`;

    showCustomAlert({
      title: isNewAporte ? 'Confirmar Aporte' : 'Confirmar Cambios',
      message: confirmMessage,
      type: 'confirm',
      onConfirm: async () => {
        await processAporteSubmit(f, idAporte, isNewAporte);
      }
    });
  }

  async function processAporteSubmit(f, idAporte, isNewAporte) {
    screenBlocker.classList.remove('hidden');

    const socioIdStr = f.querySelector('#ID_Socio').value || null;

    const payload = {
      ID_Socio:      socioIdStr ? (isNaN(Number(socioIdStr)) ? socioIdStr : Number(socioIdStr)) : null,
      Monto_Aporte:  f.querySelector('#Monto_Aporte').value ? Number(f.querySelector('#Monto_Aporte').value) : 0,
      Fecha_Aporte:  f.querySelector('#Fecha_Aporte').value || null,
      Tipo_Aporte:   f.querySelector('#Tipo_Aporte').value || null,
    };

    const result = await safeRequest(async () => {
      if (idAporte) {
        return await client.request(updateItem(APORTES_COLLECTION, idAporte, payload));
      } else {
        return await client.request(createItem(APORTES_COLLECTION, payload));
      }
    });
    
    if (result !== null) {
      showCustomAlert({
        title: 'Éxito',
        message: isNewAporte ? 'El aporte se ha registrado correctamente.' : 'Los datos del aporte se han actualizado correctamente.',
        type: 'success'
      });
      
      app.modules.aportes.container.querySelector('#aporte-modal').classList.replace('flex','hidden');
      await fetchAndRenderAportes(true);
    }
    
    screenBlocker.classList.add('hidden');
  }

  function confirmDeleteAporte(aporte) {
    const socioName = app.sociosIndex.get(keyify(aporte.ID_Socio)) ?? `Socio #${aporte.ID_Socio}`;
    const monto = formatCurrency(aporte.Monto_Aporte || 0, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    showCustomAlert({
      title: 'Confirmar Eliminación',
      message: `¿Está seguro de eliminar el aporte de ${monto} de ${socioName}?\n\nEsta acción no se puede deshacer.`,
      type: 'confirm',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      onConfirm: () => doDeleteAporte(aporte[APORTES_PK])
    });
  }
  
  async function doDeleteAporte(idVal) {
    screenBlocker.classList.remove('hidden');
    
    const result = await safeRequest(async () => {
      return await client.request(deleteItem(APORTES_COLLECTION, idVal));
    });
    
    if (result !== null) {
      await fetchAndRenderAportes(true);
      showCustomAlert({
        title: 'Éxito',
        message: 'El aporte ha sido eliminado correctamente.',
        type: 'success'
      });
    }
    
    screenBlocker.classList.add('hidden');
  }

  // ===== CRÉDITOS =====
  const CREDITOS_FIELDS = [
    'ID_Credito','ID_Socio','Monto_Solicitado','Tasa_Interes','Plazo_Meses',
    'Fecha_Solicitud','Fecha_Aprobacion','Estado','Observaciones'
  ];
  const ESTADOS_CREDITO = ['Solicitado','Aprobado','Activo','Pagado','Rechazado','En Mora'];

  function initCreditosModule() {
    const container = app.modules.creditos.container;
    container.querySelector('#add-credito-btn').addEventListener('click', () => openEditCredito(null));
    container.querySelector('#credito-cancel-btn').addEventListener('click', () => container.querySelector('#credito-modal').classList.replace('flex','hidden'));
    container.querySelector('#credito-form').addEventListener('submit', handleCreditoSubmit);
    
    // Inicializar filtros
    initCreditosFilters(container);
    
    ensurePager(container, 'creditos');

    ensureSociosIndex().then(() => populateSocioSelect(container.querySelector('#CRED_ID_Socio')));
    populateEstadoSelect(container.querySelector('#Estado'));

    // Validación en tiempo real para fecha de aprobación cuando estado es "Activo"
    const estadoSelect = container.querySelector('#Estado');
    const fechaAprobacionInput = container.querySelector('#Fecha_Aprobacion');
    
    if (estadoSelect && fechaAprobacionInput) {
      estadoSelect.addEventListener('change', function() {
        const isActivo = this.value === 'Activo';
        fechaAprobacionInput.required = isActivo;
        
        // Cambiar estilo visual para indicar que es obligatorio
        if (isActivo) {
          fechaAprobacionInput.classList.add('border-orange-500', 'border-2');
          fechaAprobacionInput.previousElementSibling.innerHTML = 'Fecha Aprobación <span class="text-red-500">*</span>';
          
          // Si no tiene fecha, poner fecha actual como sugerencia
          if (!fechaAprobacionInput.value) {
            const today = new Date().toISOString().split('T')[0];
            fechaAprobacionInput.value = today;
          }
        } else {
          fechaAprobacionInput.classList.remove('border-orange-500', 'border-2');
          fechaAprobacionInput.previousElementSibling.innerHTML = 'Fecha Aprobación';
          fechaAprobacionInput.required = false;
        }
      });
    }

    fetchAndRenderCreditos();

    subscribeRealtimeGeneric({
      collection: CREDITOS_COLLECTION, pk: CREDITOS_PK, fields: CREDITOS_FIELDS,
      onCreateOrUpdate: (row) => {
        const m = app.modules.creditos;
        const i = m.data.findIndex(r => r[CREDITOS_PK] === row[CREDITOS_PK]);
        if (i >= 0) m.data[i] = row; else m.data.unshift(row);
        renderCreditos(m.data);
      },
      onDelete: (id) => {
        const m = app.modules.creditos;
        m.data = m.data.filter(r => r[CREDITOS_PK] !== id);
        renderCreditos(m.data);
      },
      onPoll: () => (app.activeModule === 'creditos') && fetchAndRenderCreditos(true),
    });
  }

  function populateEstadoSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    ESTADOS_CREDITO.forEach(v => {
      const opt = document.createElement('option'); opt.value = v; opt.textContent = v; selectEl.appendChild(opt);
    });
  }

  function renderCreditos(all) {
    const container = app.modules.creditos.container;
    const tableBody = container?.querySelector('#creditos-table-body');
    if (!tableBody) return;

    const m = app.modules.creditos;
    const total = all.length;
    const totalPages = Math.max(1, Math.ceil(total / m.pageSize));
    const start = (m.page - 1) * m.pageSize;
    const pageRows = all.slice(start, start + m.pageSize);

    const totalEl = container.querySelector('#total-reg-creditos');
    const indEl   = container.querySelector('#page-indicator-creditos');
    if (totalEl) totalEl.textContent = `Total: ${total}`;
    if (indEl)   indEl.textContent   = `Página ${m.page} / ${totalPages}`;

    tableBody.innerHTML = '';
    if (!pageRows.length) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center p-8">No hay créditos registrados.</td></tr>';
      return;
    }

    pageRows.forEach(c => {
      const socioName = app.sociosIndex.get(keyify(c.ID_Socio)) ?? `#${c.ID_Socio}`;
      const monto = formatCurrency(c?.Monto_Solicitado, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
      const tasa  = `${Number(c?.Tasa_Interes ?? 0).toFixed(1)}%`;
      const plazo = `${c?.Plazo_Meses ?? 0} meses`;
      const fsol  = formatDate(c?.Fecha_Solicitud, { 
        includeTime: false, 
        compact: false 
      });
      const estado= c?.Estado ?? '—';

      const color = {
        'Solicitado':'bg-slate-200 text-slate-800',
        'Aprobado':'bg-emerald-100 text-emerald-700',
        'Activo':'bg-blue-100 text-blue-700',
        'Pagado':'bg-green-100 text-green-700',
        'Rechazado':'bg-red-100 text-red-700',
        'En Mora':'bg-amber-100 text-amber-800'
      }[estado] || 'bg-slate-100 text-slate-700';

      const tr = document.createElement('tr');
      tr.className = 'bg-white border-b hover:bg-slate-50';
      tr.innerHTML = `
        <td class="py-4 px-6 font-medium text-slate-900">${socioName}</td>
        <td class="py-4 px-6 text-green-600 font-semibold">${monto}</td>
        <td class="py-4 px-6 text-blue-600 font-medium">${tasa}</td>
        <td class="py-4 px-6">${plazo}</td>
        <td class="py-4 px-6">${fsol}</td>
        <td class="py-1 px-6"><span class="px-2 py-1 rounded-full text-xs font-semibold inline-block ${color}">${estado}</span></td>
        <td class="py-4 px-6 flex gap-3">
          <button class="edit-btn font-medium text-blue-600 hover:underline">Editar</button>
          <button class="del-btn font-medium text-red-600 hover:underline">Eliminar</button>
        </td>
      `;
      tr.querySelector('.edit-btn').addEventListener('click', () => openEditCredito(c));
      tr.querySelector('.del-btn').addEventListener('click', () => confirmDeleteCredito(c));
      tableBody.appendChild(tr);
    });
  }

  function renderCreditosSkeleton(rows=5){
    const tb = app.modules.creditos.container?.querySelector('#creditos-table-body');
    if (!tb) return; tb.innerHTML='';
    for(let i=0;i<rows;i++){
      tb.innerHTML += `
        <tr class="bg-white border-b skeleton-row">
          <td class="py-4 px-6"><div class="skeleton h-4 w-3/4"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/2"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/3"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/3"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/5"></div></td>
          <td class="py-4 px-6"><div class="skeleton h-4 w-1/4"></div></td>
        </tr>`;
    }
  }

  async function fetchAndRenderCreditos(isBackground=false){
    if(!isBackground) renderCreditosSkeleton();
    
    const result = await safeRequest(async () => {
      await ensureSociosIndex();
      return await client.request(readItems(CREDITOS_COLLECTION, {
        fields: CREDITOS_FIELDS, sort: ['-Fecha_Solicitud','-ID_Credito'], limit: 1000
      }));
    }, false);
    
    if (result !== null) {
      const m = app.modules.creditos;
      m.data = result ?? [];
      const totalPages = Math.max(1, Math.ceil(m.data.length / m.pageSize));
      if (m.page > totalPages) m.page = totalPages;
      renderCreditos(m.data);
    } else {
      const tb = app.modules.creditos.container?.querySelector('#creditos-table-body');
      if (tb) tb.innerHTML = `<tr><td colspan="7" class="text-center p-8 text-red-500">Error al cargar datos.</td></tr>`;
    }
  }

  function openEditCredito(credito){
    const container = app.modules.creditos.container;
    const modal = container.querySelector('#credito-modal');
    const form  = container.querySelector('#credito-form');

    form.reset();
    container.querySelector('#credito-modal-title').textContent = credito ? 'Editar Crédito' : 'Añadir Crédito';
    populateSocioSelect(form.querySelector('#CRED_ID_Socio'));
    populateEstadoSelect(form.querySelector('#Estado'));

    if (!credito){
      form.querySelector('#ID_Credito').value = '';
      const t = new Date(); const yyyy=t.getFullYear(); const mm=String(t.getMonth()+1).padStart(2,'0'); const dd=String(t.getDate()).padStart(2,'0');
      form.querySelector('#Fecha_Solicitud').value = `${yyyy}-${mm}-${dd}`;
      form.querySelector('#Estado').value = 'Solicitado';
    } else {
      form.querySelector('#ID_Credito').value       = credito.ID_Credito;
      form.querySelector('#CRED_ID_Socio').value    = keyify(credito.ID_Socio);
      form.querySelector('#Monto_Solicitado').value = Number(credito.Monto_Solicitado || 0).toFixed(2);
      form.querySelector('#Tasa_Interes').value     = Number(credito.Tasa_Interes || 0).toFixed(2);
      form.querySelector('#Plazo_Meses').value      = credito.Plazo_Meses ?? '';
      form.querySelector('#Fecha_Solicitud').value  = (credito.Fecha_Solicitud ?? '').slice(0,10);
      form.querySelector('#Fecha_Aprobacion').value = (credito.Fecha_Aprobacion ?? '').slice(0,10);
      form.querySelector('#Estado').value           = credito.Estado ?? 'Solicitado';
      form.querySelector('#Observaciones').value    = credito.Observaciones ?? '';
    }
    
    // Initialize number formatting for any number inputs in this modal
    initializeNumberFormatting(modal);
    
    modal.classList.replace('hidden','flex');
  }

  async function handleCreditoSubmit(e){
    e.preventDefault();
    screenBlocker.classList.remove('hidden');

    const f = e.target;
    const idCred = f.querySelector('#ID_Credito').value;
    const socioIdStr = f.querySelector('#CRED_ID_Socio').value || null;
    const estado = f.querySelector('#Estado').value || 'Solicitado';
    const fechaAprobacion = f.querySelector('#Fecha_Aprobacion').value;

    // Validación: Si el estado es "Activo", la fecha de aprobación es obligatoria
    if (estado === 'Activo' && !fechaAprobacion) {
      alert('La fecha de aprobación es obligatoria cuando el estado es "Activo"');
      screenBlocker.classList.add('hidden');
      f.querySelector('#Fecha_Aprobacion').focus();
      return;
    }

    // Tasa_Interes se guarda como número (ej.: 12.5 => 12.5 %)
    const payload = {
      ID_Socio:         socioIdStr ? (isNaN(Number(socioIdStr)) ? socioIdStr : Number(socioIdStr)) : null,
      Monto_Solicitado: f.querySelector('#Monto_Solicitado').value ? Number(f.querySelector('#Monto_Solicitado').value) : 0,
      Tasa_Interes:     f.querySelector('#Tasa_Interes').value ? Number(f.querySelector('#Tasa_Interes').value) : 0,
      Plazo_Meses:      f.querySelector('#Plazo_Meses').value ? Number(f.querySelector('#Plazo_Meses').value) : 0,
      Fecha_Solicitud:  f.querySelector('#Fecha_Solicitud').value || null,
      Fecha_Aprobacion: fechaAprobacion || null,
      Estado:           estado,
      Observaciones:    f.querySelector('#Observaciones').value || null,
    };

    const result = await safeRequest(async () => {
      if (idCred) {
        return await client.request(updateItem(CREDITOS_COLLECTION, idCred, payload));
      } else {
        return await client.request(createItem(CREDITOS_COLLECTION, payload));
      }
    });
    
    if (result !== null) {
      showCustomAlert({
        title: 'Éxito',
        message: idCred ? 'Los datos del crédito se han actualizado correctamente.' : 'El crédito se ha registrado correctamente.',
        type: 'success'
      });
      app.modules.creditos.container.querySelector('#credito-modal').classList.replace('flex','hidden');
      await fetchAndRenderCreditos(true);
    }
    
    screenBlocker.classList.add('hidden');
  }

  function confirmDeleteCredito(credito){
    const socioName = app.sociosIndex.get(keyify(credito.ID_Socio)) ?? `Socio #${credito.ID_Socio}`;
    const monto = formatCurrency(credito.Monto_Solicitado || 0, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    showCustomAlert({
      title: 'Confirmar Eliminación',
      message: `¿Está seguro de eliminar el crédito de ${monto} de ${socioName}?\n\nEsta acción no se puede deshacer.`,
      type: 'confirm',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      onConfirm: () => doDeleteCredito(credito[CREDITOS_PK])
    });
  }
  
  async function doDeleteCredito(idVal){
    screenBlocker.classList.remove('hidden');
    
    const result = await safeRequest(async () => {
      return await client.request(deleteItem(CREDITOS_COLLECTION, idVal));
    });
    
    if (result !== null) {
      await fetchAndRenderCreditos(true);
      showCustomAlert({
        title: 'Éxito',
        message: 'El crédito ha sido eliminado correctamente.',
        type: 'success'
      });
    }
    
    screenBlocker.classList.add('hidden');
  }

  // ===== COBRANZAS =====
  const COBRANZAS_FIELDS = [
    'ID_Cobranza','ID_Credito','ID_Socio','Fecha_Pago','Monto_Pagado',
    'Metodo_Pago','Numero_Comprobante','Observaciones'
  ];
  const METODOS_PAGO = ['Efectivo','Transferencia Bancaria','Depósito'];

  function initCobranzasModule() {
    const container = app.modules.cobranzas.container;
    if (!container) return;

    // Inicializar filtros
    initCobranzasFilters(container);

    // Botón añadir cobranza
    const addBtn = container.querySelector('#add-cobranza-btn');
    addBtn?.addEventListener('click', () => openEditCobranza(null));

    // Modal y form
    const modal = container.querySelector('#cobranza-modal');
    const form = container.querySelector('#cobranza-form');
    const cancelBtn = container.querySelector('#cobranza-cancel-btn');
    const closeBtn = container.querySelector('#cobranza-close-btn');

    const closeModal = () => {
      modal?.classList.add('hidden');
      modal?.classList.remove('flex');
      hideMobileNav(); // Asegurar que el nav móvil se cierre
    };

    cancelBtn?.addEventListener('click', closeModal);
    closeBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    form?.addEventListener('submit', handleCobranzaSubmit);

    // Select de socio que controla el select de crédito
    const socioSelect = container.querySelector('#ID_Socio_Cobranza');
    const creditoSelect = container.querySelector('#ID_Credito');
    
    socioSelect?.addEventListener('change', async () => {
      const socioId = socioSelect.value;
      if (!socioId) {
        creditoSelect.disabled = true;
        creditoSelect.innerHTML = '<option value="">Primero seleccione un socio...</option>';
        return;
      }
      
      await populateCreditoSelect(creditoSelect, socioId);
      creditoSelect.disabled = false;
    });

    // Poblar select de socios
    populateSocioSelectCobranza(socioSelect);

    // Asegurar que los índices estén poblados
    Promise.all([
      ensureSociosIndex(),
      ensureCreditosIndex()
    ]).then(() => {
      console.log('Índices de socios y créditos poblados para cobranzas');
    });

    // Realtime
    subscribeRealtimeGeneric({
      collection: COBRANZAS_COLLECTION, pk: COBRANZAS_PK, fields: COBRANZAS_FIELDS,
      onCreateOrUpdate: () => fetchAndRenderCobranzas(true),
      onDelete: () => fetchAndRenderCobranzas(true),
      onPoll: () => fetchAndRenderCobranzas(true)
    });

    fetchAndRenderCobranzas();
    ensurePager(container, 'cobranzas');
  }

  function populateSocioSelectCobranza(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">Seleccionar socio...</option>';
    app.sociosList.forEach(({ id, label }) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = label;
      selectEl.appendChild(opt);
    });
  }

  async function populateCreditoSelect(selectEl, socioId) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">Cargando créditos...</option>';
    
    try {
      await ensureSession();
      const response = await client.request(readItems(CREDITOS_COLLECTION, {
        fields: ['ID_Credito','Monto_Solicitado','Fecha_Aprobacion','Estado'],
        filter: { ID_Socio: { _eq: socioId }, Estado: { _in: ['Aprobado','Activo'] } },
        sort: ['-Fecha_Aprobacion']
      }));
      
      const creditos = response.data || (Array.isArray(response) ? response : []);
      selectEl.innerHTML = '<option value="">Seleccionar crédito...</option>';
      
      creditos.forEach(credito => {
        const opt = document.createElement('option');
        opt.value = credito.ID_Credito;
        const monto = formatCurrency(credito.Monto_Solicitado || 0, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });
        opt.textContent = `${monto} - ${credito.Fecha_Aprobacion || 'Sin fecha'}`;
        selectEl.appendChild(opt);
      });
      
      if (creditos.length === 0) {
        selectEl.innerHTML = '<option value="">No hay créditos activos para este socio</option>';
      }
    } catch (err) {
      console.error('Error loading créditos:', err);
      selectEl.innerHTML = '<option value="">Error al cargar créditos</option>';
    }
  }

  function generateComprobanteNumber(socioNombre, creditoId) {
    const timestamp = Date.now();
    const socioInitial = socioNombre ? socioNombre.charAt(0).toUpperCase() : 'X';
    const creditoInitial = creditoId ? creditoId.charAt(0).toUpperCase() : 'C';
    return `${timestamp}${socioInitial}${creditoInitial}`;
  }

  function renderCobranzas(all) {
    const container = app.modules.cobranzas.container;
    const tbody = container?.querySelector('#cobranzas-table-body');
    if (!tbody) return;

    if (!all?.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="py-3 px-3 lg:px-6 text-center text-slate-500">No hay cobranzas registradas</td></tr>';
      return;
    }

    const { page, pageSize } = app.modules.cobranzas;
    const start = (page - 1) * pageSize;
    const pageData = all.slice(start, start + pageSize);
    const mobile = isMobile();

    tbody.innerHTML = pageData.map(cobranza => {
      const socioNombre = app.sociosIndex.get(keyify(cobranza.ID_Socio)) || cobranza.ID_Socio || 'N/A';
      const creditoInfo = app.creditosIndex.get(keyify(cobranza.ID_Credito)) || cobranza.ID_Credito || 'N/A';
      
      // Formato optimizado de moneda - siempre mostrar formato completo
      const montoPagado = formatCurrency(cobranza.Monto_Pagado, { 
        compact: false, // No usar formato compacto para preservar precisión
        minimumFractionDigits: 2,
        maximumFractionDigits: 2 // Siempre mostrar 2 decimales para consistencia
      });
      
      // Formato optimizado de fecha - más legible
      const fechaPago = formatDate(cobranza.Fecha_Pago, { 
        includeTime: true,
        compact: mobile 
      });

      // Comprobante truncado para móvil
      const comprobante = mobile ? 
        (cobranza.Numero_Comprobante || 'N/A').slice(-8) :
        (cobranza.Numero_Comprobante || 'N/A');

      return `
        <tr class="hover:bg-slate-50">
          <td class="py-2 lg:py-3 px-3 lg:px-6 font-mono text-xs">${comprobante}</td>
          <td class="py-2 lg:py-3 px-3 lg:px-6 text-sm">
            <div class="truncate max-w-[120px] lg:max-w-none" title="${socioNombre}">${socioNombre}</div>
          </td>
          <td class="py-2 lg:py-3 px-3 lg:px-6 hidden sm:table-cell text-sm">
            <div class="truncate max-w-[100px] lg:max-w-none" title="${creditoInfo}">${creditoInfo}</div>
          </td>
          <td class="py-2 lg:py-3 px-3 lg:px-6 font-semibold text-green-600 currency text-sm">${montoPagado}</td>
          <td class="py-2 lg:py-3 px-3 lg:px-6 hidden md:table-cell text-sm">${fechaPago}</td>
          <td class="py-2 lg:py-3 px-3 lg:px-6 hidden lg:table-cell">
            <span class="px-2 py-1 rounded-full text-xs font-medium ${getMetodoColor(cobranza.Metodo_Pago)}">
              ${mobile ? getMetodoShort(cobranza.Metodo_Pago) : (cobranza.Metodo_Pago || 'N/A')}
            </span>
          </td>
          <td class="py-2 lg:py-3 px-3 lg:px-6">
            <div class="flex ${mobile ? 'flex-col gap-1' : 'flex-row gap-2'}">
              <button class="edit-cobranza-btn bg-blue-500 text-white py-1 px-2 rounded text-xs hover:bg-blue-600 transition-colors"
                      data-cobranza='${JSON.stringify(cobranza)}' title="Editar">
                <i class="fas fa-edit ${mobile ? '' : 'mr-1'}"></i>${mobile ? '' : 'Editar'}
              </button>
              <button class="delete-cobranza-btn bg-red-500 text-white py-1 px-2 rounded text-xs hover:bg-red-600 transition-colors"
                      data-cobranza='${JSON.stringify(cobranza)}' title="Eliminar">
                <i class="fas fa-trash ${mobile ? '' : 'mr-1'}"></i>${mobile ? '' : 'Eliminar'}
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Event listeners optimizados
    tbody.querySelectorAll('.edit-cobranza-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cobranza = JSON.parse(btn.dataset.cobranza);
        openEditCobranza(cobranza);
      });
    });

    tbody.querySelectorAll('.delete-cobranza-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cobranza = JSON.parse(btn.dataset.cobranza);
        confirmDeleteCobranza(cobranza);
      });
    });

    // Update pagination info
    updatePaginationInfo('cobranzas', all.length);
  }

  function getMetodoColor(metodo) {
    switch (metodo) {
      case 'Efectivo': return 'bg-green-100 text-green-800';
      case 'Transferencia Bancaria': return 'bg-blue-100 text-blue-800';
      case 'Depósito': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  function getMetodoShort(metodo) {
    switch (metodo) {
      case 'Efectivo': return 'Efec.';
      case 'Transferencia Bancaria': return 'Trans.';
      case 'Depósito': return 'Dep.';
      default: return metodo || 'N/A';
    }
  }

  function updatePaginationInfo(modKey, totalItems) {
    const container = app.modules[modKey].container;
    const totalElement = container?.querySelector(`#total-reg-${modKey}`);
    const pageIndicator = container?.querySelector(`#page-indicator-${modKey}`);
    const { page, pageSize } = app.modules[modKey];
    
    if (totalElement) {
      totalElement.textContent = `Total: ${totalItems} registros`;
    }
    
    if (pageIndicator) {
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      pageIndicator.textContent = `${page} de ${totalPages}`;
    }
  }

  function renderCobranzasSkeleton(rows = 5) {
    const container = app.modules.cobranzas.container;
    const tbody = container?.querySelector('#cobranzas-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = Array.from({ length: rows }, () => `
      <tr class="skeleton-row">
        <td class="py-3 px-6"><div class="skeleton h-4 w-20"></div></td>
        <td class="py-3 px-6"><div class="skeleton h-4 w-32"></div></td>
        <td class="py-3 px-6"><div class="skeleton h-4 w-24"></div></td>
        <td class="py-3 px-6"><div class="skeleton h-4 w-20"></div></td>
        <td class="py-3 px-6"><div class="skeleton h-4 w-28"></div></td>
        <td class="py-3 px-6"><div class="skeleton h-4 w-16"></div></td>
        <td class="py-3 px-6"><div class="skeleton h-4 w-24"></div></td>
      </tr>
    `).join('');
  }

  async function fetchAndRenderCobranzas(isBackground = false) {
    if (!isBackground) renderCobranzasSkeleton();
    
    const result = await safeRequest(async () => {
      // Cargar datos en paralelo para mejor rendimiento
      const [cobranzasResponse] = await Promise.all([
        client.request(readItems(COBRANZAS_COLLECTION, {
          fields: COBRANZAS_FIELDS,
          sort: ['-Fecha_Pago'],
          limit: 100 // Limitar para carga inicial más rápida
        })),
        ensureSociosIndex(),
        ensureCreditosIndex()
      ]);
      
      return cobranzasResponse;
    }, false);
    
    if (result !== null) {
      const module = app.modules.cobranzas;
      module.data = result.data || (Array.isArray(result) ? result : []);
      renderCobranzas(module.data);
    } else {
      const module = app.modules.cobranzas;
      module.data = [];
      renderCobranzas([]);
    }
  }

  async function ensureCreditosIndex() {
    if (app.creditosIndex.size > 0) return;
    
    const result = await safeRequest(async () => {
      return await client.request(readItems(CREDITOS_COLLECTION, {
        fields: ['ID_Credito','Monto_Solicitado','Fecha_Aprobacion','Estado','ID_Socio'],
        limit: 1000
      }));
    }, false);
    
    if (result !== null) {
      const creditos = result.data || (Array.isArray(result) ? result : []);
      app.creditosIndex.clear();
      app.creditosList = [];
      
      creditos.forEach(credito => {
        const monto = formatCurrency(credito.Monto_Solicitado, { 
          minimumFractionDigits: 2, 
          maximumFractionDigits: 2 
        });
        const fechaAprobacion = credito.Fecha_Aprobacion ? 
          formatDate(credito.Fecha_Aprobacion, { includeTime: false, compact: true }) : 
          'Sin aprobar';
        const label = `${monto} - ${fechaAprobacion}`;
        
        app.creditosIndex.set(keyify(credito.ID_Credito), label);
        app.creditosList.push({ 
          id: keyify(credito.ID_Credito), 
          label,
          socioId: keyify(credito.ID_Socio),
          monto: credito.Monto_Solicitado,
          estado: credito.Estado,
          fechaAprobacion: credito.Fecha_Aprobacion
        });
      });
    }
  }

  function openEditCobranza(cobranza) {
    const container = app.modules.cobranzas.container;
    const modal = container?.querySelector('#cobranza-modal');
    const form = container?.querySelector('#cobranza-form');
    
    if (!modal || !form) return;

    const title = container.querySelector('#cobranza-modal-title');
    if (title) title.textContent = cobranza ? 'Editar Pago' : 'Registrar Pago';

    // Resetear formulario
    form.reset();
    
    if (cobranza) {
      // Llenar formulario para edición
      form.querySelector('#ID_Cobranza').value = cobranza.ID_Cobranza || '';
      form.querySelector('#ID_Socio_Cobranza').value = cobranza.ID_Socio || '';
      form.querySelector('#ID_Credito').value = cobranza.ID_Credito || '';
      form.querySelector('#Monto_Pagado').value = Number(cobranza.Monto_Pagado || 0).toFixed(2);
      form.querySelector('#Metodo_Pago').value = cobranza.Metodo_Pago || '';
      form.querySelector('#Numero_Comprobante').value = cobranza.Numero_Comprobante || '';
      form.querySelector('#Observaciones').value = cobranza.Observaciones || '';
      
      if (cobranza.Fecha_Pago) {
        const fecha = new Date(cobranza.Fecha_Pago);
        form.querySelector('#Fecha_Pago').value = fecha.toISOString().slice(0, 16);
      }
      
      // Cargar créditos del socio si está seleccionado
      if (cobranza.ID_Socio) {
        const creditoSelect = form.querySelector('#ID_Credito');
        populateCreditoSelect(creditoSelect, cobranza.ID_Socio);
        creditoSelect.disabled = false;
      }
    } else {
      // Nuevo pago - establecer fecha actual
      const now = new Date();
      form.querySelector('#Fecha_Pago').value = now.toISOString().slice(0, 16);
    }

    // Initialize number formatting for any number inputs in this modal
    initializeNumberFormatting(modal);

    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  async function handleCobranzaSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const socioId = form.querySelector('#ID_Socio_Cobranza').value;
    const creditoId = form.querySelector('#ID_Credito').value;
    const socioNombre = app.sociosIndex.get(keyify(socioId)) || 'Unknown';
    
    const data = {
      ID_Socio: socioId,
      ID_Credito: creditoId,
      Monto_Pagado: parseFloat(form.querySelector('#Monto_Pagado').value) || 0,
      Fecha_Pago: form.querySelector('#Fecha_Pago').value,
      Metodo_Pago: form.querySelector('#Metodo_Pago').value,
      Observaciones: form.querySelector('#Observaciones').value || null
    };

    const idCobranza = form.querySelector('#ID_Cobranza').value;
    const isEdit = Boolean(idCobranza);

    // Generar número de comprobante si es nuevo
    if (!isEdit) {
      data.Numero_Comprobante = generateComprobanteNumber(socioNombre, creditoId);
    }

    const result = await safeRequest(async () => {
      if (isEdit) {
        return await client.request(updateItem(COBRANZAS_COLLECTION, idCobranza, data));
      } else {
        return await client.request(createItem(COBRANZAS_COLLECTION, data));
      }
    });
    
    if (result !== null) {
      showCustomAlert({
        title: 'Éxito',
        message: isEdit ? 'Los datos del pago se han actualizado correctamente.' : 'El pago se ha registrado correctamente.',
        type: 'success'
      });
      
      const modal = form.closest('#cobranza-modal');
      modal?.classList.add('hidden');
      
      await fetchAndRenderCobranzas(true);
    }
  }

  function confirmDeleteCobranza(cobranza) {
    const socioNombre = app.sociosIndex.get(keyify(cobranza.ID_Socio)) || 'Socio desconocido';
    const montoPagado = formatCurrency(cobranza.Monto_Pagado || 0, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    
    showCustomAlert({
      title: 'Confirmar Eliminación',
      message: `¿Está seguro de eliminar el pago de ${montoPagado} de ${socioNombre}?\n\nComprobante: ${cobranza.Numero_Comprobante || 'Sin comprobante'}\n\nEsta acción no se puede deshacer.`,
      type: 'confirm',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      onConfirm: () => doDeleteCobranza(cobranza.ID_Cobranza)
    });
  }
  
  async function doDeleteCobranza(idVal) {
    screenBlocker.classList.remove('hidden');
    
    const result = await safeRequest(async () => {
      return await client.request(deleteItem(COBRANZAS_COLLECTION, idVal));
    });
    
    if (result !== null) {
      await fetchAndRenderCobranzas(true);
      showCustomAlert({
        title: 'Éxito',
        message: 'El pago ha sido eliminado correctamente.',
        type: 'success'
      });
    }
    
    screenBlocker.classList.add('hidden');
  }

  // ---------- arranque ----------
  console.log('Inicializando aplicación...');
  console.log('Elementos encontrados:', {
    mainContent: !!mainContent,
    moduleTitle: !!moduleTitle,
    navLinks: navLinks.length,
    sidebar: !!sidebar,
    mobileMenuBtn: !!mobileMenuBtn
  });
  
  // Cargar módulo inicial
  await switchView('socios');
  console.log('Aplicación inicializada correctamente');
  
  // Interceptor para errores de token no manejados
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    console.log('Unhandled rejection detectado:', error);
    
    // Verificar si es un error de token/autenticación
    if (error?.status === 401 || 
        error?.status === 403 || 
        error?.message?.includes('token') ||
        error?.message?.includes('Unauthorized') ||
        error?.message?.includes('Forbidden') ||
        error?.message?.includes('Token expired')) {
      
      console.log('Error de autenticación detectado globalmente:', error);
      event.preventDefault(); // Prevenir que se muestre en la consola
      handleTokenExpiration(error);
    }
  });

  console.log('Sistema de manejo de tokens inicializado correctamente');
  
  // Función de prueba para token expiration (para debug)
  window.testTokenExpiration = () => {
    console.log('Probando sistema de token expiration...');
    handleTokenExpiration({ status: 401, message: 'Token expired (test)' });
  };
  
  console.log('Para probar el sistema: testTokenExpiration()');

// Función para inicializar filtros de reportes/cobranzas
window.initReportesFilters = function() {
  const filtersButton = document.getElementById('toggle-cobranzas-filters');
  const filtersPanel = document.getElementById('cobranzas-filters-panel');
  const searchInput = document.getElementById('cobranzas-search');
  const socioSelect = document.getElementById('cobranzas-socio');
  const metodoSelect = document.getElementById('cobranzas-metodo');
  const montoMinInput = document.getElementById('cobranzas-monto-min');
  const montoMaxInput = document.getElementById('cobranzas-monto-max');
  const fechaInicioInput = document.getElementById('cobranzas-fecha-inicio');
  const fechaFinInput = document.getElementById('cobranzas-fecha-fin');
  const clearButton = document.getElementById('clear-cobranzas-filters');
  const applyButton = document.getElementById('apply-cobranzas-filters');

  let filterState = {
    search: '',
    socio: '',
    metodo: '',
    montoMin: '',
    montoMax: '',
    fechaInicio: '',
    fechaFin: ''
  };

  let originalData = [];
  let searchTimeout;

  // Toggle panel de filtros
  if (filtersButton && filtersPanel) {
    filtersButton.addEventListener('click', () => {
      const isHidden = filtersPanel.classList.contains('hidden');
      if (isHidden) {
        filtersPanel.classList.remove('hidden');
        filtersButton.innerHTML = `
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
          Ocultar Filtros
        `;
      } else {
        filtersPanel.classList.add('hidden');
        filtersButton.innerHTML = `
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707v4.586a1 1 0 01-.293.707l-2 2A1 1 0 0111 20.586V14.414a1 1 0 00-.293-.707L4.293 7.293A1 1 0 014 6.586V4z"></path>
          </svg>
          Mostrar Filtros
        `;
      }
    });
  }

  // Función de filtrado
  function filterData() {
    if (!originalData.length) return;

    let filteredData = originalData.filter(item => {
      // Filtro de búsqueda
      if (filterState.search) {
        const searchTerm = filterState.search.toLowerCase();
        const searchableText = `${item.nombre_socio || ''} ${item.metodo_pago || ''} ${item.monto || ''}`.toLowerCase();
        if (!searchableText.includes(searchTerm)) return false;
      }

      // Filtro de socio
      if (filterState.socio && item.nombre_socio !== filterState.socio) return false;

      // Filtro de método de pago
      if (filterState.metodo && item.metodo_pago !== filterState.metodo) return false;

      // Filtro de monto mínimo
      if (filterState.montoMin && parseFloat(item.monto) < parseFloat(filterState.montoMin)) return false;

      // Filtro de monto máximo
      if (filterState.montoMax && parseFloat(item.monto) > parseFloat(filterState.montoMax)) return false;

      // Filtro de fecha inicio
      if (filterState.fechaInicio && new Date(item.fecha_pago) < new Date(filterState.fechaInicio)) return false;

      // Filtro de fecha fin
      if (filterState.fechaFin && new Date(item.fecha_pago) > new Date(filterState.fechaFin)) return false;

      return true;
    });

    // Actualizar la tabla con datos filtrados
    if (window.updateCobranzasTable) {
      window.updateCobranzasTable(filteredData);
    }
  }

  // Event listeners para búsqueda con debounce
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        filterState.search = e.target.value;
        filterData();
      }, 300);
    });
  }

  // Event listeners para selects
  if (socioSelect) {
    socioSelect.addEventListener('change', (e) => {
      filterState.socio = e.target.value;
      filterData();
    });
  }

  if (metodoSelect) {
    metodoSelect.addEventListener('change', (e) => {
      filterState.metodo = e.target.value;
      filterData();
    });
  }

  // Event listeners para inputs de monto
  if (montoMinInput) {
    montoMinInput.addEventListener('input', (e) => {
      filterState.montoMin = e.target.value;
      filterData();
    });
  }

  if (montoMaxInput) {
    montoMaxInput.addEventListener('input', (e) => {
      filterState.montoMax = e.target.value;
      filterData();
    });
  }

  // Event listeners para fechas
  if (fechaInicioInput) {
    fechaInicioInput.addEventListener('change', (e) => {
      filterState.fechaInicio = e.target.value;
      filterData();
    });
  }

  if (fechaFinInput) {
    fechaFinInput.addEventListener('change', (e) => {
      filterState.fechaFin = e.target.value;
      filterData();
    });
  }

  // Limpiar filtros
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      filterState = {
        search: '',
        socio: '',
        metodo: '',
        montoMin: '',
        montoMax: '',
        fechaInicio: '',
        fechaFin: ''
      };

      if (searchInput) searchInput.value = '';
      if (socioSelect) socioSelect.value = '';
      if (metodoSelect) metodoSelect.value = '';
      if (montoMinInput) montoMinInput.value = '';
      if (montoMaxInput) montoMaxInput.value = '';
      if (fechaInicioInput) fechaInicioInput.value = '';
      if (fechaFinInput) fechaFinInput.value = '';

      // Restaurar datos originales
      if (window.updateCobranzasTable && originalData.length) {
        window.updateCobranzasTable(originalData);
      }
    });
  }

  // Aplicar filtros (mismo comportamiento que el filtrado automático)
  if (applyButton) {
    applyButton.addEventListener('click', () => {
      filterData();
    });
  }

  // Función para establecer datos originales
  window.setOriginalCobranzasData = function(data) {
    originalData = [...data];
    
    // Poblar select de socios
    if (socioSelect) {
      const socios = [...new Set(data.map(item => item.nombre_socio).filter(Boolean))];
      socioSelect.innerHTML = '<option value="">Todos los socios</option>';
      socios.forEach(socio => {
        const option = document.createElement('option');
        option.value = socio;
        option.textContent = socio;
        socioSelect.appendChild(option);
      });
    }
  };

  console.log('Filtros de reportes/cobranzas inicializados');
};
});
