/*
 * ARKAIOS · Catálogo del mapa vivo de Yukiho: pisos, objetos (muebles) y plantillas de áreas.
 * Todo se dibuja por código a 8 px por tile. Es la única lista de cosas que la IA puede poner en el mapa:
 * si un objeto o plantilla no está aquí, el validador (map-actions.js) lo rechaza.
 * Funciona en el navegador (window.MapCatalog) y en Node (module.exports) para las pruebas.
 */
(function (root) {
  const OUT = '#1a1424';
  function box(c, px, py, w, h, fill, edge = OUT) { c.fillStyle = edge; c.fillRect(px, py, w, h); c.fillStyle = fill; c.fillRect(px + 1, py + 1, w - 2, h - 2); }
  function rect(c, color, x, y, w, h) { c.fillStyle = color; c.fillRect(x, y, w, h); }

  // Piso: nombre en español (lo que usa la IA) -> dos tonos en damero.
  const FLOORS = {
    madera: ['#9b6a43', '#8d5f3b'], madera_oscura: ['#6e4a33', '#64432e'], azulejo: ['#d9e3ea', '#c3d0d9'],
    azulejo_azul: ['#a9c9dc', '#94b8cf'], crema: ['#e8dcc2', '#dccdae'], cemento: ['#8b8f96', '#7f838a'],
    piedra: ['#5f6a72', '#566069'], alfombra: ['#7a2f3c', '#70293a'], marmol: ['#ece6dc', '#ddd5c8'],
    linoleo: ['#9fb89a', '#93ad8e'], pasto: ['#4f8a3c', '#467f35'], arena: ['#e3cf9a', '#d8c28b'],
  };

  // Objetos. w,h en tiles. solido: bloquea el paso. capa: 0 piso (tapetes), 1 mueble, 2 encima de otro mueble.
  // superficie: se le puede poner algo encima (capa 2). brillo: emite luz cálida de noche. redim: tamaño ajustable {w:[min,max], h:[min,max]}.
  const OBJ = {
    cama: { nombre: 'Cama', w: 2, h: 3, draw: (c, x, y) => { box(c, x, y, 16, 24, '#5b3b6e'); box(c, x + 2, y + 2, 12, 5, '#f1ece4'); rect(c, '#7b54a0', x + 1, y + 9, 14, 14); rect(c, '#9a74c0', x + 1, y + 9, 14, 2); } },
    cama_hotel: { nombre: 'Cama de hotel', w: 2, h: 3, draw: (c, x, y) => { box(c, x, y, 16, 24, '#e9e4da'); box(c, x + 2, y + 2, 5, 4, '#fff'); box(c, x + 9, y + 2, 5, 4, '#fff'); rect(c, '#2d6f8f', x + 1, y + 15, 14, 3); } },
    buro: { nombre: 'Buró con lámpara', superficie: true, w: 1, h: 1, brillo: true, draw: (c, x, y) => { box(c, x, y + 2, 8, 6, '#7a5232'); rect(c, '#ffd98a', x + 3, y, 3, 3); } },
    closet: { nombre: 'Clóset', w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 8, '#6b4a30'); rect(c, '#3a2618', x + 7, y + 2, 1, 5); } },
    tapete: { nombre: 'Tapete', w: 2, h: 1, solido: false, capa: 0, draw: (c, x, y) => rect(c, '#c7a6d8', x, y + 1, 16, 6) },
    regadera: { nombre: 'Regadera', w: 2, h: 2, draw: (c, x, y) => { box(c, x, y, 16, 16, '#cfe6f2'); rect(c, 'rgba(160,210,235,.6)', x + 2, y + 2, 12, 12); rect(c, '#9aa', x + 7, y + 2, 2, 2); } },
    wc: { nombre: 'WC', w: 1, h: 1, draw: (c, x, y) => { box(c, x + 1, y, 6, 4, '#f4f4f4'); box(c, x + 1, y + 3, 6, 5, '#ffffff'); } },
    lavabo: { nombre: 'Lavabo', w: 1, h: 1, draw: (c, x, y) => { box(c, x, y + 1, 8, 6, '#ffffff'); rect(c, '#9bc', x + 2, y + 3, 4, 2); } },
    tina: { nombre: 'Tina', w: 3, h: 2, draw: (c, x, y) => { box(c, x, y, 24, 14, '#ffffff'); rect(c, '#8ec8e8', x + 2, y + 2, 20, 9); rect(c, '#c8e8f8', x + 3, y + 3, 6, 2); } },
    toallero: { nombre: 'Toallero', w: 1, h: 1, solido: false, draw: (c, x, y) => { rect(c, '#b0b8c0', x + 3, y, 2, 6); rect(c, '#b0b8c0', x + 1, y, 6, 2); } },
    lavadora: { nombre: 'Lavadora', w: 1, h: 2, draw: (c, x, y) => { box(c, x, y, 8, 15, '#eef2f4'); rect(c, '#3c4a55', x + 2, y + 5, 4, 4); rect(c, '#8fb5cc', x + 3, y + 6, 2, 2); } },
    lavadero: { nombre: 'Lavadero', superficie: true, w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 8, '#b9c1c6'); rect(c, '#7d98aa', x + 2, y + 2, 12, 4); } },
    tendedero: { nombre: 'Tendedero con ropa', w: 5, h: 1, solido: false, capa: 2, draw: (c, x, y) => { rect(c, '#ddd', x, y + 1, 40, 1); ['#e86f6f', '#f2c14e', '#6fb3e8'].forEach((k, i) => rect(c, k, x + 4 + i * 12, y + 2, 6, 5)); } },
    sofa: { nombre: 'Sofá', w: 4, h: 1, draw: (c, x, y) => { box(c, x, y - 2, 32, 10, '#3f6d73'); rect(c, '#5a9098', x + 2, y, 28, 3); } },
    mesa_centro: { nombre: 'Mesa de centro', superficie: true, w: 2, h: 1, draw: (c, x, y) => { box(c, x, y + 1, 16, 6, '#7a5232'); rect(c, '#f5f0e6', x + 6, y + 2, 3, 3); } },
    alfombra: { nombre: 'Alfombra', w: 5, h: 2, solido: false, capa: 0, redim: { w: [2, 8], h: [1, 4] }, draw: (c, x, y, w, h) => { rect(c, '#8a3f4f', x, y + 2, w * 8, h * 8 - 4); rect(c, '#a5566a', x + 2, y + 4, w * 8 - 4, h * 8 - 8); } },
    planta: { nombre: 'Planta en maceta', w: 1, h: 1, draw: (c, x, y) => { rect(c, '#2f6b3a', x + 1, y, 6, 5); rect(c, '#8a5a3b', x + 2, y + 5, 4, 3); } },
    maceta_flores: { nombre: 'Maceta con flores', w: 1, h: 1, draw: (c, x, y) => { rect(c, '#2f7a3f', x + 1, y, 6, 5); rect(c, '#e46a8a', x + 3, y + 1, 2, 2); rect(c, '#9a5b36', x + 2, y + 5, 4, 3); } },
    tv: { nombre: 'Televisión', w: 3, h: 1, draw: (c, x, y) => { box(c, x, y, 24, 7, '#222'); rect(c, '#3b5f8a', x + 2, y + 1, 20, 4); } },
    mesa: { nombre: 'Mesa de comedor', superficie: true, w: 3, h: 2, draw: (c, x, y) => box(c, x + 2, y + 2, 20, 12, '#8d6440') },
    silla: { nombre: 'Silla', w: 1, h: 1, solido: false, draw: (c, x, y) => box(c, x + 2, y + 1, 5, 6, '#5a3d28') },
    lampara: { nombre: 'Lámpara de pie', w: 1, h: 1, brillo: true, draw: (c, x, y) => { rect(c, '#ffd98a', x + 3, y, 3, 3); rect(c, '#555', x + 4, y + 3, 1, 5); } },
    cocineta: { nombre: 'Cocineta (estufa y tarja)', superficie: true, w: 5, h: 1, draw: (c, x, y) => { box(c, x, y, 40, 8, '#c9b48e'); rect(c, '#333', x + 6, y + 2, 4, 4); rect(c, '#333', x + 14, y + 2, 4, 4); rect(c, '#9bc', x + 26, y + 2, 8, 4); } },
    refrigerador: { nombre: 'Refrigerador', w: 1, h: 2, draw: (c, x, y) => { box(c, x, y, 8, 16, '#e9eef0'); rect(c, '#aab', x + 6, y + 3, 1, 4); rect(c, '#aab', x + 6, y + 10, 1, 4); } },
    tetera: { nombre: 'Tetera', w: 1, h: 1, solido: false, capa: 2, draw: (c, x, y) => { rect(c, '#b5402f', x + 2, y + 1, 4, 3); rect(c, '#ddd', x + 3, y - 1, 2, 1); } },
    barandal: { nombre: 'Barandal', w: 26, h: 1, redim: { w: [2, 30], h: [1, 1] }, draw: (c, x, y, w) => { rect(c, '#c9ccd1', x, y + 2, w * 8, 1); for (let i = 0; i < w * 8; i += 4) rect(c, '#c9ccd1', x + i, y + 2, 1, 5); } },
    silla_terraza: { nombre: 'Silla de terraza', w: 1, h: 1, draw: (c, x, y) => box(c, x + 1, y + 2, 6, 5, '#d9d4c5') },
    // ---- planta baja: máquinas y tiendita ----
    maquina_bebidas: { nombre: 'Máquina expendedora de bebidas', w: 2, h: 2, brillo: true, draw: (c, x, y, w, h, t) => { box(c, x, y, 16, 16, '#c8323c'); rect(c, '#dfe9f2', x + 2, y + 2, 9, 9); ['#3a7bd5', '#f2c14e', '#7ac74f', '#e86f6f'].forEach((k, i) => { rect(c, k, x + 3 + (i % 2) * 4, y + 3 + Math.floor(i / 2) * 4, 3, 3); }); rect(c, '#222', x + 12, y + 3, 2, 4); rect(c, '#111', x + 3, y + 12, 9, 2); rect(c, (Math.floor((t || 0) / 700) % 2) ? '#7cf' : '#4ae', x + 12, y + 9, 2, 1); } },
    maquina_comida: { nombre: 'Máquina expendedora de comida', w: 2, h: 2, brillo: true, draw: (c, x, y) => { box(c, x, y, 16, 16, '#2f5fa8'); rect(c, '#dfe9f2', x + 2, y + 2, 9, 10); ['#f29e3d', '#f2d64e', '#d95b5b', '#8b5a3c', '#f29e3d', '#6fb3e8'].forEach((k, i) => rect(c, k, x + 3 + (i % 3) * 3, y + 3 + Math.floor(i / 3) * 4, 2, 3)); rect(c, '#ccd', x + 12, y + 3, 2, 6); rect(c, '#111', x + 3, y + 13, 9, 2); } },
    estante_pan: { nombre: 'Estante de pan dulce', w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 8, '#a8754a'); ['#f3c6a8', '#fff3e0', '#d98c5f', '#f3c6a8'].forEach((k, i) => { rect(c, k, x + 2 + i * 3, y + 2, 3, 3); }); rect(c, '#7a4e2b', x + 1, y + 5, 14, 1); } },
    estante_botanas: { nombre: 'Estante de papas y botanas', w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 8, '#8b8f96'); ['#e8423c', '#f2c14e', '#3a7bd5', '#7ac74f', '#f29e3d'].forEach((k, i) => rect(c, k, x + 2 + i * 2.5, y + 2, 2, 4)); } },
    refrigerador_tienda: { nombre: 'Refrigerador de refrescos', w: 2, h: 1, brillo: true, draw: (c, x, y) => { box(c, x, y, 16, 8, '#e9eef0'); rect(c, '#bfe3f2', x + 2, y + 2, 12, 4); for (let i = 0; i < 5; i++) rect(c, ['#c8323c', '#7a4e2b', '#f29e3d', '#3a7bd5', '#7ac74f'][i], x + 3 + i * 2, y + 3, 1, 3); } },
    mostrador: { nombre: 'Mostrador con caja', superficie: true, w: 3, h: 1, draw: (c, x, y) => { box(c, x, y, 24, 8, '#b8865a'); box(c, x + 15, y + 1, 7, 5, '#555'); rect(c, '#7f7', x + 16, y + 2, 4, 1); } },
    buzones: { nombre: 'Buzones', w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 8, '#9aa3ad'); for (let i = 0; i < 4; i++) rect(c, '#5d6670', x + 2 + i * 3.2, y + 2, 2, 4); } },
    escalera: { nombre: 'Escalera', w: 2, h: 2, draw: (c, x, y) => { box(c, x, y, 16, 16, '#6c6f75'); for (let i = 0; i < 5; i++) rect(c, i % 2 ? '#8b8f96' : '#a2a6ad', x + 1, y + 1 + i * 3, 14, 3); } },
    elevador: { nombre: 'Elevador', w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 8, '#a2a6ad'); rect(c, '#6c6f75', x + 7, y + 1, 1, 6); rect(c, '#ffd98a', x + 13, y + 3, 1, 2); } },
    banca: { nombre: 'Banca', w: 2, h: 1, draw: (c, x, y) => { box(c, x, y + 2, 16, 4, '#8a5a3b'); rect(c, '#555', x + 2, y + 6, 1, 2); rect(c, '#555', x + 13, y + 6, 1, 2); } },
    bote_basura: { nombre: 'Bote de basura', w: 1, h: 1, draw: (c, x, y) => { box(c, x + 2, y + 2, 5, 6, '#4b5a4b'); } },
    dispensador_agua: { nombre: 'Bebedero / garrafón', w: 1, h: 1, draw: (c, x, y) => { box(c, x + 1, y + 3, 6, 5, '#e9eef0'); rect(c, '#7fb2e9', x + 2, y, 4, 4); } },
    // ---- trabajo / hotel ----
    escritorio: { nombre: 'Escritorio', superficie: true, w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 7, '#7a5232'); rect(c, '#f1ece4', x + 2, y + 2, 4, 3); } },
    computadora: { nombre: 'Computadora', w: 1, h: 1, solido: false, capa: 2, brillo: true, draw: (c, x, y) => { box(c, x + 1, y - 2, 6, 5, '#222'); rect(c, '#6cf', x + 2, y - 1, 4, 3); } },
    silla_oficina: { nombre: 'Silla de oficina', w: 1, h: 1, solido: false, draw: (c, x, y) => { box(c, x + 2, y + 1, 5, 5, '#333'); rect(c, '#555', x + 4, y + 6, 1, 2); } },
    archivero: { nombre: 'Archivero', w: 1, h: 1, draw: (c, x, y) => { box(c, x, y, 8, 8, '#8b8f96'); rect(c, '#555', x + 3, y + 2, 2, 1); rect(c, '#555', x + 3, y + 5, 2, 1); } },
    recepcion: { nombre: 'Mostrador de recepción', superficie: true, w: 4, h: 1, draw: (c, x, y) => { box(c, x, y, 32, 8, '#3d5a73'); rect(c, '#d9c48a', x + 1, y + 1, 30, 2); rect(c, '#ffd98a', x + 26, y - 1, 2, 2); } },
    alberca: { nombre: 'Alberca', w: 8, h: 4, redim: { w: [3, 14], h: [2, 6] }, draw: (c, x, y, w, h, t) => { box(c, x, y, w * 8, h * 8, '#3fa9d6', '#e9eef0'); const o = Math.floor((t || 0) / 300) % 4; for (let i = 0; i < w * 8 - 6; i += 6) rect(c, '#8fd6f2', x + 3 + i + o, y + 4 + (i % 12 ? 6 : 0), 3, 1); } },
    camastro: { nombre: 'Camastro', w: 1, h: 2, draw: (c, x, y) => { box(c, x + 1, y, 6, 15, '#f2f2f2'); rect(c, '#2d8f8a', x + 2, y + 1, 4, 5); } },
    sombrilla: { nombre: 'Sombrilla', w: 1, h: 1, solido: false, capa: 2, draw: (c, x, y) => { rect(c, '#e8423c', x - 2, y - 2, 12, 5); rect(c, '#fff', x + 2, y - 2, 4, 5); rect(c, '#555', x + 3, y + 3, 1, 5); } },
    palmera: { nombre: 'Palmera', w: 1, h: 1, draw: (c, x, y) => { rect(c, '#8a5a3b', x + 3, y + 1, 2, 7); rect(c, '#2f7a3f', x - 2, y - 2, 12, 3); rect(c, '#3f9a4f', x + 1, y - 4, 6, 3); } },
    // ---- universidad ----
    pupitre: { nombre: 'Pupitre', w: 1, h: 1, draw: (c, x, y) => { box(c, x + 1, y + 1, 6, 4, '#c9a46a'); rect(c, '#555', x + 2, y + 5, 1, 3); rect(c, '#555', x + 5, y + 5, 1, 3); } },
    pizarron: { nombre: 'Pizarrón', w: 4, h: 1, draw: (c, x, y) => { box(c, x, y, 32, 7, '#2f5a43', '#8a5a3b'); rect(c, '#e8f0e8', x + 4, y + 2, 9, 1); rect(c, '#e8f0e8', x + 4, y + 4, 14, 1); } },
    escritorio_maestro: { nombre: 'Escritorio del maestro', superficie: true, w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 7, '#6b4a30'); rect(c, '#e8423c', x + 10, y + 2, 3, 2); } },
    casilleros: { nombre: 'Casilleros', w: 3, h: 1, draw: (c, x, y) => { box(c, x, y, 24, 8, '#4f6d8a'); for (let i = 1; i < 6; i++) rect(c, '#3a5470', x + i * 4, y + 1, 1, 6); } },
    librero: { nombre: 'Librero', w: 2, h: 1, draw: (c, x, y) => { box(c, x, y, 16, 8, '#6b4a30'); ['#c8323c', '#3a7bd5', '#f2c14e', '#7ac74f', '#9a74c0', '#f29e3d'].forEach((k, i) => rect(c, k, x + 2 + i * 2, y + 2, 1, 4)); } },
    mesa_lectura: { nombre: 'Mesa de lectura', superficie: true, w: 3, h: 2, draw: (c, x, y) => { box(c, x + 1, y + 2, 22, 11, '#a8754a'); rect(c, '#f1ece4', x + 5, y + 5, 4, 3); } },
    arbol: { nombre: 'Árbol', w: 2, h: 2, draw: (c, x, y) => { rect(c, '#6b4a30', x + 7, y + 9, 3, 7); rect(c, '#2f6b3a', x, y, 16, 10); rect(c, '#3f8a4a', x + 3, y + 2, 9, 5); } },
  };
  for (const o of Object.values(OBJ)) { if (o.solido === undefined) o.solido = true; if (o.capa === undefined) o.capa = 1; }

  // Plantillas: áreas completas con cuartos, puertas y muebles de fábrica (coordenadas absolutas en tiles).
  // spots: dónde se para cada personaje en ese cuarto. puertas: [x, y] o [x, y, 'vidrio'].
  const R = (nombre, x, y, w, h, piso, spots, extra) => ({ nombre, x, y, w, h, piso, spots, ...extra });
  const TEMPLATES = {
    departamento: {
      nombre: 'Departamento', zona: 'edificio', descripcion: 'el departamento del jugador (planta 2)', cols: 28, rows: 20,
      cuartos: {
        recamara: R('Recámara', 1, 1, 8, 6, 'madera', { yukiho: [3, 4], jugador: [6, 5] }),
        bano_recamara: R('Baño de la recámara', 10, 1, 4, 6, 'azulejo', { yukiho: [11, 4], jugador: [12, 5] }),
        bano_tina: R('Baño con tina', 15, 1, 5, 6, 'azulejo_azul', { yukiho: [16, 5], jugador: [18, 5] }),
        azotehuela: R('Azotehuela', 21, 1, 6, 6, 'cemento', { yukiho: [23, 4], jugador: [25, 5] }),
        sala: R('Sala-comedor', 1, 8, 19, 6, 'madera_oscura', { yukiho: [5, 9], jugador: [7, 9] }),
        cocina: R('Cocina', 21, 8, 6, 6, 'crema', { yukiho: [23, 11], jugador: [25, 11] }),
        terraza: R('Terraza', 1, 15, 26, 4, 'piedra', { yukiho: [8, 16], jugador: [10, 16] }, { exterior: true }),
      },
      puertas: [[9, 3], [4, 7], [17, 7], [21, 7], [20, 10], [6, 14, 'vidrio'], [7, 14, 'vidrio'], [8, 14, 'vidrio']],
      ventanas: [[4, 0], [5, 0], [11, 0], [17, 0], [24, 0]],
      muroVidrio: { y: 14, x0: 1, x1: 19 },
      muebles: [
        ['cama', 1, 1], ['buro', 3, 1], ['closet', 7, 1], ['tapete', 6, 5],
        ['regadera', 10, 1], ['wc', 13, 1], ['lavabo', 13, 3],
        ['tina', 15, 1], ['wc', 19, 1], ['lavabo', 19, 3], ['toallero', 15, 3],
        ['lavadora', 21, 1], ['lavadero', 23, 1], ['tendedero', 22, 4],
        ['alfombra', 2, 9], ['sofa', 2, 12], ['mesa_centro', 3, 10], ['planta', 1, 8], ['tv', 8, 8],
        ['mesa', 13, 10], ['silla', 12, 10], ['silla', 12, 11], ['silla', 16, 10], ['silla', 16, 11], ['lampara', 19, 8],
        ['cocineta', 22, 8], ['refrigerador', 26, 9], ['tetera', 23, 8],
        ['barandal', 1, 18], ['maceta_flores', 2, 15], ['maceta_flores', 13, 15], ['maceta_flores', 24, 15], ['silla_terraza', 17, 16], ['silla_terraza', 19, 16],
      ],
    },
    planta_baja: {
      nombre: 'Planta baja del edificio', zona: 'edificio', descripcion: 'planta 1, justo debajo del departamento', cols: 28, rows: 14,
      cuartos: {
        vestibulo: R('Vestíbulo', 1, 1, 12, 12, 'marmol', { yukiho: [5, 6], jugador: [7, 6] }),
        maquinas: R('Rincón de máquinas expendedoras', 14, 1, 6, 6, 'azulejo', { yukiho: [15, 4], jugador: [17, 4] }),
        entrada: R('Entrada del edificio', 14, 8, 6, 5, 'piedra', { yukiho: [16, 10], jugador: [17, 10] }, { exterior: true }),
        tiendita: R('Tiendita de pan dulce y botanas', 21, 1, 6, 12, 'crema', { yukiho: [23, 6], jugador: [24, 7] }),
      },
      puertas: [[13, 3], [16, 7], [13, 10, 'vidrio'], [20, 10, 'vidrio'], [20, 3]],
      ventanas: [[24, 0], [5, 0], [6, 0]],
      muebles: [
        ['buzones', 1, 1], ['escalera', 9, 1], ['elevador', 6, 1], ['planta', 1, 11], ['planta', 11, 11], ['banca', 3, 8], ['lampara', 12, 1],
        ['maquina_bebidas', 14, 1], ['maquina_comida', 16, 1], ['bote_basura', 18, 1], ['banca', 18, 5],
        ['maceta_flores', 14, 8], ['maceta_flores', 19, 8],
        ['estante_pan', 21, 1], ['estante_botanas', 23, 1], ['estante_botanas', 25, 1], ['refrigerador_tienda', 25, 5], ['estante_pan', 21, 5], ['mostrador', 22, 10],
      ],
    },
    hotel: {
      nombre: 'Hotel en la zona hotelera', zona: 'zona_hotelera', descripcion: 'el lugar de trabajo del jugador', cols: 30, rows: 20,
      cuartos: {
        lobby: R('Lobby y recepción', 1, 1, 12, 9, 'marmol', { yukiho: [6, 6], jugador: [4, 3] }),
        oficina: R('Oficina del personal', 14, 1, 8, 6, 'alfombra', { yukiho: [18, 4], jugador: [16, 3] }),
        pasillo: R('Pasillo', 14, 8, 8, 2, 'marmol', { yukiho: [16, 8], jugador: [18, 8] }),
        habitacion: R('Habitación de huéspedes', 23, 1, 6, 9, 'alfombra', { yukiho: [26, 7], jugador: [25, 7] }),
        alberca: R('Alberca y playa', 1, 11, 28, 8, 'arena', { yukiho: [15, 14], jugador: [16, 15] }, { exterior: true }),
      },
      puertas: [[13, 8], [17, 7], [22, 8], [6, 10, 'vidrio'], [7, 10, 'vidrio']],
      ventanas: [[4, 0], [8, 0], [17, 0], [25, 0]],
      muebles: [
        ['recepcion', 2, 1], ['planta', 1, 8], ['planta', 11, 8], ['sofa', 7, 4], ['alfombra', 7, 5, { w: 4, h: 2 }], ['lampara', 12, 1],
        ['escritorio', 15, 2], ['computadora', 15, 2], ['silla_oficina', 16, 3], ['escritorio', 19, 2], ['computadora', 20, 2], ['archivero', 21, 1], ['dispensador_agua', 14, 1],
        ['cama_hotel', 24, 1], ['buro', 26, 1], ['tv', 24, 5], ['planta', 28, 9],
        ['alberca', 3, 13, { w: 9, h: 4 }], ['camastro', 15, 12], ['camastro', 17, 12], ['sombrilla', 16, 12], ['palmera', 2, 11], ['palmera', 27, 12], ['palmera', 22, 16],
      ],
    },
    universidad: {
      nombre: 'Universidad de Yukiho', zona: 'zona_universitaria', descripcion: 'la universidad donde estudia Yukiho (19 años)', cols: 30, rows: 20,
      cuartos: {
        salon: R('Aula', 1, 1, 12, 9, 'linoleo', { yukiho: [5, 7], jugador: [11, 4] }),
        pasillo: R('Pasillo de la facultad', 14, 1, 5, 9, 'linoleo', { yukiho: [15, 5], jugador: [17, 5] }),
        biblioteca: R('Biblioteca', 20, 1, 9, 9, 'madera', { yukiho: [22, 8], jugador: [26, 8] }),
        patio: R('Jardín del campus', 1, 11, 28, 8, 'pasto', { yukiho: [12, 14], jugador: [14, 14] }, { exterior: true }),
      },
      puertas: [[13, 4], [19, 4], [16, 10], [6, 10]],
      ventanas: [[3, 0], [9, 0], [23, 0], [26, 0]],
      muebles: [
        ['pizarron', 3, 1], ['escritorio_maestro', 9, 2],
        ['pupitre', 3, 4], ['pupitre', 5, 4], ['pupitre', 7, 4], ['pupitre', 9, 4],
        ['pupitre', 3, 6], ['pupitre', 5, 6], ['pupitre', 7, 6], ['pupitre', 9, 6],
        ['casilleros', 14, 1], ['casilleros', 14, 8], ['dispensador_agua', 18, 1],
        ['librero', 20, 1], ['librero', 23, 1], ['librero', 26, 1], ['mesa_lectura', 22, 4], ['silla', 21, 5], ['silla', 25, 5],
        ['arbol', 3, 12], ['arbol', 24, 12], ['arbol', 19, 16], ['banca', 8, 15], ['banca', 15, 16], ['dispensador_agua', 13, 11],
      ],
    },
  };

  const ZONES = {
    edificio: 'Edificio del departamento', zona_hotelera: 'Zona hotelera', zona_universitaria: 'Zona universitaria',
    centro: 'Centro de Cancún', playa: 'Playa', parque: 'Parque', otra: 'Otra zona',
  };

  const api = { FLOORS, OBJ, TEMPLATES, ZONES, box, rect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MapCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
