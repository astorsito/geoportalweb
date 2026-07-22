// ==========================================
// 1. CONFIGURACIÓN DEL MAPA (Riobamba, Ecuador)
// ==========================================
const RIOBAMBA_CENTER = [-1.665, -78.654];
const map = L.map('map').setView(RIOBAMBA_CENTER, 14);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB'
}).addTo(map);

const SUPABASE_URL = 'https://phsaujoiuayfzwydxygo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoc2F1am9pdWF5Znp3eWR4eWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzU4NjIsImV4cCI6MjEwMDIxMTg2Mn0.drMcjGEiZmVFGYgpPz1u2PN0M1bu_8PXRpD1rGBr7Gg';

// Capas GIS (Layer Control)
const emergenciasLayerGroup = L.layerGroup().addTo(map);
const upcLayerGroup = L.layerGroup().addTo(map);
const hospitalLayerGroup = L.layerGroup().addTo(map);
let lineaRutaActiva = null; 

let rawEmergenciasData = [];
let marcadoresGuardados = {};
const cacheDirecciones = {};

// ==========================================
// 2. INFRAESTRUCTURA Y ANÁLISIS GIS
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
        const iconHTML = isPolicia ? '<i class="fa-solid fa-shield-halved text-sm"></i>' : '<i class="fa-solid fa-square-h text-sm"></i>';
        const bgClass = isPolicia ? 'bg-blue-600' : 'bg-teal-500';

        const customIcon = L.divIcon({
            className: 'infra-pin',
            html: `<div class="${bgClass} w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-[0_0_10px_rgba(0,0,0,0.5)] border-2 border-white">
                     ${iconHTML}
                   </div>`,
            iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -30]
        });

        const marker = L.marker([inst.lat, inst.lng], { icon: customIcon });
        marker.bindPopup(`
            <div class="text-xs p-2">
                <span class="font-black text-slate-800 block mb-1 border-b pb-1">
                    ${isPolicia ? '🚓' : '🏥'} ${inst.nombre}
                </span>
                <span class="text-slate-600 block mb-2">${inst.desc}</span>
                <span class="text-[9px] text-white bg-slate-800 px-2 py-1 rounded font-bold">ACTIVO 24/7 - SICOA</span>
            </div>
        `);
        if (isPolicia) upcLayerGroup.addLayer(marker);
        else hospitalLayerGroup.addLayer(marker);
    });
}

// Control manual de capas desde los Checkboxes
document.getElementById('toggleUPC')?.addEventListener('change', (e) => e.target.checked ? map.addLayer(upcLayerGroup) : map.removeLayer(upcLayerGroup));
document.getElementById('toggleHospital')?.addEventListener('change', (e) => e.target.checked ? map.addLayer(hospitalLayerGroup) : map.removeLayer(hospitalLayerGroup));
document.getElementById('toggleRutas')?.addEventListener('change', (e) => { if(!e.target.checked && lineaRutaActiva) map.removeLayer(lineaRutaActiva); });

// Análisis de Proximidad (Nearest Neighbor Algorithm)
function trazarRutaMasCercana(lat, lng, tipoEmergencia) {
    if (lineaRutaActiva) map.removeLayer(lineaRutaActiva); 
    if (!document.getElementById('toggleRutas')?.checked) return;

    let unidadMasCercana = null;
    let distanciaMinima = Infinity;
    
    // Si es asalto, busca UPC. Si es médica, busca Hospital.
    const tipoBuscado = (tipoEmergencia && tipoEmergencia.includes("Médica")) ? 'hospital' : 'policia';

    infraestructuraReal.filter(i => i.tipo === tipoBuscado).forEach(unidad => {
        const dist = map.distance([lat, lng], [unidad.lat, unidad.lng]);
        if (dist < distanciaMinima) { distanciaMinima = dist; unidadMasCercana = unidad; }
    });

    if (unidadMasCercana) {
        const colorRuta = tipoBuscado === 'policia' ? '#3b82f6' : '#14b8a6'; // Azul o Verde Teal
        lineaRutaActiva = L.polyline([[lat, lng], [unidadMasCercana.lat, unidadMasCercana.lng]], {
            color: colorRuta, weight: 4, dashArray: '8, 8', opacity: 0.9
        }).addTo(map);
        
        // Animamos el mapa para que se vean ambos puntos (La emergencia y el UPC/Hospital)
        map.fitBounds(lineaRutaActiva.getBounds(), { padding: [50, 50], maxZoom: 16 });
    }
}

// ==========================================
// 3. OBTENCIÓN Y RENDERIZADO DE ALERTAS
// ==========================================
function escapeHTML(str) { return str ? String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[match]) : ''; }

async function obtenerCalleRiobambaConPausa(lat, lon, id, index) {
    if (!lat || !lon) return;
    const coords = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    if (cacheDirecciones[coords]) { document.getElementById(`dir-${id}`).innerHTML = `<i class="fa-solid fa-map-pin text-red-400 mr-1"></i> ${escapeHTML(cacheDirecciones[coords])}`; return; }
    setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`);
            const data = await res.json();
            const dir = (data.display_name || "").split(',').slice(0, 2).join(', ') + ', Riobamba';
            cacheDirecciones[coords] = dir;
            document.getElementById(`dir-${id}`).innerHTML = `<i class="fa-solid fa-map-pin text-red-400 mr-1"></i> ${escapeHTML(dir)}`;
        } catch (e) {}
    }, index * 300);
}

async function cargarDatosIniciales() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/alertas?select=*`, { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } });
        if (!response.ok) throw new Error("Error API");
        rawEmergenciasData = await response.json();
        aplicarFiltros();
        actualizarEstado(true);
    } catch (e) { actualizarEstado(false); }
}

function actualizarEstado(ok) {
    const sb = document.getElementById('statusGeoServer');
    if(!sb) return;
    sb.className = ok ? "bg-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full border border-emerald-500/30 flex items-center shadow-inner" : "bg-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full border border-red-500/30 flex items-center";
    sb.innerHTML = ok ? '<i class="fa-solid fa-satellite-dish text-emerald-400 mr-2 animate-pulse"></i> WebSocket Realtime Activo' : '<i class="fa-solid fa-triangle-exclamation mr-2"></i> Desconectado';
}

function renderizarUI(lista) {
    emergenciasLayerGroup.clearLayers();
    marcadoresGuardados = {};
    if (lineaRutaActiva) map.removeLayer(lineaRutaActiva); 
    
    const tbody = document.getElementById('tablaEmergenciasBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const listaOrd = [...lista].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    document.getElementById('counterEmergencias').innerText = listaOrd.length;

    listaOrd.forEach((item, index) => {
        if (!item.latitud || !item.longitud) return;
        const esAtendida = item.estado === 'Atendida';
        const esMedica = item.descripcion && item.descripcion.includes("Médica");
        
        // Marcador Mapa
        const pinClass = esAtendida ? "bg-green-600" : "animate-bounce bg-red-600";
        const mIcon = L.divIcon({
            className: 'custom-alert-pin',
            html: `<div class="${pinClass} w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white shadow-[0_0_15px_rgba(220,38,38,0.7)]"><i class="fa-solid ${esAtendida ? 'fa-check' : 'fa-bell'}"></i></div>`,
            iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -25]
        });

        const marker = L.marker([item.latitud, item.longitud], { icon: mIcon });
        
        // Popup interactivo
        const bHTML = esAtendida 
            ? `<button onclick="eliminarAlerta(${item.id})" class="mt-3 w-full bg-slate-200 hover:bg-red-600 hover:text-white text-slate-700 py-2 rounded text-xs font-bold transition"><i class="fa-solid fa-trash"></i> Borrar Registro</button>`
            : `<div class="mt-3 flex gap-2">
                 <button onclick="marcarAtendida(${item.id})" class="flex-1 bg-green-500 hover:bg-green-600 text-white py-2 rounded text-[11px] font-bold transition shadow"><i class="fa-solid fa-check-double"></i> Atender</button>
                 <button onclick="eliminarAlerta(${item.id})" class="flex-1 bg-slate-300 hover:bg-red-600 hover:text-white text-slate-700 py-2 rounded text-[11px] font-bold transition shadow"><i class="fa-solid fa-trash"></i> Eliminar</button>
               </div>`;

        marker.bindPopup(`
            <div class="font-sans w-52 p-1">
                <div class="${esAtendida ? 'bg-green-600' : 'bg-red-600'} text-white font-black p-2 -m-2 mb-2 text-center rounded-t shadow-md tracking-wider text-xs">
                    ${esAtendida ? '✅ EMERGENCIA ATENDIDA' : '🚨 ALERTA ACTIVA SICOA'}
                </div>
                <div class="pt-2">
                    <p class="font-black text-slate-800 text-sm"><i class="fa-solid fa-user-astronaut text-indigo-500 mr-1"></i> ${escapeHTML(item.nombres)} ${escapeHTML(item.apellidos)}</p>
                    <p class="text-[10px] text-slate-500 font-mono mt-1 mb-2 border-b pb-2"><i class="fa-regular fa-id-card"></i> C.I: ${escapeHTML(item.cedula || 'N/D')}</p>
                    
                    <div class="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-100">
                        <span class="text-[10px] font-black uppercase ${esMedica ? 'text-green-600' : 'text-red-600'}">${esMedica ? '🚑 Médica' : '🔫 Asalto'}</span>
                        <span class="text-[10px] font-bold text-slate-600"><i class="fa-solid fa-venus-mars"></i> ${escapeHTML(item.genero)}</span>
                    </div>
                </div>
                ${bHTML}
            </div>`);
        
        emergenciasLayerGroup.addLayer(marker);
        marcadoresGuardados[item.id] = marker;

        // Fila de la Tabla
        const tr = document.createElement('tr');
        tr.className = esAtendida ? "bg-green-50/40 hover:bg-green-100 transition cursor-pointer" : "hover:bg-indigo-50 transition cursor-pointer";
        tr.onclick = () => {
            marker.openPopup();
            trazarRutaMasCercana(item.latitud, item.longitud, item.descripcion);
        };
        
        obtenerCalleRiobambaConPausa(item.latitud, item.longitud, item.id, index);

        tr.innerHTML = `
            <td class="p-3">
                <span class="${esAtendida ? 'text-green-600' : 'text-red-600'} font-black text-sm block">#${item.id}</span>
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${esAtendida ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}">${esAtendida ? 'ATENDIDA' : 'ACTIVA'}</span>
            </td>
            <td class="p-3 font-bold text-slate-700 text-xs">${item.created_at ? new Date(item.created_at).toLocaleTimeString() : 'Recién'}</td>
            <td class="p-3">
                <span class="block font-bold text-slate-800 text-xs">${escapeHTML(item.nombres)} ${escapeHTML(item.apellidos)}</span>
                <span class="text-[10px] text-slate-500 font-mono"><i class="fa-regular fa-id-card"></i> ${escapeHTML(item.cedula)}</span>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-1 border rounded text-[10px] font-bold uppercase ${esMedica ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-red-300'}">
                    ${esMedica ? '<i class="fa-solid fa-truck-medical"></i>' : '<i class="fa-solid fa-person-rifle"></i>'} ${escapeHTML(item.descripcion)}
                </span>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px] font-bold">
                    ${item.genero === 'Femenino' ? '<i class="fa-solid fa-venus text-pink-500"></i>' : '<i class="fa-solid fa-mars text-blue-500"></i>'} ${escapeHTML(item.genero)}
                </span>
            </td>
            <td class="p-3 text-[11px] font-medium text-slate-600" id="dir-${item.id}"><i class="fa-solid fa-circle-notch fa-spin text-slate-300"></i> Localizando...</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// 4. FILTROS Y ACCIONES API (SUPABASE)
// ==========================================
function aplicarFiltros() {
    const cedula = document.getElementById('filterCedula')?.value.trim() || '';
    const tipo = document.getElementById('filterTipo')?.value || 'todos';
    const gen = document.getElementById('filterGenero')?.value || 'todos';
    
    const filtrados = rawEmergenciasData.filter(i => {
        if (cedula !== '' && i.cedula !== cedula) return false;
        if (gen !== 'todos' && i.genero !== gen) return false;
        if (tipo !== 'todos' && i.descripcion && !i.descripcion.includes(tipo)) return false;
        return true;
    });
    renderizarUI(filtrados);
}

document.getElementById('btnAplicarFiltros')?.addEventListener('click', aplicarFiltros);
document.getElementById('btnLimpiarFiltros')?.addEventListener('click', () => {
    ['filterCedula', 'filterTipo', 'filterGenero'].forEach(id => { if(document.getElementById(id)) document.getElementById(id).value = (id === 'filterCedula') ? '' : 'todos'; });
    aplicarFiltros();
});
document.getElementById('btnRefresh')?.addEventListener('click', cargarDatosIniciales);

window.marcarAtendida = async function(id) {
    const idx = rawEmergenciasData.findIndex(e => e.id === id);
    if(idx !== -1) { rawEmergenciasData[idx].estado = 'Atendida'; aplicarFiltros(); map.closePopup(); }
    try { await fetch(`${SUPABASE_URL}/rest/v1/alertas?id=eq.${id}`, { method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'Atendida' }) }); } catch(e) {}
};

window.eliminarAlerta = async function(id) {
    if(!confirm("⚠️ ¿Eliminar alerta permanentemente del sistema SICOA?")) return;
    rawEmergenciasData = rawEmergenciasData.filter(e => e.id !== id); aplicarFiltros();
    try { await fetch(`${SUPABASE_URL}/rest/v1/alertas?id=eq.${id}`, { method: 'DELETE', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }); } catch(e) {}
};

// ==========================================
// 5. WEBSOCKET REALTIME
// ==========================================
function initWebSocket() {
    const socket = new WebSocket(`wss://phsaujoiuayfzwydxygo.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
    socket.onopen = () => {
        socket.send(JSON.stringify({ "topic": "realtime:public:alertas", "event": "phx_join", "payload": { "config": { "postgres_changes": [{ "event": "INSERT", "schema": "public", "table": "alertas" }] } }, "ref": "1" }));
        setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ "topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": "hb" })); }, 30000);
    };
    socket.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            if (data.event === "postgres_changes" && data.payload?.data) {
                const nueva = data.payload.data.record;
                rawEmergenciasData.unshift(nueva);
                aplicarFiltros();
                if (nueva.latitud) {
                    marcadoresGuardados[nueva.id]?.openPopup();
                    trazarRutaMasCercana(nueva.latitud, nueva.longitud, nueva.descripcion);
                }
            }
        } catch (err) {}
    };
    socket.onerror = () => cargarDatosIniciales();
}

// INICIALIZAR SISTEMA
dibujarInfraestructura(); 
cargarDatosIniciales();
initWebSocket();