// ==========================================
// 1. CONFIGURACIÓN DEL MAPA Y SUPABASE SDK
// ==========================================
const RIOBAMBA_CENTER = [-1.665, -78.654];
const map = L.map('map', { preferCanvas: true }).setView(RIOBAMBA_CENTER, 14);

L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB'
}).addTo(map);

// Inicializar Cliente Oficial de Supabase con 'supabaseClient' para evitar conflictos
const SUPABASE_URL = 'https://phsaujoiuayfzwydxygo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBoc2F1am9pdWF5Znp3eWR4eWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzU4NjIsImV4cCI6MjEwMDIxMTg2Mn0.drMcjGEiZmVFGYgpPz1u2PN0M1bu_8PXRpD1rGBr7Gg';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Capas Especializadas SICOA
const emergenciasLayerGroup = L.layerGroup().addTo(map);
const upcLayerGroup = L.layerGroup().addTo(map);
const hospitalLayerGroup = L.layerGroup().addTo(map);

// Mapa de Calor (minOpacity para ver las calles debajo)
let heatLayer = L.heatLayer([], { 
    radius: 25, 
    blur: 15, 
    maxZoom: 15, 
    minOpacity: 0.5, 
    gradient: {0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red'} 
});
let lineaRutaActiva = null; 

let rawEmergenciasData = [];
let marcadoresGuardados = {};
const cacheDirecciones = {};

// ==========================================
// 2. INFRAESTRUCTURA Y CONTROLES DE CAPAS
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
    infraestructuraReal.forEach(inst => {
        const isPolicia = inst.tipo === "policia";
        const iconHTML = isPolicia ? '<i class="fa-solid fa-shield-halved text-sm"></i>' : '<i class="fa-solid fa-square-h text-sm"></i>';
        const bgClass = isPolicia ? 'bg-blue-600' : 'bg-teal-500';

        const customIcon = L.divIcon({
            className: 'infra-pin',
            html: `<div class="${bgClass} w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-md border-2 border-white">${iconHTML}</div>`,
            iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -30]
        });

        const marker = L.marker([inst.lat, inst.lng], { icon: customIcon });
        marker.bindPopup(`<div class="text-xs p-1 font-bold text-center">${isPolicia ? '🚓' : '🏥'} ${inst.nombre}</div>`);
        if (isPolicia) upcLayerGroup.addLayer(marker);
        else hospitalLayerGroup.addLayer(marker);
    });
}

document.getElementById('toggleUPC')?.addEventListener('change', (e) => e.target.checked ? map.addLayer(upcLayerGroup) : map.removeLayer(upcLayerGroup));
document.getElementById('toggleHospital')?.addEventListener('change', (e) => e.target.checked ? map.addLayer(hospitalLayerGroup) : map.removeLayer(hospitalLayerGroup));
document.getElementById('toggleRutas')?.addEventListener('change', (e) => { if(!e.target.checked && lineaRutaActiva) map.removeLayer(lineaRutaActiva); });

document.getElementById('toggleHeatmap')?.addEventListener('change', (e) => {
    if (e.target.checked) {
        map.addLayer(heatLayer); 
    } else {
        map.removeLayer(heatLayer);
    }
});

function trazarRutaMasCercana(lat, lng, tipoEmergencia) {
    if (lineaRutaActiva) map.removeLayer(lineaRutaActiva); 
    if (!document.getElementById('toggleRutas')?.checked) return;

    let unidadMasCercana = null;
    let distanciaMinima = Infinity;
    const tipoBuscado = (tipoEmergencia && tipoEmergencia.includes("Médica")) ? 'hospital' : 'policia';

    infraestructuraReal.filter(i => i.tipo === tipoBuscado).forEach(unidad => {
        const dist = map.distance([lat, lng], [unidad.lat, unidad.lng]);
        if (dist < distanciaMinima) { distanciaMinima = dist; unidadMasCercana = unidad; }
    });

    if (unidadMasCercana) {
        lineaRutaActiva = L.polyline([[lat, lng], [unidadMasCercana.lat, unidadMasCercana.lng]], {
            color: tipoBuscado === 'policia' ? '#3b82f6' : '#14b8a6', weight: 4, dashArray: '8, 8', opacity: 0.9
        }).addTo(map);
        map.fitBounds(lineaRutaActiva.getBounds(), { padding: [50, 50], maxZoom: 16 });
    }
}

// ==========================================
// 3. RENDERIZADO Y LÓGICA CORE
// ==========================================
function escapeHTML(str) { return str ? String(str).replace(/[&<>'"]/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[match]) : ''; }

async function obtenerCalleRiobambaConPausa(lat, lon, id, index) {
    if (!lat || !lon) return;
    const coords = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    const celda = document.getElementById(`dir-${id}`);
    if (!celda) return; 

    if (cacheDirecciones[coords]) { celda.innerHTML = `<i class="fa-solid fa-map-pin text-red-400 mr-1"></i> ${escapeHTML(cacheDirecciones[coords])}`; return; }
    setTimeout(async () => {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18`);
            const data = await res.json();
            const dir = (data.display_name || "").split(',').slice(0, 2).join(', ') + ', Riobamba';
            cacheDirecciones[coords] = dir;
            if(document.getElementById(`dir-${id}`)) document.getElementById(`dir-${id}`).innerHTML = `<i class="fa-solid fa-map-pin text-red-400 mr-1"></i> ${escapeHTML(dir)}`;
        } catch (e) {}
    }, index * 300);
}

function actualizarEstado(ok) {
    const sb = document.getElementById('statusGeoServer');
    if(!sb) return;
    sb.className = ok ? "bg-emerald-500/20 text-emerald-400 text-xs px-3 py-1.5 rounded-full border border-emerald-500/30 flex items-center shadow-inner" : "bg-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full border border-red-500/30 flex items-center";
    sb.innerHTML = ok ? '<i class="fa-solid fa-bolt text-emerald-400 mr-2 animate-pulse"></i> WebSocket Activo' : '<i class="fa-solid fa-triangle-exclamation mr-2"></i> Desconectado';
}

const urlParams = new URLSearchParams(window.location.search);
const cedulaUsuarioMovil = urlParams.get('cedula');

async function cargarDatosIniciales() {
    try {
        let query = supabaseClient.from('alertas').select('*');
        
        if (cedulaUsuarioMovil && cedulaUsuarioMovil !== '') {
            query = query.eq('cedula', cedulaUsuarioMovil);
        }

        const { data, error } = await query;
        if (error) throw error;
        rawEmergenciasData = data || [];
        aplicarFiltros();
        actualizarEstado(true);
    } catch (e) { 
        actualizarEstado(false); 
        console.error("Error al cargar datos:", e); 
    }
}

function renderizarUI(lista) {
    emergenciasLayerGroup.clearLayers();
    marcadoresGuardados = {};
    if (lineaRutaActiva) map.removeLayer(lineaRutaActiva); 
    
    const puntosCalor = lista.filter(i => i.latitud && i.estado !== 'Atendida').map(i => [parseFloat(i.latitud), parseFloat(i.longitud), 1]);
    heatLayer.setLatLngs(puntosCalor);

    const tbody = document.getElementById('tablaEmergenciasBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const listaOrd = [...lista].sort((a,b) => (b.id || 0) - (a.id || 0));
    if(document.getElementById('counterEmergencias')) document.getElementById('counterEmergencias').innerText = listaOrd.length;

    listaOrd.forEach((item, index) => {
        if (!item.latitud || !item.longitud) return;
        const esAtendida = item.estado === 'Atendida';
        const esMedica = item.descripcion && item.descripcion.includes("Médica");
        
        const pinClass = esAtendida ? "bg-green-600" : "animate-bounce bg-red-600";
        const mIcon = L.divIcon({
            className: 'custom-alert-pin',
            html: `<div class="${pinClass} w-7 h-7 rounded-full border-2 border-white flex items-center justify-center text-white shadow-lg"><i class="fa-solid ${esAtendida ? 'fa-check' : 'fa-bell'}"></i></div>`,
            iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -25]
        });

        const marker = L.marker([item.latitud, item.longitud], { icon: mIcon });
        
        const bHTML = esAtendida 
            ? `<button onclick="eliminarAlerta(${item.id})" class="mt-3 w-full bg-slate-200 hover:bg-red-600 text-slate-700 py-1.5 rounded text-xs font-bold transition">Borrar</button>`
            : `<div class="mt-3 flex gap-2">
                 <button onclick="marcarAtendida(${item.id})" class="flex-1 bg-green-500 text-white py-1.5 rounded text-[11px] font-bold">Atender</button>
                 <button onclick="eliminarAlerta(${item.id})" class="flex-1 bg-slate-300 text-slate-700 hover:bg-red-600 py-1.5 rounded text-[11px] font-bold">Eliminar</button>
               </div>`;

        marker.bindPopup(`<div class="w-48 text-center p-1"><div class="${esAtendida ? 'text-green-600' : 'text-red-600'} font-black text-sm mb-1">${esAtendida ? '✅ ATENDIDA' : '🚨 ALERTA'}</div><p class="font-bold text-xs">${escapeHTML(item.nombres)}</p><p class="text-[10px] text-slate-500">${escapeHTML(item.descripcion)}</p>${bHTML}</div>`);
        emergenciasLayerGroup.addLayer(marker);
        marcadoresGuardados[item.id] = marker;

        const tr = document.createElement('tr');
        tr.className = esAtendida ? "bg-green-50/40 hover:bg-green-100 transition cursor-pointer" : "hover:bg-indigo-50 transition cursor-pointer";
        tr.onclick = () => { 
            marker.openPopup(); 
            trazarRutaMasCercana(item.latitud, item.longitud, item.descripcion); 
        };
        
        tr.innerHTML = `
            <td class="p-3">
                <span class="${esAtendida ? 'text-green-600' : 'text-red-600'} font-black text-sm block">#${item.id}</span>
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${esAtendida ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}">${esAtendida ? 'ATENDIDA' : 'ACTIVA'}</span>
            </td>
            <td class="p-3 font-bold text-slate-700 text-xs">Reciente</td>
            <td class="p-3"><span class="block font-bold text-slate-800 text-xs">${escapeHTML(item.nombres)} ${escapeHTML(item.apellidos)}</span><span class="text-[10px] text-slate-500"><i class="fa-regular fa-id-card"></i> ${escapeHTML(item.cedula)}</span></td>
            <td class="p-3 text-center"><span class="px-2 py-1 border rounded text-[10px] font-bold uppercase ${esMedica ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${escapeHTML(item.descripcion)}</span></td>
            <td class="p-3 text-center text-[10px] font-bold text-slate-600">${escapeHTML(item.genero)}</td>
            <td class="p-3 text-[11px] font-medium text-slate-600" id="dir-${item.id}"><i class="fa-solid fa-circle-notch fa-spin text-slate-300"></i> Buscando...</td>
        `;
        tbody.appendChild(tr);
        obtenerCalleRiobambaConPausa(item.latitud, item.longitud, item.id, index);
    });
}

function aplicarFiltros() {
    const ced = document.getElementById('filterCedula')?.value.trim() || '';
    const tipo = document.getElementById('filterTipo')?.value || 'todos';
    const gen = document.getElementById('filterGenero')?.value || 'todos';
    const filt = rawEmergenciasData.filter(i => (ced === '' || i.cedula === ced) && (gen === 'todos' || i.genero === gen) && (tipo === 'todos' || i.descripcion?.includes(tipo)));
    renderizarUI(filt);
}

document.getElementById('btnAplicarFiltros')?.addEventListener('click', aplicarFiltros);
document.getElementById('btnLimpiarFiltros')?.addEventListener('click', () => {
    if(document.getElementById('filterCedula')) document.getElementById('filterCedula').value = '';
    if(document.getElementById('filterTipo')) document.getElementById('filterTipo').value = 'todos';
    if(document.getElementById('filterGenero')) document.getElementById('filterGenero').value = 'todos';
    aplicarFiltros();
});
document.getElementById('btnRefresh')?.addEventListener('click', cargarDatosIniciales);

window.marcarAtendida = async function(id) {
    const idx = rawEmergenciasData.findIndex(e => e.id === id);
    if(idx !== -1) { rawEmergenciasData[idx].estado = 'Atendida'; aplicarFiltros(); map.closePopup(); }
    await supabaseClient.from('alertas').update({ estado: 'Atendida' }).eq('id', id);
};

window.eliminarAlerta = async function(id) {
    if(!confirm("¿Eliminar registro?")) return;
    rawEmergenciasData = rawEmergenciasData.filter(e => e.id !== id); aplicarFiltros();
    await supabaseClient.from('alertas').delete().eq('id', id);
};

// ==========================================
// 4. WEBSOCKET REALTIME OFICIAL (SDK)
// ==========================================
function initWebSocket() {
    supabaseClient
        .channel('schema-db-changes')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'alertas' },
            (payload) => {
                const nueva = payload.new;
                
                if (cedulaUsuarioMovil && nueva.cedula !== cedulaUsuarioMovil) return; 

                rawEmergenciasData.unshift(nueva);
                aplicarFiltros();
                
                if (nueva.latitud) {
                    map.flyTo([nueva.latitud, nueva.longitud], 16, { animate: true, duration: 1.5 });
                    setTimeout(() => { 
                        marcadoresGuardados[nueva.id]?.openPopup(); 
                        trazarRutaMasCercana(nueva.latitud, nueva.longitud, nueva.descripcion); 
                    }, 1500);
                }
            }
        )
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                actualizarEstado(true); 
            } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                actualizarEstado(false); 
            }
        });
}

dibujarInfraestructura(); 
cargarDatosIniciales();
initWebSocket();
