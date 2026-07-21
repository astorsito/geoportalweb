// ==========================================
// 1. CONFIGURACIÓN DEL MAPA (Leaflet en Riobamba)
// ==========================================
const RIOBAMBA_CENTER = [-1.665, -78.654];
const map = L.map('map').setView(RIOBAMBA_CENTER, 14);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB'
}).addTo(map);

// ==========================================
// 🔑 CREDENCIALES DE SUPABASE
// ==========================================
const SUPABASE_URL = 'https://phsaujoiuayfzwydxygo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoc2F1am9pdWF5Znp3eWR4eWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzU4NjIsImV4cCI6MjEwMDIxMTg2Mn0.drMcjGEiZmVFGYgpPz1u2PN0M1bu_8PXRpD1rGBr7Gg';

const emergenciasLayerGroup = L.layerGroup().addTo(map);
let rawEmergenciasData = [];
let marcadoresGuardados = {};
const cacheDirecciones = {};

function escapeHTML(str) { 
    return str ? String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[match]) : ''; 
}

function calcularEdad(fechaNacStr) { 
    if (!fechaNacStr) return '-'; 
    const nac = new Date(fechaNacStr); 
    const edad = Math.abs(new Date(Date.now() - nac.getTime()).getUTCFullYear() - 1970);
    return isNaN(edad) ? '-' : edad;
}

async function obtenerCalleRiobambaConPausa(lat, lon, id, index) {
    if (!lat || !lon) return;
    const coords = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    if (cacheDirecciones[coords]) { 
        actualizarCeldaDireccion(id, cacheDirecciones[coords]); 
        return; 
    }
    setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`);
            const data = await res.json();
            let direccion = (data.display_name || "").split(',').slice(0, 2).join(', ') + ', Riobamba';
            cacheDirecciones[coords] = direccion;
            actualizarCeldaDireccion(id, direccion);
        } catch (e) { 
            actualizarCeldaDireccion(id, "Riobamba (GPS Urbano)"); 
        }
    }, index * 300);
}

function actualizarCeldaDireccion(id, dir) { 
    const celda = document.getElementById(`dir-${id}`); 
    if(celda) celda.innerHTML = `<i class="fa-solid fa-map-pin text-red-400 mr-1"></i> ${escapeHTML(dir)}`; 
}

// ==========================================
// 📡 CARGA INICIAL DE DATOS
// ==========================================
async function cargarDatosIniciales() {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/alertas?select=*`, {
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (!response.ok) throw new Error("Error de conexión");
        
        rawEmergenciasData = await response.json();
        aplicarFiltros();
        actualizarEstadoConexion(true);
    } catch (e) {
        actualizarEstadoConexion(false);
    }
}

function actualizarEstadoConexion(conectado) {
    const statusBadge = document.getElementById('statusGeoServer');
    if(statusBadge) {
        if (conectado) {
            // 👇 AQUÍ ESTÁ LA ETIQUETA DEL WEBSOCKET
            statusBadge.className = "bg-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full border border-emerald-500/30 flex items-center shadow-inner";
            statusBadge.innerHTML = '<i class="fa-solid fa-satellite-dish text-emerald-400 mr-2 animate-pulse"></i> WebSocket Realtime Activo';
        } else {
            statusBadge.className = "bg-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full border border-red-500/30 flex items-center";
            statusBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation mr-2"></i> Desconectado';
        }
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

    const listaOrdenada = [...lista].sort((a,b) => {
        const fechaA = new Date(a.created_at || a.fecha_hora || 0);
        const fechaB = new Date(b.created_at || b.fecha_hora || 0);
        return fechaB - fechaA;
    });

    listaOrdenada.forEach((item, index) => {
        if (!item.latitud || !item.longitud) return;

        const edad = calcularEdad(item.fecha_nacimiento);
        
        const iconAlert = L.divIcon({
            className: 'custom-alert-pin',
            html: `<div class="animate-bounce bg-red-600 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white text-[10px] shadow-lg"><i class="fa-solid fa-bell"></i></div>`,
            iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -20]
        });

        const marker = L.marker([item.latitud, item.longitud], { icon: iconAlert });
        const popupHTML = `
            <div class="font-sans text-xs">
                <div class="bg-red-600 text-white font-bold p-2 -m-3 mb-2 rounded-t-lg">🚨 ALERTA REALTIME #${item.id}</div>
                <p class="mt-2 text-sm font-bold text-slate-800">${escapeHTML(item.nombres || 'Ciudadano')} ${escapeHTML(item.apellidos || '')}</p>
                <p class="text-xs text-red-600 font-bold mt-1">Tipo: ${escapeHTML(item.descripcion || 'Emergencia')}</p>
                <div class="grid grid-cols-2 gap-2 bg-slate-50 p-2 rounded mt-2">
                    <div><span class="text-slate-400 block text-[9px] uppercase">Género</span> <span class="font-semibold">${escapeHTML(item.genero || '-')}</span></div>
                    <div><span class="text-slate-400 block text-[9px] uppercase">Edad</span> <span class="font-semibold text-indigo-600">${edad} años</span></div>
                </div>
            </div>`;
        marker.bindPopup(popupHTML);
        emergenciasLayerGroup.addLayer(marker);
        marcadoresGuardados[item.id] = marker;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-indigo-50 transition cursor-pointer group";
        tr.onclick = () => enfocarAlerta(item.id, item.latitud, item.longitud);
        
        obtenerCalleRiobambaConPausa(item.latitud, item.longitud, item.id, index);

        const fechaCruda = item.created_at || item.fecha_hora;
        const horaFormateada = fechaCruda ? new Date(fechaCruda).toLocaleTimeString() : 'Recién';

        tr.innerHTML = `
            <td class="p-3 text-red-600 font-black">#${item.id}</td>
            <td class="p-3"><span class="block font-bold text-slate-700">${horaFormateada}</span></td>
            <td class="p-3"><span class="block font-bold text-slate-800">${escapeHTML(item.nombres || 'Anónimo')} ${escapeHTML(item.apellidos || '')}</span></td>
            <td class="p-3"><span class="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">${escapeHTML(item.genero || 'N/D')}</span></td>
            <td class="p-3 text-[11px] font-medium text-slate-600" id="dir-${item.id}"><i class="fa-solid fa-circle-notch fa-spin text-slate-300"></i> Localizando...</td>
        `;
        tbody.appendChild(tr);
    });
    
    const counter = document.getElementById('counterEmergencias');
    if(counter) counter.innerText = listaOrdenada.length;
}

function aplicarFiltros() {
    const genSelect = document.getElementById('filterGenero');
    const gen = genSelect ? genSelect.value : 'todos';
    
    const filtrados = rawEmergenciasData.filter(item => {
        if (gen !== 'todos' && item.genero !== gen) return false;
        return true;
    });
    renderizarUI(filtrados);
}

// ==========================================
// ⚡ CONEXIÓN WEBSOCKET REAL (SUPABASE REALTIME)
// ==========================================
function inicializarWebSocketRealtime() {
    const wsUrl = `wss://phsaujoiuayfzwydxygo.supabase.co/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("WebSocket conectado con Supabase");
        const joinPayload = {
            "topic": "realtime:public:alertas",
            "event": "phx_join",
            "payload": {
                "config": {
                    "postgres_changes": [{ "event": "INSERT", "schema": "public", "table": "alertas" }]
                }
            },
            "ref": "1"
        };
        socket.send(JSON.stringify(joinPayload));
        
        setInterval(() => {
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ "topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": "hb" }));
            }
        }, 30000);
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.event === "postgres_changes" && data.payload && data.payload.data) {
                const nuevaAlerta = data.payload.data.record;
                console.log("¡Nueva alerta en tiempo real por WebSocket!", nuevaAlerta);
                
                rawEmergenciasData.unshift(nuevaAlerta);
                aplicarFiltros();
                
                if (nuevaAlerta.latitud && nuevaAlerta.longitud) {
                    enfocarAlerta(nuevaAlerta.id, nuevaAlerta.latitud, nuevaAlerta.longitud);
                }
            }
        } catch (err) {
            console.error("Error procesando mensaje WebSocket:", err);
        }
    };

    socket.onerror = () => {
        console.warn("WebSocket desconectado. Intentando modo clásico...");
        cargarDatosIniciales();
    };
}

// Listeners
const btnFiltro = document.getElementById('btnAplicarFiltros');
if(btnFiltro) btnFiltro.addEventListener('click', aplicarFiltros);

const btnRefresh = document.getElementById('btnRefresh');
if(btnRefresh) btnRefresh.addEventListener('click', cargarDatosIniciales);

// Arrancar sistema
cargarDatosIniciales();
inicializarWebSocketRealtime(); // 🚀 ¡Canal WebSocket real activo!