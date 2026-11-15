// node --test tests/map-actions.test.js tests/life-routine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const MA = require('../assets/apartment/map-actions.js');
const CAT = require('../assets/apartment/map-catalog.js');

const reachableAll = (a) => {
  // every room spot is reachable from the first door
  const ok = (x, y) => a.grid[y] && a.grid[y][x] && a.grid[y][x] !== 'wall' && !a.blocked.has(`${x},${y}`);
  const seen = new Set([`${a.doors[0][0]},${a.doors[0][1]}`]); const q = [a.doors[0]];
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = `${x + dx},${y + dy}`; if (!seen.has(k) && ok(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } } }
  return Object.values(a.rooms).every((r) => Object.values(r.spots).every(([x, y]) => seen.has(`${x},${y}`)));
};

test('every template is consistent: furniture inside rooms, spots free and reachable', () => {
  for (const id of Object.keys(CAT.TEMPLATES)) {
    let w = MA.emptyWorld();
    if (id !== MA.HOME) w = MA.applyActions(w, [{ accion: 'crear_area', plantilla: id }]).world;
    const a = MA.geometry(w, id);
    for (const it of a.items) {
      const inside = Object.values(a.rooms).some((r) => it.x >= r.x && it.y >= r.y && it.x + it.w <= r.x + r.w && it.y + it.h <= r.y + r.h);
      assert.ok(inside, `${id}: ${it.objeto} at ${it.x},${it.y} outside rooms`);
    }
    for (const [x, y] of a.doors) assert.equal(a.grid[y][x], 'door', `${id}: door ${x},${y}`);
    for (const r of Object.values(a.rooms)) for (const [x, y] of Object.values(r.spots)) assert.ok(!a.blocked.has(`${x},${y}`), `${id}: spot ${x},${y} blocked`);
    assert.ok(reachableAll(a), `${id}: some spot unreachable`);
  }
});

test('creates the three requested areas from templates', () => {
  const { world, log } = MA.applyActions(MA.emptyWorld(), [
    { accion: 'crear_area', plantilla: 'planta_baja' },
    { accion: 'crear_area', plantilla: 'hotel', nombre: 'Hotel Marea Azul' },
    { accion: 'crear_area', plantilla: 'universidad' },
  ]);
  assert.deepEqual(log.map((l) => l.ok), [true, true, true]);
  assert.deepEqual(world.areas.map((a) => a.id), ['planta_baja', 'hotel', 'universidad']);
  assert.equal(world.areas[1].nombre, 'Hotel Marea Azul');
  assert.equal(world.areas[1].zona, 'zona_hotelera');
  const pb = MA.geometry(world, 'planta_baja');
  const ids = pb.items.map((i) => i.objeto);
  for (const need of ['maquina_bebidas', 'maquina_comida', 'estante_pan', 'estante_botanas']) assert.ok(ids.includes(need), need);
});

test('creating an existing area is a harmless no-op', () => {
  const w1 = MA.applyActions(MA.emptyWorld(), [{ accion: 'crear_area', plantilla: 'hotel' }]).world;
  const { world, log } = MA.applyActions(w1, [{ accion: 'crear_area', plantilla: 'hotel' }]);
  assert.equal(world.areas.length, 1);
  assert.equal(log[0].ok, true);
});

test('places furniture in a free spot and never on a door or a character spot', () => {
  const { world, log } = MA.applyActions(MA.emptyWorld(), [{ accion: 'colocar', objeto: 'librero', donde: 'sala' }]);
  assert.equal(log[0].ok, true, log[0].texto);
  const it = world.objetos[0];
  assert.equal(it.area, 'departamento'); assert.equal(it.cuarto, 'sala');
  const a = MA.geometry(world, 'departamento');
  assert.ok(reachableAll(a));
});

test('solid furniture never sits right in front of a door', () => {
  const w0 = MA.applyActions(MA.emptyWorld(), [{ accion: 'crear_area', plantilla: 'planta_baja' }]).world;
  const { world } = MA.applyActions(w0, [{ accion: 'colocar', objeto: 'banca', donde: 'planta_baja.maquinas' }, { accion: 'colocar', objeto: 'banca', donde: 'planta_baja.maquinas', x: 0, y: 2 }]);
  const a = MA.geometry(world, 'planta_baja');
  const nearDoor = new Set(a.doors.flatMap(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([ox, oy]) => `${x + ox},${y + oy}`)));
  for (const o of world.objetos) for (let i = o.x; i < o.x + o.w; i++) assert.ok(!nearDoor.has(`${i},${o.y}`), `banca at ${o.x},${o.y}`);
});

test('explicit x,y is relative to the room, and falls back to a free spot when occupied', () => {
  const w = MA.applyActions(MA.emptyWorld(), [{ accion: 'colocar', objeto: 'planta', donde: 'cocina', x: 1, y: 4 }]).world;
  assert.deepEqual([w.objetos[0].x, w.objetos[0].y], [22, 12]);
  const w2 = MA.applyActions(w, [{ accion: 'colocar', objeto: 'planta', donde: 'cocina', x: 1, y: 4 }]).world;
  assert.notDeepEqual([w2.objetos[1].x, w2.objetos[1].y], [22, 12]);
});

test('"encima" objects go on top of furniture in the room', () => {
  const w = MA.applyActions(MA.emptyWorld(), [{ accion: 'colocar', objeto: 'escritorio', donde: 'recamara' }, { accion: 'colocar', objeto: 'computadora', donde: 'recamara' }]).world;
  const desk = MA.geometry(w, 'departamento').items.filter((i) => i.x >= 1 && i.y >= 1 && i.x < 9 && i.y < 7 && i.objeto === 'escritorio');
  const pc = w.objetos[1];
  assert.ok(desk.some((d) => d.x === pc.x && d.y === pc.y), `pc at ${pc.x},${pc.y}`);
});

test('placing in a template area that does not exist yet creates it', () => {
  const { world, log } = MA.applyActions(MA.emptyWorld(), [{ accion: 'colocar', objeto: 'computadora', donde: 'hotel.oficina' }]);
  assert.equal(log[0].ok, true, log[0].texto);
  assert.equal(world.areas[0].id, 'hotel');
  assert.match(log[0].texto, /nueva área/);
});

test('custom areas lay out rooms with connecting doors', () => {
  const { world, log } = MA.applyActions(MA.emptyWorld(), [{
    accion: 'crear_area', plantilla: 'personalizada', id: 'cafeteria', nombre: 'Cafetería <b>Luna</b>', zona: 'centro',
    cuartos: [{ id: 'barra', nombre: 'Barra', piso: 'madera', ancho: 12, alto: 5 }, { id: 'mesas', ancho: 12, alto: 6 }, { id: 'terraza', ancho: 10, alto: 4, exterior: true, piso: 'piedra' }],
  }]);
  assert.equal(log[0].ok, true, log[0].texto);
  assert.equal(world.areas[0].nombre, 'Cafetería bLuna/b');
  const a = MA.geometry(world, 'cafeteria');
  assert.equal(Object.keys(a.rooms).length, 3);
  assert.ok(reachableAll(a));
});

test('rejects unknown objects, templates, places and actions without stopping the rest', () => {
  const { world, log } = MA.applyActions(MA.emptyWorld(), [
    { accion: 'colocar', objeto: 'cohete', donde: 'sala' },
    { accion: 'crear_area', plantilla: 'castillo' },
    { accion: 'colocar', objeto: 'planta', donde: 'luna.crater' },
    { accion: 'borrar_todo' },
    'texto',
    { accion: 'colocar', objeto: 'planta', donde: 'terraza' },
  ]);
  assert.deepEqual(log.map((l) => l.ok), [false, false, false, false, false, true]);
  assert.equal(world.objetos.length, 1);
});

test('caps actions per turn', () => {
  const many = Array.from({ length: 20 }, () => ({ accion: 'colocar', objeto: 'planta', donde: 'terraza' }));
  const { world, log } = MA.applyActions(MA.emptyWorld(), many);
  assert.equal(world.objetos.length, MA.LIMITS.MAX_ACTIONS);
  assert.equal(log[log.length - 1].ok, false);
});

test('quitar removes placed objects first, then built-in furniture', () => {
  let w = MA.applyActions(MA.emptyWorld(), [{ accion: 'colocar', objeto: 'tv', donde: 'recamara' }]).world;
  w = MA.applyActions(w, [{ accion: 'quitar', objeto: 'tv', donde: 'recamara' }]).world;
  assert.equal(w.objetos.length, 0);
  const r = MA.applyActions(w, [{ accion: 'quitar', objeto: 'tv', donde: 'sala' }]);
  assert.equal(r.log[0].ok, true);
  assert.ok(!MA.geometry(r.world, 'departamento').items.some((i) => i.objeto === 'tv'));
  assert.equal(MA.applyActions(r.world, [{ accion: 'quitar', objeto: 'tv', donde: 'sala' }]).log[0].ok, false);
});

test('does not mutate the input world', () => {
  const w = MA.emptyWorld();
  const snap = JSON.stringify(w);
  MA.applyActions(w, [{ accion: 'crear_area', plantilla: 'hotel' }, { accion: 'colocar', objeto: 'planta', donde: 'sala' }]);
  assert.equal(JSON.stringify(w), snap);
});

test('resolvePlace understands the forms the model uses', () => {
  const w = MA.applyActions(MA.emptyWorld(), [{ accion: 'crear_area', plantilla: 'planta_baja' }]).world;
  assert.equal(MA.resolvePlace(w, 'sala').key, 'sala');
  assert.equal(MA.resolvePlace(w, 'planta_baja.maquinas').key, 'planta_baja.maquinas');
  assert.equal(MA.resolvePlace(w, 'Planta baja/Tiendita').key, 'planta_baja.tiendita');
  assert.equal(MA.resolvePlace(w, 'maquinas').key, 'planta_baja.maquinas');
  assert.equal(MA.resolvePlace(w, 'planta_1').key, 'planta_baja.vestibulo');
  const h = MA.resolvePlace(w, 'hotel.oficina');
  assert.equal(h.key, 'hotel.oficina'); assert.equal(h.falta, 'hotel');
  assert.equal(MA.resolvePlace(w, 'marte'), null);
  assert.equal(MA.resolvePlace(w, 'terrace').key, 'terraza');
  assert.equal(MA.resolvePlace(w, 'Baño').key, 'bano_tina');
});

test('salvageMapa recovers actions from broken JSON', () => {
  const raw = '{"narration":"x", "mapa": [{"accion":"crear_area","plantilla":"hotel"}, {"accion":"colocar","objeto":"planta","donde":"sala"}], "options": [';
  assert.equal(MA.salvageMapa(raw).length, 2);
  const broken = '"mapa": [{"accion":"crear_area","plantilla":"hotel"}, {"accion":"colocar", objeto:planta}';
  assert.equal(MA.salvageMapa(broken).length, 1);
  assert.deepEqual(MA.salvageMapa('{"narration":"sin mapa"}'), []);
});

test('sanitizeWorld drops tampered saves', () => {
  assert.deepEqual(MA.sanitizeWorld(null), MA.emptyWorld());
  const w = MA.sanitizeWorld({ v: 1, areas: [{ id: 'X Y', plantilla: 'hotel' }, { id: 'hotel', plantilla: 'hotel' }], objetos: [{ objeto: 'bomba' }], quitados: [1, 'departamento#3'] });
  assert.equal(w.areas.length, 1); assert.equal(w.objetos.length, 0); assert.deepEqual(w.quitados, ['departamento#3']);
});

test('prompt lists catalog ids, current areas and pending templates', () => {
  const w = MA.applyActions(MA.emptyWorld(), [{ accion: 'crear_area', plantilla: 'hotel' }]).world;
  const p = MA.promptText(w);
  assert.match(p, /maquina_bebidas/);
  assert.match(p, /hotel\.oficina/);
  assert.match(p, /planta_baja \(/);
  assert.doesNotMatch(p, /Plantillas aún sin crear:[^\n]*hotel \(/);
});

test('real model output: template zone is fixed and invented rooms fall back to the area just created', () => {
  const { world, log } = MA.applyActions(MA.emptyWorld(), [
    { accion: 'crear_area', plantilla: 'planta_baja', nombre: 'Planta Baja: Tiendas de la zona', zona: 'zona_hotelera', cuartos: [{ id: 'tiendas', ancho: 10, alto: 8 }] },
    { accion: 'colocar', objeto: 'maquina_bebidas', donde: 'tiendas', x: 2, y: 3 },
    { accion: 'colocar', objeto: 'estante_pan', donde: 'tiendas' },
  ]);
  assert.deepEqual(log.map((l) => l.ok), [true, true, true], JSON.stringify(log));
  assert.equal(world.areas[0].zona, 'edificio');
  assert.ok(world.objetos.every((o) => o.area === 'planta_baja' && o.cuarto === 'tiendita'));
  assert.equal(MA.applyActions(MA.emptyWorld(), [{ accion: 'colocar', objeto: 'planta', donde: 'tiendas' }]).log[0].ok, false);
});

test('old saves: the school area becomes the university without breaking places', () => {
  const w = MA.sanitizeWorld({ v: 1, seq: 0, areas: [{ id: 'escuela', plantilla: 'escuela', nombre: 'Escuela de Yukiho', zona: 'zona_escolar' }], objetos: [], quitados: [] });
  assert.deepEqual(w.areas[0], { id: 'escuela', plantilla: 'universidad', nombre: 'Universidad de Yukiho', zona: 'zona_universitaria' });
  assert.equal(MA.resolvePlace(w, 'escuela.salon').key, 'escuela.salon');
  assert.equal(MA.geometry(w, 'escuela').rooms.salon.nombre, 'Aula');
  assert.equal(MA.resolvePlace(MA.emptyWorld(), 'escuela.salon').key, 'universidad.salon');
  assert.equal(MA.resolvePlace(w, 'universidad.biblioteca').key, 'escuela.biblioteca');
  assert.equal(MA.resolvePlace(w, 'universidad').key, 'escuela.salon');
});

test('privacidad closes and reopens a curtain on a known room only', () => {
  let r = MA.applyActions(MA.emptyWorld(), [{ accion: 'privacidad', donde: 'recamara' }, { accion: 'privacidad', donde: 'marte' }]);
  assert.deepEqual(r.log.map((l) => l.ok), [true, false]);
  assert.deepEqual(r.world.privados, ['recamara']);
  r = MA.applyActions(r.world, [{ accion: 'privacidad', donde: 'recamara', activa: false }]);
  assert.deepEqual(r.world.privados, []);
});
