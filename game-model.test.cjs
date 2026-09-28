const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { GameSimulation } = require('./game-model.js');
const html = fs.readFileSync('index.html', 'utf8');
const cities = [...html.matchAll(/<g class="(town|capital)" transform="translate\((\d+) (\d+)\)">.*?<text[^>]*>([^<]+)<\/text>/g)].map((m,id) => ({id,capital:m[1]==='capital',x:+m[2],y:+m[3],name:m[4]}));
test('initial health and income', () => {
  const game = new GameSimulation(cities);
  assert.equal(game.settlements.length,11);
  assert.equal(game.income,120);
  for (const city of game.settlements) assert.equal(city.health,city.capital ? 5 : 3);
  game.advance(59999); assert.equal(game.resources,200);
  game.advance(1); assert.equal(game.resources,320);
});
test('all eight approaches select one of the three nearest targets', () => {
  for (let sector=0;sector<8;sector++) {
    for (const roll of [0.1,0.7,0.95]) {
      const values = [sector/8+0.01,0.5,roll,0.99,0.5];
      const game = new GameSimulation(cities, () => values.shift());
      const raid = game.spawnRaid();
      assert.equal(raid.direction,['N','NE','E','SE','S','SW','W','NW'][sector]);
      assert.equal(raid.count,5);
      const nearest = game.settlements.slice().sort((a,b) => Math.hypot(a.x-raid.origin.x,a.y-raid.origin.y)-Math.hypot(b.x-raid.origin.x,b.y-raid.origin.y)).slice(0,3);
      assert.ok(nearest.includes(raid.target));
      assert.ok(raid.origin.x>=23.99 && raid.origin.x<=976.01 && raid.origin.y>=23.99 && raid.origin.y<=736.01);
    }
  }
});
test('each impact removes one health and completed raids disappear', () => {
  const game = new GameSimulation(cities, () => 0.5);
  const raid = game.spawnRaid(3);
  const initial = raid.target.health;
  game.advance(raid.units[0].impactAt-1); assert.equal(raid.target.health,initial);
  game.advance(1); assert.equal(raid.target.health,initial-1);
  game.advance(2400); assert.equal(raid.target.health,Math.max(0,initial-3));
  assert.equal(game.raids.length,0);
});
test('health clamps at zero and destroyed towns stop income and targeting', () => {
  const game = new GameSimulation([{id:0,name:'Test',x:500,y:400}], () => 0.5);
  const raid = game.spawnRaid(12);
  game.advance(60000);
  assert.equal(raid.target.health,0);
  assert.equal(game.income,0);
  assert.equal(game.spawnRaid(),null);
  assert.equal(game.raids.length,0);
});
test('large time steps match small steps across payouts and impacts', () => {
  const a = new GameSimulation(cities, () => 0.5), b = new GameSimulation(cities, () => 0.5);
  a.spawnRaid(5); b.spawnRaid(5);
  a.advance(120000);
  for(let i=0;i<1200;i++) b.advance(100);
  assert.equal(a.resources,b.resources);
  assert.equal(a.morale,b.morale);
  assert.deepEqual(a.settlements,b.settlements);
});
test('invalid UAV counts rejected', () => {
  const game = new GameSimulation(cities);
  for(const n of [0,-1,1.5,13,NaN]) assert.throws(() => game.spawnRaid(n),RangeError);
});
test('warning lasts 20–40 seconds before any UAV launch', () => {
  for (const random of [0, 0.999999]) {
    const game = new GameSimulation(cities, () => random);
    const raid = game.spawnRaid(1);
    assert.equal(raid.warningSeconds, random === 0 ? 20 : 40);
    assert.equal(raid.units[0].launchAt, raid.attackAt);
    game.advance(raid.attackAt - 1);
    assert.ok(game.time < raid.units[0].launchAt);
    assert.equal(raid.target.health, raid.target.maxHealth);
    game.advance(1);
    assert.equal(game.time, raid.units[0].launchAt);
    assert.ok(raid.units[0].impactAt > game.time);
  }
});
test('rapid spawning is bounded for pending and active raids', () => {
  const game = new GameSimulation(cities, () => 0.5);
  for (let i=0;i<10000;i++) game.spawnRaid(12);
  assert.equal(game.activeUnitCount,192);
  assert.equal(game.raids.length,16);
  assert.match(game.spawnError,/limit/);
  const small = new GameSimulation(cities, () => 0.5);
  for (let i=0;i<100;i++) small.spawnRaid(1);
  assert.equal(small.raids.length,24);
  small.advance(120000);
  assert.equal(small.activeUnitCount,0);
  assert.ok(small.spawnRaid(1));
});
test('impacts at a payout timestamp resolve first', () => {
  const game = new GameSimulation([{id:0,name:'Test',x:500,y:400}], () => 0.5);
  const raid=game.spawnRaid(3);
  raid.units.forEach(unit => unit.impactAt=60000);
  game.advance(60000);
  assert.equal(game.resources,200);
  assert.equal(game.nextIncome,120000);
});
test('long idle catch-up batches payouts', () => {
  const game = new GameSimulation(cities);
  game.advance(86400000);
  assert.equal(game.resources,200+1440*120);
});
test('morale falls on every impact and recovers once per minute up to ten', () => {
  const game = new GameSimulation([{id:0,name:'Test',x:500,y:400}], () => 0.5);
  const raid = game.spawnRaid(3);
  raid.units.forEach(unit => unit.impactAt = 60000);
  game.advance(60000);
  assert.equal(game.morale, 8);
  game.advance(120000);
  assert.equal(game.morale, 10);
  game.advance(600000);
  assert.equal(game.morale, 10);
});
test('radar placement spends resources and records coverage', () => {
  const game = new GameSimulation(cities);
  assert.equal(game.isWithinRadar(500, 400), false);
  assert.equal(game.placeRadar(500, 400), true);
  assert.equal(game.isWithinRadar(500, 400), true);
  assert.equal(game.isWithinRadar(620, 400), true);
  assert.equal(game.isWithinRadar(621, 400), false);
  assert.equal(game.isWithinRadar(614, 400, 6), true);
  assert.equal(game.isWithinRadar(615, 400, 6), false);
  assert.equal(game.placeRadar(600, 400), true);
  assert.equal(game.isWithinRadar(621, 400), true);
  assert.equal(game.placeRadar(700, 400), false);
  assert.equal(game.resources, 0);
  assert.deepEqual(game.radars.map(({x,y,radius,health})=>({x,y,radius,health})), [{x:500,y:400,radius:120,health:1},{x:600,y:400,radius:120,health:1}]);
});
test('a UAV can destroy a one-health radar and create an impact event', () => {
  const game = new GameSimulation([{id:0,name:'Test',x:500,y:400}], () => 0);
  game.placeRadar(500,300);
  const radar = game.radars[0];
  const raid = game.spawnRaid(1);
  assert.equal(raid.target, radar);
  game.advance(raid.units[0].impactAt);
  assert.equal(radar.health, 0);
  assert.equal(game.morale, 9);
  assert.equal(game.isWithinRadar(500,300), false);
  assert.deepEqual(game.events.map(event=>event.type), ['impact']);
});
test('a SAM site intercepts three UAVs, then reloads one per minute', () => {
  const game = new GameSimulation([{id:0,name:'Test',x:500,y:400}], () => 0);
  assert.equal(game.placeSam(500,300), true);
  const site = game.samSites[0];
  const raid = game.spawnRaid(3);
  assert.equal(raid.target, site);
  game.advance(60000);
  assert.equal(site.health, 1);
  assert.equal(site.ammo, 1);
  assert.equal(game.morale, 10);
  assert.deepEqual(game.events.map(event=>event.type), ['intercept','intercept','intercept']);
  game.spawnRaid(1);
  game.advance(60000);
  assert.equal(site.ammo, 1);
  assert.equal(site.health, 1);
  assert.equal(game.events.filter(event=>event.type==='intercept').length, 4);
});
test('SAM salvos have only three ready interceptors', () => {
  const game = new GameSimulation([{id:0,name:'Test',x:500,y:400}], () => 0);
  game.placeSam(500,300);
  game.spawnRaid(4);
  game.advance(50000);
  assert.equal(game.events.filter(event=>event.type==='intercept').length, 3);
  assert.equal(game.events.filter(event=>event.type==='impact').length, 1);
  assert.equal(game.samSites[0].health, 0);
  assert.equal(game.morale, 9);
});
test('SAM combat is consistent across large and small time steps', () => {
  const make = () => {
    const game = new GameSimulation([{id:0,name:'Test',x:500,y:400}], () => 0);
    game.placeSam(500,300);
    game.spawnRaid(4);
    return game;
  };
  const large = make(), small = make();
  large.advance(120000);
  for (let i=0;i<1200;i++) small.advance(100);
  assert.equal(large.morale,small.morale);
  assert.equal(large.resources,small.resources);
  assert.deepEqual(large.samSites,small.samSites);
  assert.deepEqual(large.events,small.events);
});
