// Módulo de Reportes con generación de PDFs
import { formatCurrency, formatDate, showCustomAlert } from './utils.js';
import { 
    SOCIOS_COLLECTION, 
    APORTES_COLLECTION, 
    CREDITOS_COLLECTION, 
    COBRANZAS_COLLECTION 
} from './config.js';

// Estado del módulo
let currentData = [];
let reportConfig = {};

// Función auxiliar para convertir valores a string (tomada de main.js)
const keyify = (v) => String(v ?? '');

// Función para obtener nombre de socio por ID
function getSocioName(socioId) {
    if (!socioId) return '';
    
    // Verificar si window.app y sociosIndex están disponibles
    if (window.app && window.app.sociosIndex) {
        const nombre = window.app.sociosIndex.get(keyify(socioId));
        return nombre || `Socio #${socioId}`;
    }
    
    return `Socio #${socioId}`;
}

// Inicializar módulo
export function initReportes() {
    setupEventListeners();
    loadSociosForFilters();
    loadCreditosForFilters();
    
    // Inicializar filtros si están disponibles
    if (window.initReportesFilters) {
        window.initReportesFilters();
    }
}

// Configurar event listeners
function setupEventListeners() {
    const reportTypeSelect = document.getElementById('report-type');
    const generateBtn = document.getElementById('generate-report-btn');

    reportTypeSelect?.addEventListener('change', handleReportTypeChange);
    generateBtn?.addEventListener('click', generateReport);

    // Event listeners para filtros dinámicos
    setupFilterListeners();
}

// Configurar listeners para filtros
function setupFilterListeners() {
    // Filtros de socios
    const sociosFilterType = document.getElementById('socios-filter-type');
    sociosFilterType?.addEventListener('change', handleSociosFilterChange);

    // Filtros de aportes
    const aportesFilterType = document.getElementById('aportes-filter-type');
    aportesFilterType?.addEventListener('change', handleAportesFilterChange);

    // Filtros de créditos
    const creditosFilterType = document.getElementById('creditos-filter-type');
    creditosFilterType?.addEventListener('change', handleCreditosFilterChange);

    // Filtros de cobranzas
    const cobranzasFilterType = document.getElementById('cobranzas-filter-type');
    cobranzasFilterType?.addEventListener('change', handleCobranzasFilterChange);

    // Listeners para actualizar preview
    document.querySelectorAll('#report-filters input, #report-filters select').forEach(element => {
        element.addEventListener('change', updatePreview);
    });
}

// Manejar cambio de tipo de reporte
function handleReportTypeChange(e) {
    const reportType = e.target.value;
    const filtersContainer = document.getElementById('report-filters');
    
    // Ocultar todos los filtros
    document.querySelectorAll('[id$="-filters"]').forEach(filter => {
        filter.classList.add('hidden');
    });

    if (reportType) {
        filtersContainer.classList.remove('hidden');
        document.getElementById(`${reportType}-filters`).classList.remove('hidden');
        updatePreview();
    } else {
        filtersContainer.classList.add('hidden');
        resetPreview();
    }
}

// Manejar filtros de socios
function handleSociosFilterChange(e) {
    const filterType = e.target.value;
    const dateRange = document.getElementById('socios-date-range');
    
    if (filterType === 'fecha_inscripcion') {
        dateRange.classList.remove('hidden');
    } else {
        dateRange.classList.add('hidden');
    }
    updatePreview();
}

// Manejar filtros de aportes
function handleAportesFilterChange(e) {
    const filterType = e.target.value;
    const dateRange = document.getElementById('aportes-date-range');
    const socioSelect = document.getElementById('aportes-socio-select');
    const tipoSelect = document.getElementById('aportes-tipo-select');
    
    // Ocultar todos los sub-filtros
    dateRange.classList.add('hidden');
    socioSelect.classList.add('hidden');
    tipoSelect.classList.add('hidden');
    
    switch (filterType) {
        case 'fecha':
            dateRange.classList.remove('hidden');
            break;
        case 'socio':
            socioSelect.classList.remove('hidden');
            break;
        case 'tipo':
            tipoSelect.classList.remove('hidden');
            break;
    }
    updatePreview();
}

// Manejar filtros de créditos
function handleCreditosFilterChange(e) {
    const filterType = e.target.value;
    const estadoSelect = document.getElementById('creditos-estado-select');
    const dateRange = document.getElementById('creditos-date-range');
    const socioSelect = document.getElementById('creditos-socio-select');
    const montoRange = document.getElementById('creditos-monto-range');
    
    // Ocultar todos los sub-filtros
    estadoSelect.classList.add('hidden');
    dateRange.classList.add('hidden');
    socioSelect.classList.add('hidden');
    montoRange.classList.add('hidden');
    
    switch (filterType) {
        case 'estado':
            estadoSelect.classList.remove('hidden');
            break;
        case 'fecha_aprobacion':
            dateRange.classList.remove('hidden');
            break;
        case 'socio':
            socioSelect.classList.remove('hidden');
            break;
        case 'monto':
            montoRange.classList.remove('hidden');
            break;
    }
    updatePreview();
}

// Manejar filtros de cobranzas
function handleCobranzasFilterChange(e) {
    const filterType = e.target.value;
    const dateRange = document.getElementById('cobranzas-date-range');
    const socioSelect = document.getElementById('cobranzas-socio-select');
    const creditoSelect = document.getElementById('cobranzas-credito-select');
    const montoRange = document.getElementById('cobranzas-monto-range');
    const metodoSelect = document.getElementById('cobranzas-metodo-select');
    
    // Ocultar todos los sub-filtros
    dateRange.classList.add('hidden');
    socioSelect.classList.add('hidden');
    creditoSelect.classList.add('hidden');
    montoRange.classList.add('hidden');
    metodoSelect.classList.add('hidden');
    
    switch (filterType) {
        case 'fecha':
            dateRange.classList.remove('hidden');
            break;
        case 'socio':
            socioSelect.classList.remove('hidden');
            break;
        case 'credito':
            creditoSelect.classList.remove('hidden');
            break;
        case 'monto':
            montoRange.classList.remove('hidden');
            break;
        case 'metodo':
            metodoSelect.classList.remove('hidden');
            break;
    }
    updatePreview();
}

// Cargar socios para filtros
async function loadSociosForFilters() {
    try {
        const response = await window.safeRequest(async () => {
            const client = window.getClient();
            return await client.request(window.readItems('socios', {
                fields: ['ID_Socio','Nombres_Completos','Apellidos_Completos'],
                limit: 1000, 
                sort: ['Nombres_Completos','Apellidos_Completos']
            }));
        }, false);
        
        if (response) {
            const sociosSelects = [
                'aportes-socio',
                'creditos-socio',
                'cobranzas-socio'
            ];

            sociosSelects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    // Limpiar opciones existentes (excepto la primera)
                    select.innerHTML = '<option value="">Todos los socios</option>';
                    
                    (response.data || response).forEach(socio => {
                        const option = document.createElement('option');
                        option.value = socio.ID_Socio;
                        option.textContent = `${socio.Nombres_Completos} ${socio.Apellidos_Completos}`;
                        select.appendChild(option);
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error cargando socios para filtros:', error);
        showCustomAlert({
            title: 'Error',
            message: 'Error al cargar la lista de socios para los filtros',
            type: 'error'
        });
    }
}

// Cargar créditos para filtros
async function loadCreditosForFilters() {
    try {
        const response = await window.safeRequest(async () => {
            const client = window.getClient();
            return await client.request(window.readItems('creditos', {
                fields: ['ID_Credito','Monto_Solicitado','ID_Socio','Estado'],
                filter: { Estado: { _eq: 'Activo' } },
                limit: 1000
            }));
        }, false);
        
        if (response) {
            const creditoSelect = document.getElementById('cobranzas-credito');
            if (creditoSelect) {
                creditoSelect.innerHTML = '<option value="">Todos los créditos</option>';
                
                (response.data || response).forEach(credito => {
                    const option = document.createElement('option');
                    option.value = credito.ID_Credito;
                    option.textContent = `Crédito ${credito.ID_Credito} - ${formatCurrency(credito.Monto_Solicitado)}`;
                    creditoSelect.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error cargando créditos para filtros:', error);
        showCustomAlert({
            title: 'Error',
            message: 'Error al cargar la lista de créditos para los filtros',
            type: 'error'
        });
    }
}

// Función para cargar índice de socios manualmente
async function loadSociosIndex() {
    try {
        const response = await window.safeRequest(async () => {
            const client = window.getClient();
            return await client.request(window.readItems('socios', {
                fields: ['ID_Socio','Nombres_Completos','Apellidos_Completos'],
                limit: 1000, 
                sort: ['Nombres_Completos','Apellidos_Completos']
            }));
        }, false);
        
        if (response) {
            const socios = response.data || response;
            const keyify = (v) => String(v ?? '');
            
            // Inicializar si no existe
            if (!window.app) {
                window.app = {
                    sociosIndex: new Map(),
                    sociosList: []
                };
            }
            
            // Limpiar índices existentes
            window.app.sociosIndex.clear();
            window.app.sociosList = [];
            
            // Poblar índices
            socios.forEach(socio => {
                const id = keyify(socio.ID_Socio);
                const label = `${socio.Nombres_Completos || ''} ${socio.Apellidos_Completos || ''}`.trim() || `Socio ${id}`;
                window.app.sociosIndex.set(id, label);
                window.app.sociosList.push({ id, label });
            });
            
            console.log('Índices de socios cargados exitosamente:', window.app.sociosIndex.size);
        }
    } catch (error) {
        console.error('Error cargando índices de socios:', error);
        throw error;
    }
}

// Actualizar vista previa
async function updatePreview() {
    const reportType = document.getElementById('report-type').value;
    if (!reportType) return;

    try {
        const data = await fetchReportData(reportType);
        currentData = data;
        displayPreview(data, reportType);
        updateQuickStats(data, reportType);
    } catch (error) {
        console.error('Error actualizando preview:', error);
        showCustomAlert({
            title: 'Error',
            message: 'Error al cargar los datos del reporte',
            type: 'error'
        });
    }
}

// Obtener datos del reporte
async function fetchReportData(reportType) {
    // Asegurar que los índices de socios estén cargados para mostrar nombres en lugar de IDs
    if (reportType === 'aportes' || reportType === 'creditos' || reportType === 'cobranzas') {
        try {
            console.log('Verificando disponibilidad de window.app...');
            
            // Si window.app no está disponible, inicializarlo
            if (!window.app) {
                console.log('window.app no disponible, inicializando...');
                window.app = {
                    sociosIndex: new Map(),
                    sociosList: []
                };
            }
            
            // Verificar si los índices están cargados
            if (!window.app.sociosIndex || window.app.sociosIndex.size === 0) {
                console.log('Cargando índices de socios manualmente...');
                await loadSociosIndex();
            } else {
                console.log('Índices de socios ya están cargados:', window.app.sociosIndex.size);
            }
        } catch (error) {
            console.warn('Error cargando índices de socios:', error);
        }
    }

    let collection = '';
    let filters = [];
    
    switch (reportType) {
        case 'socios':
            collection = SOCIOS_COLLECTION;
            filters = buildSociosFilters();
            break;
        case 'aportes':
            collection = APORTES_COLLECTION;
            filters = buildAportesFilters();
            break;
        case 'creditos':
            collection = CREDITOS_COLLECTION;
            filters = buildCreditosFilters();
            break;
        case 'cobranzas':
            collection = COBRANZAS_COLLECTION;
            filters = buildCobranzasFilters();
            break;
    }

    try {
        const response = await window.safeRequest(async () => {
            const client = window.getClient();
            const query = {
                fields: getFieldsForReportType(reportType),
                limit: -1
            };
            
            // Aplicar filtros si existen
            if (filters.length > 0) {
                query.filter = buildFilterObject(filters);
            }
            
            return await client.request(window.readItems(collection, query));
        }, false);
        
        return (response?.data || response) || [];
    } catch (error) {
        console.error('Error obteniendo datos del reporte:', error);
        showCustomAlert({
            title: 'Error',
            message: 'Error al obtener los datos del reporte',
            type: 'error'
        });
        return [];
    }
}

// Convertir filtros de URL a objeto de filtro
function buildFilterObject(filters) {
    const filterObj = {};
    
    filters.forEach(filter => {
        // Parsear filtros del formato filter[campo][operador]=valor
        const match = filter.match(/filter\[([^\]]+)\]\[([^\]]+)\]=(.+)/);
        if (match) {
            const [, field, operator, value] = match;
            if (!filterObj[field]) filterObj[field] = {};
            filterObj[field][operator] = value;
        }
    });
    
    return filterObj;
}

// Construir filtros para socios
function buildSociosFilters() {
    const filters = [];
    const filterType = document.getElementById('socios-filter-type').value;
    
    switch (filterType) {
        case 'activos':
            filters.push('filter[Estado_Socio][_eq]=Activo');
            break;
        case 'inactivos':
            filters.push('filter[Estado_Socio][_eq]=Inactivo');
            break;
        case 'fecha_inscripcion':
            const fechaDesde = document.getElementById('socios-fecha-desde').value;
            const fechaHasta = document.getElementById('socios-fecha-hasta').value;
            if (fechaDesde) filters.push(`filter[Fecha_Ingreso][_gte]=${fechaDesde}`);
            if (fechaHasta) filters.push(`filter[Fecha_Ingreso][_lte]=${fechaHasta}`);
            break;
    }
    
    return filters;
}

// Construir filtros para aportes
function buildAportesFilters() {
    const filters = [];
    const filterType = document.getElementById('aportes-filter-type').value;
    
    switch (filterType) {
        case 'fecha':
            const fechaDesde = document.getElementById('aportes-fecha-desde').value;
            const fechaHasta = document.getElementById('aportes-fecha-hasta').value;
            if (fechaDesde) filters.push(`filter[Fecha_Aporte][_gte]=${fechaDesde}`);
            if (fechaHasta) filters.push(`filter[Fecha_Aporte][_lte]=${fechaHasta}`);
            break;
        case 'socio':
            const socioId = document.getElementById('aportes-socio').value;
            if (socioId) filters.push(`filter[ID_Socio][_eq]=${socioId}`);
            break;
        case 'tipo':
            const tipo = document.getElementById('aportes-tipo').value;
            if (tipo) filters.push(`filter[Tipo_Aporte][_eq]=${tipo}`);
            break;
    }
    
    return filters;
}

// Construir filtros para créditos
function buildCreditosFilters() {
    const filters = [];
    const filterType = document.getElementById('creditos-filter-type').value;
    
    switch (filterType) {
        case 'estado':
            const estado = document.getElementById('creditos-estado').value;
            if (estado) filters.push(`filter[Estado][_eq]=${estado}`);
            break;
        case 'fecha_aprobacion':
            const fechaDesde = document.getElementById('creditos-fecha-desde').value;
            const fechaHasta = document.getElementById('creditos-fecha-hasta').value;
            if (fechaDesde) filters.push(`filter[Fecha_Aprobacion][_gte]=${fechaDesde}`);
            if (fechaHasta) filters.push(`filter[Fecha_Aprobacion][_lte]=${fechaHasta}`);
            break;
        case 'socio':
            const socioId = document.getElementById('creditos-socio').value;
            if (socioId) filters.push(`filter[ID_Socio][_eq]=${socioId}`);
            break;
        case 'monto':
            const montoMin = document.getElementById('creditos-monto-min').value;
            const montoMax = document.getElementById('creditos-monto-max').value;
            if (montoMin) filters.push(`filter[Monto_Solicitado][_gte]=${montoMin}`);
            if (montoMax) filters.push(`filter[Monto_Solicitado][_lte]=${montoMax}`);
            break;
    }
    
    return filters;
}

// Construir filtros para cobranzas
function buildCobranzasFilters() {
    const filters = [];
    const filterType = document.getElementById('cobranzas-filter-type').value;
    
    switch (filterType) {
        case 'fecha':
            const fechaDesde = document.getElementById('cobranzas-fecha-desde').value;
            const fechaHasta = document.getElementById('cobranzas-fecha-hasta').value;
            if (fechaDesde) filters.push(`filter[Fecha_Pago][_gte]=${fechaDesde}`);
            if (fechaHasta) filters.push(`filter[Fecha_Pago][_lte]=${fechaHasta}`);
            break;
        case 'socio':
            const socioId = document.getElementById('cobranzas-socio').value;
            if (socioId) filters.push(`filter[ID_Socio][_eq]=${socioId}`);
            break;
        case 'credito':
            const creditoId = document.getElementById('cobranzas-credito').value;
            if (creditoId) filters.push(`filter[ID_Credito][_eq]=${creditoId}`);
            break;
        case 'monto':
            const montoMin = document.getElementById('cobranzas-monto-min').value;
            const montoMax = document.getElementById('cobranzas-monto-max').value;
            if (montoMin) filters.push(`filter[Monto_Pagado][_gte]=${montoMin}`);
            if (montoMax) filters.push(`filter[Monto_Pagado][_lte]=${montoMax}`);
            break;
        case 'metodo':
            const metodo = document.getElementById('cobranzas-metodo').value;
            if (metodo) filters.push(`filter[Metodo_Pago][_eq]=${metodo}`);
            break;
    }
    
    return filters;
}

// Obtener campos para cada tipo de reporte
function getFieldsForReportType(reportType) {
    const fieldMaps = {
        socios: ['ID_Socio','Nombres_Completos','Apellidos_Completos','Cedula_Identidad','Fecha_Nacimiento','Direccion_Domicilio','Telefono_Celular','Correo_Electronico','Fecha_Ingreso','Estado_Socio'],
        aportes: ['ID_Aporte','ID_Socio','Monto_Aporte','Fecha_Aporte','Tipo_Aporte'],
        creditos: ['ID_Credito','ID_Socio','Monto_Solicitado','Tasa_Interes','Plazo_Meses','Fecha_Solicitud','Fecha_Aprobacion','Estado','Observaciones'],
        cobranzas: ['ID_Cobranza','ID_Credito','ID_Socio','Fecha_Pago','Monto_Pagado','Metodo_Pago','Numero_Comprobante','Observaciones']
    };
    
    return fieldMaps[reportType] || ['*'];
}

// Mostrar vista previa
function displayPreview(data, reportType) {
    const preview = document.getElementById('report-preview');
    if (!preview) return;

    const reportTitle = document.getElementById('report-title').value || `Reporte de ${reportType.charAt(0).toUpperCase() + reportType.slice(1)}`;
    
    let html = `
        <div class="bg-white">
            <div class="text-center mb-6 pb-4 border-b">
                <div class="flex items-center justify-center mb-4">
                    <img src="images/logo.webp" alt="Logo" class="h-16 w-16 mr-4">
                    <div>
                        <h1 class="text-2xl font-bold text-slate-800">CAJA DE AHORROS TUPAK RANTINA</h1>
                        <p class="text-slate-600">${reportTitle}</p>
                        <p class="text-sm text-slate-500">Generado el ${formatDate(new Date())}</p>
                    </div>
                </div>
            </div>
            
            <div class="overflow-x-auto">
                ${generateTableForReportType(data, reportType)}
            </div>
            
            ${document.getElementById('include-summary').checked ? generateSummary(data, reportType) : ''}
        </div>
    `;
    
    preview.innerHTML = html;
}

// Generar tabla según tipo de reporte
function generateTableForReportType(data, reportType) {
    if (!data || data.length === 0) {
        return '<p class="text-center text-slate-500 py-8">No hay datos para mostrar con los filtros seleccionados</p>';
    }

    switch (reportType) {
        case 'socios':
            return generateSociosTable(data);
        case 'aportes':
            return generateAportesTable(data);
        case 'creditos':
            return generateCreditosTable(data);
        case 'cobranzas':
            return generateCobranzasTable(data);
        default:
            return '<p class="text-center text-slate-500">Tipo de reporte no válido</p>';
    }
}

// Generar tabla de socios
function generateSociosTable(data) {
    return `
        <table class="min-w-full text-sm">
            <thead class="bg-slate-100">
                <tr>
                    <th class="px-4 py-2 text-left">Código</th>
                    <th class="px-4 py-2 text-left">Nombre Completo</th>
                    <th class="px-4 py-2 text-left">Cédula</th>
                    <th class="px-4 py-2 text-left">Teléfono</th>
                    <th class="px-4 py-2 text-left">Fecha Ingreso</th>
                    <th class="px-4 py-2 text-left">Estado</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(socio => `
                    <tr class="border-b">
                        <td class="px-4 py-2">${socio.ID_Socio || '-'}</td>
                        <td class="px-4 py-2">${socio.Nombres_Completos} ${socio.Apellidos_Completos}</td>
                        <td class="px-4 py-2">${socio.Cedula_Identidad || '-'}</td>
                        <td class="px-4 py-2">${socio.Telefono_Celular || '-'}</td>
                        <td class="px-4 py-2">${formatDate(socio.Fecha_Ingreso)}</td>
                        <td class="px-4 py-2">
                            <span class="px-2 py-1 text-xs rounded ${socio.Estado_Socio === 'Activo' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                                ${socio.Estado_Socio || 'N/A'}
                            </span>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

// Generar tabla de aportes
function generateAportesTable(data) {
    console.log('Generando tabla de aportes con', data.length, 'registros');
    console.log('Estado de window.app:', !!window.app);
    console.log('Estado de sociosIndex:', window.app?.sociosIndex?.size || 'No disponible');
    
    // Función auxiliar para keyify (convertir a string)
    const keyify = (v) => String(v ?? '');
    
    return `
        <table class="min-w-full text-sm">
            <thead class="bg-slate-100">
                <tr>
                    <th class="px-4 py-2 text-left">Fecha</th>
                    <th class="px-4 py-2 text-left">Socio</th>
                    <th class="px-4 py-2 text-left">Tipo</th>
                    <th class="px-4 py-2 text-right">Monto</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(aporte => {
                    const socioId = keyify(aporte.ID_Socio);
                    const socioNombre = window.app?.sociosIndex?.get(socioId) || socioId || '-';
                    
                    // Debug para el primer registro
                    if (data.indexOf(aporte) === 0) {
                        console.log('Primer aporte - ID_Socio original:', aporte.ID_Socio, 'keyify:', socioId, 'Nombre encontrado:', socioNombre);
                        console.log('Claves disponibles en sociosIndex:', window.app?.sociosIndex ? Array.from(window.app.sociosIndex.keys()).slice(0, 5) : 'No disponible');
                    }
                    
                    return `
                    <tr class="border-b">
                        <td class="px-4 py-2">${formatDate(aporte.Fecha_Aporte)}</td>
                        <td class="px-4 py-2">${socioNombre}</td>
                        <td class="px-4 py-2">${aporte.Tipo_Aporte || '-'}</td>
                        <td class="px-4 py-2 text-right font-medium">${formatCurrency(aporte.Monto_Aporte)}</td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Generar tabla de créditos
function generateCreditosTable(data) {
    console.log('Generando tabla de créditos con', data.length, 'registros');
    
    // Función auxiliar para keyify (convertir a string)
    const keyify = (v) => String(v ?? '');
    
    return `
        <table class="min-w-full text-sm">
            <thead class="bg-slate-100">
                <tr>
                    <th class="px-4 py-2 text-left">Socio</th>
                    <th class="px-4 py-2 text-right">Monto</th>
                    <th class="px-4 py-2 text-left">Fecha Solicitud</th>
                    <th class="px-4 py-2 text-left">Fecha Aprobación</th>
                    <th class="px-4 py-2 text-left">Estado</th>
                    <th class="px-4 py-2 text-center">Plazo (Meses)</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(credito => {
                    const socioId = keyify(credito.ID_Socio);
                    const socioNombre = window.app?.sociosIndex?.get(socioId) || socioId || '-';
                    
                    return `
                    <tr class="border-b">
                        <td class="px-4 py-2">${socioNombre}</td>
                        <td class="px-4 py-2 text-right font-medium">${formatCurrency(credito.Monto_Solicitado)}</td>
                        <td class="px-4 py-2">${formatDate(credito.Fecha_Solicitud)}</td>
                        <td class="px-4 py-2">${credito.Fecha_Aprobacion ? formatDate(credito.Fecha_Aprobacion) : '-'}</td>
                        <td class="px-4 py-2">
                            <span class="px-2 py-1 text-xs rounded ${getEstadoColor(credito.Estado)}">
                                ${credito.Estado}
                            </span>
                        </td>
                        <td class="px-4 py-2 text-center">${credito.Plazo_Meses || '-'}</td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Generar tabla de cobranzas
function generateCobranzasTable(data) {
    console.log('Generando tabla de cobranzas con', data.length, 'registros');
    
    // Función auxiliar para keyify (convertir a string)
    const keyify = (v) => String(v ?? '');
    
    return `
        <table class="min-w-full text-sm">
            <thead class="bg-slate-100">
                <tr>
                    <th class="px-4 py-2 text-left">Fecha Pago</th>
                    <th class="px-4 py-2 text-left">Socio</th>
                    <th class="px-4 py-2 text-left">Crédito</th>
                    <th class="px-4 py-2 text-right">Monto Pagado</th>
                    <th class="px-4 py-2 text-left">Método Pago</th>
                    <th class="px-4 py-2 text-left">Comprobante</th>
                </tr>
            </thead>
            <tbody>
                ${data.map(cobranza => {
                    const socioId = keyify(cobranza.ID_Socio);
                    const socioNombre = window.app?.sociosIndex?.get(socioId) || socioId || '-';
                    
                    return `
                    <tr class="border-b">
                        <td class="px-4 py-2">${formatDate(cobranza.Fecha_Pago)}</td>
                        <td class="px-4 py-2">${socioNombre}</td>
                        <td class="px-4 py-2">${cobranza.ID_Credito || '-'}</td>
                        <td class="px-4 py-2 text-right font-medium">${formatCurrency(cobranza.Monto_Pagado)}</td>
                        <td class="px-4 py-2">${cobranza.Metodo_Pago || '-'}</td>
                        <td class="px-4 py-2">${cobranza.Numero_Comprobante || '-'}</td>
                    </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Obtener color para estado
function getEstadoColor(estado) {
    const colors = {
        'Solicitado': 'bg-yellow-100 text-yellow-800',
        'Aprobado': 'bg-blue-100 text-blue-800',
        'Activo': 'bg-green-100 text-green-800',
        'Pagado': 'bg-gray-100 text-gray-800',
        'Rechazado': 'bg-red-100 text-red-800',
        'En Mora': 'bg-red-100 text-red-800'
    };
    return colors[estado] || 'bg-gray-100 text-gray-800';
}

// Generar resumen
function generateSummary(data, reportType) {
    const stats = calculateStats(data, reportType);
    
    return `
        <div class="mt-8 pt-6 border-t">
            <h3 class="text-lg font-semibold text-slate-700 mb-4">Resumen Estadístico</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                ${Object.entries(stats).map(([label, value]) => `
                    <div class="bg-slate-50 rounded-lg p-4 text-center">
                        <div class="text-xl font-bold text-slate-800">${value}</div>
                        <div class="text-sm text-slate-600">${label}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// Calcular estadísticas
function calculateStats(data, reportType) {
    const stats = {
        'Total Registros': data.length
    };

    switch (reportType) {
        case 'socios':
            const activos = data.filter(s => s.Estado_Socio === 'Activo').length;
            stats['Socios Activos'] = activos;
            stats['Socios Inactivos'] = data.length - activos;
            break;
            
        case 'aportes':
            const totalAportes = data.reduce((sum, a) => sum + (parseFloat(a.Monto_Aporte) || 0), 0);
            stats['Total Aportes'] = formatCurrency(totalAportes);
            stats['Promedio'] = formatCurrency(totalAportes / data.length);
            break;
            
        case 'creditos':
            const totalCreditos = data.reduce((sum, c) => sum + (parseFloat(c.Monto_Solicitado) || 0), 0);
            stats['Total Prestado'] = formatCurrency(totalCreditos);
            stats['Promedio'] = formatCurrency(totalCreditos / data.length);
            break;
            
        case 'cobranzas':
            const totalCobranzas = data.reduce((sum, c) => sum + (parseFloat(c.Monto_Pagado) || 0), 0);
            stats['Total Cobrado'] = formatCurrency(totalCobranzas);
            stats['Promedio'] = formatCurrency(totalCobranzas / data.length);
            break;
    }

    return stats;
}

// Actualizar estadísticas rápidas
function updateQuickStats(data, reportType) {
    const quickStats = document.getElementById('quick-stats');
    const statCount = document.getElementById('stat-count');
    const statTotal = document.getElementById('stat-total');
    const statLabel = document.getElementById('stat-label');

    if (!quickStats || !statCount || !statTotal) return;

    quickStats.classList.remove('hidden');
    statCount.textContent = data.length;

    let total = 0;
    let label = 'Registros';

    switch (reportType) {
        case 'aportes':
            total = data.reduce((sum, item) => sum + (parseFloat(item.monto) || 0), 0);
            label = 'Aportes';
            break;
        case 'creditos':
            total = data.reduce((sum, item) => sum + (parseFloat(item.monto) || 0), 0);
            label = 'Créditos';
            break;
        case 'cobranzas':
            total = data.reduce((sum, item) => sum + (parseFloat(item.monto_pago) || 0), 0);
            label = 'Cobranzas';
            break;
        default:
            total = data.length;
            label = 'Socios';
    }

    statTotal.textContent = typeof total === 'number' && total > 0 ? formatCurrency(total) : data.length.toString();
    statLabel.textContent = label;
}

// Resetear vista previa
function resetPreview() {
    const preview = document.getElementById('report-preview');
    const quickStats = document.getElementById('quick-stats');
    
    if (preview) {
        preview.innerHTML = `
            <div class="text-center text-slate-500 mt-16">
                <i class="fas fa-file-pdf text-4xl mb-4 opacity-50"></i>
                <p>Seleccione un tipo de reporte para ver la vista previa</p>
            </div>
        `;
    }
    
    if (quickStats) {
        quickStats.classList.add('hidden');
    }
}

// Generar reporte PDF
async function generateReport() {
    const reportType = document.getElementById('report-type').value;
    if (!reportType) {
        showCustomAlert({
            title: 'Error',
            message: 'Por favor seleccione un tipo de reporte',
            type: 'warning'
        });
        return;
    }

    const generateBtn = document.getElementById('generate-report-btn');
    const statusDiv = document.getElementById('generation-status');
    
    try {
        // Mostrar estado de carga
        generateBtn.disabled = true;
        statusDiv.classList.remove('hidden');
        
        // Crear configuración del reporte
        const config = buildReportConfig(reportType);
        
        // Verificar que tenemos datos para generar el reporte
        if (!currentData || currentData.length === 0) {
            throw new Error('No hay datos disponibles para generar el reporte. Verifique los filtros aplicados.');
        }
        
        console.log('Datos para generar reporte:', currentData.length, 'registros');
        
        // Generar reporte usando window.print en lugar de jsPDF
        await generatePrintableReport(currentData, config, reportType);
        
        showCustomAlert({
            title: 'Éxito',
            message: 'Reporte generado exitosamente. Se abrió una nueva ventana para imprimir.',
            type: 'success'
        });
        
    } catch (error) {
        console.error('Error generando reporte:', error);
        showCustomAlert({
            title: 'Error',
            message: 'Error al generar el reporte: ' + error.message,
            type: 'error'
        });
    } finally {
        generateBtn.disabled = false;
        statusDiv.classList.add('hidden');
    }
}

// Generar reporte imprimible en nueva ventana
async function generatePrintableReport(data, config, reportType) {
    // Crear el HTML del reporte
    const reportHTML = createPrintableHTML(data, config, reportType);
    
    // Abrir nueva ventana
    const printWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');
    
    if (!printWindow) {
        throw new Error('No se pudo abrir la ventana para imprimir. Verifique que no esté bloqueando ventanas emergentes.');
    }
    
    // Escribir el HTML en la nueva ventana
    printWindow.document.write(reportHTML);
    printWindow.document.close();
    
    // Configurar auto-impresión cuando cargue
    printWindow.onload = function() {
        setTimeout(() => {
            printWindow.print();
        }, 500);
    };
}

// Crear HTML imprimible
function createPrintableHTML(data, config, reportType) {
    const fechaActual = new Date().toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    const horaActual = new Date().toLocaleTimeString('es-ES');
    
    // Generar tabla HTML
    const tableHTML = generatePrintableTable(data, config, reportType);
    
    // Generar resumen si está habilitado
    const summaryHTML = config.includeSummary ? generatePrintableSummary(data, config) : '';
    
    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reporte ${config.title}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            line-height: 1.4;
            color: #333;
            background: white;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e67e22;
        }
        
        .logo {
            width: 60px;
            height: 60px;
            margin: 0 auto 15px;
            display: block;
        }
        
        h1 {
            color: #2c3e50;
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 8px;
        }
        
        h2 {
            color: #e67e22;
            font-size: 16px;
            font-weight: normal;
            margin-bottom: 15px;
        }
        
        .date-info {
            color: #7f8c8d;
            font-size: 11px;
        }
        
        .content {
            margin: 20px 0;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            font-size: 11px;
        }
        
        th, td {
            border: 1px solid #bdc3c7;
            padding: 8px 6px;
            text-align: left;
            vertical-align: top;
        }
        
        th {
            background-color: #34495e;
            color: white;
            font-weight: bold;
            text-align: center;
        }
        
        tbody tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        
        tbody tr:hover {
            background-color: #e8f4f8;
        }
        
        .summary {
            margin-top: 30px;
            padding: 20px;
            background-color: #ecf0f1;
            border-radius: 8px;
            border-left: 4px solid #e67e22;
        }
        
        .summary h3 {
            color: #2c3e50;
            margin-bottom: 15px;
            font-size: 14px;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        
        .summary-item {
            background: white;
            padding: 12px;
            border-radius: 4px;
            border: 1px solid #bdc3c7;
        }
        
        .summary-label {
            font-weight: bold;
            color: #34495e;
            font-size: 11px;
            margin-bottom: 4px;
        }
        
        .summary-value {
            font-size: 13px;
            color: #e67e22;
            font-weight: bold;
        }
        
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #bdc3c7;
            text-align: center;
            color: #7f8c8d;
            font-size: 10px;
        }
        
        .no-data {
            text-align: center;
            padding: 40px;
            color: #7f8c8d;
            font-style: italic;
        }
        
        @media print {
            body { padding: 10px; }
            .header { margin-bottom: 20px; }
            table { font-size: 10px; }
            th, td { padding: 4px 3px; }
            .summary { margin-top: 20px; padding: 15px; }
            .footer { margin-top: 20px; }
            
            /* Evitar saltos de página dentro de filas */
            tr { page-break-inside: avoid; }
            
            /* Mantener encabezados en nuevas páginas */
            thead { display: table-header-group; }
            tfoot { display: table-footer-group; }
        }
    </style>
</head>
<body>
    <div class="header">
        <img src="images/logo.webp" alt="Logo" class="logo" onerror="this.style.display='none'">
        <h1>CAJA DE AHORROS TUPAK RANTINA</h1>
        <h2>${config.title}</h2>
        <div class="date-info">
            Generado el ${fechaActual} a las ${horaActual}
        </div>
    </div>
    
    <div class="content">
        ${tableHTML}
        ${summaryHTML}
    </div>
    
    <div class="footer">
        <p>Sistema de Gestión Cooperativa - TUPAK RANTINA</p>
        <p>Este documento ha sido generado automáticamente</p>
    </div>
</body>
</html>`;
}

// Generar tabla HTML para impresión
function generatePrintableTable(data, config, reportType) {
    console.log('generatePrintableTable:', reportType, 'con', data.length, 'registros');
    console.log('Primer registro de datos:', data[0]);
    
    if (!data || data.length === 0) {
        return '<div class="no-data">No hay datos disponibles para mostrar en este reporte.</div>';
    }
    
    const columns = getColumnsForTable(reportType);
    console.log('Columnas para', reportType, ':', columns);
    
    if (!columns || columns.length === 0) {
        return '<div class="no-data">No se pudieron determinar las columnas para este tipo de reporte.</div>';
    }
    
    // Generar encabezados
    const headers = columns.map(col => `<th>${col.label}</th>`).join('');
    
    // Generar filas
    const rows = data.map((item, index) => {
        console.log(`Procesando registro ${index + 1}:`, item);
        
        const cells = columns.map(col => {
            let value = '';
            
            // Manejar campo especial nombre_completo
            if (col.key === 'nombre_completo') {
                value = `${item.Nombres_Completos || ''} ${item.Apellidos_Completos || ''}`.trim();
            } else {
                value = item[col.key] || '';
            }
            
            // Convertir IDs de socios a nombres
            if (col.key === 'ID_Socio') {
                const originalValue = value;
                value = getSocioName(value);
                console.log(`ID_Socio convertido: ${originalValue} -> ${value}`);
            }
            
            // Formatear valores especiales
            if (col.key === 'Monto_Aporte' || col.key === 'Monto_Solicitado' || col.key === 'Monto_Pagado') {
                value = typeof value === 'number' ? `$ ${value.toFixed(2)}` : (value ? `$ ${parseFloat(value).toFixed(2)}` : '');
            } else if (col.key === 'Tasa_Interes') {
                value = typeof value === 'number' ? `${value.toFixed(2)}%` : (value ? `${parseFloat(value).toFixed(2)}%` : '');
            } else if (col.key === 'Fecha_Ingreso' || col.key === 'Fecha_Aporte' || col.key === 'Fecha_Aprobacion' || col.key === 'Fecha_Pago') {
                value = value ? formatDate(value) : '';
            } else if (col.key === 'Estado_Socio') {
                // Mantener el valor tal como viene de la base de datos
                value = value || '';
            }
            
            console.log(`Campo ${col.key}: ${item[col.key]} -> ${value}`);
            
            return `<td>${value || ''}</td>`;
        }).join('');
        
        return `<tr>${cells}</tr>`;
    }).join('');
    
    return `
        <table>
            <thead>
                <tr>${headers}</tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

// Generar resumen HTML para impresión
function generatePrintableSummary(data, config) {
    if (!data || data.length === 0) return '';
    
    const summaryItems = [];
    
    // Total de registros
    summaryItems.push({
        label: 'Total de registros',
        value: data.length.toLocaleString()
    });
    
    // Resúmenes específicos por tipo
    if (config.type === 'socios') {
        const activos = data.filter(item => item.activo).length;
        const inactivos = data.length - activos;
        
        summaryItems.push(
            { label: 'Socios activos', value: activos.toLocaleString() },
            { label: 'Socios inactivos', value: inactivos.toLocaleString() }
        );
        
    } else if (config.type === 'aportes') {
        const totalMontos = data.reduce((sum, item) => sum + (parseFloat(item.Monto_Aporte) || 0), 0);
        
        summaryItems.push(
            { label: 'Total en aportes', value: `$ ${totalMontos.toFixed(2)}` }
        );
        
        // Agrupar por tipo de aporte
        const porTipo = {};
        data.forEach(item => {
            const tipo = item.Tipo_Aporte || 'Sin especificar';
            porTipo[tipo] = (porTipo[tipo] || 0) + (parseFloat(item.Monto_Aporte) || 0);
        });
        
        Object.entries(porTipo).forEach(([tipo, total]) => {
            summaryItems.push({
                label: `Total ${tipo}`,
                value: `$ ${total.toFixed(2)}`
            });
        });
        
    } else if (config.type === 'creditos') {
        const totalMontos = data.reduce((sum, item) => sum + (parseFloat(item.Monto_Solicitado) || 0), 0);
        
        summaryItems.push(
            { label: 'Total en créditos', value: `$ ${totalMontos.toFixed(2)}` }
        );
        
        // Agrupar por estado
        const porEstado = {};
        data.forEach(item => {
            const estado = item.Estado || 'Sin especificar';
            porEstado[estado] = (porEstado[estado] || 0) + 1;
        });
        
        Object.entries(porEstado).forEach(([estado, cantidad]) => {
            summaryItems.push({
                label: `${estado}`,
                value: cantidad.toLocaleString()
            });
        });
        
    } else if (config.type === 'cobranzas') {
        const totalMontos = data.reduce((sum, item) => sum + (parseFloat(item.Monto_Pagado) || 0), 0);
        
        summaryItems.push(
            { label: 'Total cobrado', value: `$ ${totalMontos.toFixed(2)}` }
        );
        
        // Agrupar por método de pago
        const porMetodo = {};
        data.forEach(item => {
            const metodo = item.Metodo_Pago || 'Sin especificar';
            porMetodo[metodo] = (porMetodo[metodo] || 0) + (parseFloat(item.Monto_Pagado) || 0);
        });
        
        Object.entries(porMetodo).forEach(([metodo, total]) => {
            summaryItems.push({
                label: `Total ${metodo}`,
                value: `$ ${total.toFixed(2)}`
            });
        });
    }
    
    const summaryHTML = summaryItems.map(item => `
        <div class="summary-item">
            <div class="summary-label">${item.label}</div>
            <div class="summary-value">${item.value}</div>
        </div>
    `).join('');
    
    return `
        <div class="summary">
            <h3>Resumen del Reporte</h3>
            <div class="summary-grid">
                ${summaryHTML}
            </div>
        </div>
    `;
}

// Obtener columnas para tabla (reutilizar lógica existente)
function getColumnsForTable(reportType) {
    const columnMap = {
        'socios': [
            { key: 'ID_Socio', label: 'Código' },
            { key: 'nombre_completo', label: 'Nombre Completo' },
            { key: 'Cedula_Identidad', label: 'Cédula' },
            { key: 'Telefono_Celular', label: 'Teléfono' },
            { key: 'Fecha_Ingreso', label: 'Fecha Ingreso' },
            { key: 'Estado_Socio', label: 'Estado' }
        ],
        'aportes': [
            { key: 'ID_Aporte', label: 'N° Aporte' },
            { key: 'ID_Socio', label: 'Socio' },
            { key: 'Tipo_Aporte', label: 'Tipo' },
            { key: 'Monto_Aporte', label: 'Monto' },
            { key: 'Fecha_Aporte', label: 'Fecha' }
        ],
        'creditos': [
            { key: 'ID_Credito', label: 'N° Crédito' },
            { key: 'ID_Socio', label: 'Socio' },
            { key: 'Monto_Solicitado', label: 'Monto' },
            { key: 'Tasa_Interes', label: 'Tasa %' },
            { key: 'Plazo_Meses', label: 'Plazo (meses)' },
            { key: 'Fecha_Aprobacion', label: 'Fecha Aprobación' },
            { key: 'Estado', label: 'Estado' }
        ],
        'cobranzas': [
            { key: 'ID_Cobranza', label: 'N° Cobranza' },
            { key: 'ID_Credito', label: 'N° Crédito' },
            { key: 'ID_Socio', label: 'Socio' },
            { key: 'Monto_Pagado', label: 'Monto' },
            { key: 'Fecha_Pago', label: 'Fecha Pago' },
            { key: 'Metodo_Pago', label: 'Método Pago' }
        ]
    };
    
    return columnMap[reportType] || [];
}

// Función para cargar scripts dinámicamente
function loadScript(src) {
    return new Promise((resolve, reject) => {
        // Verificar si el script ya está cargado
        const existingScript = document.querySelector(`script[src="${src}"]`);
        if (existingScript) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            console.log(`Script cargado correctamente: ${src}`);
            resolve();
        };
        script.onerror = (error) => {
            console.error(`Error cargando script: ${src}`, error);
            reject(new Error(`Failed to load script: ${src}`));
        };
        document.head.appendChild(script);
    });
}

// Construir configuración del reporte
function buildReportConfig(reportType) {
    const reportTitle = document.getElementById('report-title').value || `Reporte de ${reportType.charAt(0).toUpperCase() + reportType.slice(1)}`;
    const includeSummary = document.getElementById('include-summary').checked;
    
    return {
        type: reportType,
        title: reportTitle,
        includeSummary: includeSummary,
        date: new Date()
    };
}

// Generar contenido PDF
async function generatePDFContent(pdf, data, config) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let currentY = 20;

    // Encabezado
    currentY = await addPDFHeader(pdf, config, currentY, pageWidth);
    
    // Tabla de datos
    currentY = addPDFTable(pdf, data, config, currentY, pageWidth, pageHeight);
    
    // Resumen (si está habilitado)
    if (config.includeSummary && data.length > 0) {
        currentY = addPDFSummary(pdf, data, config, currentY, pageWidth, pageHeight);
    }
    
    // Pie de página
    addPDFFooter(pdf, pageWidth, pageHeight);
}

// Agregar encabezado al PDF
async function addPDFHeader(pdf, config, startY, pageWidth) {
    try {
        // Intentar cargar y agregar logo
        const logoDataUrl = await loadImageAsDataUrl('images/logo.webp');
        if (logoDataUrl) {
            pdf.addImage(logoDataUrl, 'WEBP', 20, startY - 5, 20, 20);
        }
    } catch (error) {
        console.warn('No se pudo cargar el logo:', error);
    }
    
    // Título principal
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('CAJA DE AHORROS TUPAK RANTINA', pageWidth / 2, startY + 5, { align: 'center' });
    
    // Título del reporte
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'normal');
    pdf.text(config.title, pageWidth / 2, startY + 15, { align: 'center' });
    
    // Fecha
    pdf.setFontSize(10);
    pdf.text(`Generado el: ${formatDate(config.date)} a las ${new Date().toLocaleTimeString()}`, pageWidth / 2, startY + 25, { align: 'center' });
    
    // Línea separadora
    pdf.setLineWidth(0.5);
    pdf.line(20, startY + 30, pageWidth - 20, startY + 30);
    
    return startY + 40;
}

// Función para cargar imagen como Data URL
function loadImageAsDataUrl(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL());
        };
        img.onerror = reject;
        img.src = src;
    });
}

// Agregar tabla al PDF
function addPDFTable(pdf, data, config, startY, pageWidth, pageHeight) {
    if (!data || data.length === 0) {
        pdf.setFontSize(12);
        pdf.text('No hay datos para mostrar', pageWidth / 2, startY + 20, { align: 'center' });
        return startY + 40;
    }

    const columns = getColumnsForPDFTable(config.type);
    const rows = data.map(item => columns.map(col => getValueForColumn(item, col)));
    
    // Usar autoTable si está disponible
    if (typeof pdf.autoTable === 'function') {
        try {
            pdf.autoTable({
                head: [columns.map(col => col.header)],
                body: rows,
                startY: startY,
                styles: { 
                    fontSize: 8,
                    cellPadding: 2
                },
                headStyles: { 
                    fillColor: [71, 85, 105],
                    textColor: [255, 255, 255],
                    fontStyle: 'bold'
                },
                alternateRowStyles: {
                    fillColor: [249, 250, 251]
                },
                margin: { left: 20, right: 20 },
                tableWidth: 'auto',
                columnStyles: getColumnStyles(config.type)
            });
            return pdf.lastAutoTable.finalY + 10;
        } catch (error) {
            console.warn('Error con autoTable, usando tabla básica:', error);
            return addBasicTable(pdf, columns, rows, startY, pageWidth);
        }
    } else {
        return addBasicTable(pdf, columns, rows, startY, pageWidth);
    }
}

// Obtener estilos de columna para autoTable
function getColumnStyles(reportType) {
    const styles = {};
    
    switch (reportType) {
        case 'socios':
            styles[0] = { cellWidth: 20 }; // Código
            styles[1] = { cellWidth: 40 }; // Nombre
            styles[2] = { cellWidth: 30 }; // Apellido
            styles[3] = { cellWidth: 25 }; // DNI
            styles[4] = { cellWidth: 25 }; // Teléfono
            styles[5] = { cellWidth: 25 }; // F. Inscripción
            styles[6] = { cellWidth: 20, halign: 'center' }; // Estado
            break;
            
        case 'aportes':
            styles[0] = { cellWidth: 25 }; // Fecha
            styles[1] = { cellWidth: 50 }; // Socio
            styles[2] = { cellWidth: 40 }; // Tipo
            styles[3] = { cellWidth: 30, halign: 'right' }; // Monto
            break;
            
        case 'creditos':
            styles[0] = { cellWidth: 50 }; // Socio
            styles[1] = { cellWidth: 30, halign: 'right' }; // Monto
            styles[2] = { cellWidth: 25 }; // F. Solicitud
            styles[3] = { cellWidth: 25 }; // F. Aprobación
            styles[4] = { cellWidth: 25, halign: 'center' }; // Estado
            break;
            
        case 'cobranzas':
            styles[0] = { cellWidth: 25 }; // F. Pago
            styles[1] = { cellWidth: 40 }; // Socio
            styles[2] = { cellWidth: 30, halign: 'right' }; // Monto Crédito
            styles[3] = { cellWidth: 30, halign: 'right' }; // Monto Pagado
            styles[4] = { cellWidth: 20, halign: 'center' }; // Cuota #
            break;
    }
    
    return styles;
}

// Obtener columnas para tabla PDF
function getColumnsForPDFTable(reportType) {
    const columnMaps = {
        socios: [
            { key: 'ID_Socio', header: 'Código' },
            { key: 'nombre_completo', header: 'Nombre Completo' },
            { key: 'Cedula_Identidad', header: 'Cédula' },
            { key: 'Telefono_Celular', header: 'Teléfono' },
            { key: 'Fecha_Ingreso', header: 'Fecha Ingreso' },
            { key: 'Estado_Socio', header: 'Estado' }
        ],
        aportes: [
            { key: 'ID_Aporte', header: 'N° Aporte' },
            { key: 'ID_Socio', header: 'Socio' },
            { key: 'Tipo_Aporte', header: 'Tipo' },
            { key: 'Monto_Aporte', header: 'Monto' },
            { key: 'Fecha_Aporte', header: 'Fecha' }
        ],
        creditos: [
            { key: 'ID_Credito', header: 'N° Crédito' },
            { key: 'ID_Socio', header: 'Socio' },
            { key: 'Monto_Solicitado', header: 'Monto' },
            { key: 'Tasa_Interes', header: 'Tasa %' },
            { key: 'Plazo_Meses', header: 'Plazo (meses)' },
            { key: 'Fecha_Aprobacion', header: 'F. Aprobación' },
            { key: 'Estado', header: 'Estado' }
        ],
        cobranzas: [
            { key: 'ID_Cobranza', header: 'N° Cobranza' },
            { key: 'ID_Credito', header: 'N° Crédito' },
            { key: 'ID_Socio', header: 'Socio' },
            { key: 'Monto_Pagado', header: 'Monto' },
            { key: 'Fecha_Pago', header: 'F. Pago' },
            { key: 'Metodo_Pago', header: 'Método Pago' }
        ]
    };
    
    return columnMaps[reportType] || [];
}

// Obtener valor para columna
function getValueForColumn(item, column) {
    switch (column.key) {
        case 'nombre_completo':
            return `${item.Nombres_Completos || ''} ${item.Apellidos_Completos || ''}`.trim();
        case 'ID_Socio':
            // Convertir ID de socio a nombre
            return getSocioName(item[column.key]);
        case 'socio':
            return item.socio ? `${item.socio.nombre} ${item.socio.apellido}` : '-';
        case 'monto_credito':
            return item.credito ? formatCurrency(item.credito.monto) : '-';
        case 'Fecha_Aporte':
        case 'Fecha_Ingreso':
        case 'Fecha_Aprobacion':
        case 'Fecha_Pago':
        case 'fecha_inscripcion':
        case 'fecha_solicitud':
        case 'fecha_pago':
            return item[column.key] ? formatDate(item[column.key]) : '-';
        case 'Monto_Aporte':
        case 'Monto_Solicitado':
        case 'Monto_Pagado':
        case 'monto':
        case 'monto_pago':
            return formatCurrency(item[column.key]);
        case 'Tasa_Interes':
            return item[column.key] ? `${item[column.key]}%` : '-';
        case 'Estado_Socio':
        case 'Estado':
            return item[column.key] || '-';
        case 'activo':
            return item[column.key] ? 'Activo' : 'Inactivo';
        default:
            return item[column.key] || '-';
    }
}

// Agregar tabla básica
function addBasicTable(pdf, columns, rows, startY, pageWidth) {
    let currentY = startY;
    const cellHeight = 6;
    const availableWidth = pageWidth - 40;
    const cellWidth = availableWidth / columns.length;
    const maxRowsPerPage = Math.floor((pdf.internal.pageSize.getHeight() - 100) / cellHeight);
    
    // Función para agregar encabezados
    function addTableHeaders() {
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'bold');
        pdf.setFillColor(71, 85, 105);
        pdf.setTextColor(255, 255, 255);
        
        columns.forEach((col, index) => {
            const x = 20 + (index * cellWidth);
            pdf.rect(x, currentY, cellWidth, cellHeight, 'F');
            pdf.text(col.header, x + 2, currentY + 4);
        });
        
        currentY += cellHeight;
        pdf.setTextColor(0, 0, 0);
        pdf.setFont('helvetica', 'normal');
    }
    
    // Agregar encabezados iniciales
    addTableHeaders();
    
    // Agregar filas
    rows.forEach((row, rowIndex) => {
        // Verificar si necesitamos una nueva página
        if (rowIndex > 0 && rowIndex % maxRowsPerPage === 0) {
            pdf.addPage();
            currentY = 20;
            addTableHeaders();
        }
        
        // Alternar color de fondo
        if (rowIndex % 2 === 0) {
            pdf.setFillColor(249, 250, 251);
            pdf.rect(20, currentY, availableWidth, cellHeight, 'F');
        }
        
        row.forEach((cell, index) => {
            const x = 20 + (index * cellWidth);
            const cellText = String(cell).substring(0, 25); // Truncar texto largo
            pdf.text(cellText, x + 2, currentY + 4);
        });
        
        currentY += cellHeight;
    });
    
    return currentY + 10;
}

// Agregar resumen al PDF
function addPDFSummary(pdf, data, config, startY, pageWidth, pageHeight) {
    if (startY > pageHeight - 60) {
        pdf.addPage();
        startY = 20;
    }
    
    const stats = calculateStats(data, config.type);
    
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Resumen Estadístico', 20, startY);
    
    let currentY = startY + 15;
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    
    Object.entries(stats).forEach(([label, value]) => {
        pdf.text(`${label}: ${value}`, 20, currentY);
        currentY += 8;
    });
    
    return currentY + 10;
}

// Agregar pie de página
function addPDFFooter(pdf, pageWidth, pageHeight) {
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Sistema de Gestión - Caja de Ahorros TUPAK RANTINA', pageWidth / 2, pageHeight - 10, { align: 'center' });
}

// Exportar funciones públicas
export { generateReport, updatePreview };
