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

const emergenciasLayerGroup = L.layerGroup().addTo(map);
let rawEmergenciasData = [];
let marcadoresGuardados = {};
const cacheDirecciones = {};
// ==========================================
// 🌟 INNOVACIÓN GIS: INFRAESTRUCTURA ESTRATÉGICA RIOBAMBA
// ==========================================
const infraestructuraLayerGroup = L.layerGroup().addTo(map);

// Coordenadas reales (aproximadas) de Riobamba
const infraestructuraSICOA = [
    { nombre: "UPC La Condamine", tipo: "policia", lat: -1.6685, lng: -78.6480, desc: "Patrullas Sector Centro" },
    { nombre: "UPC Politécnica (UNACH)", tipo: "policia", lat: -1.6580, lng: -78.6750, desc: "Respuesta Inmediata Universitaria" },
    { nombre: "UPC Terminal Terrestre", tipo: "policia", lat: -1.6500, lng: -78.6600, desc: "Control Norte" },
    { nombre: "Hospital General Docente", tipo: "hospital", lat: -1.6540, lng: -78.6550, desc: "Emergencias Mayores (Trauma)" },
    { nombre: "Hospital del IESS", tipo: "hospital", lat: -1.6750, lng: -78.6450, desc: "Atención General" }
];

// Dibujar las instalaciones en el mapa
infraestructuraSICOA.forEach(instalacion => {
    // Definimos el color y el ícono dependiendo si es Policía o Hospital
    const isPolicia = instalacion.tipo === "policia";
    const bgClass = isPolicia ? "bg-blue-600" : "bg-teal-500";
    const iconClass = isPolicia ? "fa-shield-halved" : "fa-square-h";

    const customIcon = L.divIcon({
        className: 'infra-pin',
        html: `<div class="${bgClass} w-7 h-7 rounded flex items-center justify-center text-white shadow-lg border border-white">
                 <i class="fa-solid ${iconClass} text-xs"></i>
               </div>`,
        iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -25]
    });

    const marker = L.marker([instalacion.lat, instalacion.lng], { icon: customIcon });
    
    // El globo de información (Popup)
    marker.bindPopup(`
        <div class="text-xs p-1">
            <span class="font-black text-slate-800 block mb-1 uppercase border-b pb-1">
                ${isPolicia ? '🚓' : '🏥'} ${instalacion.nombre}
            </span>
            <span class="text-slate-500">${instalacion.desc}</span>
            <div class="mt-2 text-[9px] text-indigo-500 font-bold bg-indigo-50 p-1 rounded text-center">
                ACTIVO 24/7 - RADIO SICOA
            </div>
        </div>
    `);
    
    infraestructuraLayerGroup.addLayer(marker);
});

// ==========================================
// 2. FUNCIONES DE UTILIDAD
// ==========================================
function escapeHTML(str) { return str ? String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[match]) : ''; }
function calcularEdad(fecha) { if(!fecha) return '-'; const ed = Math.abs(new Date(Date.now() - new Date(fecha).getTime()).getUTCFullYear() - 1970); return isNaN(ed) ? '-' : ed; }

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
        } catch (e) { actualizarCeldaDireccion(id, "Riobamba (GPS Urbano)"); }
    }, index * 300);
}

function actualizarCeldaDireccion(id, dir) { 
    const celda = document.getElementById(`dir-${id}`); 
    if(celda) celda.innerHTML = `<i class="fa-solid fa-map-pin text-red-400 mr-1"></i> ${escapeHTML(dir)}`; 
}

// ==========================================
// 3. CARGA DE DATOS Y RENDERIZADO
// ==========================================
async function cargarDatosIniciales() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/alertas?select=*`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (!response.ok) throw new Error("Error");
        rawEmergenciasData = await response.json();
        aplicarFiltros();
        actualizarEstadoConexion(true);
    } catch (e) { actualizarEstadoConexion(false); }
}

function actualizarEstadoConexion(conectado) {
    const sb = document.getElementById('statusGeoServer');
    if(sb) {
        sb.className = conectado ? "bg-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full border border-emerald-500/30 flex items-center shadow-inner" 
                                 : "bg-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full border border-red-500/30 flex items-center";
        sb.innerHTML = conectado ? '<i class="fa-solid fa-satellite-dish text-emerald-400 mr-2 animate-pulse"></i> WebSocket Realtime Activo' 
                                 : '<i class="fa-solid fa-triangle-exclamation mr-2"></i> Desconectado';
    }
}

function enfocarAlerta(id, lat, lon) {
    map.flyTo([lat, lon], 17, { animate: true, duration: 1.5 });
    setTimeout(() => { if (marcadoresGuardados[id]) marcadoresGuardados[id].openPopup(); }, 1500);
}

function renderizarUI(lista) {
    emergenciasLayerGroup.clearLayers();
    marcadoresGuardados = {};
    const tbody = document.getElementById('tablaEmergenciasBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const listaOrdenada = [...lista].sort((a,b) => new Date(b.created_at || b.fecha_hora || 0) - new Date(a.created_at || a.fecha_hora || 0));

    listaOrdenada.forEach((item, index) => {
        if (!item.latitud || !item.longitud) return;

        const edad = calcularEdad(item.fecha_nacimiento);
        const esAtendida = item.estado === 'Atendida'; // Logica de colores
        
        // DISEÑO DEL MARCADOR (Verde si está atendida, Rojo rebotando si es nueva)
        const pinClass = esAtendida ? "bg-green-600" : "animate-bounce bg-red-600";
        const iconAlert = L.divIcon({
            className: 'custom-alert-pin',
            html: `<div class="${pinClass} w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] shadow-lg"><i class="fa-solid ${esAtendida ? 'fa-check' : 'fa-bell'}"></i></div>`,
            iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -20]
        });

        const marker = L.marker([item.latitud, item.longitud], { icon: iconAlert });
        
        // BOTONES DE INTERACCIÓN DEL POPUP
        const controlesHTML = esAtendida 
            ? `<div class="mt-3"><button onclick="eliminarAlerta(${item.id})" class="w-full bg-slate-500 hover:bg-red-600 text-white py-1.5 rounded text-[10px] font-bold transition shadow"><i class="fa-solid fa-trash"></i> Borrar Registro</button></div>`
            : `<div class="mt-3 flex gap-2">
                 <button onclick="marcarAtendida(${item.id})" class="flex-1 bg-green-500 hover:bg-green-600 text-white py-1.5 rounded text-[10px] font-bold transition shadow"><i class="fa-solid fa-check-circle"></i> Atender</button>
                 <button onclick="eliminarAlerta(${item.id})" class="flex-1 bg-slate-500 hover:bg-red-600 text-white py-1.5 rounded text-[10px] font-bold transition shadow"><i class="fa-solid fa-trash"></i> Eliminar</button>
               </div>`;

        const popupHTML = `
            <div class="font-sans text-xs w-48">
                <div class="${esAtendida ? 'bg-green-600' : 'bg-red-600'} text-white font-bold p-2 -m-3 mb-2 rounded-t-lg text-center">
                    ${esAtendida ? '✅ ALERTA ATENDIDA' : '🚨 ALERTA REALTIME'}
                </div>
                <p class="mt-3 text-sm font-bold text-slate-800"><i class="fa-regular fa-id-card"></i> ${escapeHTML(item.cedula || 'N/D')}</p>
                <p class="text-xs text-slate-600">${escapeHTML(item.nombres)} ${escapeHTML(item.apellidos)}</p>
                <p class="text-[10px] font-bold mt-1 ${item.descripcion?.includes("Médica") ? 'text-green-600' : 'text-red-600'}">
                    Tipo: ${escapeHTML(item.descripcion || 'Emergencia')}
                </p>
                ${controlesHTML}
            </div>`;
        
        marker.bindPopup(popupHTML);
        emergenciasLayerGroup.addLayer(marker);
        marcadoresGuardados[item.id] = marker;

        // FILA DE LA TABLA (Cambia de color si está atendida)
        const tr = document.createElement('tr');
        tr.className = esAtendida ? "bg-green-50/50 hover:bg-green-100 transition cursor-pointer group" : "hover:bg-indigo-50 transition cursor-pointer group";
        tr.onclick = () => enfocarAlerta(item.id, item.latitud, item.longitud);
        
        obtenerCalleRiobambaConPausa(item.latitud, item.longitud, item.id, index);

        const fechaCruda = item.created_at || item.fecha_hora;
        const horaFormateada = fechaCruda ? new Date(fechaCruda).toLocaleTimeString() : 'Recién';
        const esMedica = item.descripcion && item.descripcion.includes("Médica");
        const colorBadge = esMedica ? "bg-green-100 text-green-700 border-green-300" : "bg-red-100 text-red-700 border-red-300";

        tr.innerHTML = `
            <td class="p-3 ${esAtendida ? 'text-green-600' : 'text-red-600'} font-black">#${item.id}</td>
            <td class="p-3"><span class="block font-bold text-slate-700">${horaFormateada}</span></td>
            <td class="p-3">
                <span class="block font-bold text-slate-800">${escapeHTML(item.nombres || 'Anónimo')} ${escapeHTML(item.apellidos || '')}</span>
                <span class="text-[10px] text-slate-500 font-mono"><i class="fa-regular fa-id-card"></i> ${escapeHTML(item.cedula || 'Sin cédula')}</span>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-1 border rounded text-[10px] font-bold uppercase ${colorBadge}">
                    ${esMedica ? '<i class="fa-solid fa-truck-medical"></i>' : '<i class="fa-solid fa-person-rifle"></i>'} 
                    ${escapeHTML(item.descripcion || 'Alerta')}
                </span>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px]">
                    ${item.genero === 'Femenino' ? '<i class="fa-solid fa-venus text-pink-500"></i>' : '<i class="fa-solid fa-mars text-blue-500"></i>'} 
                    ${escapeHTML(item.genero || 'N/D')}
                </span>
            </td>
            <td class="p-3 text-[11px] font-medium text-slate-600" id="dir-${item.id}">
                <i class="fa-solid fa-circle-notch fa-spin text-slate-300"></i> Localizando...
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    const counter = document.getElementById('counterEmergencias');
    if(counter) counter.innerText = listaOrdenada.length;
}

// ==========================================
// 4. FUNCIONES DE FILTRADO Y GESTIÓN (SICOA)
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
    if(document.getElementById('filterCedula')) document.getElementById('filterCedula').value = '';
    if(document.getElementById('filterTipo')) document.getElementById('filterTipo').value = 'todos';
    if(document.getElementById('filterGenero')) document.getElementById('filterGenero').value = 'todos';
    aplicarFiltros();
}

// 🔥 ACTUALIZAR ESTADO EN SUPABASE (Marcar Atendida)
window.marcarAtendida = async function(id) {
    const idx = rawEmergenciasData.findIndex(e => e.id === id);
    if(idx !== -1) {
        rawEmergenciasData[idx].estado = 'Atendida'; // Cambia en la UI de inmediato
        aplicarFiltros(); 
        map.closePopup();
    }
    // Llama a la API para guardarlo en la nube
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/alertas?id=eq.${id}`, {
            method: 'PATCH',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 'Atendida' })
        });
    } catch(e) { console.warn("No se pudo actualizar en Supabase, asegúrate de haber creado la columna 'estado'"); }
};

// 🔥 ELIMINAR REGISTRO DE SUPABASE
window.eliminarAlerta = async function(id) {
    if(!confirm("⚠️ ¿Estás seguro de que deseas eliminar esta alerta del sistema?")) return;
    
    rawEmergenciasData = rawEmergenciasData.filter(e => e.id !== id);
    aplicarFiltros();
    
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/alertas?id=eq.${id}`, {
            method: 'DELETE',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
    } catch(e) { console.error("Error al borrar", e); }
};

// ==========================================
// 5. CONEXIÓN WEBSOCKET REALTIME
// ==========================================
function inicializarWebSocketRealtime() {
    const socket = new WebSocket(`wss://phsaujoiuayfzwydxygo.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
    socket.onopen = () => {
        socket.send(JSON.stringify({
            "topic": "realtime:public:alertas", "event": "phx_join",
            "payload": { "config": { "postgres_changes": [{ "event": "INSERT", "schema": "public", "table": "alertas" }] } },
            "ref": "1"
        }));
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

// ASIGNACIÓN DE EVENTOS
document.getElementById('btnAplicarFiltros')?.addEventListener('click', aplicarFiltros);
document.getElementById('btnLimpiarFiltros')?.addEventListener('click', limpiarFiltros);
document.getElementById('btnRefresh')?.addEventListener('click', cargarDatosIniciales);

// ARRANQUE SICOA
cargarDatosIniciales();
inicializarWebSocketRealtime();