// ==========================================
// 1. CONFIGURACIÓN DEL MAPA Y CREDENCIALES
// ==========================================
const RIOBAMBA_CENTER = [-1.665, -78.654];
const map = L.map('map').setView(RIOBAMBA_CENTER, 14);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB'
}).addTo(map);

const SUPABASE_URL = 'https://phsaujoiuayfzwydxygo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoc2F1am9pdWF5Znp3eWR4eWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzU4NjIsImV4cCI6MjEwMDIxMTg2Mn0.drMcjGEiZmVFGYgpPz1u2PN0M1bu_8PXRpD1rGBr7Gg';

// Grupos de capas separados (Layer Control Profesional)
const emergenciasLayerGroup = L.layerGroup().addTo(map);
const upcLayerGroup = L.layerGroup().addTo(map);
const hospitalLayerGroup = L.layerGroup().addTo(map);
let lineaRutaActiva = null; // Línea dinámica para análisis de proximidad

let rawEmergenciasData = [];
let marcadoresGuardados = {};
const cacheDirecciones = {};

// ==========================================
// 🌟 INFRAESTRUCTURA REAL Y CONTROL DE CAPAS GIS
// ==========================================
const infraestructuraReal = [
    { nombre: "UPC La Condamine", tipo: "policia", lat: -1.6685, lng: -78.6480, desc: "Patrullas Sector Centro" },
    { nombre: "UPC Politécnica (UNACH)", tipo: "policia", lat: -1.6580, lng: -78.6750, desc: "Respuesta Inmediata Universitaria" },
    { nombre: "UPC Terminal Terrestre", tipo: "policia", lat: -1.6492, lng: -78.6585, desc: "Control Norte" },
    { nombre: "UPC La Paz", tipo: "policia", lat: -1.6780, lng: -78.6620, desc: "Control Sur" },
    { nombre: "Hospital General Docente", tipo: "hospital", lat: -1.6548, lng: -78.6558, desc: "Emergencias Mayores (Trauma)" },
    { nombre: "Hospital del IESS", tipo: "hospital", lat: -1.6738, lng: -78.6461, desc: "Atención General" }
];

function dibujarInfraestructura() {
    upcLayerGroup.clearLayers();
    hospitalLayerGroup.clearLayers();

    infraestructuraReal.forEach(inst => {
        const isPolicia = inst.tipo === "policia";
        const customIcon = L.divIcon({
            className: 'infra-pin',
            html: `<div class="${isPolicia ? 'bg-blue-600' : 'bg-teal-500'} w-7 h-7 rounded flex items-center justify-center text-white shadow-lg border border-white">
                     <i class="fa-solid ${isPolicia ? 'fa-shield-halved' : 'fa-square-h'} text-xs"></i>
                   </div>`,
            iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -25]
        });

        const marker = L.marker([inst.lat, inst.lng], { icon: customIcon });
        marker.bindPopup(`
            <div class="text-xs p-1">
                <span class="font-black text-slate-800 block mb-1 uppercase border-b pb-1">
                    ${isPolicia ? '🚓' : '🏥'} ${inst.nombre}
                </span>
                <span class="text-slate-500">${inst.desc}</span>
                <div class="mt-2 text-[9px] text-indigo-500 font-bold bg-indigo-50 p-1 rounded text-center">ACTIVO 24/7 - RED SICOA</div>
            </div>
        `);
        if (isPolicia) upcLayerGroup.addLayer(marker);
        else hospitalLayerGroup.addLayer(marker);
    });
}

// Eventos de los Checkboxes (Apagar y prender capas)
document.getElementById('toggleUPC')?.addEventListener('change', (e) => e.target.checked ? map.addLayer(upcLayerGroup) : map.removeLayer(upcLayerGroup));
document.getElementById('toggleHospital')?.addEventListener('change', (e) => e.target.checked ? map.addLayer(hospitalLayerGroup) : map.removeLayer(hospitalLayerGroup));
document.getElementById('toggleRutas')?.addEventListener('change', (e) => { if(!e.target.checked && lineaRutaActiva) map.removeLayer(lineaRutaActiva); });

// ==========================================
// 🚀 ANÁLISIS ESPACIAL: ENCONTRAR PATRULLA MÁS CERCANA
// ==========================================
function trazarRutaMasCercana(lat, lng) {
    if (lineaRutaActiva) map.removeLayer(lineaRutaActiva); // Limpiar ruta anterior
    if (!document.getElementById('toggleRutas')?.checked) return;

    let upcMasCercano = null;
    let distanciaMinima = Infinity;

    // Calcular distancias (En metros) usando el motor interno de Leaflet
    infraestructuraReal.filter(i => i.tipo === 'policia').forEach(upc => {
        const distanciaMetros = map.distance([lat, lng], [upc.lat, upc.lng]);
        if (distanciaMetros < distanciaMinima) {
            distanciaMinima = distanciaMetros;
            upcMasCercano = upc;
        }
    });

    if (upcMasCercano) {
        // Trazar línea animada en el mapa
        lineaRutaActiva = L.polyline([[lat, lng], [upcMasCercano.lat, upcMasCercano.lng]], {
            color: '#dc2626', weight: 3, dashArray: '5, 10', opacity: 0.8
        }).addTo(map);
        
        // Notificación de despacho
        const distKm = (distanciaMinima / 1000).toFixed(2);
        console.log(`🚓 Despachando patrulla desde ${upcMasCercano.nombre}. Distancia: ${distKm} km`);
    }
}

// ==========================================
// 3. FUNCIONALIDADES NÚCLEO (API, UTILIDADES)
// ==========================================
function escapeHTML(str) { return str ? String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[match]) : ''; }
function calcularEdad(f) { if(!f) return '-'; const ed = Math.abs(new Date(Date.now() - new Date(f).getTime()).getUTCFullYear() - 1970); return isNaN(ed) ? '-' : ed; }

async function obtenerCalleRiobambaConPausa(lat, lon, id, index) {
    if (!lat || !lon) return;
    const coords = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    if (cacheDirecciones[coords]) { actualizarCeldaDireccion(id, cacheDirecciones[coords]); return; }
    setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`);
            const data = await res.json();
            const dir = (data.display_name || "").split(',').slice(0, 2).join(', ') + ', Riobamba';
            cacheDirecciones[coords] = dir;
            actualizarCeldaDireccion(id, dir);
        } catch (e) { actualizarCeldaDireccion(id, "Riobamba (GPS)"); }
    }, index * 300);
}

function actualizarCeldaDireccion(id, dir) { 
    const celda = document.getElementById(`dir-${id}`); 
    if(celda) celda.innerHTML = `<i class="fa-solid fa-map-pin text-red-400 mr-1"></i> ${escapeHTML(dir)}`; 
}

async function cargarDatosIniciales() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/alertas?select=*`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
        if (!response.ok) throw new Error("Error");
        rawEmergenciasData = await response.json();
        aplicarFiltros();
        actualizarEstadoConexion(true);
    } catch (e) { actualizarEstadoConexion(false); }
}

function actualizarEstadoConexion(conectado) {
    const sb = document.getElementById('statusGeoServer');
    if(sb) {
        sb.className = conectado ? "bg-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full border border-emerald-500/30 flex items-center shadow-inner" : "bg-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full border border-red-500/30 flex items-center";
        sb.innerHTML = conectado ? '<i class="fa-solid fa-satellite-dish text-emerald-400 mr-2 animate-pulse"></i> WebSocket Realtime Activo' : '<i class="fa-solid fa-triangle-exclamation mr-2"></i> Desconectado';
    }
}

function enfocarAlerta(id, lat, lon) {
    map.flyTo([lat, lon], 17, { animate: true, duration: 1.5 });
    setTimeout(() => { if (marcadoresGuardados[id]) marcadoresGuardados[id].openPopup(); }, 1500);
    // DISPARAR EL ANÁLISIS DE PROXIMIDAD AL ENFOCAR
    trazarRutaMasCercana(lat, lon);
}

function renderizarUI(lista) {
    emergenciasLayerGroup.clearLayers();
    marcadoresGuardados = {};
    if (lineaRutaActiva) map.removeLayer(lineaRutaActiva); // Limpiar ruta al recargar
    
    const tbody = document.getElementById('tablaEmergenciasBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const listaOrdenada = [...lista].sort((a,b) => new Date(b.created_at || b.fecha_hora || 0) - new Date(a.created_at || a.fecha_hora || 0));

    listaOrdenada.forEach((item, index) => {
        if (!item.latitud || !item.longitud) return;

        const edad = calcularEdad(item.fecha_nacimiento);
        const esAtendida = item.estado === 'Atendida';
        
        const pinClass = esAtendida ? "bg-green-600" : "animate-bounce bg-red-600";
        const iconAlert = L.divIcon({
            className: 'custom-alert-pin',
            html: `<div class="${pinClass} w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] shadow-lg"><i class="fa-solid ${esAtendida ? 'fa-check' : 'fa-bell'}"></i></div>`,
            iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -20]
        });

        const marker = L.marker([item.latitud, item.longitud], { icon: iconAlert });
        const controlesHTML = esAtendida 
            ? `<div class="mt-3"><button onclick="eliminarAlerta(${item.id})" class="w-full bg-slate-500 hover:bg-red-600 text-white py-1.5 rounded text-[10px] font-bold transition shadow"><i class="fa-solid fa-trash"></i> Borrar Registro</button></div>`
            : `<div class="mt-3 flex gap-2">
                 <button onclick="marcarAtendida(${item.id})" class="flex-1 bg-green-500 hover:bg-green-600 text-white py-1.5 rounded text-[10px] font-bold transition shadow"><i class="fa-solid fa-check-circle"></i> Atender</button>
                 <button onclick="eliminarAlerta(${item.id})" class="flex-1 bg-slate-500 hover:bg-red-600 text-white py-1.5 rounded text-[10px] font-bold transition shadow"><i class="fa-solid fa-trash"></i> Eliminar</button>
               </div>`;

        marker.bindPopup(`
            <div class="font-sans text-xs w-48">
                <div class="${esAtendida ? 'bg-green-600' : 'bg-red-600'} text-white font-bold p-2 -m-3 mb-2 rounded-t-lg text-center">
                    ${esAtendida ? '✅ ALERTA ATENDIDA' : '🚨 ALERTA REALTIME'}
                </div>
                <p class="mt-3 text-sm font-bold text-slate-800"><i class="fa-regular fa-id-card"></i> ${escapeHTML(item.cedula || 'N/D')}</p>
                <p class="text-xs text-slate-600">${escapeHTML(item.nombres)} ${escapeHTML(item.apellidos)}</p>
                <p class="text-[10px] font-bold mt-1 ${item.descripcion?.includes("Médica") ? 'text-green-600' : 'text-red-600'}">Tipo: ${escapeHTML(item.descripcion || 'Emergencia')}</p>
                ${controlesHTML}
            </div>`);
        
        emergenciasLayerGroup.addLayer(marker);
        marcadoresGuardados[item.id] = marker;

        const tr = document.createElement('tr');
        tr.className = esAtendida ? "bg-green-50/50 hover:bg-green-100 transition cursor-pointer group" : "hover:bg-indigo-50 transition cursor-pointer group";
        tr.onclick = () => enfocarAlerta(item.id, item.latitud, item.longitud);
        
        obtenerCalleRiobambaConPausa(item.latitud, item.longitud, item.id, index);

        const fechaCruda = item.created_at || item.fecha_hora;
        const esMedica = item.descripcion && item.descripcion.includes("Médica");
        const colorBadge = esMedica ? "bg-green-100 text-green-700 border-green-300" : "bg-red-100 text-red-700 border-red-300";

        tr.innerHTML = `
            <td class="p-3 ${esAtendida ? 'text-green-600' : 'text-red-600'} font-black">#${item.id}</td>
            <td class="p-3"><span class="block font-bold text-slate-700">${fechaCruda ? new Date(fechaCruda).toLocaleTimeString() : 'Recién'}</span></td>
            <td class="p-3">
                <span class="block font-bold text-slate-800">${escapeHTML(item.nombres || 'Anónimo')} ${escapeHTML(item.apellidos || '')}</span>
                <span class="text-[10px] text-slate-500 font-mono"><i class="fa-regular fa-id-card"></i> ${escapeHTML(item.cedula || 'Sin cédula')}</span>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-1 border rounded text-[10px] font-bold uppercase ${colorBadge}">${esMedica ? '<i class="fa-solid fa-truck-medical"></i>' : '<i class="fa-solid fa-person-rifle"></i>'} ${escapeHTML(item.descripcion || 'Alerta')}</span>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px]">${item.genero === 'Femenino' ? '<i class="fa-solid fa-venus text-pink-500"></i>' : '<i class="fa-solid fa-mars text-blue-500"></i>'} ${escapeHTML(item.genero || 'N/D')}</span>
            </td>
            <td class="p-3 text-[11px] font-medium text-slate-600" id="dir-${item.id}"><i class="fa-solid fa-circle-notch fa-spin text-slate-300"></i> Localizando...</td>
        `;
        tbody.appendChild(tr);
    });
    
    const counter = document.getElementById('counterEmergencias');
    if(counter) counter.innerText = listaOrdenada.length;
}

// ==========================================
// 4. FUNCIONES DE FILTRADO Y GESTIÓN
// ==========================================
function aplicarFiltros() {
    const cedula = document.getElementById('filterCedula')?.value.trim() || '';
    const tipo = document.getElementById('filterTipo')?.value || 'todos';
    const gen = document.getElementById('filterGenero')?.value || 'todos';
    
    const filtrados = rawEmergenciasData.filter(item => {
        if (cedula !== '' && item.cedula !== cedula) return false;
        if (gen !== 'todos' && item.genero !== gen) return false;
        if (tipo !== 'todos' && item.descripcion && !item.descripcion.includes(tipo)) return false;
        return true;
    });
    renderizarUI(filtrados);
}

function limpiarFiltros() {
    ['filterCedula', 'filterTipo', 'filterGenero'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = id === 'filterCedula' ? '' : 'todos';
    });
    aplicarFiltros();
}

window.marcarAtendida = async function(id) {
    const idx = rawEmergenciasData.findIndex(e => e.id === id);
    if(idx !== -1) { rawEmergenciasData[idx].estado = 'Atendida'; aplicarFiltros(); map.closePopup(); }
    try { await fetch(`${SUPABASE_URL}/rest/v1/alertas?id=eq.${id}`, { method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'Atendida' }) }); } catch(e) {}
};

window.eliminarAlerta = async function(id) {
    if(!confirm("⚠️ ¿Estás seguro de que deseas eliminar esta alerta del sistema?")) return;
    rawEmergenciasData = rawEmergenciasData.filter(e => e.id !== id);
    aplicarFiltros();
    try { await fetch(`${SUPABASE_URL}/rest/v1/alertas?id=eq.${id}`, { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }); } catch(e) {}
};

// ==========================================
// 5. CONEXIÓN WEBSOCKET REALTIME
// ==========================================
function inicializarWebSocketRealtime() {
    const socket = new WebSocket(`wss://phsaujoiuayfzwydxygo.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
    socket.onopen = () => {
        socket.send(JSON.stringify({ "topic": "realtime:public:alertas", "event": "phx_join", "payload": { "config": { "postgres_changes": [{ "event": "INSERT", "schema": "public", "table": "alertas" }] } }, "ref": "1" }));
        setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ "topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": "hb" })); }, 30000);
    };
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.event === "postgres_changes" && data.payload && data.payload.data) {
                const nueva = data.payload.data.record;
                rawEmergenciasData.unshift(nueva);
                aplicarFiltros();
                if (nueva.latitud) enfocarAlerta(nueva.id, nueva.latitud, nueva.longitud);
            }
        } catch (err) {}
    };
    socket.onerror = () => cargarDatosIniciales();
}

// ASIGNACIÓN DE EVENTOS Y ARRANQUE SICOA
document.getElementById('btnAplicarFiltros')?.addEventListener('click', aplicarFiltros);
document.getElementById('btnLimpiarFiltros')?.addEventListener('click', limpiarFiltros);
document.getElementById('btnRefresh')?.addEventListener('click', cargarDatosIniciales);

dibujarInfraestructura(); // 👈 Dibuja UPCs y Hospitales al instante
cargarDatosIniciales();
inicializarWebSocketRealtime();