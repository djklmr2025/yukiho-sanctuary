// node --test tests/map-actions.test.js tests/life-routine.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const LR = require('../assets/apartment/life-routine.js');
const MA = require('../assets/apartment/map-actions.js');

test('every hour of the day has a valid place for both characters, even in a brand-new world', () => {
  const w = MA.emptyWorld();
  for (let h = 0; h < 24; h += 0.5) for (const who of ['yukiho', 'jugador']) {
    const r = LR.routineFor(w, who, h);
    assert.ok(r && MA.resolvePlace(w, r.key) && !MA.resolvePlace(w, r.key).falta, `${who} at ${h}`);
  }
});

test('routine never creates areas: university and hotel are used only once the story created them', () => {
  const empty = MA.emptyWorld();
  assert.equal(LR.routineFor(empty, 'yukiho', 10).key, 'sala');
  assert.equal(LR.routineFor(empty, 'jugador', 10).key, 'sala');
  const w = MA.applyActions(empty, [{ accion: 'crear_area', plantilla: 'universidad' }, { accion: 'crear_area', plantilla: 'hotel' }, { accion: 'crear_area', plantilla: 'planta_baja' }]).world;
  assert.equal(LR.routineFor(w, 'yukiho', 10).key, 'universidad.salon');
  assert.equal(LR.routineFor(w, 'jugador', 10).key, 'hotel.oficina');
  assert.equal(LR.routineFor(w, 'yukiho', 16.5).key, 'planta_baja.tiendita');
  assert.deepEqual(empty, MA.emptyWorld());
});

test('slots are stable inside a time range and change at its boundaries', () => {
  const w = MA.emptyWorld();
  assert.equal(LR.routineFor(w, 'yukiho', 19.1).slot, LR.routineFor(w, 'yukiho', 20.9).slot);
  assert.notEqual(LR.routineFor(w, 'yukiho', 20.9).slot, LR.routineFor(w, 'yukiho', 21.0).slot);
});

test('hourIn uses Cancun time', () => {
  assert.equal(LR.hourIn(new Date('2026-11-11T15:30:00Z')), 10.5);
});

test('scene prompts keep the adult look and skip bathrooms and private moments', () => {
  const p = LR.scenePrompt({ key: 'cocina', en: 'cooking ramen', hour: 20 });
  assert.match(p, /young woman in her early twenties/);
  assert.match(p, /^2D anime illustration, cel shading, wide shot of a small warm apartment kitchen/);
  assert.doesNotMatch(p, /Yukiho|adult|clothed|nude|sexy/i);
  assert.doesNotMatch(p, /school|uniform|student|Japanese|TV anime/i);
  assert.match(p, /night/);
  assert.equal(LR.scenePrompt({ key: 'bano_tina', en: 'x', hour: 9 }), null);
  assert.equal(LR.scenePrompt({ key: 'recamara', en: 'x', hour: 23 }), null);
  assert.equal(LR.scenePrompt({ key: 'hotel.habitacion', en: 'x', hour: 12 }), null);
  assert.equal(LR.scenePrompt({ key: 'sala', en: 'x', hour: 23, private: true }), null);
  assert.match(LR.scenePrompt({ key: 'cafeteria.barra', placeName: 'Barra (Cafetería)', en: 'x', hour: 9 }), /Barra \(Cafetería\)/);
});

test('scene urls are deterministic per seed text', () => {
  const p = LR.scenePrompt({ key: 'sala', en: 'reading', hour: 22 });
  assert.equal(LR.sceneUrl(p, 'a'), LR.sceneUrl(p, 'a'));
  assert.notEqual(LR.sceneUrl(p, 'a'), LR.sceneUrl(p, 'b'));
  assert.match(LR.sceneUrl(p, 'a'), /^https:\/\/image\.pollinations\.ai\/prompt\//);
});
